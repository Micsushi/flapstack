import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CronAutomationNextFireCalculator } from "../src/main/lib/automation/cron"
import { AutomationScheduler } from "../src/main/lib/automation/scheduler"
import {
  AutomationRunTerminalEventBridge,
  AutomationTriggerService,
} from "../src/main/lib/automation/triggers"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"

const migrations = resolve(process.cwd(), "drizzle")
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("automation manual triggers", () => {
  it("uses caller idempotency keys and fails closed for archived targets", async () => {
    const fixture = database("manual")
    seedAutomation(fixture.sqlite, "automation-chat", "chat", "chat-target")
    seedTrigger(fixture.sqlite, "manual-trigger", "automation-chat", "manual")
    const service = triggerService(fixture.path, 1_000)

    const first = service.fireManual({
      triggerId: "manual-trigger",
      idempotencyKey: "button-click-1",
    })
    const duplicate = service.fireManual({
      triggerId: "manual-trigger",
      idempotencyKey: "button-click-1",
    })

    expect(first).toMatchObject({ status: "created" })
    expect(duplicate).toMatchObject({ status: "duplicate" })
    expect(first.status === "created" && duplicate.status === "duplicate").toBe(true)
    if (first.status !== "ignored" && duplicate.status !== "ignored") {
      expect(duplicate.occurrence).toEqual(first.occurrence)
      expect(first.occurrence.dedupeKey).toBe("manual:manual-trigger:button-click-1")
    }

    fixture.sqlite.prepare("UPDATE chats SET archived_at = ? WHERE id = 'chat-target'").run(2_000)
    expect(
      service.fireManual({ triggerId: "manual-trigger", idempotencyKey: "button-click-2" }),
    ).toEqual({ status: "ignored", reason: "archived-target" })
    expect(occurrenceCount(fixture.sqlite)).toBe(1)

    const scheduler = new AutomationScheduler({
      databasePath: fixture.path,
      owner: "test-scheduler",
      clock: { now: () => 3_000 },
      nextFireCalculator: new CronAutomationNextFireCalculator(),
    })
    expect(await scheduler.drainDueOccurrences()).toEqual([])
    expect(
      fixture.sqlite.prepare("SELECT state, terminal_at FROM automation_occurrences").get(),
    ).toEqual({ state: "skipped", terminal_at: 3_000 })
  })
})

describe("automation cron calculation", () => {
  const calculator = new CronAutomationNextFireCalculator()

  it("calculates the same wall time in explicit timezones", () => {
    const after = Date.UTC(2026, 0, 1, 0, 0)
    expect(next(calculator, "15 9 * * *", "UTC", after)).toBe(Date.UTC(2026, 0, 1, 9, 15))
    expect(next(calculator, "15 9 * * *", "America/Vancouver", after)).toBe(
      Date.UTC(2026, 0, 1, 17, 15),
    )
  })

  it("skips nonexistent spring times and preserves both fall occurrences", () => {
    expect(next(calculator, "30 2 * * *", "America/Vancouver", Date.UTC(2026, 2, 8, 8, 0))).toBe(
      Date.UTC(2026, 2, 9, 9, 30),
    )

    const firstRepeatedTime = Date.UTC(2026, 10, 1, 8, 30)
    expect(next(calculator, "30 1 * * *", "America/Vancouver", firstRepeatedTime)).toBe(
      Date.UTC(2026, 10, 1, 9, 30),
    )
  })

  it("supports bounded lists, ranges, steps, names, and rejects invalid zones", () => {
    expect(next(calculator, "*/15 9-10 * JAN MON-FRI", "UTC", Date.UTC(2026, 0, 5, 9, 7))).toBe(
      Date.UTC(2026, 0, 5, 9, 15),
    )
    expect(() => next(calculator, "0 9 * * *", "Mars/Olympus", 0)).toThrow(
      "Invalid automation timezone",
    )
  })
})

describe("automation run-complete bridge", () => {
  it("filters persisted terminal runs and deduplicates repeated events", () => {
    const fixture = database("run-complete")
    seedAutomation(fixture.sqlite, "automation-project", "project", "project-1")
    seedRunTrigger(fixture.sqlite, "run-trigger", "automation-project", {
      projectId: "project-1",
      statuses: ["success"],
    })
    seedRunTrigger(fixture.sqlite, "wrong-task-trigger", "automation-project", {
      taskId: "task-other",
      statuses: ["success"],
    })
    seedRun(fixture.sqlite, "run-1", "success", 5_000)
    const bridge = new AutomationRunTerminalEventBridge(triggerService(fixture.path, 6_000))

    const first = bridge.onRunTerminal({ runId: "run-1" })
    const duplicate = bridge.onRunTerminal({ runId: "run-1" })

    expect(first).toMatchObject({ status: "handled", archivedTargets: 0 })
    expect(duplicate).toMatchObject({ status: "handled", archivedTargets: 0 })
    if (first.status === "handled" && duplicate.status === "handled") {
      expect(first.created).toHaveLength(1)
      expect(first.duplicates).toHaveLength(0)
      expect(duplicate.created).toHaveLength(0)
      expect(duplicate.duplicates).toEqual(first.created)
      expect(first.created[0].dedupeKey).toBe("run-complete:run-trigger:run-1:success")
    }
    expect(occurrenceCount(fixture.sqlite)).toBe(1)
  })

  it("ignores archived run sources and archived automation targets", () => {
    const fixture = database("run-archive")
    seedAutomation(fixture.sqlite, "automation-chat", "chat", "chat-target")
    seedRunTrigger(fixture.sqlite, "run-trigger", "automation-chat", {
      projectId: "project-1",
      statuses: ["failure"],
    })
    seedRun(fixture.sqlite, "run-1", "failure", 5_000)
    const bridge = new AutomationRunTerminalEventBridge(triggerService(fixture.path, 6_000))

    fixture.sqlite.prepare("UPDATE chats SET archived_at = 1 WHERE id = 'chat-target'").run()
    expect(bridge.onRunTerminal({ runId: "run-1" })).toMatchObject({
      status: "handled",
      created: [],
      archivedTargets: 1,
    })

    fixture.sqlite.prepare("UPDATE chats SET archived_at = 1 WHERE id = 'chat-source'").run()
    expect(bridge.onRunTerminal({ runId: "run-1" })).toEqual({
      status: "ignored",
      runId: "run-1",
      reason: "archived-source",
    })
  })
})

describe("automation schedule trigger integration", () => {
  it("queues one startup catch-up and advances beyond every missed tick", () => {
    const fixture = database("catch-up")
    seedAutomation(fixture.sqlite, "automation-project", "project", "project-1")
    seedScheduleTrigger(
      fixture.sqlite,
      "schedule-trigger",
      "automation-project",
      "0 9 * * *",
      "UTC",
      "one",
      Date.UTC(2026, 0, 1, 9),
    )
    const now = Date.UTC(2026, 0, 5, 12)
    const scheduler = new AutomationScheduler({
      databasePath: fixture.path,
      owner: "test-scheduler",
      clock: { now: () => now },
      nextFireCalculator: new CronAutomationNextFireCalculator(),
      createId: sequenceIds("catch-up"),
    })

    expect(scheduler.reconcileSchedules("startup")).toEqual({
      queued: 1,
      skipped: 0,
      initialized: 0,
    })
    expect(scheduler.reconcileSchedules("startup")).toEqual({
      queued: 0,
      skipped: 0,
      initialized: 0,
    })
    expect(
      fixture.sqlite.prepare("SELECT dedupe_key, scheduled_for FROM automation_occurrences").all(),
    ).toEqual([
      {
        dedupe_key: `schedule:schedule-trigger:${Date.UTC(2026, 0, 1, 9)}`,
        scheduled_for: Date.UTC(2026, 0, 1, 9),
      },
    ])
    expect(
      fixture.sqlite
        .prepare("SELECT next_fire_at FROM automation_triggers WHERE id = 'schedule-trigger'")
        .get(),
    ).toEqual({ next_fire_at: Date.UTC(2026, 0, 6, 9) })
  })

  it("advances archived targets without creating or leasing occurrences", async () => {
    const fixture = database("schedule-archive")
    seedAutomation(fixture.sqlite, "automation-chat", "chat", "chat-target")
    seedScheduleTrigger(
      fixture.sqlite,
      "schedule-trigger",
      "automation-chat",
      "0 9 * * *",
      "UTC",
      "one",
      Date.UTC(2026, 0, 1, 9),
    )
    fixture.sqlite.prepare("UPDATE chats SET archived_at = 1 WHERE id = 'chat-target'").run()
    const now = Date.UTC(2026, 0, 1, 10)
    const scheduler = new AutomationScheduler({
      databasePath: fixture.path,
      owner: "test-scheduler",
      clock: { now: () => now },
      nextFireCalculator: new CronAutomationNextFireCalculator(),
    })

    expect(scheduler.reconcileSchedules("tick")).toEqual({
      queued: 0,
      skipped: 1,
      initialized: 0,
    })
    expect(await scheduler.drainDueOccurrences()).toEqual([])
    expect(occurrenceCount(fixture.sqlite)).toBe(0)
  })
})

function database(name: string): { path: string; sqlite: Database.Database } {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-triggers-${name}-`))
  temporaryDirectories.push(directory)
  const path = join(directory, "agents.db")
  const sqlite = new Database(path)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("busy_timeout = 5000")
  migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
  sqlite.prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'One', '/p1')").run()
  sqlite
    .prepare(
      `INSERT INTO tasks (id, project_id, name) VALUES
         ('task-1', 'project-1', 'One'),
         ('task-other', 'project-1', 'Other')`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats (id, name, scope, project_id, task_id, permission_mode) VALUES
         ('chat-source', 'Source', 'task', 'project-1', 'task-1', 'read-only'),
         ('chat-target', 'Target', 'project', 'project-1', NULL, 'read-only')`,
    )
    .run()
  return { path, sqlite }
}

function seedAutomation(
  sqlite: Database.Database,
  id: string,
  scope: "project" | "chat",
  targetId: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO automations (
         id, name, scope_type, project_id, chat_id, action_type, prompt, harness, permission_mode,
         state, enabled, approval_state, approved_by, approved_at, approval_audit_id,
         created_at, updated_at
       ) VALUES (?, 'Review', ?, ?, ?, ?, 'Review it', 'codex', 'read-only',
         'active', 1, 'approved', 'local-user', 1, 'audit-1', 1, 1)`,
    )
    .run(
      id,
      scope,
      scope === "project" ? targetId : null,
      scope === "chat" ? targetId : null,
      scope === "project" ? "create-chat-run" : "run-chat",
    )
}

function seedTrigger(
  sqlite: Database.Database,
  id: string,
  automationId: string,
  type: "manual",
): void {
  sqlite
    .prepare(
      `INSERT INTO automation_triggers (id, automation_id, type, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1)`,
    )
    .run(id, automationId, type)
}

function seedRunTrigger(
  sqlite: Database.Database,
  id: string,
  automationId: string,
  input: { projectId?: string; taskId?: string; chatId?: string; statuses: string[] },
): void {
  sqlite
    .prepare(
      `INSERT INTO automation_triggers (
         id, automation_id, type, run_project_id, run_task_id, run_chat_id, run_statuses,
         created_at, updated_at
       ) VALUES (?, ?, 'run-complete', ?, ?, ?, ?, 1, 1)`,
    )
    .run(
      id,
      automationId,
      input.projectId ?? null,
      input.taskId ?? null,
      input.chatId ?? null,
      JSON.stringify(input.statuses),
    )
}

function seedRun(
  sqlite: Database.Database,
  id: string,
  status: "success" | "failure" | "cancelled",
  completedAt: number,
): void {
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
         id, chat_id, harness, permission_mode, status, started_at, completed_at
       ) VALUES (?, 'chat-source', 'codex', 'read-only', ?, 1, ?)`,
    )
    .run(id, status, completedAt)
}

function seedScheduleTrigger(
  sqlite: Database.Database,
  id: string,
  automationId: string,
  cron: string,
  timezone: string,
  catchUp: "none" | "one",
  nextFireAt: number,
): void {
  sqlite
    .prepare(
      `INSERT INTO automation_triggers (
         id, automation_id, type, cron, timezone, catch_up, next_fire_at, created_at, updated_at
       ) VALUES (?, ?, 'schedule', ?, ?, ?, ?, 1, 1)`,
    )
    .run(id, automationId, cron, timezone, catchUp, nextFireAt)
}

function triggerService(path: string, now: number): AutomationTriggerService {
  return new AutomationTriggerService({
    databasePath: path,
    clock: { now: () => now },
    createId: sequenceIds("occurrence"),
  })
}

function sequenceIds(prefix: string): () => string {
  let index = 0
  return () => `${prefix}-${++index}`
}

function occurrenceCount(sqlite: Database.Database): number {
  return Number(
    (sqlite.prepare("SELECT count(*) count FROM automation_occurrences").get() as { count: number })
      .count,
  )
}

function next(
  calculator: CronAutomationNextFireCalculator,
  cron: string,
  timezone: string,
  afterMs: number,
): number | null {
  return calculator.nextFireAfter(
    { id: "schedule-trigger", automationId: "automation-1", cron, timezone },
    afterMs,
  )
}
