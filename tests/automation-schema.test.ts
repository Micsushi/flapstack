import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import {
  automationActionTypes,
  automationBudgetSchema,
  automationDraftSchema,
  automationOccurrenceStates,
  automationRetryPolicySchema,
  automationRunStates,
  automationScopes,
  automationTriggerTypes,
} from "../src/shared/automation"

const migrations = resolve(process.cwd(), "drizzle")
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("automation contracts", () => {
  it("publishes stable enums and applies bounded safe defaults", () => {
    expect(automationScopes).toEqual(["global", "project", "task", "chat"])
    expect(automationActionTypes).toEqual(["run-chat", "create-chat-run", "create-task-run"])
    expect(automationTriggerTypes).toEqual(["manual", "schedule", "run-complete", "file-change"])
    expect(automationOccurrenceStates).toEqual([
      "pending",
      "leased",
      "running",
      "completed",
      "cancelled",
      "skipped",
    ])
    expect(automationRunStates).toEqual([
      "pending",
      "running",
      "succeeded",
      "failed",
      "denied",
      "cancelled",
      "timed-out",
    ])

    const draft = automationDraftSchema.parse(validDraft())
    expect(draft.retry).toEqual({
      mode: "none",
      maxAttempts: 1,
      initialDelayMs: 0,
      maxDelayMs: 0,
      deadlineMs: 0,
    })
    expect(draft.budget).toEqual({
      maxDurationMs: 3_600_000,
      maxTotalTokens: null,
      maxCostUsdMicros: null,
      maxConcurrentRuns: 1,
    })
    expect(draft.run.worktreeStrategy).toBe("inherit")
  })

  it("accepts the merged local-model harness", () => {
    const draft = automationDraftSchema.parse({
      ...validDraft(),
      run: { ...validDraft().run, harness: "local" },
    })
    expect(draft.run.harness).toBe("local")
  })

  it("rejects invalid trigger, target, permission, worktree, retry, and budget combinations", () => {
    expect(
      automationDraftSchema.safeParse({
        ...validDraft(),
        scope: { type: "project", projectId: "project-1" },
      }).success,
    ).toBe(false)
    expect(
      automationDraftSchema.safeParse({
        ...validDraft(),
        scope: { type: "global" },
        action: { type: "create-chat-run" },
        trigger: { type: "file-change", rootPath: "/tmp/project" },
      }).success,
    ).toBe(false)
    expect(
      automationDraftSchema.safeParse({
        ...validDraft(),
        trigger: {
          type: "run-complete",
          projectId: "project-1",
          chatId: "chat-1",
        },
      }).success,
    ).toBe(false)
    expect(
      automationDraftSchema.safeParse({
        ...validDraft(),
        run: { ...validDraft().run, permissionMode: "custom" },
      }).success,
    ).toBe(false)
    expect(
      automationDraftSchema.safeParse({
        ...validDraft(),
        run: {
          ...validDraft().run,
          worktreeStrategy: "existing",
        },
      }).success,
    ).toBe(false)
    expect(
      automationRetryPolicySchema.safeParse({
        mode: "exponential",
        maxAttempts: 1,
        initialDelayMs: 100,
        maxDelayMs: 1_000,
        deadlineMs: 10_000,
      }).success,
    ).toBe(false)
    expect(
      automationBudgetSchema.safeParse({
        maxDurationMs: null,
        maxTotalTokens: null,
        maxCostUsdMicros: 10_000,
      }).success,
    ).toBe(false)
    expect(
      automationBudgetSchema.safeParse({
        maxConcurrentRuns: 2,
      }).success,
    ).toBe(false)
  })
})

describe("automation schema", () => {
  it("creates inert automation records and rejects incomplete approval or target state", () => {
    const { sqlite } = database("fresh")
    try {
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
      seedScope(sqlite)
      insertAutomation(sqlite, "automation-1", "user")

      expect(
        sqlite
          .prepare(
            `SELECT state, enabled, approval_state, created_by_type, version
             FROM automations WHERE id = 'automation-1'`,
          )
          .get(),
      ).toEqual({
        state: "draft",
        enabled: 0,
        approval_state: "pending",
        created_by_type: "user",
        version: 1,
      })
      expect(() =>
        sqlite.prepare("UPDATE automations SET enabled = 1 WHERE id = 'automation-1'").run(),
      ).toThrow(/check constraint/i)
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO automations (
              id, name, scope_type, project_id, action_type, prompt, harness, permission_mode
            ) VALUES (
              'bad-target', 'Bad target', 'project', 'project-1', 'run-chat', 'Run', 'codex', 'read-only'
            )`,
          )
          .run(),
      ).toThrow(/check constraint/i)
      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO automations (
              id, name, scope_type, chat_id, action_type, prompt, harness,
              permission_mode, custom_permissions
            ) VALUES (
              'bad-permission', 'Bad permission', 'chat', 'chat-1', 'run-chat', 'Run',
              'codex', 'read-only', '{}'
            )`,
          )
          .run(),
      ).toThrow(/check constraint/i)

      sqlite
        .prepare(
          `UPDATE automations
           SET state = 'active', enabled = 1, approval_state = 'approved',
               approved_by = 'local-user', approved_at = 123, approval_audit_id = 'audit-1'
           WHERE id = 'automation-1'`,
        )
        .run()
      expect(
        sqlite.prepare("SELECT state, enabled, approval_state FROM automations").get(),
      ).toEqual({ state: "active", enabled: 1, approval_state: "approved" })
    } finally {
      sqlite.close()
    }
  })

  it("persists trigger, occurrence, execution, lease, retry, budget, and inbox records", () => {
    const { sqlite } = database("records")
    try {
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
      seedScope(sqlite)
      insertAutomation(sqlite, "automation-1", "agent")
      sqlite
        .prepare(
          "INSERT INTO automation_triggers (id, automation_id, type) VALUES ('trigger-1', 'automation-1', 'manual')",
        )
        .run()
      sqlite
        .prepare(
          `INSERT INTO automation_occurrences
             (id, automation_id, trigger_id, dedupe_key, scheduled_for)
           VALUES ('occurrence-1', 'automation-1', 'trigger-1', 'manual:1', 100)`,
        )
        .run()
      sqlite
        .prepare(
          `INSERT INTO automation_executions
             (id, occurrence_id, authority_snapshot, budget_snapshot)
           VALUES ('execution-1', 'occurrence-1', '{}', '{}')`,
        )
        .run()
      sqlite
        .prepare(
          `INSERT INTO automation_leases
             (occurrence_id, owner, token, acquired_at, expires_at)
           VALUES ('occurrence-1', 'scheduler-1', 'lease-1', 100, 200)`,
        )
        .run()
      sqlite
        .prepare("INSERT INTO automation_retry_policies (automation_id) VALUES ('automation-1')")
        .run()
      sqlite.prepare("INSERT INTO automation_budgets (automation_id) VALUES ('automation-1')").run()
      sqlite
        .prepare(
          `INSERT INTO automation_inbox_items
             (id, automation_id, occurrence_id, execution_id, kind, title)
           VALUES (
             'inbox-1', 'automation-1', 'occurrence-1', 'execution-1', 'completed', 'Done'
           )`,
        )
        .run()

      expect(
        sqlite
          .prepare(
            `SELECT
              (SELECT state FROM automation_occurrences) occurrence_state,
              (SELECT state FROM automation_executions) execution_state,
              (SELECT mode FROM automation_retry_policies) retry_mode,
              (SELECT max_duration_ms FROM automation_budgets) max_duration_ms,
              (SELECT unread FROM automation_inbox_items) unread`,
          )
          .get(),
      ).toEqual({
        occurrence_state: "pending",
        execution_state: "pending",
        retry_mode: "none",
        max_duration_ms: 3_600_000,
        unread: 1,
      })

      expect(() =>
        sqlite
          .prepare(
            `INSERT INTO automation_triggers
               (id, automation_id, type, timezone, catch_up)
             VALUES ('bad-trigger', 'automation-1', 'schedule', 'UTC', 'one')`,
          )
          .run(),
      ).toThrow(/check constraint/i)
      expect(() =>
        sqlite
          .prepare(
            `UPDATE automation_retry_policies
             SET mode = 'exponential', max_attempts = 1, initial_delay_ms = 100,
                 max_delay_ms = 1000, deadline_ms = 10000
             WHERE automation_id = 'automation-1'`,
          )
          .run(),
      ).toThrow(/check constraint/i)
      expect(() =>
        sqlite
          .prepare(
            `UPDATE automation_budgets
             SET max_duration_ms = null, max_total_tokens = null, max_cost_usd_micros = 1
             WHERE automation_id = 'automation-1'`,
          )
          .run(),
      ).toThrow(/check constraint/i)
      expect(() =>
        sqlite
          .prepare(
            `UPDATE automation_executions SET state = 'succeeded'
             WHERE id = 'execution-1'`,
          )
          .run(),
      ).toThrow(/check constraint/i)
      expect(() =>
        sqlite
          .prepare(
            `UPDATE automation_leases SET expires_at = acquired_at
             WHERE occurrence_id = 'occurrence-1'`,
          )
          .run(),
      ).toThrow(/check constraint/i)
    } finally {
      sqlite.close()
    }
  })
})

describe("automation Stage 3 migrations", () => {
  it.each([
    { name: "consolidated-main", lastMigration: 20 },
    { name: "Stage-3-release", lastMigration: 22 },
  ])("upgrades the $name fixture with no runnable automation", ({ name, lastMigration }) => {
    const { directory, sqlite } = database(name)
    try {
      migrate(drizzle(sqlite, { schema }), {
        migrationsFolder: migrationSubset(directory, lastMigration),
      })
      sqlite
        .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'One', '/p1')")
        .run()
      sqlite
        .prepare(
          `INSERT INTO chats (id, name, scope, project_id, permission_mode)
           VALUES ('chat-1', 'Chat', 'project', 'project-1', 'read-only')`,
        )
        .run()

      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
      expect(sqlite.prepare("SELECT count(*) count FROM automations").get()).toEqual({ count: 0 })
      insertAutomation(sqlite, "agent-draft", "agent", "local")

      expect(
        sqlite.prepare("SELECT count(*) count FROM automations WHERE enabled = 1").get(),
      ).toEqual({ count: 0 })
      expect(
        sqlite
          .prepare(
            "SELECT state, enabled, approval_state, created_by_type, harness FROM automations WHERE id = 'agent-draft'",
          )
          .get(),
      ).toEqual({
        state: "draft",
        enabled: 0,
        approval_state: "pending",
        created_by_type: "agent",
        harness: "local",
      })
      expect(sqlite.pragma("foreign_key_check")).toEqual([])
    } finally {
      sqlite.close()
    }
  })
})

function validDraft() {
  return {
    name: "Daily review",
    scope: { type: "chat" as const, chatId: "chat-1" },
    action: { type: "run-chat" as const },
    trigger: { type: "manual" as const },
    run: {
      prompt: "Review the project.",
      harness: "codex" as const,
      permissionMode: "read-only" as const,
    },
  }
}

function database(name: string): { directory: string; sqlite: Database.Database } {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-automation-${name}-`))
  temporaryDirectories.push(directory)
  const sqlite = new Database(join(directory, "agents.db"))
  sqlite.pragma("foreign_keys = ON")
  return { directory, sqlite }
}

function seedScope(sqlite: Database.Database): void {
  sqlite.prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'One', '/p1')").run()
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES ('task-1', 'project-1', 'Task')")
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats (id, name, scope, project_id, task_id, permission_mode)
       VALUES ('chat-1', 'Chat', 'task', 'project-1', 'task-1', 'read-only')`,
    )
    .run()
}

function insertAutomation(
  sqlite: Database.Database,
  id: string,
  creator: "user" | "agent",
  harness = "codex",
): void {
  sqlite
    .prepare(
      `INSERT INTO automations (
        id, name, scope_type, chat_id, action_type, prompt, harness, permission_mode,
        created_by_type, created_by_chat_id
      ) VALUES (?, 'Review', 'chat', 'chat-1', 'run-chat', 'Review it', ?,
        'read-only', ?, ?)`,
    )
    .run(id, harness, creator, creator === "agent" ? "chat-1" : null)
}

function migrationSubset(directory: string, lastIndex: number): string {
  const target = join(directory, `migrations-through-${lastIndex}`)
  mkdirSync(join(target, "meta"), { recursive: true })
  const journal = JSON.parse(readFileSync(join(migrations, "meta", "_journal.json"), "utf8")) as {
    version: string
    dialect: string
    entries: Array<{ idx: number; tag: string }>
  }
  const subset = { ...journal, entries: journal.entries.filter((entry) => entry.idx <= lastIndex) }
  writeFileSync(join(target, "meta", "_journal.json"), `${JSON.stringify(subset, null, 2)}\n`)
  for (const entry of subset.entries) {
    cpSync(join(migrations, `${entry.tag}.sql`), join(target, `${entry.tag}.sql`))
  }
  return target
}
