import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AutomationScheduler,
  type AutomationNextFireCalculator,
  type AutomationSchedulerClock,
  type AutomationSchedulerTimerLifecycle,
  type LeasedAutomationOccurrence,
} from "../src/main/lib/automation/scheduler"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"

const migrations = resolve(process.cwd(), "drizzle")
const temporaryDirectories: string[] = []
const databases: Database.Database[] = []

afterEach(() => {
  for (const database of databases.splice(0)) if (database.open) database.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("automation scheduler leases", () => {
  it("uses transactional CAS so concurrent drains never double-lease", async () => {
    const fixture = database("concurrent")
    seedAutomation(fixture.sqlite)
    seedManualOccurrence(fixture.sqlite, "occurrence-1", 1_000)
    const clock = new FakeClock(1_000)
    let releaseDispatch!: () => void
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve
    })
    const firstDispatch = vi.fn(() => dispatchGate)
    const secondDispatch = vi.fn()
    const first = scheduler(fixture.path, "scheduler-a", clock, { dispatch: firstDispatch })
    const second = scheduler(fixture.path, "scheduler-b", clock, { dispatch: secondDispatch })

    const firstDrain = first.drainDueOccurrences()
    const secondDrain = second.drainDueOccurrences()
    releaseDispatch()
    const [firstLeases, secondLeases] = await Promise.all([firstDrain, secondDrain])

    expect(firstLeases).toHaveLength(1)
    expect(secondLeases).toHaveLength(0)
    expect(firstDispatch).toHaveBeenCalledTimes(1)
    expect(secondDispatch).not.toHaveBeenCalled()
    expect(
      fixture.sqlite.prepare("SELECT occurrence_id, owner FROM automation_leases").all(),
    ).toEqual([{ occurrence_id: "occurrence-1", owner: "scheduler-a" }])
    expect(
      fixture.sqlite
        .prepare("SELECT state FROM automation_occurrences WHERE id = ?")
        .get("occurrence-1"),
    ).toEqual({ state: "leased" })
  })
})

function scheduler(
  databasePath: string,
  owner: string,
  clock: AutomationSchedulerClock,
  options: {
    timers?: AutomationSchedulerTimerLifecycle
    dispatch?: (occurrence: LeasedAutomationOccurrence) => void | Promise<void>
    maxSleepMs?: number
  } = {},
): AutomationScheduler {
  return new AutomationScheduler({
    databasePath,
    owner,
    clock,
    timers: options.timers,
    dispatch: options.dispatch,
    maxSleepMs: options.maxSleepMs,
    leaseDurationMs: 500,
    nextFireCalculator: everySecond,
  })
}

const everySecond: AutomationNextFireCalculator = {
  nextFireAfter(_trigger, afterMs) {
    return afterMs + 1_000
  },
}

class FakeClock implements AutomationSchedulerClock {
  constructor(private value: number) {}

  now(): number {
    return this.value
  }

  set(value: number): void {
    this.value = value
  }
}

function database(name: string): {
  path: string
  sqlite: Database.Database
} {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-scheduler-${name}-`))
  temporaryDirectories.push(directory)
  const path = join(directory, "agents.db")
  const sqlite = new Database(path)
  databases.push(sqlite)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("busy_timeout = 5000")
  migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations)
  sqlite.prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'One', '/p1')").run()
  sqlite
    .prepare(
      `INSERT INTO chats (id, name, scope, project_id, permission_mode)
       VALUES ('chat-1', 'Chat', 'project', 'project-1', 'read-only')`,
    )
    .run()
  return { path, sqlite }
}

function seedAutomation(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO automations (
         id, name, scope_type, chat_id, action_type, prompt, harness, permission_mode,
         state, enabled, approval_state, approved_by, approved_at, approval_audit_id,
         created_at, updated_at
       ) VALUES (
         'automation-1', 'Review', 'chat', 'chat-1', 'run-chat', 'Review it',
         'codex', 'read-only', 'active', 1, 'approved', 'local-user', 1, 'audit-1', 1, 1
       )`,
    )
    .run()
}

function seedManualOccurrence(
  sqlite: Database.Database,
  id: string,
  scheduledFor: number,
  state = "pending",
  terminalAt: number | null = null,
): void {
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO automation_triggers (id, automation_id, type, created_at, updated_at)
       VALUES ('manual-trigger', 'automation-1', 'manual', 1, 1)`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO automation_occurrences (
         id, automation_id, trigger_id, dedupe_key, state, scheduled_for, payload, created_at, terminal_at
       ) VALUES (?, 'automation-1', 'manual-trigger', ?, ?, ?, '{}', ?, ?)`,
    )
    .run(id, `manual:${id}`, state, scheduledFor, scheduledFor, terminalAt)
}
