import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AutomationExecutionService,
  type AutomationExecutionServiceOptions,
} from "../src/main/lib/automation/execution"
import type { LeasedAutomationOccurrence } from "../src/main/lib/automation/scheduler"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import type { QueuedAgentRun } from "../src/main/lib/run-launch-service"

const migrations = resolve(process.cwd(), "drizzle")
const directories: string[] = []
const databases: Database.Database[] = []

afterEach(() => {
  for (const database of databases.splice(0)) if (database.open) database.close()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("bounded automation execution", () => {
  it("dry-runs target, authority, worktree, and budget without launching or writing", () => {
    const fixture = database("dry-run")
    seedRunnable(fixture.sqlite, fixture.directory)
    const launch = vi.fn()
    const service = execution(fixture.path, { launch })
    const before = tableCounts(fixture.sqlite)

    const preview = service.dryRun("automation-1", "occurrence-1")

    expect(preview).toMatchObject({
      automationId: "automation-1",
      occurrenceId: "occurrence-1",
      launchKind: "run",
      harness: "codex",
      prompt: "Review the approved target.",
      target: { projectId: "project-1", chatId: "chat-1", subChatId: "sub-chat-1" },
      worktreeSnapshot: { path: fixture.directory, source: "chat" },
      budget: { maxConcurrentRuns: 1 },
      launchable: true,
    })
    expect(preview.authoritySnapshot).toMatchObject({
      approvalState: "approved",
      permissionMode: "read-only",
      approvalAuditId: "audit-1",
    })
    expect(tableCounts(fixture.sqlite)).toEqual(before)
    expect(launch).not.toHaveBeenCalled()
  })

  it("launches one normal run and retains snapshots, usage, checkpoints, manifest, and summary", async () => {
    const fixture = database("success")
    const occurrence = seedRunnable(fixture.sqlite, fixture.directory)
    const launch = vi.fn(async (run: QueuedAgentRun) => {
      fixture.sqlite
        .prepare("UPDATE agent_runs SET status = 'success', completed_at = 1100 WHERE id = ?")
        .run(run.runId)
      fixture.sqlite
        .prepare(
          `INSERT INTO checkpoints (id, run_id, kind, worktree_path)
           VALUES ('before-1', ?, 'before', ?), ('after-1', ?, 'after', ?)`,
        )
        .run(run.runId, fixture.directory, run.runId, fixture.directory)
      fixture.sqlite
        .prepare(
          `INSERT INTO file_change_manifests
             (id, run_id, file_path, change_type, additions, deletions)
           VALUES ('manifest-1', ?, '', 'none', 0, 0)`,
        )
        .run(run.runId)
      insertUsage(fixture.sqlite, run.runId, 42, 700)
    })
    const service = execution(fixture.path, { launch, now: () => 1_000 })

    const result = await service.execute(occurrence)

    expect(result).toMatchObject({
      state: "succeeded",
      attempt: 1,
      stopReason: null,
      retryScheduledAt: null,
      resultSummary: {
        outcome: "succeeded",
        usage: { totalTokens: 42, costUsdMicros: 700 },
        evidence: { beforeCheckpoints: 1, afterCheckpoints: 1, manifestEntries: 1 },
      },
    })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(
      fixture.sqlite
        .prepare(
          "SELECT state, run_id, authority_snapshot, budget_snapshot, result_summary FROM automation_executions",
        )
        .get(),
    ).toMatchObject({ state: "succeeded", run_id: result.runId })
    expect(
      JSON.parse(
        String(
          (
            fixture.sqlite
              .prepare("SELECT authority_snapshot value FROM automation_executions")
              .get() as {
              value: string
            }
          ).value,
        ),
      ),
    ).toMatchObject({ permissionMode: "read-only", worktree: { path: fixture.directory } })
    expect(fixture.sqlite.prepare("SELECT state FROM automation_occurrences").get()).toEqual({
      state: "completed",
    })
    expect(fixture.sqlite.prepare("SELECT kind FROM automation_inbox_items").get()).toEqual({
      kind: "completed",
    })
  })

  it("launches create-task actions through the bounded orchestration service", async () => {
    const fixture = database("orchestration")
    const occurrence = seedRunnable(fixture.sqlite, fixture.directory)
    fixture.sqlite
      .prepare(
        `UPDATE automations SET
           scope_type = 'project', project_id = 'project-1', chat_id = NULL,
           action_type = 'create-task-run',
           action_config = '{"type":"create-task-run","taskName":"Automated task"}',
           worktree_strategy = 'none'
         WHERE id = 'automation-1'`,
      )
      .run()
    const launch = vi.fn(async () => undefined)

    const result = await execution(fixture.path, { launch, now: () => 1_000 }).execute(occurrence)

    expect(result.state, JSON.stringify(result)).toBe("succeeded")
    expect(result.resultSummary).toMatchObject({ launchKind: "orchestration" })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(fixture.sqlite.prepare("SELECT name FROM tasks").get()).toEqual({
      name: "Automated task",
    })
    expect(fixture.sqlite.prepare("SELECT status FROM task_orchestrations").get()).toEqual({
      status: "completed",
    })
    expect(
      fixture.sqlite
        .prepare("SELECT COUNT(*) count FROM orchestration_agents WHERE run_id = ?")
        .get(result.runId),
    ).toEqual({ count: 1 })
    expect(
      fixture.sqlite
        .prepare(
          "SELECT harness, mcp_exposure_enabled FROM chats WHERE name = 'Automation: Review'",
        )
        .get(),
    ).toEqual({ harness: "codex", mcp_exposure_enabled: 1 })
  })

  it.each([
    ["codex", null],
    ["claude-code", null],
    ["cursor-agent", null],
    ["openrouter", "openai/gpt-5"],
    ["nanogpt", "openai/gpt-5"],
  ] as const)(
    "persists product MCP exposure for automation-created %s chats",
    async (harness, model) => {
      const fixture = database(`create-chat-${harness}`)
      const occurrence = seedRunnable(fixture.sqlite, fixture.directory)
      fixture.sqlite
        .prepare(
          `UPDATE automations SET
             scope_type = 'project', project_id = 'project-1', chat_id = NULL,
             action_type = 'create-chat-run',
             action_config = '{"type":"create-chat-run","chatName":"Automated review"}',
             harness = ?, model = ?
           WHERE id = 'automation-1'`,
        )
        .run(harness, model)

      const result = await execution(fixture.path, {
        launch: vi.fn(async () => undefined),
        now: () => 1_000,
      }).execute(occurrence)

      expect(result.state, JSON.stringify(result)).toBe("succeeded")
      expect(
        fixture.sqlite
          .prepare(
            "SELECT harness, mcp_exposure_enabled FROM chats WHERE name = 'Automated review'",
          )
          .get(),
      ).toEqual({ harness, mcp_exposure_enabled: 1 })
    },
  )

  it("records a denied terminal result when approval is no longer runnable", async () => {
    const fixture = database("deny")
    const occurrence = seedRunnable(fixture.sqlite, fixture.directory)
    fixture.sqlite
      .prepare("UPDATE automations SET enabled = 0, state = 'paused' WHERE id = 'automation-1'")
      .run()
    const launch = vi.fn()

    const result = await execution(fixture.path, { launch }).execute(occurrence)

    expect(result).toMatchObject({ state: "denied", stopReason: "approval-denied", runId: null })
    expect(launch).not.toHaveBeenCalled()
    expect(fixture.sqlite.prepare("SELECT state FROM automation_executions").get()).toEqual({
      state: "denied",
    })
  })

  it("retries a crash once, respects attempt and deadline bounds, then succeeds", async () => {
    const fixture = database("retry")
    const firstLease = seedRunnable(fixture.sqlite, fixture.directory, {
      retry: {
        mode: "exponential",
        maxAttempts: 2,
        initialDelayMs: 100,
        maxDelayMs: 100,
        deadlineMs: 500,
      },
    })
    let attempt = 0
    const launch = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error("provider process crashed")
    })
    let now = 1_000
    const service = execution(fixture.path, { launch, now: () => now })

    const crashed = await service.execute(firstLease)
    expect(crashed).toMatchObject({
      state: "failed",
      attempt: 1,
      stopReason: "launch-crash",
      retryScheduledAt: 1_100,
    })
    expect(
      fixture.sqlite.prepare("SELECT state, scheduled_for FROM automation_occurrences").get(),
    ).toEqual({
      state: "pending",
      scheduled_for: 1_100,
    })

    now = 1_100
    const secondLease = leaseExisting(fixture.sqlite, now)
    const succeeded = await service.execute(secondLease)
    expect(succeeded).toMatchObject({ state: "succeeded", attempt: 2, retryScheduledAt: null })
    expect(launch).toHaveBeenCalledTimes(2)
    expect(
      fixture.sqlite
        .prepare("SELECT attempt, state FROM automation_executions ORDER BY attempt")
        .all(),
    ).toEqual([
      { attempt: 1, state: "failed" },
      { attempt: 2, state: "succeeded" },
    ])
  })

  it("does not retry after the persisted wall-clock retry deadline", async () => {
    const fixture = database("retry-deadline")
    const occurrence = seedRunnable(fixture.sqlite, fixture.directory, {
      retry: {
        mode: "exponential",
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 100,
        deadlineMs: 100,
      },
    })
    let now = 1_000
    const launch = vi.fn(async () => {
      now = 1_150
      throw new Error("late crash")
    })

    const result = await execution(fixture.path, { launch, now: () => now }).execute(occurrence)

    expect(result).toMatchObject({
      state: "failed",
      stopReason: "launch-crash",
      retryScheduledAt: null,
    })
    expect(fixture.sqlite.prepare("SELECT state FROM automation_occurrences").get()).toEqual({
      state: "completed",
    })
  })

  it("stops at token budget, calls cancellation, and never schedules a budget retry", async () => {
    const fixture = database("budget")
    const occurrence = seedRunnable(fixture.sqlite, fixture.directory, {
      budget: { maxDurationMs: 60_000, maxTotalTokens: 100, maxCostUsdMicros: null },
      retry: {
        mode: "exponential",
        maxAttempts: 2,
        initialDelayMs: 100,
        maxDelayMs: 100,
        deadlineMs: 1_000,
      },
    })
    const cancel = vi.fn()
    const launch = vi.fn(async (run: QueuedAgentRun) => {
      insertUsage(fixture.sqlite, run.runId, 101, 0)
    })

    const result = await execution(fixture.path, { launch, cancel, now: () => 1_000 }).execute(
      occurrence,
    )

    expect(result).toMatchObject({
      state: "failed",
      stopReason: "token-budget",
      retryScheduledAt: null,
    })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fixture.sqlite.prepare("SELECT state FROM automation_occurrences").get()).toEqual({
      state: "completed",
    })
    expect(fixture.sqlite.prepare("SELECT kind FROM automation_inbox_items").get()).toEqual({
      kind: "budget-exhausted",
    })
  })

  it("enforces token and cost budgets cumulatively across retry attempts", async () => {
    const fixture = database("retry-budget")
    const firstLease = seedRunnable(fixture.sqlite, fixture.directory, {
      budget: { maxDurationMs: 60_000, maxTotalTokens: 100, maxCostUsdMicros: 1_000 },
      retry: {
        mode: "exponential",
        maxAttempts: 2,
        initialDelayMs: 100,
        maxDelayMs: 100,
        deadlineMs: 1_000,
      },
    })
    let attempt = 0
    const launch = vi.fn(async (run: QueuedAgentRun) => {
      attempt += 1
      insertUsage(fixture.sqlite, run.runId, 60, 400)
      if (attempt === 1) throw new Error("retryable crash")
    })
    let now = 1_000
    const service = execution(fixture.path, { launch, now: () => now })

    expect(await service.execute(firstLease)).toMatchObject({ retryScheduledAt: 1_100 })
    now = 1_100
    const result = await service.execute(leaseExisting(fixture.sqlite, now))

    expect(result).toMatchObject({
      state: "failed",
      stopReason: "token-budget",
      retryScheduledAt: null,
      resultSummary: { usage: { totalTokens: 120, costUsdMicros: 800 } },
    })
  })

  it("kills an active run, invokes harness cancellation, and prevents future retry", async () => {
    const fixture = database("kill")
    const occurrence = seedRunnable(fixture.sqlite, fixture.directory, {
      retry: {
        mode: "exponential",
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 200,
        deadlineMs: 2_000,
      },
    })
    const cancel = vi.fn()
    const launch = vi.fn(() => new Promise<void>(() => undefined))
    const service = execution(fixture.path, { launch, cancel, pollIntervalMs: 10 })
    const running = service.execute(occurrence)
    await vi.waitFor(() => {
      expect(fixture.sqlite.prepare("SELECT state FROM automation_executions").get()).toEqual({
        state: "running",
      })
    })

    expect(await service.kill(occurrence.id)).toBe(true)
    const result = await running

    expect(result).toMatchObject({ state: "cancelled", stopReason: "killed" })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fixture.sqlite.prepare("SELECT state FROM automation_occurrences").get()).toEqual({
      state: "cancelled",
    })
    expect(fixture.sqlite.prepare("SELECT COUNT(*) count FROM automation_leases").get()).toEqual({
      count: 0,
    })
    expect(
      fixture.sqlite.prepare("SELECT COUNT(*) count FROM automation_executions").get(),
    ).toEqual({
      count: 1,
    })
  })

  it("atomically claims concurrency across competing execution services", async () => {
    const fixture = database("concurrency-race")
    const firstOccurrence = seedRunnable(fixture.sqlite, fixture.directory)
    const secondOccurrence = seedSecondOccurrence(fixture.sqlite)
    const launch = vi.fn(() => new Promise<void>(() => undefined))
    let waiting = 0
    let releaseClaims: (() => void) | null = null
    const claimsReady = new Promise<void>((resolve) => {
      releaseClaims = resolve
    })
    const beforeConcurrencyClaim = async () => {
      waiting += 1
      if (waiting === 2) releaseClaims?.()
      await claimsReady
    }
    const options = {
      launch,
      now: () => 1_000,
      pollIntervalMs: 10,
      beforeConcurrencyClaim,
    }
    const first = execution(fixture.path, options).execute(firstOccurrence)
    const second = execution(fixture.path, options).execute(secondOccurrence)

    const deferred = await Promise.race([first, second])

    expect(deferred).toMatchObject({
      state: "deferred",
      stopReason: "concurrency-limit",
      retryScheduledAt: 2_000,
    })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(
      fixture.sqlite
        .prepare("SELECT state, COUNT(*) count FROM automation_occurrences GROUP BY state")
        .all(),
    ).toEqual([
      { state: "pending", count: 1 },
      { state: "running", count: 1 },
    ])
    expect(
      fixture.sqlite
        .prepare("SELECT state, COUNT(*) count FROM automation_executions GROUP BY state")
        .all(),
    ).toEqual([{ state: "running", count: 1 }])

    const runningOccurrence = fixture.sqlite
      .prepare("SELECT id FROM automation_occurrences WHERE state = 'running'")
      .get() as { id: string }
    expect(
      await execution(fixture.path, { ...options, beforeConcurrencyClaim: undefined }).kill(
        runningOccurrence.id,
      ),
    ).toBe(true)
    expect((await Promise.all([first, second])).map((result) => result.state).sort()).toEqual([
      "cancelled",
      "deferred",
    ])
  })

  it("fails stale targets before launch and records the reason", async () => {
    const fixture = database("stale")
    const occurrence = seedRunnable(fixture.sqlite, fixture.directory)
    fixture.sqlite.prepare("UPDATE chats SET archived_at = 1000 WHERE id = 'chat-1'").run()
    const launch = vi.fn()

    const result = await execution(fixture.path, { launch }).execute(occurrence)

    expect(result).toMatchObject({ state: "denied", stopReason: "stale-target" })
    expect(launch).not.toHaveBeenCalled()
    expect(fixture.sqlite.prepare("SELECT stop_reason FROM automation_executions").get()).toEqual({
      stop_reason: "stale-target",
    })
  })

  it("rejects stale lease callers without mutating the owned occurrence", async () => {
    const fixture = database("stale-lease")
    const occurrence = seedRunnable(fixture.sqlite, fixture.directory)
    occurrence.lease.token = "not-the-owned-token"

    await expect(
      execution(fixture.path, { launch: vi.fn() }).execute(occurrence),
    ).rejects.toMatchObject({
      code: "invalid-lease",
    })
    expect(fixture.sqlite.prepare("SELECT state FROM automation_occurrences").get()).toEqual({
      state: "leased",
    })
    expect(
      fixture.sqlite.prepare("SELECT COUNT(*) count FROM automation_executions").get(),
    ).toEqual({
      count: 0,
    })
  })

  it("pauses and resumes only approved automations", () => {
    const fixture = database("pause")
    seedRunnable(fixture.sqlite, fixture.directory)
    const service = execution(fixture.path)

    expect(service.pause("automation-1")).toBe(true)
    expect(fixture.sqlite.prepare("SELECT state, enabled FROM automations").get()).toEqual({
      state: "paused",
      enabled: 0,
    })
    expect(service.resume("automation-1")).toBe(true)
    expect(fixture.sqlite.prepare("SELECT state, enabled FROM automations").get()).toEqual({
      state: "active",
      enabled: 1,
    })
  })
})

function execution(
  databasePath: string,
  options: AutomationExecutionServiceOptions = {},
): AutomationExecutionService {
  return new AutomationExecutionService(databasePath, options)
}

function database(name: string): {
  directory: string
  path: string
  sqlite: Database.Database
} {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-automation-execution-${name}-`))
  directories.push(directory)
  const path = join(directory, "agents.db")
  const sqlite = new Database(path)
  databases.push(sqlite)
  sqlite.pragma("foreign_keys = ON")
  migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
  return { directory, path, sqlite }
}

function seedRunnable(
  sqlite: Database.Database,
  projectPath: string,
  options: {
    retry?: {
      mode: "none" | "exponential"
      maxAttempts: number
      initialDelayMs: number
      maxDelayMs: number
      deadlineMs: number
    }
    budget?: {
      maxDurationMs: number | null
      maxTotalTokens: number | null
      maxCostUsdMicros: number | null
    }
  } = {},
): LeasedAutomationOccurrence {
  sqlite
    .prepare(
      `INSERT INTO projects (id, name, path, default_permission_mode)
       VALUES ('project-1', 'Project', ?, 'read-only')`,
    )
    .run(projectPath)
  sqlite
    .prepare(
      `INSERT INTO chats (
         id, name, project_id, scope, permission_mode, harness, worktree_path, created_at, updated_at
       ) VALUES ('chat-1', 'Target', 'project-1', 'project', 'read-only', 'codex', ?, 1, 1)`,
    )
    .run(projectPath)
  sqlite
    .prepare(
      `INSERT INTO sub_chats (
         id, chat_id, harness, permission_mode, worktree_path, messages, created_at, updated_at
       ) VALUES ('sub-chat-1', 'chat-1', 'codex', 'read-only', ?, '[]', 1, 1)`,
    )
    .run(projectPath)
  sqlite
    .prepare(
      `INSERT INTO automations (
         id, name, scope_type, chat_id, action_type, action_config, prompt, harness,
         permission_mode, worktree_strategy, state, enabled, approval_state, approved_by,
         approved_at, approval_audit_id, version, created_at, updated_at
       ) VALUES (
         'automation-1', 'Review', 'chat', 'chat-1', 'run-chat', '{"type":"run-chat"}',
         'Review the approved target.', 'codex', 'read-only', 'inherit', 'active', 1,
         'approved', 'local-user', 1, 'audit-1', 1, 1, 1
       )`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automation_triggers (id, automation_id, type, created_at, updated_at)
       VALUES ('trigger-1', 'automation-1', 'manual', 1, 1)`,
    )
    .run()
  const retry = options.retry ?? {
    mode: "none" as const,
    maxAttempts: 1,
    initialDelayMs: 0,
    maxDelayMs: 0,
    deadlineMs: 0,
  }
  sqlite
    .prepare(
      `INSERT INTO automation_retry_policies (
         automation_id, mode, max_attempts, initial_delay_ms, max_delay_ms, deadline_ms
       ) VALUES ('automation-1', ?, ?, ?, ?, ?)`,
    )
    .run(retry.mode, retry.maxAttempts, retry.initialDelayMs, retry.maxDelayMs, retry.deadlineMs)
  const budget = options.budget ?? {
    maxDurationMs: 60_000,
    maxTotalTokens: null,
    maxCostUsdMicros: null,
  }
  sqlite
    .prepare(
      `INSERT INTO automation_budgets (
         automation_id, max_duration_ms, max_total_tokens, max_cost_usd_micros, max_concurrent_runs
       ) VALUES ('automation-1', ?, ?, ?, 1)`,
    )
    .run(budget.maxDurationMs, budget.maxTotalTokens, budget.maxCostUsdMicros)
  sqlite
    .prepare(
      `INSERT INTO automation_occurrences (
         id, automation_id, trigger_id, dedupe_key, state, scheduled_for, payload, created_at
       ) VALUES ('occurrence-1', 'automation-1', 'trigger-1', 'manual:1', 'leased', 1000, '{}', 1000)`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automation_leases (occurrence_id, owner, token, acquired_at, expires_at)
       VALUES ('occurrence-1', 'scheduler-1', 'lease-1', 1000, 61000)`,
    )
    .run()
  return leased(1_000, "lease-1")
}

function leaseExisting(sqlite: Database.Database, now: number): LeasedAutomationOccurrence {
  sqlite
    .prepare("UPDATE automation_occurrences SET state = 'leased' WHERE id = 'occurrence-1'")
    .run()
  sqlite
    .prepare(
      `INSERT INTO automation_leases (occurrence_id, owner, token, acquired_at, expires_at)
       VALUES ('occurrence-1', 'scheduler-1', 'lease-2', ?, ?)`,
    )
    .run(now, now + 60_000)
  return leased(now, "lease-2")
}

function seedSecondOccurrence(sqlite: Database.Database): LeasedAutomationOccurrence {
  sqlite
    .prepare(
      `INSERT INTO automation_occurrences (
         id, automation_id, trigger_id, dedupe_key, state, scheduled_for, payload, created_at
       ) VALUES ('occurrence-2', 'automation-1', 'trigger-1', 'manual:2', 'leased', 1000, '{}', 1000)`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automation_leases (occurrence_id, owner, token, acquired_at, expires_at)
       VALUES ('occurrence-2', 'scheduler-2', 'lease-2', 1000, 61000)`,
    )
    .run()
  return {
    ...leased(1_000, "lease-2"),
    id: "occurrence-2",
    dedupeKey: "manual:2",
    lease: {
      owner: "scheduler-2",
      token: "lease-2",
      acquiredAt: 1_000,
      expiresAt: 61_000,
    },
  }
}

function leased(now: number, token: string): LeasedAutomationOccurrence {
  return {
    id: "occurrence-1",
    automationId: "automation-1",
    triggerId: "trigger-1",
    dedupeKey: "manual:1",
    scheduledFor: 1_000,
    payload: {},
    lease: {
      owner: "scheduler-1",
      token,
      acquiredAt: now,
      expiresAt: now + 60_000,
    },
  }
}

function insertUsage(
  sqlite: Database.Database,
  runId: string,
  totalTokens: number,
  costUsdMicros: number,
): void {
  sqlite
    .prepare(
      `INSERT INTO usage_samples (
         id, provider_id, account_tag, source, cost_quality, captured_at, total_tokens,
         cost_usd_micros, run_id, attribution_state, source_class, dedupe_strategy, dedupe_key
       ) VALUES (?, 'codex', '', 'flapstack-run', 'exact', 1000, ?, ?, ?,
                 'unknown', 'flapstack-run', 'exact-fact', ?)`,
    )
    .run(`usage-${runId}`, totalTokens, costUsdMicros, runId, `run:${runId}`)
}

function tableCounts(sqlite: Database.Database) {
  return {
    runs: count(sqlite, "agent_runs"),
    executions: count(sqlite, "automation_executions"),
    checkpoints: count(sqlite, "checkpoints"),
    manifests: count(sqlite, "file_change_manifests"),
  }
}

function count(sqlite: Database.Database, table: string): number {
  return Number(
    (sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count,
  )
}
