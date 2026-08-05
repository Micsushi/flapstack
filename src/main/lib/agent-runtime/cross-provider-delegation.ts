import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import {
  runtimeAdapterForPreference,
  type AgentRuntimePreference,
  type ResolvedAgentRuntime,
  type RuntimeAdapterProbe,
} from "../../../shared/agent-runtime"
import {
  customPermissionCapabilitiesSchema,
  customPermissionCapabilityKeys,
  type CustomPermissionCapabilities,
} from "../../../shared/permission-capabilities"
import {
  crossProviderResultEnvelopeSchema,
  crossProviderTaskEnvelopeSchema,
  executionTargetSchema,
  type CrossProviderResultEnvelope,
  type CrossProviderTaskEnvelope,
  type DelegationAuthorityCeiling,
  type RuntimeCompositionPreview,
} from "../../../shared/runtime-composition"
import { isProductMcpEnabledByDefault } from "../mcp-control/exposure"
import {
  assertNoSecretText,
  PORTABLE_SECRET_PLACEHOLDER,
  sanitizeStructuredValue,
} from "../portability/secrets"
import { validateJsonSchema } from "../agent-orchestration/workflow-engine"
import { openAppDatabase } from "../db/access"
import { nowEpochSeconds } from "../db/timestamps"
import { loadRunningAgentRun, type QueuedAgentRun } from "../run-launch-service"
import { claimPendingRunWithinUsageBudget } from "../usage/budgets"
import {
  constructRuntimeSnapshot,
  runtimePermissionSnapshot,
  runtimeSnapshotSqlValues,
} from "./snapshot"
import {
  createRuntimeChatLifecycleService,
  RuntimeChatLifecycleError,
  type RuntimeContinuationInput,
  type RuntimeContinuationPreview,
} from "./chat-lifecycle"
import { productRuntimeForHarness } from "./compatibility"

type Row = Record<string, unknown>

export interface RuntimeDelegationLaunchPort {
  launch(run: QueuedAgentRun): Promise<void>
  reconcileRun(
    runId: string,
  ): Promise<"running" | "completed" | "cancelled" | "failed" | "uncertain">
  cancel(runId: string, reason: string): Promise<boolean>
  readStructuredOutput?(runId: string): Promise<{
    value: unknown
    activityReference: { runId: string; eventId: string; sequence: number }
  } | null>
  compositionProbe?(harness: string, runtime: ResolvedAgentRuntime): RuntimeAdapterProbe | null
}

export type CrossProviderDelegationInput = Omit<
  RuntimeContinuationInput,
  "mode" | "confirmedPreviewDigest"
> & {
  objective: string
  confirmedPreviewDigest?: string
  priorAttemptId?: string | null
  deadline?: string | null
  authorityRestrictions?: Partial<
    Pick<
      DelegationAuthorityCeiling,
      | "permissionMode"
      | "customPermissions"
      | "allowedToolTiers"
      | "network"
      | "maxDescendantDepth"
      | "tokenBudget"
      | "costBudgetMicros"
    >
  >
}

export type CrossProviderDelegationReference = {
  attemptId: string
  attemptNumber: number
  childChatId: string
  childSubChatId: string
  runId: string
  status: "running" | "success" | "failure" | "cancelled" | "uncertain"
  previewDigest: string
  result: CrossProviderResultEnvelope | null
  created: boolean
}

export type RuntimeRecoverySweep = {
  attempted: number
  failed: number
  remaining: number
  quarantined: number
  retryAfterMs: number | null
}

// A running attempt whose provider reconcile and terminalization both keep failing used to be
// retried on every drain tick forever. Recovery failures are therefore backed off per attempt and
// quarantined after a bounded number of consecutive failures. Quarantine is deliberately process
// local: the attempt row stays 'running' and is retried from scratch on the next app start.
const RECOVERY_RETRY_BASE_MS = 10_000
const RECOVERY_RETRY_MAX_MS = 300_000
const RECOVERY_MAX_FAILURES = 5
const RECOVERY_MINIMUM_INTERVAL_MS = 5_000

type RecoveryFailureState = { failures: number; retryAt: number; quarantined: boolean }

type RecoverySweepProgress = {
  actionable: number
  earliestRetryAt: number | null
  observedFailures: Set<string>
}

export function nextRuntimeRecoverySchedule(
  sweep: RuntimeRecoverySweep,
  now: number,
  minimumIntervalMs = RECOVERY_MINIMUM_INTERVAL_MS,
): { pending: boolean; nextAttemptAt: number } {
  if (sweep.remaining <= 0 || sweep.retryAfterMs === null) {
    return { pending: false, nextAttemptAt: now }
  }
  return { pending: true, nextAttemptAt: now + Math.max(minimumIntervalMs, sweep.retryAfterMs) }
}

export class CrossProviderDelegationError extends Error {
  constructor(
    readonly code:
      | "invalid-target"
      | "preview-required"
      | "preview-mismatch"
      | "capability-missing"
      | "authority-widening"
      | "secret-detected"
      | "attempt-conflict"
      | "stale-attempt",
    message: string,
  ) {
    super(message)
    this.name = "CrossProviderDelegationError"
  }
}

export class CrossProviderDelegationService {
  private recoveryCursor = ""
  private recoveryUpperBound: string | null | undefined
  private readonly recoveryFailures = new Map<string, RecoveryFailureState>()
  private recoverySweep: RecoverySweepProgress = newRecoverySweepProgress()

  constructor(
    private readonly databasePath: string,
    private readonly runtime: RuntimeDelegationLaunchPort,
  ) {}

  preview(
    input: CrossProviderDelegationInput,
    probe?: RuntimeAdapterProbe | null,
  ): RuntimeContinuationPreview {
    assertDelegationObjectiveSafe(input.objective)
    const db = this.open()
    try {
      const source = requireChat(db, input.sourceChatId)
      const targetHarness = input.targetHarness?.trim()
      if (!targetHarness || targetHarness === String(source.harness)) {
        throw new CrossProviderDelegationError(
          "invalid-target",
          "Cross-provider delegation requires one exact different target provider.",
        )
      }
      const requiredCapabilities = [
        ...new Set([
          ...(input.requiredCapabilities ?? []),
          ...(input.outputSchema ? ["structuredOutput"] : []),
        ]),
      ]
      const targetRuntime =
        runtimeAdapterForPreference(input.preference) ?? productRuntimeForHarness(targetHarness)
      const targetProbe =
        probe ?? this.runtime.compositionProbe?.(targetHarness, targetRuntime) ?? null
      const base = createRuntimeChatLifecycleService(db, (harness, runtime) =>
        targetProbe?.harness === harness && targetProbe.runtime === runtime ? targetProbe : null,
      ).previewContinuation({
        ...input,
        mode: "delegate",
        requiredCapabilities,
        outputSchema: input.outputSchema ?? null,
      })
      const authority = narrowAuthority(base.authorityCeiling, input.authorityRestrictions)
      const missing = requiredCapabilities.filter(
        (capability) => base.targetSnapshot.capabilities.capabilities[capability] !== "available",
      )
      const availability =
        missing.length > 0
          ? {
              state: "blocked" as const,
              reason: `Target lacks required capabilities: ${[...new Set(missing)].join(", ")}.`,
              repair: "Select a target that advertises every required capability.",
            }
          : base.availability
      return rebuildPreview(base, authority, availability)
    } finally {
      db.close()
    }
  }

  delegate(
    input: CrossProviderDelegationInput,
    probe?: RuntimeAdapterProbe | null,
  ): CrossProviderDelegationReference {
    if (!input.confirmedPreviewDigest) {
      throw new CrossProviderDelegationError(
        "preview-required",
        "Cross-provider delegation requires confirmation of the exact preview digest.",
      )
    }
    const preview = this.preview(input, probe)
    if (preview.digest !== input.confirmedPreviewDigest) {
      throw new CrossProviderDelegationError(
        "preview-mismatch",
        "Delegation target, context, authority, worktree, budget, or output contract changed after preview.",
      )
    }
    if (preview.availability.state !== "available") {
      throw new CrossProviderDelegationError(
        "capability-missing",
        preview.availability.reason ?? "Delegation target is unavailable.",
      )
    }
    const target = preview.targetSnapshot
    const confirmedProbe =
      probe ?? this.runtime.compositionProbe?.(target.harness, target.runtime) ?? null
    if (
      !confirmedProbe ||
      confirmedProbe.harness !== target.harness ||
      confirmedProbe.runtime !== target.runtime ||
      !confirmedProbe.available
    ) {
      throw new CrossProviderDelegationError(
        "preview-mismatch",
        "Delegation requires the exact available capability probe confirmed by the preview.",
      )
    }

    const db = this.open()
    let reference: CrossProviderDelegationReference
    try {
      reference = db
        .transaction(() => {
          const existing = db
            .prepare("SELECT * FROM runtime_composition_attempts WHERE idempotency_key = ?")
            .get(input.requestId) as Row | undefined
          if (existing) {
            assertMatchingIdempotentIntent(existing, input, preview.digest)
            return referenceFromRow(existing, false)
          }

          const source = requireChat(db, input.sourceChatId)
          const prior = input.priorAttemptId
            ? (db
                .prepare("SELECT * FROM runtime_composition_attempts WHERE attempt_id = ?")
                .get(input.priorAttemptId) as Row | undefined)
            : undefined
          if (input.priorAttemptId && !prior) {
            throw new CrossProviderDelegationError(
              "stale-attempt",
              "Explicit retry references a missing prior attempt.",
            )
          }
          if (prior && String(prior.source_chat_id) !== input.sourceChatId) {
            throw new CrossProviderDelegationError(
              "attempt-conflict",
              "Retry attempt belongs to a different source Chat.",
            )
          }
          const identities = delegationIdentities(input.sourceChatId, input.requestId)
          const attemptNumber = prior ? Number(prior.attempt_number) + 1 : 1
          const ancestors = parseIds(source.ancestor_chat_ids)
          if (ancestors.includes(input.sourceChatId)) {
            throw new CrossProviderDelegationError(
              "attempt-conflict",
              "Source Chat lineage is malformed.",
            )
          }
          const now = nowEpochSeconds()
          const customPermissions = preview.authorityCeiling.customPermissions
          const name =
            input.name?.trim() || `${String(source.name ?? "Chat")} · Delegate to ${target.harness}`
          db.prepare(
            `INSERT INTO chats (
              id, name, project_id, task_id, scope, permission_mode, custom_permissions,
              mcp_exposure_enabled, harness, model, runtime_preference, parent_chat_id,
              initiator_chat_id, parent_run_id, ancestor_chat_ids, worktree_path, branch,
              base_branch, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            identities.chatId,
            name,
            source.project_id ?? null,
            source.task_id ?? null,
            source.scope,
            preview.authorityCeiling.permissionMode,
            customPermissions ? JSON.stringify(customPermissions) : null,
            isProductMcpEnabledByDefault(target.harness) ? 1 : 0,
            target.harness,
            target.model,
            input.preference,
            input.sourceChatId,
            source.initiator_chat_id ?? input.sourceChatId,
            preview.visibleContextManifest.sourceRunId,
            JSON.stringify([...ancestors, input.sourceChatId]),
            preview.worktreeLease.path,
            preview.worktreeLease.branch,
            source.base_branch ?? null,
            now,
            now,
          )
          db.prepare(
            `INSERT INTO sub_chats (
              id, chat_id, name, mode, harness, model, permission_mode, worktree_path,
              run_status, messages, created_at, updated_at
            ) VALUES (?, ?, ?, 'agent', ?, ?, ?, ?, 'running', '[]', ?, ?)`,
          ).run(
            identities.subChatId,
            identities.chatId,
            name,
            target.harness,
            target.model,
            preview.authorityCeiling.permissionMode,
            preview.worktreeLease.path,
            now,
            now,
          )
          const runtimeSnapshot = constructRuntimeSnapshot(db, {
            chatId: identities.chatId,
            harness: target.harness,
            model: target.model,
            permission: runtimePermissionSnapshot(
              preview.authorityCeiling.permissionMode,
              customPermissions,
            ),
            adapterProbes: { [target.runtime]: confirmedProbe },
          })
          if (runtimeSnapshot.resolvedRuntime !== target.runtime) {
            throw new CrossProviderDelegationError(
              "preview-mismatch",
              "Runtime resolution changed after the exact target preview.",
            )
          }
          const attempt = {
            attemptId: identities.attemptId,
            attemptNumber,
            priorAttemptId: input.priorAttemptId ?? null,
          }
          const taskEnvelope = crossProviderTaskEnvelopeSchema.parse({
            version: 1,
            idempotencyKey: input.requestId,
            previewDigest: preview.digest,
            mode: "delegate",
            initiatorChatId: String(source.initiator_chat_id ?? input.sourceChatId),
            parentChatId: input.sourceChatId,
            ancestorChatIds: [...ancestors, input.sourceChatId],
            attempt,
            targetSnapshot: target,
            objective: input.objective,
            visibleContextManifest: preview.visibleContextManifest,
            fileAndArtifactRefs: [
              ...preview.visibleContextManifest.selectedFileRefs,
              ...preview.visibleContextManifest.selectedArtifactRefs,
            ],
            requiredCapabilities: preview.requiredCapabilities,
            outputSchema: input.outputSchema ?? null,
            permissionCeiling: preview.authorityCeiling,
            worktreeLeaseId: preview.worktreeLease.leaseId,
            deadline: input.deadline ?? null,
          })
          const prompt = [
            "# Cross-provider delegated task",
            "",
            input.objective.trim(),
            "",
            preview.contextText,
            "",
            "Return only visible task output. Do not request or reconstruct private reasoning, credentials, provider session state, or hidden tool state.",
          ].join("\n")
          db.prepare(
            `INSERT INTO agent_runs (
              id, chat_id, sub_chat_id, harness, model, permission_mode, custom_permissions,
              worktree_path, prompt_message_id, initial_prompt, runtime_snapshot_version,
              runtime_preference, runtime_preference_source, resolved_runtime,
              runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot,
              runtime_control_snapshot, status, started_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          ).run(
            identities.runId,
            identities.chatId,
            identities.subChatId,
            target.harness,
            target.model,
            preview.authorityCeiling.permissionMode,
            customPermissions ? JSON.stringify(customPermissions) : null,
            preview.worktreeLease.path,
            `runtime-delegation-${identities.attemptId}`,
            prompt,
            ...runtimeSnapshotSqlValues(runtimeSnapshot),
            now,
          )
          const claim = claimPendingRunWithinUsageBudget(db, identities.runId)
          if (!claim.claimed) {
            throw new CrossProviderDelegationError(
              "attempt-conflict",
              "Delegation Runtime run could not claim its exact usage budget reservation.",
            )
          }
          db.prepare(
            `INSERT INTO runtime_composition_attempts (
              attempt_id, idempotency_key, prior_attempt_id, attempt_number, mode,
              source_chat_id, child_chat_id, child_sub_chat_id, run_id, preview_digest,
              target_snapshot, task_envelope, result_envelope, worktree_path,
              worktree_lease_id, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'delegate', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'running', ?, ?)`,
          ).run(
            identities.attemptId,
            input.requestId,
            input.priorAttemptId ?? null,
            attemptNumber,
            input.sourceChatId,
            identities.chatId,
            identities.subChatId,
            identities.runId,
            preview.digest,
            JSON.stringify(target),
            JSON.stringify(taskEnvelope),
            preview.worktreeLease.path,
            preview.worktreeLease.leaseId,
            now,
            now,
          )
          return {
            attemptId: identities.attemptId,
            attemptNumber,
            childChatId: identities.chatId,
            childSubChatId: identities.subChatId,
            runId: identities.runId,
            status: "running" as const,
            previewDigest: preview.digest,
            result: null,
            created: true,
          }
        })
        .immediate()
    } finally {
      db.close()
    }

    if (reference.created) this.launch(reference.runId)
    else if (reference.status === "running") void this.reconcile(reference.attemptId)
    return reference
  }

  async reconcile(attemptId: string): Promise<CrossProviderDelegationReference> {
    const row = this.requireAttempt(attemptId)
    if (isTerminal(String(row.status))) return referenceFromRow(row, false)
    const state = await this.runtime.reconcileRun(String(row.run_id))
    if (state === "running") return referenceFromRow(this.requireAttempt(attemptId), false)
    return await this.finalize(attemptId, state)
  }

  async cancel(attemptId: string, reason: string): Promise<CrossProviderDelegationReference> {
    const db = this.open()
    let row: Row
    try {
      row = db
        .transaction(() => {
          const current = requireAttempt(db, attemptId)
          if (isTerminal(String(current.status))) return current
          const now = nowEpochSeconds()
          db.prepare(
            `UPDATE runtime_composition_attempts
             SET cancellation_requested_at = COALESCE(cancellation_requested_at, ?), updated_at = ?
             WHERE attempt_id = ? AND status = 'running'`,
          ).run(now, now, attemptId)
          return requireAttempt(db, attemptId)
        })
        .immediate()
    } finally {
      db.close()
    }
    if (isTerminal(String(row.status))) return referenceFromRow(row, false)
    await this.runtime.cancel(String(row.run_id), reason)
    return await this.reconcile(attemptId)
  }

  async recoverRunningAttempts(limit = 128): Promise<RuntimeRecoverySweep> {
    const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 128
    const boundedLimit = Math.max(1, Math.min(requestedLimit, 1_000))
    if (this.recoveryUpperBound === undefined) {
      const snapshotDb = this.open()
      try {
        this.recoveryUpperBound = (
          snapshotDb
            .prepare(
              "SELECT MAX(attempt_id) attempt_id FROM runtime_composition_attempts WHERE status = 'running'",
            )
            .get() as { attempt_id: string | null }
        ).attempt_id
        this.recoveryCursor = ""
        this.recoverySweep = newRecoverySweepProgress()
      } finally {
        snapshotDb.close()
      }
    }

    let attemptIds: string[] = []
    let hasMore = false
    if (this.recoveryUpperBound) {
      const db = this.open()
      try {
        const rows = (
          db
            .prepare(
              `SELECT attempt_id FROM runtime_composition_attempts
               WHERE status = 'running' AND attempt_id > ? AND attempt_id <= ?
               ORDER BY attempt_id LIMIT ?`,
            )
            .all(this.recoveryCursor, this.recoveryUpperBound, boundedLimit + 1) as Array<{
            attempt_id: string
          }>
        ).map((row) => row.attempt_id)
        hasMore = rows.length > boundedLimit
        attemptIds = rows.slice(0, boundedLimit)
      } finally {
        db.close()
      }
    }

    const sweep = this.recoverySweep
    let attempted = 0
    let failed = 0
    for (const attemptId of attemptIds) {
      const blocked = this.recoveryFailures.get(attemptId)
      if (blocked) sweep.observedFailures.add(attemptId)
      if (blocked?.quarantined) continue
      if (blocked && blocked.retryAt > Date.now()) {
        sweep.earliestRetryAt = earlier(sweep.earliestRetryAt, blocked.retryAt)
        continue
      }
      attempted += 1
      try {
        await this.reconcile(attemptId)
        this.clearRecoveryFailure(attemptId, sweep)
        sweep.actionable += 1
      } catch {
        try {
          await this.finalize(attemptId, "uncertain")
          this.clearRecoveryFailure(attemptId, sweep)
          sweep.actionable += 1
        } catch {
          failed += 1
          const state = this.recordRecoveryFailure(attemptId, sweep)
          if (!state.quarantined) {
            sweep.earliestRetryAt = earlier(sweep.earliestRetryAt, state.retryAt)
          }
        }
      }
    }
    if (attemptIds.length > 0) this.recoveryCursor = attemptIds.at(-1)!
    if (!hasMore) {
      this.recoveryUpperBound = undefined
      // The completed sweep saw every running attempt, so failure state it never observed
      // belongs to an attempt that has since become terminal.
      for (const attemptId of this.recoveryFailures.keys()) {
        if (!sweep.observedFailures.has(attemptId)) this.recoveryFailures.delete(attemptId)
      }
    }

    const remainingDb = this.open()
    try {
      const remaining = (
        remainingDb
          .prepare(
            "SELECT COUNT(*) count FROM runtime_composition_attempts WHERE status = 'running'",
          )
          .get() as { count: number }
      ).count
      return {
        attempted,
        failed,
        remaining,
        quarantined: this.quarantinedCount(),
        retryAfterMs: this.recoveryRetryAfterMs(remaining, hasMore, sweep),
      }
    } finally {
      remainingDb.close()
    }
  }

  private recoveryRetryAfterMs(
    remaining: number,
    hasMore: boolean,
    sweep: RecoverySweepProgress,
  ): number | null {
    if (remaining <= 0) return null
    if (hasMore || sweep.actionable > 0) return 0
    if (sweep.earliestRetryAt === null) return null
    return Math.max(0, sweep.earliestRetryAt - Date.now())
  }

  private recordRecoveryFailure(
    attemptId: string,
    sweep: RecoverySweepProgress,
  ): RecoveryFailureState {
    const failures = (this.recoveryFailures.get(attemptId)?.failures ?? 0) + 1
    const quarantined = failures >= RECOVERY_MAX_FAILURES
    const backoff = Math.min(RECOVERY_RETRY_MAX_MS, RECOVERY_RETRY_BASE_MS * 2 ** (failures - 1))
    const state: RecoveryFailureState = {
      failures,
      quarantined,
      retryAt: Date.now() + backoff,
    }
    this.recoveryFailures.set(attemptId, state)
    sweep.observedFailures.add(attemptId)
    return state
  }

  private clearRecoveryFailure(attemptId: string, sweep: RecoverySweepProgress): void {
    this.recoveryFailures.delete(attemptId)
    sweep.observedFailures.delete(attemptId)
  }

  private quarantinedCount(): number {
    let count = 0
    for (const state of this.recoveryFailures.values()) if (state.quarantined) count += 1
    return count
  }

  private launch(runId: string): void {
    const run = loadRunningAgentRun(this.databasePath, runId)
    if (!run) {
      void this.finalizeByRun(runId, "uncertain")
      return
    }
    void this.runtime
      .launch(run)
      .then(() => this.reconcileByRun(runId))
      .catch(async () => {
        try {
          await this.reconcileByRun(runId)
        } catch {
          await this.finalizeByRun(runId, "uncertain")
        }
      })
  }

  private async reconcileByRun(runId: string) {
    const attemptId = this.attemptIdForRun(runId)
    if (attemptId) await this.reconcile(attemptId)
  }

  private async finalizeByRun(
    runId: string,
    state: "completed" | "cancelled" | "failed" | "uncertain",
  ) {
    const attemptId = this.attemptIdForRun(runId)
    if (attemptId) await this.finalize(attemptId, state)
  }

  private async finalize(
    attemptId: string,
    state: "completed" | "cancelled" | "failed" | "uncertain",
  ): Promise<CrossProviderDelegationReference> {
    const before = this.requireAttempt(attemptId)
    if (isTerminal(String(before.status))) return referenceFromRow(before, false)
    const runId = String(before.run_id)
    const structured =
      state === "completed" && this.runtime.readStructuredOutput
        ? await this.runtime.readStructuredOutput(runId)
        : null
    const taskEnvelope = crossProviderTaskEnvelopeSchema.parse(
      JSON.parse(String(before.task_envelope)),
    )
    let acceptedStructuredOutput = structured?.value ?? null
    const outputLimitations: string[] = []
    let barrierFailed = false
    if (state === "completed") {
      if (structured && !isDelegationValueSecretSafe(structured.value, "structured-output")) {
        barrierFailed = true
        acceptedStructuredOutput = null
        outputLimitations.push("Secret-bearing structured output was blocked.")
      } else if (taskEnvelope.outputSchema && !structured) {
        barrierFailed = true
        outputLimitations.push("Required structured output was absent.")
      } else if (taskEnvelope.outputSchema && structured) {
        try {
          validateJsonSchema(
            taskEnvelope.outputSchema,
            structured.value,
            "Delegation structured output",
          )
        } catch (error) {
          barrierFailed = true
          acceptedStructuredOutput = null
          outputLimitations.push(
            error instanceof Error
              ? `Structured output failed validation: ${error.message}`
              : "Structured output failed validation.",
          )
        }
      }
    }
    const db = this.open()
    try {
      return db
        .transaction(() => {
          const current = requireAttempt(db, attemptId)
          if (isTerminal(String(current.status))) return referenceFromRow(current, false)
          const target = JSON.parse(String(current.target_snapshot))
          const highWater = tableExists(db, "agent_activity_events")
            ? Number(
                (
                  db
                    .prepare(
                      "SELECT COALESCE(MAX(sequence), 0) value FROM agent_activity_events WHERE run_id = ?",
                    )
                    .get(runId) as { value: number }
                ).value,
              )
            : 0
          const usageRefs = tableExists(db, "usage_samples")
            ? (
                db
                  .prepare(
                    `SELECT id, provider_id, account_tag, model
                     FROM usage_samples WHERE run_id = ? OR attribution_run_id = ?
                     GROUP BY id ORDER BY captured_at, id`,
                  )
                  .all(runId, runId) as Row[]
              ).map((usage) => ({
                usageRecordId: String(usage.id),
                runId,
                provider: String(usage.provider_id),
                accountId: stringOrNull(usage.account_tag),
                model: stringOrNull(usage.model),
                runtime: target.runtime,
              }))
            : []
          let summary = readVisibleSummary(db, runId)
          if (summary && !isDelegationValueSecretSafe(summary, "visible-summary")) {
            barrierFailed = true
            acceptedStructuredOutput = null
            summary = ""
            outputLimitations.push("Secret-bearing visible result summary was blocked.")
          }
          const status =
            state === "completed"
              ? barrierFailed
                ? "failure"
                : "success"
              : state === "failed"
                ? "failure"
                : state
          const cancellationRequestedAt = epochIso(current.cancellation_requested_at)
          const result = crossProviderResultEnvelopeSchema.parse({
            version: 1,
            taskEnvelopeVersion: 1,
            childChatId: String(current.child_chat_id),
            runId,
            attempt: {
              attemptId,
              attemptNumber: Number(current.attempt_number),
              priorAttemptId: stringOrNull(current.prior_attempt_id),
            },
            targetSnapshot: target,
            status,
            structuredOutput: acceptedStructuredOutput,
            visibleSummary: summary,
            artifactAndChangeRefs: [],
            checkpointRefs: [],
            usageRefs,
            activityRefs: [{ runId, afterSequence: highWater }],
            partial: status !== "success" && Boolean(summary),
            cancellationRequestedAt,
            limitations:
              outputLimitations.length > 0
                ? outputLimitations
                : structured || state !== "completed"
                  ? []
                  : ["No structured output was produced."],
            warnings:
              state === "uncertain" ? ["Provider state is uncertain; work was not replayed."] : [],
            terminalEvidence: {
              reconciledAt: new Date().toISOString(),
              providerTerminalState: state,
              activityHighWater: highWater,
            },
          })
          const now = nowEpochSeconds()
          const update = db
            .prepare(
              `UPDATE runtime_composition_attempts
               SET status = ?, result_envelope = ?, terminal_at = ?, updated_at = ?
               WHERE attempt_id = ? AND status = 'running'`,
            )
            .run(status, JSON.stringify(result), now, now, attemptId)
          if (update.changes === 0) return referenceFromRow(requireAttempt(db, attemptId), false)
          db.prepare(`UPDATE sub_chats SET run_status = ?, updated_at = ? WHERE id = ?`).run(
            status,
            now,
            current.child_sub_chat_id,
          )
          return referenceFromRow(requireAttempt(db, attemptId), false)
        })
        .immediate()
    } finally {
      db.close()
    }
  }

  private requireAttempt(attemptId: string): Row {
    const db = this.open()
    try {
      return requireAttempt(db, attemptId)
    } finally {
      db.close()
    }
  }

  private attemptIdForRun(runId: string): string | null {
    const db = this.open()
    try {
      const row = db
        .prepare("SELECT attempt_id FROM runtime_composition_attempts WHERE run_id = ?")
        .get(runId) as { attempt_id: string } | undefined
      return row?.attempt_id ?? null
    } finally {
      db.close()
    }
  }

  private open() {
    const db = openAppDatabase(this.databasePath)
    db.pragma("foreign_keys = ON")
    db.pragma("busy_timeout = 5000")
    return db
  }
}

function newRecoverySweepProgress(): RecoverySweepProgress {
  return { actionable: 0, earliestRetryAt: null, observedFailures: new Set() }
}

function earlier(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.min(current, candidate)
}

function rebuildPreview(
  base: RuntimeContinuationPreview,
  authority: DelegationAuthorityCeiling,
  availability: RuntimeCompositionPreview["availability"],
): RuntimeContinuationPreview {
  const targetSnapshot = executionTargetSchema.parse({
    ...base.targetSnapshot,
    permission: {
      mode: authority.permissionMode,
      customPermissions: authority.customPermissions,
    },
  })
  const body = {
    schemaVersion: 1 as const,
    mode: "delegate" as const,
    objectiveDigest: base.objectiveDigest,
    requiredCapabilities: base.requiredCapabilities,
    outputSchemaDigest: base.outputSchemaDigest,
    targetSnapshot,
    visibleContextManifest: base.visibleContextManifest,
    authorityCeiling: authority,
    worktreeLease: base.worktreeLease,
    availability,
  }
  return {
    ...body,
    digest: sha256(canonicalJson(body)),
    contextText: base.contextText,
    visibleMessageCount: base.visibleMessageCount,
  }
}

function narrowAuthority(
  parent: DelegationAuthorityCeiling,
  restrictions?: CrossProviderDelegationInput["authorityRestrictions"],
): DelegationAuthorityCeiling {
  const parentCapabilities = capabilitiesForAuthority(
    parent.permissionMode,
    parent.customPermissions,
  )
  const parentCanonicalTiers = toolTiersFor(parent.permissionMode, parent.customPermissions)
  if (
    !sameStringSet(parent.allowedToolTiers, parentCanonicalTiers) ||
    parent.network !== parentCapabilities.network > 0
  ) {
    throw new CrossProviderDelegationError(
      "authority-widening",
      "Parent delegation authority does not match exact enforceable permission controls.",
    )
  }
  if (!restrictions) return parent
  const permissionMode = restrictions.permissionMode ?? parent.permissionMode
  const customPermissions = requestedCustomPermissions(parent, permissionMode, restrictions)
  const requestedCapabilities = capabilitiesForAuthority(permissionMode, customPermissions)
  if (!capabilityLevelsNarrow(parentCapabilities, requestedCapabilities)) {
    throw new CrossProviderDelegationError(
      "authority-widening",
      "Delegation permission capabilities or approval authority cannot exceed the parent ceiling.",
    )
  }
  const canonicalTiers = toolTiersFor(permissionMode, customPermissions)
  const requestedTiers = restrictions.allowedToolTiers ?? canonicalTiers
  if (
    !sameStringSet(requestedTiers, canonicalTiers) ||
    requestedTiers.some((tier) => !parent.allowedToolTiers.includes(tier))
  ) {
    throw new CrossProviderDelegationError(
      "authority-widening",
      "Delegation tool tiers must exactly match controls enforced by the selected permission mode.",
    )
  }
  const network = requestedCapabilities.network > 0
  if (restrictions.network !== undefined && restrictions.network !== network) {
    throw new CrossProviderDelegationError(
      "authority-widening",
      "Delegation network authority must match the selected enforced permission controls.",
    )
  }
  if (network && !parent.network) {
    throw new CrossProviderDelegationError(
      "authority-widening",
      "Delegation cannot enable network access beyond the parent ceiling.",
    )
  }
  return {
    ...parent,
    permissionMode,
    customPermissions,
    allowedToolTiers: canonicalTiers,
    network,
    maxDescendantDepth: Math.min(
      parent.maxDescendantDepth,
      restrictions.maxDescendantDepth ?? parent.maxDescendantDepth,
    ),
    tokenBudget: minimumNullable(parent.tokenBudget, restrictions.tokenBudget),
    costBudgetMicros: minimumNullable(parent.costBudgetMicros, restrictions.costBudgetMicros),
  }
}

type CapabilityLevels = Record<(typeof customPermissionCapabilityKeys)[number], 0 | 1 | 2>

function requestedCustomPermissions(
  parent: DelegationAuthorityCeiling,
  permissionMode: DelegationAuthorityCeiling["permissionMode"],
  restrictions: NonNullable<CrossProviderDelegationInput["authorityRestrictions"]>,
): CustomPermissionCapabilities | null {
  if (permissionMode !== "custom") {
    if (restrictions.customPermissions !== undefined && restrictions.customPermissions !== null) {
      throw new CrossProviderDelegationError(
        "authority-widening",
        "Custom capabilities require the custom delegation permission mode.",
      )
    }
    return null
  }
  const requested = restrictions.customPermissions
  if (requested !== undefined && requested !== null) {
    const parsed = customPermissionCapabilitiesSchema.safeParse(requested)
    if (!parsed.success) {
      throw new CrossProviderDelegationError(
        "authority-widening",
        "Custom delegation capabilities must use the exact versioned capability schema.",
      )
    }
    return parsed.data
  }
  if (parent.permissionMode === "custom" && parent.customPermissions) {
    return parent.customPermissions
  }
  throw new CrossProviderDelegationError(
    "authority-widening",
    "Changing to custom delegation permission requires explicit enforceable capabilities.",
  )
}

function capabilitiesForAuthority(
  mode: DelegationAuthorityCeiling["permissionMode"],
  customPermissions: CustomPermissionCapabilities | null,
): CapabilityLevels {
  const levels = Object.fromEntries(
    customPermissionCapabilityKeys.map((key) => [key, 0 as const]),
  ) as CapabilityLevels
  if (mode === "read-only") return levels
  if (mode === "auto-edit-project-only") {
    levels.projectWrite = 2
    return levels
  }
  if (mode === "ask-before-edits") {
    for (const key of customPermissionCapabilityKeys) levels[key] = 1
    return levels
  }
  if (mode === "full-access") {
    for (const key of customPermissionCapabilityKeys) levels[key] = 2
    return levels
  }
  if (!customPermissions) {
    throw new CrossProviderDelegationError(
      "authority-widening",
      "Custom parent authority is missing exact enforceable capabilities.",
    )
  }
  for (const key of customPermissionCapabilityKeys) {
    levels[key] = customPermissions[key] ? 2 : 0
  }
  return levels
}

function capabilityLevelsNarrow(parent: CapabilityLevels, requested: CapabilityLevels): boolean {
  return customPermissionCapabilityKeys.every((key) => requested[key] <= parent[key])
}

function toolTiersFor(
  mode: DelegationAuthorityCeiling["permissionMode"],
  customPermissions: CustomPermissionCapabilities | null,
): DelegationAuthorityCeiling["allowedToolTiers"] {
  if (mode === "read-only") return ["read"]
  if (mode === "auto-edit-project-only") return ["read", "project-write"]
  if (mode === "ask-before-edits" || mode === "full-access") {
    return ["read", "project-write", "shell", "git", "network"]
  }
  if (!customPermissions) {
    throw new CrossProviderDelegationError(
      "authority-widening",
      "Custom delegation authority is missing enforceable capabilities.",
    )
  }
  return [
    "read",
    ...(customPermissions.projectWrite ? (["project-write"] as const) : []),
    ...(customPermissions.shell ? (["shell"] as const) : []),
    ...(customPermissions.git ? (["git"] as const) : []),
    ...(customPermissions.network ? (["network"] as const) : []),
  ]
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    left.every((value) => right.includes(value))
  )
}

function minimumNullable(
  parent: number | null,
  requested: number | null | undefined,
): number | null {
  if (requested === undefined) return parent
  if (parent === null) return requested
  if (requested === null) return parent
  return Math.min(parent, requested)
}

function referenceFromRow(row: Row, created: boolean): CrossProviderDelegationReference {
  return {
    attemptId: String(row.attempt_id),
    attemptNumber: Number(row.attempt_number),
    childChatId: String(row.child_chat_id),
    childSubChatId: String(row.child_sub_chat_id),
    runId: String(row.run_id),
    status: String(row.status) as CrossProviderDelegationReference["status"],
    previewDigest: String(row.preview_digest),
    result: row.result_envelope
      ? crossProviderResultEnvelopeSchema.parse(JSON.parse(String(row.result_envelope)))
      : null,
    created,
  }
}

function assertMatchingIdempotentIntent(
  row: Row,
  input: CrossProviderDelegationInput,
  previewDigest: string,
): void {
  let taskEnvelope: CrossProviderTaskEnvelope
  try {
    taskEnvelope = crossProviderTaskEnvelopeSchema.parse(JSON.parse(String(row.task_envelope)))
  } catch {
    throw new CrossProviderDelegationError(
      "attempt-conflict",
      "Existing delegation intent is corrupt and cannot satisfy an idempotent retry.",
    )
  }
  const storedPriorAttemptId =
    row.prior_attempt_id === null || row.prior_attempt_id === undefined
      ? null
      : String(row.prior_attempt_id)
  const requestedPriorAttemptId = input.priorAttemptId ?? null
  if (
    String(row.mode) !== "delegate" ||
    String(row.source_chat_id) !== input.sourceChatId ||
    String(row.preview_digest) !== previewDigest ||
    storedPriorAttemptId !== requestedPriorAttemptId ||
    taskEnvelope.idempotencyKey !== input.requestId ||
    taskEnvelope.previewDigest !== previewDigest ||
    taskEnvelope.mode !== "delegate" ||
    taskEnvelope.parentChatId !== input.sourceChatId ||
    taskEnvelope.attempt.priorAttemptId !== requestedPriorAttemptId ||
    taskEnvelope.objective !== input.objective.trim() ||
    taskEnvelope.deadline !== (input.deadline ?? null)
  ) {
    throw new CrossProviderDelegationError(
      "attempt-conflict",
      "Delegation request identity is already bound to a different exact launch intent.",
    )
  }
}

function requireChat(db: Database.Database, chatId: string): Row {
  const row = db.prepare("SELECT * FROM chats WHERE id = ? AND archived_at IS NULL").get(chatId) as
    Row | undefined
  if (!row) throw new RuntimeChatLifecycleError("chat-missing", "Source Chat is missing.")
  return row
}

function requireAttempt(db: Database.Database, attemptId: string): Row {
  const row = db
    .prepare("SELECT * FROM runtime_composition_attempts WHERE attempt_id = ?")
    .get(attemptId) as Row | undefined
  if (!row) {
    throw new CrossProviderDelegationError("stale-attempt", "Delegation attempt is missing.")
  }
  return row
}

function delegationIdentities(sourceChatId: string, requestId: string) {
  const digest = createHash("sha256")
    .update(`${sourceChatId}\0delegate\0${requestId}`)
    .digest("hex")
  return {
    attemptId: `runtime-attempt-${digest.slice(0, 32)}`,
    chatId: `runtime-delegation-${digest.slice(0, 32)}`,
    subChatId: `runtime-delegation-conversation-${digest.slice(0, 32)}`,
    runId: `runtime-delegation-run-${digest.slice(0, 32)}`,
  }
}

function readVisibleSummary(db: Database.Database, runId: string): string {
  if (!tableExists(db, "agent_activity_events")) return ""
  const rows = db
    .prepare(
      `SELECT payload_json FROM agent_activity_events
       WHERE run_id = ? AND kind = 'agent-text' AND privacy_class = 'public'
       ORDER BY sequence`,
    )
    .all(runId) as Array<{ payload_json: string }>
  return rows
    .flatMap((row) => {
      try {
        const payload = JSON.parse(row.payload_json) as { text?: unknown }
        return typeof payload.text === "string" ? [payload.text] : []
      } catch {
        return []
      }
    })
    .join("\n")
    .slice(0, 100_000)
}

function isTerminal(status: string) {
  return ["success", "failure", "cancelled", "uncertain"].includes(status)
}

function parseIds(value: unknown): string[] {
  if (typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : []
  } catch {
    return []
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  )
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function epochIso(value: unknown): string | null {
  return typeof value === "number" ? new Date(value * 1_000).toISOString() : null
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function assertDelegationObjectiveSafe(objective: string): void {
  try {
    assertNoSecretText(objective, "cross-provider delegation objective")
  } catch {
    throw new CrossProviderDelegationError(
      "secret-detected",
      "Cross-provider delegation objective contains detected secret material.",
    )
  }
}

function isDelegationValueSecretSafe(value: unknown, path: string): boolean {
  if (!isBoundedJsonValue(value)) return false
  try {
    const scan = sanitizeStructuredValue(value, {
      scopeId: "settings",
      path: `cross-provider-delegation/${path}`,
    })
    return !scan.secretFound && !JSON.stringify(scan.value).includes(PORTABLE_SECRET_PLACEHOLDER)
  } catch {
    return false
  }
}

function isBoundedJsonValue(value: unknown): boolean {
  const seen = new WeakSet<object>()
  let nodes = 0
  let bytes = 0
  const visit = (current: unknown, depth: number): boolean => {
    nodes += 1
    if (nodes > 2_000 || depth > 12) return false
    if (current === null || typeof current === "boolean") return true
    if (typeof current === "number") return Number.isFinite(current)
    if (typeof current === "string") {
      bytes += Buffer.byteLength(current, "utf8")
      return bytes <= 200_000
    }
    if (typeof current !== "object") return false
    if (seen.has(current)) return false
    seen.add(current)
    if (Array.isArray(current)) {
      return current.length <= 1_000 && current.every((entry) => visit(entry, depth + 1))
    }
    const prototype = Object.getPrototypeOf(current)
    if (prototype !== Object.prototype && prototype !== null) return false
    const entries = Object.entries(current as Record<string, unknown>)
    if (entries.length > 1_000) return false
    return entries.every(([key, nested]) => {
      bytes += Buffer.byteLength(key, "utf8")
      return bytes <= 200_000 && visit(nested, depth + 1)
    })
  }
  return visit(value, 0)
}
