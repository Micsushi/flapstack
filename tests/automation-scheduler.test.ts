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

afterEach(() => {
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

  it("never leases terminal occurrences again", async () => {
    const fixture = database("terminal")
    seedAutomation(fixture.sqlite)
    seedManualOccurrence(fixture.sqlite, "occurrence-1", 1_000, "completed", 1_100)
    fixture.sqlite
      .prepare(
        `INSERT INTO automation_leases
           (occurrence_id, owner, token, acquired_at, expires_at)
         VALUES ('occurrence-1', 'dead-owner', 'dead-token', 100, 200)`,
      )
      .run()
    const dispatch = vi.fn()
    const service = scheduler(fixture.path, "scheduler-a", new FakeClock(1_000), { dispatch })

    expect(service.reconcileExpiredLeases()).toEqual({ released: 1, retryable: 0, terminal: 1 })
    expect(await service.drainDueOccurrences()).toEqual([])
    expect(dispatch).not.toHaveBeenCalled()
    expect(fixture.sqlite.prepare("SELECT count(*) count FROM automation_leases").get()).toEqual({
      count: 0,
    })
  })

  it("recovers expired crash leases according to persisted retry policy", async () => {
    const fixture = database("restart")
    seedAutomation(fixture.sqlite)
    seedManualOccurrence(fixture.sqlite, "retry-occurrence", 1_000, "running")
    seedExecution(fixture.sqlite, "retry-occurrence", "running", 1, 1_000)
    seedLease(fixture.sqlite, "retry-occurrence", 1_000, 1_500)
    fixture.sqlite
      .prepare(
        `INSERT INTO automation_retry_policies (
           automation_id, mode, max_attempts, initial_delay_ms, max_delay_ms, deadline_ms
         ) VALUES ('automation-1', 'exponential', 2, 100, 1000, 10000)`,
      )
      .run()
    const clock = new FakeClock(2_000)
    const recovery = scheduler(fixture.path, "recovery", clock)

    expect(recovery.reconcileExpiredLeases()).toEqual({ released: 1, retryable: 1, terminal: 0 })
    expect(
      fixture.sqlite
        .prepare("SELECT state, terminal_at FROM automation_occurrences WHERE id = ?")
        .get("retry-occurrence"),
    ).toEqual({ state: "pending", terminal_at: null })
    expect(
      fixture.sqlite
        .prepare("SELECT state, stop_reason, completed_at FROM automation_executions")
        .get(),
    ).toEqual({ state: "failed", stop_reason: "lease-expired", completed_at: 2_000 })

    const restartedDispatch = vi.fn()
    const restarted = scheduler(fixture.path, "restarted", clock, { dispatch: restartedDispatch })
    expect(await restarted.drainDueOccurrences()).toHaveLength(1)
    expect(restartedDispatch).toHaveBeenCalledTimes(1)
  })

  it("closes an expired attempt when retry is disabled", () => {
    const fixture = database("restart-no-retry")
    seedAutomation(fixture.sqlite)
    seedManualOccurrence(fixture.sqlite, "occurrence-1", 1_000, "running")
    seedExecution(fixture.sqlite, "occurrence-1", "running", 1, 1_000)
    seedLease(fixture.sqlite, "occurrence-1", 1_000, 1_500)
    const service = scheduler(fixture.path, "recovery", new FakeClock(2_000))

    expect(service.reconcileExpiredLeases()).toEqual({ released: 1, retryable: 0, terminal: 1 })
    expect(
      fixture.sqlite
        .prepare("SELECT state, terminal_at FROM automation_occurrences WHERE id = ?")
        .get("occurrence-1"),
    ).toEqual({ state: "completed", terminal_at: 2_000 })
  })
})

describe("automation scheduler timing", () => {
  it("queues at most one startup catch-up and advances beyond all missed ticks", async () => {
    const fixture = database("catch-up")
    seedAutomation(fixture.sqlite)
    seedScheduleTrigger(fixture.sqlite, "catch-up", "one", 1_000)
    seedScheduleTrigger(fixture.sqlite, "skip-catch-up", "none", 2_000)
    const clock = new FakeClock(10_000)
    const timers = new FakeTimers()
    const service = scheduler(fixture.path, "scheduler-a", clock, { timers })

    await service.start()

    expect(
      fixture.sqlite
        .prepare("SELECT trigger_id, scheduled_for FROM automation_occurrences ORDER BY trigger_id")
        .all(),
    ).toEqual([{ trigger_id: "catch-up", scheduled_for: 1_000 }])
    expect(
      fixture.sqlite.prepare("SELECT id, next_fire_at FROM automation_triggers ORDER BY id").all(),
    ).toEqual([
      { id: "catch-up", next_fire_at: 11_000 },
      { id: "skip-catch-up", next_fire_at: 11_000 },
    ])

    await service.handleClockChange()
    expect(
      fixture.sqlite.prepare("SELECT count(*) count FROM automation_occurrences").get(),
    ).toEqual({
      count: 1,
    })
    await service.stop()
  })

  it("reconciles forward and backward clock jumps through the lifecycle seam", async () => {
    const fixture = database("clock-jump")
    seedAutomation(fixture.sqlite)
    seedScheduleTrigger(fixture.sqlite, "schedule-1", "one", 5_000)
    const clock = new FakeClock(1_000)
    const timers = new FakeTimers()
    const dispatch = vi.fn()
    const service = scheduler(fixture.path, "scheduler-a", clock, {
      timers,
      dispatch,
      maxSleepMs: 10_000,
    })

    await service.start()
    expect(timers.nextDelay()).toBe(4_000)

    clock.set(100_000)
    await timers.signalClockChange()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(
      fixture.sqlite.prepare("SELECT scheduled_for FROM automation_occurrences").all(),
    ).toEqual([{ scheduled_for: 5_000 }])
    // Lease expiry is the next persisted reconciliation boundary.
    expect(timers.nextDelay()).toBe(500)

    clock.set(2_000)
    await timers.signalClockChange()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(timers.nextDelay()).toBe(10_000)

    await service.stop()
    expect(timers.activeCount()).toBe(0)
    expect(timers.clockListenerCount()).toBe(0)
  })

  it("waits for an in-flight drain before shutdown and installs one lifecycle", async () => {
    const fixture = database("shutdown")
    seedAutomation(fixture.sqlite)
    seedManualOccurrence(fixture.sqlite, "occurrence-1", 1_000)
    const timers = new FakeTimers()
    let releaseDispatch!: () => void
    const dispatchGate = new Promise<void>((resolve) => {
      releaseDispatch = resolve
    })
    const dispatch = vi.fn(() => dispatchGate)
    const service = scheduler(fixture.path, "scheduler-a", new FakeClock(1_000), {
      timers,
      dispatch,
    })

    const starting = service.start()
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    const stopping = service.stop()
    releaseDispatch()
    await Promise.all([starting, stopping])
    await service.stop()

    expect(timers.activeCount()).toBe(0)
    expect(timers.clockListenerCount()).toBe(0)
  })

  it("reports and rejects a failed first pass without leaving a timer installed", async () => {
    const fixture = database("startup-failure")
    seedAutomation(fixture.sqlite)
    seedScheduleTrigger(fixture.sqlite, "schedule-1", "one", 1_000)
    const timers = new FakeTimers()
    const onError = vi.fn()
    const service = new AutomationScheduler({
      databasePath: fixture.path,
      owner: "scheduler-a",
      clock: new FakeClock(1_000),
      timers,
      nextFireCalculator: {
        nextFireAfter() {
          throw new Error("invalid schedule")
        },
      },
      onError,
    })

    await expect(service.start()).rejects.toThrow("invalid schedule")
    expect(onError).toHaveBeenCalledOnce()
    expect(timers.activeCount()).toBe(0)
    expect(timers.clockListenerCount()).toBe(0)
    await expect(service.stop()).resolves.toBeUndefined()
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

class FakeTimers implements AutomationSchedulerTimerLifecycle {
  private nextHandle = 1
  private readonly timers = new Map<number, { callback: () => void; delayMs: number }>()
  private readonly clockListeners = new Set<() => void>()

  setTimeout(callback: () => void, delayMs: number): number {
    const handle = this.nextHandle++
    this.timers.set(handle, { callback, delayMs })
    return handle
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(Number(handle))
  }

  onClockChange(callback: () => void): () => void {
    this.clockListeners.add(callback)
    return () => this.clockListeners.delete(callback)
  }

  async signalClockChange(): Promise<void> {
    for (const listener of [...this.clockListeners]) listener()
    await vi.waitFor(() => expect(this.timers.size).toBe(1))
  }

  nextDelay(): number | null {
    return [...this.timers.values()][0]?.delayMs ?? null
  }

  activeCount(): number {
    return this.timers.size
  }

  clockListenerCount(): number {
    return this.clockListeners.size
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

function seedScheduleTrigger(
  sqlite: Database.Database,
  id: string,
  catchUp: "none" | "one",
  nextFireAt: number,
): void {
  sqlite
    .prepare(
      `INSERT INTO automation_triggers (
         id, automation_id, type, cron, timezone, catch_up, next_fire_at, created_at, updated_at
       ) VALUES (?, 'automation-1', 'schedule', '* * * * *', 'UTC', ?, ?, 1, 1)`,
    )
    .run(id, catchUp, nextFireAt)
}

function seedExecution(
  sqlite: Database.Database,
  occurrenceId: string,
  state: "pending" | "running",
  attempt: number,
  createdAt: number,
): void {
  sqlite
    .prepare(
      `INSERT INTO automation_executions (
         id, occurrence_id, attempt, state, authority_snapshot, budget_snapshot,
         created_at, started_at
       ) VALUES (?, ?, ?, ?, '{}', '{}', ?, ?)`,
    )
    .run(
      `execution-${occurrenceId}`,
      occurrenceId,
      attempt,
      state,
      createdAt,
      state === "running" ? createdAt : null,
    )
}

function seedLease(
  sqlite: Database.Database,
  occurrenceId: string,
  acquiredAt: number,
  expiresAt: number,
): void {
  sqlite
    .prepare(
      `INSERT INTO automation_leases (occurrence_id, owner, token, acquired_at, expires_at)
       VALUES (?, 'dead-owner', ?, ?, ?)`,
    )
    .run(occurrenceId, `dead-token-${occurrenceId}`, acquiredAt, expiresAt)
}
