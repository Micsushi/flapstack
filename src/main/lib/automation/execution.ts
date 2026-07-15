import type Database from "better-sqlite3"
import { openAppDatabase } from "../db/access"
import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { isAbsolute, relative } from "node:path"
import { drizzle } from "drizzle-orm/better-sqlite3"
import {
  automationActionSchema,
  automationBudgetSchema,
  automationRetryPolicySchema,
  automationRunConfigSchema,
  type AutomationAction,
  type AutomationBudget,
  type AutomationRetryPolicy,
  type AutomationRunConfig,
} from "../../../shared/automation"
import type { AgentHarness } from "../../../shared/harness-types"
import {
  AgentOrchestrationError,
  createAgentOrchestrationService,
} from "../agent-orchestration/service"
import type { AgentRunLauncher, QueuedAgentRun } from "../run-launch-service"
import * as dbSchema from "../db/schema"
import {
  UsageBudgetExceededError,
  assertUsageBudgetAllowsLaunch,
  providerForHarness,
  resolveUsageBudgetContextForRun,
  resolveUsageBudgets,
} from "../usage/budgets"
import {
  resolveAutomationTarget,
  type AutomationTargetReference,
  type ResolvedAutomationTarget,
} from "./targets"
import type { LeasedAutomationOccurrence } from "./scheduler"

type Sqlite = Database.Database
type Row = Record<string, unknown>

const SUPPORTED_AUTOMATION_HARNESSES = new Set<AgentHarness>([
  "codex",
  "claude-code",
  "cursor-agent",
  "openrouter",
  "nanogpt",
])
const TERMINAL_EXECUTION_STATES = new Set([
  "succeeded",
  "failed",
  "denied",
  "cancelled",
  "timed-out",
])

export type AutomationExecutionErrorCode =
  | "approval-denied"
  | "stale-target"
  | "permission-denied"
  | "worktree-unavailable"
  | "unsupported-harness"
  | "invalid-lease"
  | "concurrency-limit"
  | "usage-budget-exhausted"

export class AutomationExecutionError extends Error {
  constructor(
    readonly code: AutomationExecutionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "AutomationExecutionError"
  }
}

export type AutomationExecutionPreview = {
  automationId: string
  occurrenceId: string | null
  launchKind: "run" | "orchestration"
  prompt: string
  harness: AgentHarness
  model: string | null
  target: {
    scopeType: string
    projectId: string | null
    taskId: string | null
    chatId: string | null
    subChatId: string | null
  }
  authoritySnapshot: Record<string, unknown>
  worktreeSnapshot: {
    strategy: AutomationRunConfig["worktreeStrategy"]
    path: string | null
    projectPath: string | null
    source: "chat" | "task-primary" | "project" | "explicit" | "none"
  }
  budget: AutomationBudget
  retry: AutomationRetryPolicy
  launchable: boolean
  launchBlocker: string | null
}

export type AutomationExecutionOutcome = {
  occurrenceId: string
  executionId: string | null
  runId: string | null
  attempt: number
  state: "succeeded" | "failed" | "denied" | "cancelled" | "timed-out" | "deferred"
  stopReason: string | null
  retryScheduledAt: number | null
  resultSummary: Record<string, unknown>
}

export type AutomationExecutionServiceOptions = {
  launch?: AgentRunLauncher
  cancel?: (run: QueuedAgentRun) => void | Promise<void>
  now?: () => number
  createId?: () => string
  pollIntervalMs?: number
  sleep?: (delayMs: number) => Promise<void>
  beforeConcurrencyClaim?: () => void | Promise<void>
}

type ExecutionPlan = {
  id: string
  name: string
  scope: AutomationTargetReference
  action: AutomationAction
  run: AutomationRunConfig
  retry: AutomationRetryPolicy
  budget: AutomationBudget
  approval: {
    state: string
    approvedBy: string | null
    approvedAt: number | null
    auditId: string | null
    enabled: boolean
    automationState: string
    version: number
  }
}

type PreparedExecution = {
  plan: ExecutionPlan
  target: ResolvedAutomationTarget
  preview: AutomationExecutionPreview
}

type MaterializedRun = {
  run: QueuedAgentRun
  launchKind: "run" | "orchestration"
  orchestrationTaskId: string | null
}

type LaunchResult =
  | { kind: "completed" }
  | { kind: "crashed"; error: string }
  | { kind: "cancelled"; reason: string }
  | {
      kind: "budget"
      reason: "token-budget" | "cost-budget" | "time-budget" | "scoped-usage-budget"
    }

export class AutomationExecutionService {
  private readonly now: () => number
  private readonly createId: () => string
  private readonly pollIntervalMs: number
  private readonly sleep: (delayMs: number) => Promise<void>

  constructor(
    private readonly databasePath: string,
    private readonly options: AutomationExecutionServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.createId = options.createId ?? randomUUID
    this.pollIntervalMs = Math.max(10, options.pollIntervalMs ?? 500)
    this.sleep =
      options.sleep ??
      ((delayMs) =>
        new Promise((resolve) => {
          const timer = setTimeout(resolve, delayMs)
          timer.unref?.()
        }))
  }

  dryRun(automationId: string, occurrenceId: string | null = null): AutomationExecutionPreview {
    return this.withDatabase(
      (database) => this.prepare(database, automationId, occurrenceId).preview,
    )
  }

  async execute(occurrence: LeasedAutomationOccurrence): Promise<AutomationExecutionOutcome> {
    if (!this.options.launch) throw new Error("Automation execution has no run launcher.")

    let prepared: PreparedExecution
    try {
      prepared = this.withDatabase((database) => {
        this.requireLease(database, occurrence)
        return this.prepare(database, occurrence.automationId, occurrence.id)
      })
    } catch (error) {
      if (!(error instanceof AutomationExecutionError)) throw error
      if (error.code === "invalid-lease") throw error
      return this.recordPreflightDenial(occurrence, error)
    }

    await this.options.beforeConcurrencyClaim?.()
    const claim = this.withDatabase((database) =>
      this.claimExecution(database, occurrence, prepared),
    )
    if (claim.kind === "deferred") return claim.outcome
    const started = claim
    let materialized: MaterializedRun
    try {
      materialized = this.materializeRun(occurrence, started.attempt, prepared)
      this.withDatabase((database) => {
        database
          .prepare("UPDATE automation_executions SET run_id = ? WHERE id = ? AND state = 'running'")
          .run(materialized.run.runId, started.executionId)
      })
    } catch (error) {
      const failure = materializationError(error)
      return this.finalize(
        occurrence,
        started.executionId,
        started.attempt,
        null,
        prepared,
        failure.code === "permission-denied" ? "denied" : "failed",
        failure.code,
        failure.message,
      )
    }

    const launch = await this.monitorLaunch(
      occurrence,
      started.executionId,
      started.firstAttemptAt,
      materialized.run,
      prepared.plan.budget,
    )
    if (launch.kind === "cancelled") {
      return this.currentOutcome(occurrence.id, started.executionId)
    }
    if (launch.kind === "crashed") {
      this.markRunTerminal(materialized.run, "failure")
      this.reconcileOrchestration(materialized)
      return this.finalize(
        occurrence,
        started.executionId,
        started.attempt,
        materialized,
        prepared,
        "failed",
        "launch-crash",
        launch.error,
      )
    }
    if (launch.kind === "budget") {
      this.markRunTerminal(materialized.run, "cancelled")
      this.reconcileOrchestration(materialized)
      return this.finalize(
        occurrence,
        started.executionId,
        started.attempt,
        materialized,
        prepared,
        launch.reason === "time-budget" ? "timed-out" : "failed",
        launch.reason,
        `Automation stopped at its ${launch.reason.replaceAll("-", " ")}.`,
        false,
      )
    }

    const runStatus = this.runStatus(materialized.run.runId)
    if (runStatus === "cancelled") {
      this.reconcileOrchestration(materialized)
      return this.finalize(
        occurrence,
        started.executionId,
        started.attempt,
        materialized,
        prepared,
        "cancelled",
        "run-cancelled",
        "The normal run path reported cancellation.",
        false,
      )
    }
    if (runStatus === "failure") {
      this.reconcileOrchestration(materialized)
      return this.finalize(
        occurrence,
        started.executionId,
        started.attempt,
        materialized,
        prepared,
        "failed",
        "run-failed",
        "The normal run path reported failure.",
      )
    }
    this.markRunTerminal(materialized.run, "success")
    this.reconcileOrchestration(materialized)
    return this.finalize(
      occurrence,
      started.executionId,
      started.attempt,
      materialized,
      prepared,
      "succeeded",
      null,
      "Automation run completed through the normal Flapstack launch path.",
      false,
    )
  }

  pause(automationId: string): boolean {
    return this.withDatabase((database) => {
      const changed = database
        .prepare(
          `UPDATE automations SET enabled = 0, state = 'paused', version = version + 1, updated_at = ?
           WHERE id = ? AND enabled = 1 AND state = 'active' AND archived_at IS NULL`,
        )
        .run(this.now(), automationId)
      return changed.changes === 1
    })
  }

  resume(automationId: string): boolean {
    return this.withDatabase((database) => {
      const changed = database
        .prepare(
          `UPDATE automations SET enabled = 1, state = 'active', version = version + 1, updated_at = ?
           WHERE id = ? AND enabled = 0 AND state = 'paused' AND approval_state = 'approved'
             AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND archived_at IS NULL`,
        )
        .run(this.now(), automationId)
      return changed.changes === 1
    })
  }

  async kill(occurrenceId: string): Promise<boolean> {
    const killed = this.withDatabase((database) => {
      const row = database
        .prepare(
          `SELECT o.automation_id, o.state occurrence_state, e.id execution_id, e.run_id
           FROM automation_occurrences o
           LEFT JOIN automation_executions e ON e.occurrence_id = o.id
             AND e.attempt = (SELECT MAX(attempt) FROM automation_executions WHERE occurrence_id = o.id)
           WHERE o.id = ?`,
        )
        .get(occurrenceId) as Row | undefined
      if (!row || ["completed", "cancelled", "skipped"].includes(String(row.occurrence_state))) {
        return { changed: false, run: null as QueuedAgentRun | null }
      }
      const now = this.now()
      const run = row.run_id ? queuedRunById(database, String(row.run_id)) : null
      const transaction = database.transaction(() => {
        database
          .prepare(
            "UPDATE automation_occurrences SET state = 'cancelled', terminal_at = ? WHERE id = ?",
          )
          .run(now, occurrenceId)
        database
          .prepare(
            `UPDATE automation_executions
             SET state = 'cancelled', stop_reason = 'killed', completed_at = ?
             WHERE occurrence_id = ? AND state IN ('pending','running')`,
          )
          .run(now, occurrenceId)
        if (row.run_id) cancelRunRows(database, String(row.run_id), now)
        database.prepare("DELETE FROM automation_leases WHERE occurrence_id = ?").run(occurrenceId)
        insertInbox(database, {
          id: this.createId(),
          automationId: String(row.automation_id),
          occurrenceId,
          executionId: stringOrNull(row.execution_id),
          kind: "cancelled",
          title: "Automation killed",
          body: "Execution was killed; future retry is disabled for this occurrence.",
          now,
        })
      })
      transaction.immediate()
      return { changed: true, run }
    })
    if (killed.run) await this.options.cancel?.(killed.run)
    return killed.changed
  }

  private prepare(
    database: Sqlite,
    automationId: string,
    occurrenceId: string | null,
  ): PreparedExecution {
    const plan = loadPlan(database, automationId)
    requireApproved(plan)
    const target = resolveAutomationTarget(database, plan.scope)
    if (!target) fail("stale-target", "Automation target is missing or archived.")
    if (plan.action.type === "run-chat" && !target.subChatId) {
      fail("stale-target", "Automation chat has no conversation to run.")
    }
    const worktree = resolveWorktree(database, target, plan.run)
    const launchKind = plan.action.type === "create-task-run" ? "orchestration" : "run"
    try {
      assertUsageBudgetAllowsLaunch(
        drizzle(database, { schema: dbSchema }),
        {
          controlled: true,
          providerId: providerForHarness(plan.run.harness),
          accountTag: null,
          projectId: target.projectId,
          taskId: target.taskId,
          automationId: plan.id,
          orchestrationId: null,
          runId: null,
        },
        { nowMs: this.now() },
      )
    } catch (error) {
      if (error instanceof UsageBudgetExceededError) {
        fail(
          "usage-budget-exhausted",
          `Automation launch blocked by ${error.decision.hardStops.length} scoped usage budget(s).`,
        )
      }
      throw error
    }
    const launchBlocker = launchBlockerFor(plan)
    const authoritySnapshot = {
      automationVersion: plan.approval.version,
      approvalState: plan.approval.state,
      approvedBy: plan.approval.approvedBy,
      approvedAt: plan.approval.approvedAt,
      approvalAuditId: plan.approval.auditId,
      permissionMode: plan.run.permissionMode,
      customPermissions: plan.run.customPermissions ?? null,
      targetPermissionMode: target.targetPermissionMode,
      targetCustomPermissions: parseJsonOrNull(target.targetCustomPermissions),
      target: {
        scopeType: target.scopeType,
        projectId: target.projectId,
        taskId: target.taskId,
        chatId: target.chatId,
      },
      worktree,
    }
    return {
      plan,
      target,
      preview: {
        automationId,
        occurrenceId,
        launchKind,
        prompt: plan.run.prompt,
        harness: plan.run.harness,
        model: plan.run.model ?? null,
        target: {
          scopeType: target.scopeType,
          projectId: target.projectId,
          taskId: target.taskId,
          chatId: target.chatId,
          subChatId: target.subChatId,
        },
        authoritySnapshot,
        worktreeSnapshot: worktree,
        budget: plan.budget,
        retry: plan.retry,
        launchable: launchBlocker === null,
        launchBlocker,
      },
    }
  }

  private requireLease(database: Sqlite, occurrence: LeasedAutomationOccurrence): void {
    const row = database
      .prepare(
        `SELECT o.automation_id, o.state, l.owner, l.token
         FROM automation_occurrences o
         LEFT JOIN automation_leases l ON l.occurrence_id = o.id
         WHERE o.id = ?`,
      )
      .get(occurrence.id) as Row | undefined
    if (
      !row ||
      row.automation_id !== occurrence.automationId ||
      row.state !== "leased" ||
      row.owner !== occurrence.lease.owner ||
      row.token !== occurrence.lease.token
    ) {
      fail("invalid-lease", "Automation occurrence lease is missing, stale, or not owned.")
    }
  }

  private claimExecution(
    database: Sqlite,
    occurrence: LeasedAutomationOccurrence,
    prepared: PreparedExecution,
  ):
    | {
        kind: "started"
        executionId: string
        attempt: number
        firstAttemptAt: number
      }
    | { kind: "deferred"; outcome: AutomationExecutionOutcome } {
    const transaction = database.transaction(() => {
      this.requireLease(database, occurrence)
      const active = database
        .prepare(
          `SELECT e.id FROM automation_executions e
           JOIN automation_occurrences o ON o.id = e.occurrence_id
           WHERE o.automation_id = ? AND o.id <> ? AND e.state IN ('pending','running')
           LIMIT 1`,
        )
        .get(prepared.plan.id, occurrence.id)
      if (active) {
        const retryAt = this.now() + 1_000
        database
          .prepare(
            `UPDATE automation_occurrences
             SET state = 'pending', scheduled_for = ?, terminal_at = NULL
             WHERE id = ? AND state = 'leased'`,
          )
          .run(retryAt, occurrence.id)
        database.prepare("DELETE FROM automation_leases WHERE occurrence_id = ?").run(occurrence.id)
        return {
          kind: "deferred" as const,
          outcome: {
            occurrenceId: occurrence.id,
            executionId: null,
            runId: null,
            attempt: 0,
            state: "deferred" as const,
            stopReason: "concurrency-limit",
            retryScheduledAt: retryAt,
            resultSummary: {
              outcome: "deferred",
              reason: "concurrency-limit",
              maxConcurrentRuns: 1,
            },
          },
        }
      }

      const attemptRow = database
        .prepare(
          `SELECT COALESCE(MAX(attempt), 0) + 1 attempt, MIN(created_at) first_attempt_at
           FROM automation_executions WHERE occurrence_id = ?`,
        )
        .get(occurrence.id) as Row
      const attempt = Number(attemptRow.attempt)
      if (attempt > prepared.plan.retry.maxAttempts) {
        fail("invalid-lease", "Automation retry limit is already exhausted.")
      }
      const executionId = this.createId()
      const now = this.now()
      database
        .prepare(
          `INSERT INTO automation_executions (
             id, occurrence_id, attempt, state, authority_snapshot, budget_snapshot,
             created_at, started_at
           ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
        )
        .run(
          executionId,
          occurrence.id,
          attempt,
          JSON.stringify(prepared.preview.authoritySnapshot),
          JSON.stringify(prepared.plan.budget),
          now,
          now,
        )
      database
        .prepare(
          "UPDATE automation_occurrences SET state = 'running' WHERE id = ? AND state = 'leased'",
        )
        .run(occurrence.id)
      return {
        kind: "started" as const,
        executionId,
        attempt,
        firstAttemptAt: numberOrNull(attemptRow.first_attempt_at) ?? now,
      }
    })
    return transaction.immediate()
  }

  private materializeRun(
    occurrence: LeasedAutomationOccurrence,
    attempt: number,
    prepared: PreparedExecution,
  ): MaterializedRun {
    if (!prepared.preview.launchable) {
      fail("unsupported-harness", prepared.preview.launchBlocker ?? "Harness is not launchable.")
    }
    if (prepared.plan.action.type === "create-task-run") {
      return this.materializeOrchestration(occurrence, prepared)
    }
    return this.withDatabase((database) => {
      const now = this.now()
      const chat =
        prepared.plan.action.type === "run-chat"
          ? {
              chatId: prepared.target.chatId!,
              subChatId: prepared.target.subChatId!,
            }
          : createChatTarget(
              database,
              this.createId,
              prepared,
              prepared.preview.worktreeSnapshot.path,
              now,
            )
      const runId = this.createId()
      database
        .prepare(
          `INSERT INTO agent_runs (
             id, chat_id, sub_chat_id, harness, model, permission_mode, custom_permissions,
             worktree_path, prompt_message_id, initial_prompt, status, started_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(
          runId,
          chat.chatId,
          chat.subChatId,
          prepared.plan.run.harness,
          prepared.plan.run.model ?? null,
          prepared.plan.run.permissionMode,
          prepared.plan.run.customPermissions
            ? JSON.stringify(prepared.plan.run.customPermissions)
            : null,
          prepared.preview.worktreeSnapshot.path,
          `automation-${occurrence.id}-${attempt}`,
          prepared.plan.run.prompt,
          now,
        )
      database
        .prepare("UPDATE sub_chats SET run_status = 'pending', updated_at = ? WHERE id = ?")
        .run(now, chat.subChatId)
      const run = queuedRunById(database, runId)
      if (!run) throw new Error("Automation run could not be materialized.")
      return { run, launchKind: "run" as const, orchestrationTaskId: null }
    })
  }

  private materializeOrchestration(
    occurrence: LeasedAutomationOccurrence,
    prepared: PreparedExecution,
  ): MaterializedRun {
    if (!prepared.target.projectId) {
      fail("stale-target", "Task automation requires an active project target.")
    }
    if (prepared.plan.run.harness !== "codex" && prepared.plan.run.harness !== "claude-code") {
      fail("unsupported-harness", "Task orchestration currently requires Codex or Claude Code.")
    }
    if (prepared.plan.run.worktreeStrategy === "task-primary") {
      fail(
        "worktree-unavailable",
        "A new task has no primary worktree yet; choose inherit, existing, or none.",
      )
    }
    const initiatingChatId = this.withDatabase((database) => {
      const id = this.createId()
      const now = this.now()
      database
        .prepare(
          `INSERT INTO chats (
             id, name, project_id, scope, permission_mode, custom_permissions, harness, model,
             worktree_path, ancestor_chat_ids, created_at, updated_at
           ) VALUES (?, ?, ?, 'project', ?, ?, ?, ?, ?, '[]', ?, ?)`,
        )
        .run(
          id,
          `Automation: ${prepared.plan.name}`,
          prepared.target.projectId,
          prepared.plan.run.permissionMode,
          prepared.plan.run.customPermissions
            ? JSON.stringify(prepared.plan.run.customPermissions)
            : null,
          prepared.plan.run.harness,
          prepared.plan.run.model ?? null,
          prepared.preview.worktreeSnapshot.path,
          now,
          now,
        )
      return id
    })
    const action = prepared.plan.action
    if (action.type !== "create-task-run") throw new Error("Expected create-task action.")
    const service = createAgentOrchestrationService(this.databasePath)
    const overview = service.create({
      projectId: prepared.target.projectId,
      task: { mode: "create", name: action.taskName },
      initiatingChatId,
      maxParallelAgents: 1,
      maxDepth: 1,
      stopConditions: compact({
        targetCompletedAgents: 1,
        maxWallClockMs: prepared.plan.budget.maxDurationMs ?? undefined,
        maxTotalTokens: prepared.plan.budget.maxTotalTokens ?? undefined,
        maxCostUsdMicros: prepared.plan.budget.maxCostUsdMicros ?? undefined,
        maxFailures: 1,
      }),
      agents: [
        compact({
          agentId: `automation-${occurrence.id}`,
          role: "automation",
          name: prepared.plan.name,
          prompt: prepared.plan.run.prompt,
          harness: prepared.plan.run.harness,
          model: prepared.plan.run.model,
          permissionMode: prepared.plan.run.permissionMode,
          customPermissions: prepared.plan.run.customPermissions,
          worktreeStrategy: prepared.plan.run.worktreeStrategy,
          worktreePath: prepared.plan.run.worktreePath,
          dependencyAgentIds: [],
          completionCriteria: "Complete the approved automation prompt and retain normal evidence.",
        }),
      ],
    })
    const agent = overview.agents[0]
    if (!agent?.runId) throw new Error("Automation orchestration did not materialize a run.")
    return this.withDatabase((database) => {
      const run = queuedRunById(database, agent.runId!)
      if (!run) throw new Error("Automation orchestration run is missing.")
      return {
        run,
        launchKind: "orchestration" as const,
        orchestrationTaskId: overview.orchestration.taskId,
      }
    })
  }

  private async monitorLaunch(
    occurrence: LeasedAutomationOccurrence,
    executionId: string,
    firstAttemptAt: number,
    run: QueuedAgentRun,
    budget: AutomationBudget,
  ): Promise<LaunchResult> {
    const settled = this.options.launch!(run).then(
      () => ({ kind: "completed" as const }),
      (error: unknown) => ({
        kind: "crashed" as const,
        error: error instanceof Error ? error.message : "Harness launch crashed.",
      }),
    )
    const leaseDuration = Math.max(1_000, occurrence.lease.expiresAt - occurrence.lease.acquiredAt)
    while (true) {
      const control = this.executionControlState(occurrence.id, executionId)
      if (control.cancelled) {
        return { kind: "cancelled", reason: control.reason ?? "killed" }
      }
      const usage = this.usageForOccurrence(occurrence.id)
      const budgetStop = exceededBudget(budget, usage, this.now() - firstAttemptAt)
      if (budgetStop) {
        await this.options.cancel?.(run)
        return { kind: "budget", reason: budgetStop }
      }
      const scopedBudget = this.withDatabase((database) =>
        resolveUsageBudgets(
          drizzle(database, { schema: dbSchema }),
          resolveUsageBudgetContextForRun(database, run.runId),
          { nowMs: this.now() },
        ),
      )
      if (scopedBudget.blocked) {
        await this.options.cancel?.(run)
        return { kind: "budget", reason: "scoped-usage-budget" }
      }
      this.refreshLease(occurrence, leaseDuration)
      const result = await Promise.race([settled, this.sleep(this.pollIntervalMs).then(() => null)])
      if (result) {
        if (result.kind === "completed") {
          const finalUsage = this.usageForOccurrence(occurrence.id)
          const finalBudgetStop = exceededBudget(budget, finalUsage, this.now() - firstAttemptAt)
          if (finalBudgetStop) return { kind: "budget", reason: finalBudgetStop }
        }
        return result
      }
    }
  }

  private finalize(
    occurrence: LeasedAutomationOccurrence,
    executionId: string,
    attempt: number,
    materialized: MaterializedRun | null,
    prepared: PreparedExecution,
    state: "succeeded" | "failed" | "denied" | "cancelled" | "timed-out",
    stopReason: string | null,
    message: string,
    allowRetry = true,
  ): AutomationExecutionOutcome {
    return this.withDatabase((database) => {
      const current = database
        .prepare("SELECT state FROM automation_executions WHERE id = ?")
        .get(executionId) as Row | undefined
      if (current?.state === "cancelled")
        return outcomeFromDatabase(database, occurrence.id, executionId)
      const now = this.now()
      const usage = materialized ? usageForOccurrence(database, occurrence.id) : emptyUsage()
      const evidence = materialized
        ? evidenceForRun(database, materialized.run.runId)
        : emptyEvidence()
      const summary = {
        outcome: state,
        message,
        stopReason,
        runId: materialized?.run.runId ?? null,
        chatId: materialized?.run.chatId ?? null,
        launchKind: materialized?.launchKind ?? prepared.preview.launchKind,
        usage,
        evidence,
      }
      const retryAt =
        allowRetry && (state === "failed" || state === "timed-out")
          ? retryTime(database, occurrence.id, prepared.plan, attempt, now)
          : null
      const transaction = database.transaction(() => {
        database
          .prepare(
            `UPDATE automation_executions
             SET state = ?, result_summary = ?, stop_reason = ?, completed_at = ?
             WHERE id = ? AND state IN ('pending','running')`,
          )
          .run(state, JSON.stringify(summary), stopReason, now, executionId)
        if (retryAt !== null) {
          database
            .prepare(
              `UPDATE automation_occurrences
               SET state = 'pending', scheduled_for = ?, terminal_at = NULL
               WHERE id = ? AND state IN ('leased','running')`,
            )
            .run(retryAt, occurrence.id)
        } else {
          database
            .prepare(
              `UPDATE automation_occurrences SET state = 'completed', terminal_at = ?
               WHERE id = ? AND state IN ('leased','running')`,
            )
            .run(now, occurrence.id)
          insertTerminalInbox(database, {
            id: this.createId(),
            automationId: prepared.plan.id,
            occurrenceId: occurrence.id,
            executionId,
            state,
            stopReason,
            message,
            now,
          })
        }
        database.prepare("DELETE FROM automation_leases WHERE occurrence_id = ?").run(occurrence.id)
      })
      transaction.immediate()
      return {
        occurrenceId: occurrence.id,
        executionId,
        runId: materialized?.run.runId ?? null,
        attempt,
        state,
        stopReason,
        retryScheduledAt: retryAt,
        resultSummary: summary,
      }
    })
  }

  private recordPreflightDenial(
    occurrence: LeasedAutomationOccurrence,
    error: AutomationExecutionError,
  ): AutomationExecutionOutcome {
    return this.withDatabase((database) => {
      const plan = loadPlan(database, occurrence.automationId)
      const attempt = Number(
        (
          database
            .prepare(
              "SELECT COALESCE(MAX(attempt), 0) + 1 attempt FROM automation_executions WHERE occurrence_id = ?",
            )
            .get(occurrence.id) as Row
        ).attempt,
      )
      const executionId = this.createId()
      const now = this.now()
      const summary = { outcome: "denied", reason: error.code, message: error.message }
      const authority = {
        automationVersion: plan.approval.version,
        approvalState: plan.approval.state,
        approvedBy: plan.approval.approvedBy,
        approvedAt: plan.approval.approvedAt,
        approvalAuditId: plan.approval.auditId,
        permissionMode: plan.run.permissionMode,
        customPermissions: plan.run.customPermissions ?? null,
      }
      const transaction = database.transaction(() => {
        database
          .prepare(
            `INSERT INTO automation_executions (
               id, occurrence_id, attempt, state, authority_snapshot, budget_snapshot,
               result_summary, stop_reason, created_at, completed_at
             ) VALUES (?, ?, ?, 'denied', ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            executionId,
            occurrence.id,
            attempt,
            JSON.stringify(authority),
            JSON.stringify(plan.budget),
            JSON.stringify(summary),
            error.code,
            now,
            now,
          )
        database
          .prepare(
            `UPDATE automation_occurrences SET state = 'completed', terminal_at = ?
             WHERE id = ? AND state IN ('pending','leased','running')`,
          )
          .run(now, occurrence.id)
        database.prepare("DELETE FROM automation_leases WHERE occurrence_id = ?").run(occurrence.id)
        insertTerminalInbox(database, {
          id: this.createId(),
          automationId: plan.id,
          occurrenceId: occurrence.id,
          executionId,
          state: "denied",
          stopReason: error.code,
          message: error.message,
          now,
        })
      })
      transaction.immediate()
      return {
        occurrenceId: occurrence.id,
        executionId,
        runId: null,
        attempt,
        state: "denied",
        stopReason: error.code,
        retryScheduledAt: null,
        resultSummary: summary,
      }
    })
  }

  private executionControlState(
    occurrenceId: string,
    executionId: string,
  ): { cancelled: boolean; reason: string | null } {
    return this.withDatabase((database) => {
      const row = database
        .prepare(
          `SELECT o.state occurrence_state, e.state execution_state, e.stop_reason
           FROM automation_occurrences o JOIN automation_executions e ON e.occurrence_id = o.id
           WHERE o.id = ? AND e.id = ?`,
        )
        .get(occurrenceId, executionId) as Row | undefined
      return {
        cancelled: row?.occurrence_state === "cancelled" || row?.execution_state === "cancelled",
        reason: stringOrNull(row?.stop_reason),
      }
    })
  }

  private refreshLease(occurrence: LeasedAutomationOccurrence, durationMs: number): void {
    this.withDatabase((database) => {
      database
        .prepare(
          `UPDATE automation_leases SET expires_at = ?
           WHERE occurrence_id = ? AND owner = ? AND token = ?`,
        )
        .run(this.now() + durationMs, occurrence.id, occurrence.lease.owner, occurrence.lease.token)
    })
  }

  private usageForOccurrence(occurrenceId: string) {
    return this.withDatabase((database) => usageForOccurrence(database, occurrenceId))
  }

  private runStatus(runId: string): string | null {
    return this.withDatabase((database) => {
      const row = database.prepare("SELECT status FROM agent_runs WHERE id = ?").get(runId) as
        Row | undefined
      return stringOrNull(row?.status)
    })
  }

  private markRunTerminal(run: QueuedAgentRun, status: "success" | "failure" | "cancelled"): void {
    this.withDatabase((database) => {
      const now = this.now()
      database
        .prepare(
          `UPDATE agent_runs SET status = ?, completed_at = ?
           WHERE id = ? AND status IN ('pending','running')`,
        )
        .run(status, now, run.runId)
      database
        .prepare(
          `UPDATE sub_chats SET run_status = COALESCE((
             SELECT status FROM agent_runs WHERE sub_chat_id = ? AND id <> ?
               AND status IN ('pending','running')
             ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, started_at, id LIMIT 1
           ), ?), updated_at = ? WHERE id = ?`,
        )
        .run(run.subChatId, run.runId, status, now, run.subChatId)
    })
  }

  private currentOutcome(occurrenceId: string, executionId: string): AutomationExecutionOutcome {
    return this.withDatabase((database) => outcomeFromDatabase(database, occurrenceId, executionId))
  }

  private reconcileOrchestration(materialized: MaterializedRun): void {
    if (materialized.orchestrationTaskId) {
      createAgentOrchestrationService(this.databasePath).tickAll()
    }
  }

  private withDatabase<T>(operation: (database: Sqlite) => T): T {
    const database = openAppDatabase(this.databasePath)
    try {
      database.pragma("foreign_keys = ON")
      database.pragma("busy_timeout = 5000")
      return operation(database)
    } finally {
      database.close()
    }
  }
}

function loadPlan(database: Sqlite, automationId: string): ExecutionPlan {
  const row = database
    .prepare(
      `SELECT a.*, r.mode retry_mode, r.max_attempts, r.initial_delay_ms, r.max_delay_ms,
              r.deadline_ms, b.max_duration_ms, b.max_total_tokens, b.max_cost_usd_micros,
              b.max_concurrent_runs
       FROM automations a
       JOIN automation_retry_policies r ON r.automation_id = a.id
       JOIN automation_budgets b ON b.automation_id = a.id
       WHERE a.id = ? AND a.archived_at IS NULL`,
    )
    .get(automationId) as Row | undefined
  if (!row) fail("stale-target", "Automation is missing or archived.")
  const scope: AutomationTargetReference = {
    scopeType: String(row.scope_type),
    projectId: stringOrNull(row.project_id),
    taskId: stringOrNull(row.task_id),
    chatId: stringOrNull(row.chat_id),
  }
  return {
    id: String(row.id),
    name: String(row.name),
    scope,
    action: automationActionSchema.parse(parseJson(row.action_config, "automation action")),
    run: automationRunConfigSchema.parse({
      prompt: row.prompt,
      harness: row.harness,
      ...(row.model ? { model: row.model } : {}),
      permissionMode: row.permission_mode,
      ...(row.custom_permissions
        ? { customPermissions: parseJson(row.custom_permissions, "custom permissions") }
        : {}),
      worktreeStrategy: row.worktree_strategy,
      ...(row.worktree_path ? { worktreePath: row.worktree_path } : {}),
    }),
    retry: automationRetryPolicySchema.parse({
      mode: row.retry_mode,
      maxAttempts: row.max_attempts,
      initialDelayMs: row.initial_delay_ms,
      maxDelayMs: row.max_delay_ms,
      deadlineMs: row.deadline_ms,
    }),
    budget: automationBudgetSchema.parse({
      maxDurationMs: row.max_duration_ms ?? null,
      maxTotalTokens: row.max_total_tokens ?? null,
      maxCostUsdMicros: row.max_cost_usd_micros ?? null,
      maxConcurrentRuns: row.max_concurrent_runs,
    }),
    approval: {
      state: String(row.approval_state),
      approvedBy: stringOrNull(row.approved_by),
      approvedAt: numberOrNull(row.approved_at),
      auditId: stringOrNull(row.approval_audit_id),
      enabled: Boolean(row.enabled),
      automationState: String(row.state),
      version: Number(row.version),
    },
  }
}

function requireApproved(plan: ExecutionPlan): void {
  if (
    !plan.approval.enabled ||
    plan.approval.automationState !== "active" ||
    plan.approval.state !== "approved" ||
    !plan.approval.approvedBy ||
    plan.approval.approvedAt === null ||
    !plan.approval.auditId
  ) {
    fail("approval-denied", "Automation is not enabled with current approval provenance.")
  }
}

function launchBlockerFor(plan: ExecutionPlan): string | null {
  if (!SUPPORTED_AUTOMATION_HARNESSES.has(plan.run.harness)) {
    return `Harness ${plan.run.harness} has no normal main-process automation launch contract.`
  }
  if ((plan.run.harness === "openrouter" || plan.run.harness === "nanogpt") && !plan.run.model) {
    return `${plan.run.harness} automation requires an explicit model.`
  }
  if (
    plan.action.type === "create-task-run" &&
    plan.run.harness !== "codex" &&
    plan.run.harness !== "claude-code"
  ) {
    return "Task orchestration currently requires Codex or Claude Code."
  }
  return null
}

function resolveWorktree(
  database: Sqlite,
  target: ResolvedAutomationTarget,
  run: AutomationRunConfig,
): AutomationExecutionPreview["worktreeSnapshot"] {
  let path: string | null = null
  let source: AutomationExecutionPreview["worktreeSnapshot"]["source"] = "none"
  if (run.worktreeStrategy === "existing") {
    path = run.worktreePath ?? null
    source = "explicit"
  } else if (run.worktreeStrategy === "task-primary") {
    path = target.taskPrimaryWorktreePath
    source = "task-primary"
  } else if (run.worktreeStrategy === "inherit") {
    path = target.chatWorktreePath ?? target.taskPrimaryWorktreePath ?? target.projectPath
    source = target.chatWorktreePath
      ? "chat"
      : target.taskPrimaryWorktreePath
        ? "task-primary"
        : target.projectPath
          ? "project"
          : "none"
  }
  if (run.worktreeStrategy !== "none" && !path) {
    fail("worktree-unavailable", "Configured automation worktree could not be resolved.")
  }
  if (path) assertRegisteredWorktree(database, path, target.projectPath)
  return { strategy: run.worktreeStrategy, path, projectPath: target.projectPath, source }
}

function assertRegisteredWorktree(
  database: Sqlite,
  path: string,
  projectPath: string | null,
): void {
  if (!isAbsolute(path) || !existsSync(path)) {
    fail("worktree-unavailable", "Automation worktree is missing or not absolute.")
  }
  const canonical = realpathSync(path)
  if (projectPath && existsSync(projectPath)) {
    const projectCanonical = realpathSync(projectPath)
    const inside = relative(projectCanonical, canonical)
    if (canonical === projectCanonical || (!inside.startsWith("..") && !isAbsolute(inside))) return
    try {
      const worktrees = execFileSync(
        "git",
        ["-C", projectCanonical, "worktree", "list", "--porcelain"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length))
        .filter(existsSync)
        .map((worktreePath) => realpathSync(worktreePath))
      if (worktrees.includes(canonical)) return
    } catch {
      // Fall through to durable root identity.
    }
  }
  const registration = database
    .prepare("SELECT canonical_path FROM filesystem_root_registrations WHERE path = ?")
    .get(path) as Row | undefined
  if (registration && registration.canonical_path === canonical) return
  fail("worktree-unavailable", "Automation worktree is outside its registered project roots.")
}

function createChatTarget(
  database: Sqlite,
  createId: () => string,
  prepared: PreparedExecution,
  worktreePath: string | null,
  now: number,
): { chatId: string; subChatId: string } {
  const chatId = createId()
  const subChatId = createId()
  const action = prepared.plan.action
  if (action.type !== "create-chat-run") throw new Error("Expected create-chat action.")
  database
    .prepare(
      `INSERT INTO chats (
         id, name, project_id, task_id, scope, permission_mode, custom_permissions, harness,
         model, worktree_path, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      chatId,
      action.chatName ?? `Automation: ${prepared.plan.name}`,
      prepared.target.projectId,
      prepared.target.taskId,
      prepared.target.taskId ? "task" : prepared.target.projectId ? "project" : "global",
      prepared.plan.run.permissionMode,
      prepared.plan.run.customPermissions
        ? JSON.stringify(prepared.plan.run.customPermissions)
        : null,
      prepared.plan.run.harness,
      prepared.plan.run.model ?? null,
      worktreePath,
      now,
      now,
    )
  database
    .prepare(
      `INSERT INTO sub_chats (
         id, chat_id, harness, model, permission_mode, worktree_path, run_status, messages,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', '[]', ?, ?)`,
    )
    .run(
      subChatId,
      chatId,
      prepared.plan.run.harness,
      prepared.plan.run.model ?? null,
      prepared.plan.run.permissionMode,
      worktreePath,
      now,
      now,
    )
  return { chatId, subChatId }
}

function queuedRunById(database: Sqlite, runId: string): QueuedAgentRun | null {
  const row = database
    .prepare(
      `SELECT r.*, p.path project_path
       FROM agent_runs r JOIN chats c ON c.id = r.chat_id
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE r.id = ?`,
    )
    .get(runId) as Row | undefined
  if (!row) return null
  return {
    runId: String(row.id),
    chatId: String(row.chat_id),
    subChatId: String(row.sub_chat_id),
    harness: row.harness as AgentHarness,
    prompt: String(row.initial_prompt),
    model: stringOrNull(row.model),
    reasoningEffort: null,
    permissionMode: String(row.permission_mode),
    customPermissions: stringOrNull(row.custom_permissions),
    worktreePath: stringOrNull(row.worktree_path),
    projectPath: stringOrNull(row.project_path),
  }
}

function exceededBudget(
  budget: AutomationBudget,
  usage: ReturnType<typeof emptyUsage>,
  elapsedMs: number,
): "token-budget" | "cost-budget" | "time-budget" | null {
  if (budget.maxDurationMs !== null && elapsedMs >= budget.maxDurationMs) return "time-budget"
  if (budget.maxTotalTokens !== null && usage.totalTokens >= budget.maxTotalTokens) {
    return "token-budget"
  }
  if (budget.maxCostUsdMicros !== null && usage.costUsdMicros >= budget.maxCostUsdMicros) {
    return "cost-budget"
  }
  return null
}

function usageForOccurrence(database: Sqlite, occurrenceId: string) {
  const row = database
    .prepare(
      `SELECT COALESCE(SUM(run_tokens), 0) total_tokens,
              COALESCE(SUM(run_cost), 0) cost_usd_micros
       FROM (
         SELECT e.run_id,
                MAX(COALESCE(u.total_tokens, 0)) run_tokens,
                MAX(COALESCE(u.cost_usd_micros, 0)) run_cost
         FROM automation_executions e
         LEFT JOIN usage_samples u ON u.run_id = e.run_id
         WHERE e.occurrence_id = ? AND e.run_id IS NOT NULL
         GROUP BY e.run_id
       )`,
    )
    .get(occurrenceId) as Row
  return {
    totalTokens: Number(row.total_tokens ?? 0),
    costUsdMicros: Number(row.cost_usd_micros ?? 0),
  }
}

function emptyUsage() {
  return { totalTokens: 0, costUsdMicros: 0 }
}

function evidenceForRun(database: Sqlite, runId: string) {
  const checkpoint = database
    .prepare(
      `SELECT SUM(CASE WHEN kind = 'before' THEN 1 ELSE 0 END) before_count,
              SUM(CASE WHEN kind = 'after' THEN 1 ELSE 0 END) after_count
       FROM checkpoints WHERE run_id = ?`,
    )
    .get(runId) as Row
  const manifest = database
    .prepare("SELECT COUNT(*) count FROM file_change_manifests WHERE run_id = ?")
    .get(runId) as Row
  return {
    beforeCheckpoints: Number(checkpoint.before_count ?? 0),
    afterCheckpoints: Number(checkpoint.after_count ?? 0),
    manifestEntries: Number(manifest.count ?? 0),
  }
}

function emptyEvidence() {
  return { beforeCheckpoints: 0, afterCheckpoints: 0, manifestEntries: 0 }
}

function retryTime(
  database: Sqlite,
  occurrenceId: string,
  plan: ExecutionPlan,
  attempt: number,
  now: number,
): number | null {
  if (plan.retry.mode !== "exponential" || attempt >= plan.retry.maxAttempts) return null
  const active = database
    .prepare(
      "SELECT enabled, state, approval_state FROM automations WHERE id = ? AND archived_at IS NULL",
    )
    .get(plan.id) as Row | undefined
  if (
    !active ||
    !active.enabled ||
    active.state !== "active" ||
    active.approval_state !== "approved"
  ) {
    return null
  }
  const first = database
    .prepare("SELECT MIN(created_at) started_at FROM automation_executions WHERE occurrence_id = ?")
    .get(occurrenceId) as Row
  const startedAt = numberOrNull(first.started_at) ?? now
  const delay = Math.min(
    plan.retry.maxDelayMs,
    plan.retry.initialDelayMs * 2 ** Math.max(0, attempt - 1),
  )
  const retryAt = now + delay
  return retryAt - startedAt <= plan.retry.deadlineMs ? retryAt : null
}

function outcomeFromDatabase(
  database: Sqlite,
  occurrenceId: string,
  executionId: string,
): AutomationExecutionOutcome {
  const row = database
    .prepare(
      `SELECT id, attempt, state, run_id, stop_reason, result_summary
       FROM automation_executions WHERE id = ? AND occurrence_id = ?`,
    )
    .get(executionId, occurrenceId) as Row | undefined
  if (!row || !TERMINAL_EXECUTION_STATES.has(String(row.state))) {
    throw new Error("Automation execution is not terminal.")
  }
  return {
    occurrenceId,
    executionId,
    runId: stringOrNull(row.run_id),
    attempt: Number(row.attempt),
    state: row.state as AutomationExecutionOutcome["state"],
    stopReason: stringOrNull(row.stop_reason),
    retryScheduledAt: null,
    resultSummary: parseObject(row.result_summary),
  }
}

function cancelRunRows(database: Sqlite, runId: string, now: number): void {
  const row = database.prepare("SELECT sub_chat_id FROM agent_runs WHERE id = ?").get(runId) as
    Row | undefined
  database
    .prepare(
      "UPDATE agent_runs SET status = 'cancelled', completed_at = ? WHERE id = ? AND status IN ('pending','running')",
    )
    .run(now, runId)
  if (row?.sub_chat_id) {
    database
      .prepare("UPDATE sub_chats SET run_status = 'cancelled', updated_at = ? WHERE id = ?")
      .run(now, row.sub_chat_id)
  }
}

function insertTerminalInbox(
  database: Sqlite,
  input: {
    id: string
    automationId: string
    occurrenceId: string
    executionId: string
    state: "succeeded" | "failed" | "denied" | "cancelled" | "timed-out"
    stopReason: string | null
    message: string
    now: number
  },
): void {
  const kind =
    input.stopReason === "token-budget" ||
    input.stopReason === "cost-budget" ||
    input.stopReason === "time-budget"
      ? "budget-exhausted"
      : input.state === "succeeded"
        ? "completed"
        : input.state === "denied"
          ? "denied"
          : input.state === "cancelled"
            ? "cancelled"
            : "failed"
  insertInbox(database, {
    ...input,
    kind,
    title: input.state === "succeeded" ? "Automation completed" : "Automation needs attention",
    body: input.message,
  })
}

function insertInbox(
  database: Sqlite,
  input: {
    id: string
    automationId: string
    occurrenceId: string
    executionId: string | null
    kind: "completed" | "failed" | "denied" | "budget-exhausted" | "cancelled"
    title: string
    body: string
    now: number
  },
): void {
  database
    .prepare(
      `INSERT INTO automation_inbox_items (
         id, automation_id, occurrence_id, execution_id, kind, title, body, unread, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(
      input.id,
      input.automationId,
      input.occurrenceId,
      input.executionId,
      input.kind,
      input.title,
      input.body,
      input.now,
    )
}

function parseJson(value: unknown, label: string): unknown {
  if (typeof value !== "string") throw new Error(`Stored ${label} is invalid.`)
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`Stored ${label} is invalid.`)
  }
}

function parseJsonOrNull(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function fail(code: AutomationExecutionErrorCode, message: string): never {
  throw new AutomationExecutionError(code, message)
}

function materializationError(error: unknown): AutomationExecutionError {
  if (error instanceof AutomationExecutionError) return error
  if (error instanceof AgentOrchestrationError) {
    return new AutomationExecutionError(
      error.code === "permission-denied" ? "permission-denied" : "stale-target",
      error.message,
    )
  }
  return new AutomationExecutionError(
    "stale-target",
    error instanceof Error ? error.message : "Automation target could not be created.",
  )
}
