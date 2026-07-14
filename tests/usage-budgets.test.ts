import Database from "better-sqlite3"
import { execFileSync } from "node:child_process"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAgentOrchestrationService } from "../src/main/lib/agent-orchestration/service"
import { AutomationExecutionService } from "../src/main/lib/automation/execution"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import type { LeasedAutomationOccurrence } from "../src/main/lib/automation/scheduler"
import {
  bindUsageBudgetOverrideToRun,
  claimPendingRunWithinUsageBudget,
  createUsageBudget,
  createUsageBudgetOverride,
  deleteUsageBudget,
  evaluateUsageBudgetAlerts,
  listUsageBudgets,
  resolveUsageBudgets,
  stopRunningRunsOverUsageBudget,
  updateUsageBudget,
  type UsageBudgetDecision,
} from "../src/main/lib/usage/budgets"
import { UsageEngine } from "../src/main/lib/usage/engine"
import { defaultUsageSettings } from "../src/main/lib/usage/settings"
import type { UsageDb } from "../src/main/lib/usage/store"

const migrations = resolve(process.cwd(), "drizzle")
const NOW = Date.parse("2026-07-14T12:00:00.000Z")
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("scoped usage budgets", () => {
  it("does CRUD with optimistic versions and resolves the most specific scope", () => {
    const fixture = database("precedence")
    try {
      seedGraph(fixture)
      seedAutomation(fixture.sqlite, fixture.directory)
      seedOrchestration(fixture.sqlite)
      insertUsage(fixture.sqlite, {
        id: "usage-1",
        tokens: 28,
        projectId: "project-1",
        taskId: "task-1",
        automationId: "automation-1",
        orchestrationId: "task-1",
      })
      createTokenBudget(fixture.db, "global", { type: "global" }, 5)
      createTokenBudget(fixture.db, "project", { type: "project", projectId: "project-1" }, 10)
      createTokenBudget(fixture.db, "task", { type: "task", taskId: "task-1" }, 20)
      createTokenBudget(
        fixture.db,
        "orchestration",
        { type: "orchestration", orchestrationId: "task-1" },
        25,
      )
      const automation = createTokenBudget(
        fixture.db,
        "automation",
        { type: "automation", automationId: "automation-1" },
        30,
      )

      const context = budgetContext({
        projectId: "project-1",
        taskId: "task-1",
        automationId: "automation-1",
        orchestrationId: "task-1",
      })
      const below = resolveUsageBudgets(fixture.db, context, { nowMs: NOW })
      expect(below.evaluations).toHaveLength(1)
      expect(below.evaluations[0]).toMatchObject({
        policy: { id: "automation" },
        observedValue: 28,
        thresholdValue: 30,
        exceeded: false,
      })
      expect(below.blocked).toBe(false)

      fixture.sqlite
        .prepare("UPDATE usage_samples SET total_tokens = 31 WHERE id = 'usage-1'")
        .run()
      expect(resolveUsageBudgets(fixture.db, context, { nowMs: NOW })).toMatchObject({
        blocked: true,
        hardStops: [{ policy: { id: "automation" }, observedValue: 31 }],
      })

      const updated = updateUsageBudget(
        fixture.db,
        {
          id: automation.id,
          expectedVersion: automation.version,
          threshold: { type: "total-tokens", value: 40 },
        },
        { nowMs: NOW + 1_000 },
      )
      expect(updated).toMatchObject({ version: 2, threshold: { value: 40 } })
      expect(() =>
        updateUsageBudget(fixture.db, {
          id: automation.id,
          expectedVersion: automation.version,
          enabled: false,
        }),
      ).toThrow(/version conflict/i)
      expect(deleteUsageBudget(fixture.db, { id: automation.id, expectedVersion: 2 })).toBe(true)
      expect(listUsageBudgets(fixture.db).map((budget) => budget.id)).not.toContain("automation")

      const audit = fixture.sqlite
        .prepare(
          "SELECT input_summary FROM mcp_audit_records WHERE tool_name LIKE 'usage_budget.%' ORDER BY created_at, id",
        )
        .all() as Array<{ input_summary: string }>
      expect(audit.length).toBeGreaterThan(0)
      expect(audit.map((row) => row.input_summary).join("\n")).not.toContain("project-1")
      expect(audit.map((row) => row.input_summary).join("\n")).not.toContain("automation-1")
    } finally {
      fixture.close()
    }
  })

  it("re-checks budget state inside the atomic pending-run claim", () => {
    const fixture = database("race")
    try {
      seedGraph(fixture)
      seedRun(fixture.sqlite, "run-1", "sub-chat-1", "pending")
      seedSubChat(fixture.sqlite, "sub-chat-2")
      seedRun(fixture.sqlite, "run-2", "sub-chat-2", "pending")
      createTokenBudget(fixture.db, "project-cap", { type: "project", projectId: "project-1" }, 10)

      expect(claimPendingRunWithinUsageBudget(fixture.sqlite, "run-1", { nowMs: NOW })).toEqual({
        claimed: true,
        blocked: null,
      })
      insertUsage(fixture.sqlite, {
        id: "usage-race",
        tokens: 10,
        projectId: "project-1",
        taskId: "task-1",
      })
      const second = claimPendingRunWithinUsageBudget(fixture.sqlite, "run-2", { nowMs: NOW })
      expect(second.claimed).toBe(false)
      expect(second.blocked).toMatchObject({ blocked: true })
      expect(
        fixture.sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'run-2'").get(),
      ).toEqual({ status: "cancelled" })
      expect(claimPendingRunWithinUsageBudget(fixture.sqlite, "run-1", { nowMs: NOW })).toEqual({
        claimed: false,
        blocked: null,
      })
    } finally {
      fixture.close()
    }
  })

  it("marks a controlled running run cancelled before returning its stop signal", () => {
    const fixture = database("running-stop")
    try {
      seedGraph(fixture)
      seedRun(fixture.sqlite, "running-1", "sub-chat-1", "running")
      createTokenBudget(fixture.db, "running-cap", { type: "project", projectId: "project-1" }, 10)
      insertUsage(fixture.sqlite, {
        id: "running-usage",
        tokens: 10,
        projectId: "project-1",
        taskId: "task-1",
      })

      expect(stopRunningRunsOverUsageBudget(fixture.db, { nowMs: NOW })).toEqual([
        { runId: "running-1", subChatId: "sub-chat-1", harness: "codex" },
      ])
      expect(
        fixture.sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'running-1'").get(),
      ).toEqual({ status: "cancelled" })
      expect(stopRunningRunsOverUsageBudget(fixture.db, { nowMs: NOW + 1 })).toEqual([])
    } finally {
      fixture.close()
    }
  })

  it("debounces, re-arms below the band, and fires again after reset", () => {
    const fixture = database("alerts")
    try {
      seedGraph(fixture)
      createUsageBudget(
        fixture.db,
        {
          name: "Daily alert",
          enabled: true,
          scope: { type: "project", projectId: "project-1" },
          threshold: { type: "total-tokens", value: 10 },
          action: "soft-alert",
          reset: { type: "daily", timezone: "UTC" },
        },
        { id: "daily-alert", nowMs: NOW },
      )
      insertUsage(fixture.sqlite, {
        id: "daily-usage",
        tokens: 12,
        projectId: "project-1",
        taskId: "task-1",
      })

      expect(evaluateUsageBudgetAlerts(fixture.db, { nowMs: NOW })).toEqual({
        fired: 1,
        rearmed: 0,
      })
      expect(evaluateUsageBudgetAlerts(fixture.db, { nowMs: NOW + 1_000 })).toEqual({
        fired: 0,
        rearmed: 0,
      })
      fixture.sqlite
        .prepare("UPDATE usage_samples SET total_tokens = 8 WHERE id = 'daily-usage'")
        .run()
      expect(evaluateUsageBudgetAlerts(fixture.db, { nowMs: NOW + 2_000 })).toEqual({
        fired: 0,
        rearmed: 1,
      })
      fixture.sqlite
        .prepare("UPDATE usage_samples SET total_tokens = 12 WHERE id = 'daily-usage'")
        .run()
      expect(evaluateUsageBudgetAlerts(fixture.db, { nowMs: NOW + 3_000 })).toEqual({
        fired: 1,
        rearmed: 0,
      })

      const tomorrow = Date.parse("2026-07-15T18:00:00.000Z")
      fixture.sqlite
        .prepare("UPDATE usage_samples SET captured_at = ? WHERE id = 'daily-usage'")
        .run(Math.floor(tomorrow / 1_000))
      expect(evaluateUsageBudgetAlerts(fixture.db, { nowMs: tomorrow })).toEqual({
        fired: 1,
        rearmed: 0,
      })
      expect(count(fixture.sqlite, "usage_alert_events")).toBe(3)
    } finally {
      fixture.close()
    }
  })

  it("accepts one bounded override, binds it to the run, then expires closed", () => {
    const fixture = database("override")
    try {
      seedGraph(fixture)
      insertUsage(fixture.sqlite, {
        id: "override-usage",
        tokens: 20,
        projectId: "project-1",
        taskId: "task-1",
      })
      createTokenBudget(fixture.db, "override-cap", { type: "project", projectId: "project-1" }, 10)
      const context = budgetContext({ projectId: "project-1", taskId: "task-1" })
      expect(resolveUsageBudgets(fixture.db, context, { nowMs: NOW }).blocked).toBe(true)

      const override = createUsageBudgetOverride({
        budgetIds: ["override-cap"],
        context,
        durationMs: 60_000,
        nowMs: NOW,
      })
      const allowed = resolveUsageBudgets(fixture.db, context, {
        nowMs: NOW,
        overrideToken: override.token,
      })
      expect(allowed).toMatchObject({ blocked: false, evaluations: [{ overridden: true }] })
      expect(bindUsageBudgetOverrideToRun(override.token, context, "run-override", NOW)).toBe(true)
      expect(
        resolveUsageBudgets(
          fixture.db,
          { ...context, runId: "run-override" },
          { nowMs: NOW + 30_000 },
        ).blocked,
      ).toBe(false)
      expect(
        resolveUsageBudgets(
          fixture.db,
          { ...context, runId: "run-override" },
          { nowMs: NOW + 60_001 },
        ).blocked,
      ).toBe(true)
      expect(bindUsageBudgetOverrideToRun(override.token, context, "run-two", NOW)).toBe(false)
    } finally {
      fixture.close()
    }
  })

  it("blocks automation before launch and orchestration before worker materialization", async () => {
    const automationFixture = database("automation")
    try {
      seedGraph(automationFixture)
      const occurrence = seedAutomation(automationFixture.sqlite, automationFixture.directory)
      insertUsage(automationFixture.sqlite, {
        id: "automation-usage",
        tokens: 10,
        projectId: "project-1",
        taskId: "task-1",
      })
      createTokenBudget(
        automationFixture.db,
        "automation-project-cap",
        { type: "project", projectId: "project-1" },
        10,
      )
      const launch = vi.fn()
      const result = await new AutomationExecutionService(automationFixture.path, {
        launch,
        now: () => NOW,
      }).execute(occurrence)
      expect(result).toMatchObject({ state: "denied", stopReason: "usage-budget-exhausted" })
      expect(launch).not.toHaveBeenCalled()
      expect(count(automationFixture.sqlite, "agent_runs")).toBe(0)
    } finally {
      automationFixture.close()
    }

    const orchestrationFixture = database("orchestration")
    try {
      seedGitGraph(orchestrationFixture)
      insertUsage(orchestrationFixture.sqlite, {
        id: "orchestration-usage",
        tokens: 10,
        projectId: "project-1",
      })
      createTokenBudget(
        orchestrationFixture.db,
        "orchestration-project-cap",
        { type: "project", projectId: "project-1" },
        10,
      )
      const overview = createAgentOrchestrationService(orchestrationFixture.path).create({
        projectId: "project-1",
        task: { mode: "create", name: "Budgeted orchestration" },
        initiatingChatId: "root-chat",
        maxParallelAgents: 1,
        maxDepth: 2,
        stopConditions: {},
        agents: [
          {
            role: "worker",
            name: "worker",
            prompt: "Do work",
            harness: "codex",
            model: "test-model",
            reasoningEffort: "high",
            permissionMode: "full-access",
            worktreeStrategy: "inherit",
            dependencyAgentIds: [],
            completionCriteria: "Done",
          },
        ],
      })
      expect(overview.orchestration).toMatchObject({
        status: "stopped",
        stopReason: "scoped-usage-budget",
      })
      expect(count(orchestrationFixture.sqlite, "agent_runs")).toBe(0)
    } finally {
      orchestrationFixture.close()
    }
  })

  it("runs advanced thresholds in daemon mode and never claims external usage was stopped", async () => {
    const fixture = database("daemon-external")
    try {
      seedGraph(fixture)
      createUsageBudget(
        fixture.db,
        {
          name: "Provider alert",
          enabled: true,
          scope: { type: "provider-account", providerId: "codex", accountTag: null },
          threshold: { type: "total-tokens", value: 10 },
          action: "soft-alert",
          reset: { type: "none" },
        },
        { id: "provider-alert", nowMs: NOW },
      )
      insertUsage(fixture.sqlite, {
        id: "external-usage",
        tokens: 20,
        sourceClass: "external-provider",
        providerId: "codex",
      })
      const engine = new UsageEngine("daemon", {
        db: fixture.db,
        getSecret: async () => null,
        loadSettings: () => defaultUsageSettings,
        loadProviders: () => [],
      })
      expect(await engine.runOnce()).toEqual([])
      const event = fixture.sqlite
        .prepare(
          "SELECT channel, delivery_status, message FROM usage_alert_events WHERE account_tag = 'provider-alert'",
        )
        .get() as { channel: string; delivery_status: string; message: string }
      expect(event).toEqual({
        channel: "daemon",
        delivery_status: "sent",
        message: "External provider usage crossed a soft budget; Flapstack did not stop it.",
      })
      const externalDecision = resolveUsageBudgets(
        fixture.db,
        budgetContext({ controlled: false, providerId: "codex" }),
        { nowMs: NOW },
      )
      expect(externalDecision).toMatchObject({
        blocked: false,
        softAlerts: [{ externalOnly: true }],
      })
      expect(() =>
        createUsageBudget(fixture.db, {
          name: "Invalid provider stop",
          enabled: true,
          scope: { type: "provider-account", providerId: "codex", accountTag: null },
          threshold: { type: "total-tokens", value: 1 },
          action: "hard-stop",
          reset: { type: "none" },
        }),
      ).toThrow()
    } finally {
      fixture.close()
    }
  })
})

function database(name: string): {
  directory: string
  path: string
  sqlite: Database.Database
  db: UsageDb
  close: () => void
} {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-usage-budgets-${name}-`))
  directories.push(directory)
  const path = join(directory, "agents.db")
  const sqlite = new Database(path)
  sqlite.pragma("foreign_keys = ON")
  const db = drizzle(sqlite, { schema })
  migrateDatabase(db, sqlite, migrations)
  return { directory, path, sqlite, db, close: () => sqlite.close() }
}

function seedGraph(fixture: { sqlite: Database.Database; directory: string }): void {
  fixture.sqlite
    .prepare(
      "INSERT INTO projects (id, name, path, default_permission_mode) VALUES ('project-1', 'Project', ?, 'read-only')",
    )
    .run(fixture.directory)
  fixture.sqlite
    .prepare(
      `INSERT INTO tasks (id, project_id, name, default_permission_mode, created_at, updated_at)
       VALUES ('task-1', 'project-1', 'Task', 'read-only', ?, ?)`,
    )
    .run(Math.floor(NOW / 1_000), Math.floor(NOW / 1_000))
  fixture.sqlite
    .prepare(
      `INSERT INTO chats (
        id, name, project_id, task_id, scope, permission_mode, harness, worktree_path,
        initiator_chat_id, ancestor_chat_ids, created_at, updated_at
      ) VALUES ('chat-1', 'Chat', 'project-1', 'task-1', 'task', 'read-only', 'codex', ?,
        'chat-1', '[]', ?, ?)`,
    )
    .run(fixture.directory, Math.floor(NOW / 1_000), Math.floor(NOW / 1_000))
  seedSubChat(fixture.sqlite, "sub-chat-1")
}

function seedSubChat(sqlite: Database.Database, id: string): void {
  sqlite
    .prepare(
      `INSERT INTO sub_chats (
        id, chat_id, harness, permission_mode, worktree_path, run_status, messages, created_at, updated_at
      ) VALUES (?, 'chat-1', 'codex', 'read-only', NULL, NULL, '[]', ?, ?)`,
    )
    .run(id, Math.floor(NOW / 1_000), Math.floor(NOW / 1_000))
}

function seedRun(
  sqlite: Database.Database,
  id: string,
  subChatId: string,
  status: "pending" | "running",
): void {
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, permission_mode, initial_prompt, prompt_message_id,
        status, started_at
      ) VALUES (?, 'chat-1', ?, 'codex', 'read-only', 'Run', ?, ?, ?)`,
    )
    .run(id, subChatId, `mcp-${id}`, status, Math.floor(NOW / 1_000))
}

function seedAutomation(sqlite: Database.Database, directory: string): LeasedAutomationOccurrence {
  sqlite
    .prepare(
      `INSERT INTO automations (
        id, name, scope_type, chat_id, action_type, action_config, prompt, harness,
        permission_mode, worktree_strategy, state, enabled, approval_state, approved_by,
        approved_at, approval_audit_id, version, created_at, updated_at
      ) VALUES (
        'automation-1', 'Review', 'chat', 'chat-1', 'run-chat', '{"type":"run-chat"}',
        'Review target.', 'codex', 'read-only', 'inherit', 'active', 1, 'approved',
        'local-user', ?, 'audit-1', 1, ?, ?
      )`,
    )
    .run(NOW, NOW, NOW)
  sqlite
    .prepare(
      "INSERT INTO automation_triggers (id, automation_id, type, created_at, updated_at) VALUES ('trigger-1', 'automation-1', 'manual', ?, ?)",
    )
    .run(NOW, NOW)
  sqlite
    .prepare(
      `INSERT INTO automation_retry_policies (
        automation_id, mode, max_attempts, initial_delay_ms, max_delay_ms, deadline_ms
      ) VALUES ('automation-1', 'none', 1, 0, 0, 0)`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automation_budgets (
        automation_id, max_duration_ms, max_total_tokens, max_cost_usd_micros, max_concurrent_runs
      ) VALUES ('automation-1', 60000, NULL, NULL, 1)`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automation_occurrences (
        id, automation_id, trigger_id, dedupe_key, state, scheduled_for, payload, created_at
      ) VALUES ('occurrence-1', 'automation-1', 'trigger-1', 'manual:1', 'leased', ?, '{}', ?)`,
    )
    .run(NOW, NOW)
  sqlite
    .prepare(
      `INSERT INTO automation_leases (occurrence_id, owner, token, acquired_at, expires_at)
       VALUES ('occurrence-1', 'scheduler-1', 'lease-1', ?, ?)`,
    )
    .run(NOW, NOW + 60_000)
  sqlite.prepare("UPDATE chats SET worktree_path = ? WHERE id = 'chat-1'").run(directory)
  return {
    id: "occurrence-1",
    automationId: "automation-1",
    triggerId: "trigger-1",
    dedupeKey: "manual:1",
    scheduledFor: NOW,
    payload: {},
    lease: {
      owner: "scheduler-1",
      token: "lease-1",
      acquiredAt: NOW,
      expiresAt: NOW + 60_000,
    },
  }
}

function seedOrchestration(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO task_orchestrations (
        task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions,
        created_at, updated_at
      ) VALUES ('task-1', 'chat-1', 'paused', 1, 1, '{}', ?, ?)`,
    )
    .run(Math.floor(NOW / 1_000), Math.floor(NOW / 1_000))
}

function seedGitGraph(fixture: { sqlite: Database.Database; directory: string }): void {
  const projectPath = join(fixture.directory, "project")
  execFileSync("git", ["init", "-b", "main", projectPath])
  execFileSync("git", [
    "-C",
    projectPath,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "init",
  ])
  fixture.sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'Project', ?)")
    .run(projectPath)
  fixture.sqlite
    .prepare(
      `INSERT INTO chats (
        id, name, scope, project_id, permission_mode, harness, worktree_path,
        branch, initiator_chat_id, ancestor_chat_ids
      ) VALUES ('root-chat', 'Root', 'project', 'project-1', 'full-access', 'codex', ?,
        'main', 'root-chat', '[]')`,
    )
    .run(projectPath)
}

function insertUsage(
  sqlite: Database.Database,
  input: {
    id: string
    tokens: number
    providerId?: string
    sourceClass?: "flapstack-run" | "external-provider"
    projectId?: string
    taskId?: string
    automationId?: string
    orchestrationId?: string
  },
): void {
  const sourceClass = input.sourceClass ?? "flapstack-run"
  const attributed = Boolean(
    input.projectId || input.taskId || input.automationId || input.orchestrationId,
  )
  sqlite
    .prepare(
      `INSERT INTO usage_samples (
        id, provider_id, account_tag, source, cost_quality, captured_at, total_tokens,
        attribution_state, attribution_harness, attribution_project_id, attribution_task_id,
        attribution_automation_id, attribution_orchestration_id,
        source_class, dedupe_strategy, dedupe_key, created_at
      ) VALUES (?, ?, '', ?, 'exact', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'exact-fact', ?, ?)`,
    )
    .run(
      input.id,
      input.providerId ?? "codex",
      sourceClass === "flapstack-run" ? "flapstack-run" : "external-provider",
      Math.floor(NOW / 1_000),
      input.tokens,
      attributed ? "attributed" : "unknown",
      attributed ? "codex" : null,
      input.projectId ?? null,
      input.taskId ?? null,
      input.automationId ?? null,
      input.orchestrationId ?? null,
      sourceClass,
      `dedupe:${input.id}`,
      Math.floor(NOW / 1_000),
    )
}

function createTokenBudget(
  db: UsageDb,
  id: string,
  scope: Parameters<typeof createUsageBudget>[1]["scope"],
  value: number,
) {
  return createUsageBudget(
    db,
    {
      name: id,
      enabled: true,
      scope,
      threshold: { type: "total-tokens", value },
      action: "hard-stop",
      reset: { type: "none" },
    },
    { id, nowMs: NOW },
  )
}

function budgetContext(
  patch: Partial<UsageBudgetDecision["context"]> = {},
): UsageBudgetDecision["context"] {
  return {
    controlled: true,
    providerId: "codex",
    accountTag: null,
    projectId: null,
    taskId: null,
    automationId: null,
    orchestrationId: null,
    runId: null,
    ...patch,
  }
}

function count(sqlite: Database.Database, table: string): number {
  return Number(
    (sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count,
  )
}
