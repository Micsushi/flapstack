import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { isAutomationTargetActive } from "./targets"
import { scheduleDedupeKey } from "./triggers"

type Sqlite = Database.Database
type Row = Record<string, unknown>

const TERMINAL_EXECUTION_STATES = new Set([
  "succeeded",
  "failed",
  "denied",
  "cancelled",
  "timed-out",
])
const RETRYABLE_EXECUTION_STATES = new Set(["failed", "timed-out"])

export interface AutomationSchedulerClock {
  now(): number
}

export interface AutomationSchedulerTimerLifecycle {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
  onClockChange?(callback: () => void): () => void
}

export interface AutomationScheduleTrigger {
  id: string
  automationId: string
  cron: string
  timezone: string
}

/** T3 owns cron parsing. T2 only requires a deterministic next-fire seam. */
export interface AutomationNextFireCalculator {
  nextFireAfter(trigger: AutomationScheduleTrigger, afterMs: number): number | null
}

export interface LeasedAutomationOccurrence {
  id: string
  automationId: string
  triggerId: string
  dedupeKey: string
  scheduledFor: number
  payload: Record<string, unknown>
  lease: {
    owner: string
    token: string
    acquiredAt: number
    expiresAt: number
  }
}

export interface AutomationLeaseRecoveryResult {
  released: number
  retryable: number
  terminal: number
}

export interface AutomationScheduleReconciliationResult {
  queued: number
  skipped: number
  initialized: number
}

export interface AutomationSchedulerOptions {
  databasePath: string
  owner: string
  nextFireCalculator: AutomationNextFireCalculator
  dispatch?: (occurrence: LeasedAutomationOccurrence) => void | Promise<void>
  clock?: AutomationSchedulerClock
  timers?: AutomationSchedulerTimerLifecycle
  leaseDurationMs?: number
  batchSize?: number
  maxSleepMs?: number
  createId?: () => string
  onError?: (error: unknown) => void
}

const systemClock: AutomationSchedulerClock = { now: () => Date.now() }
const systemTimers: AutomationSchedulerTimerLifecycle = {
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs)
    timer.unref?.()
    return timer
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

export class AutomationScheduler {
  private readonly clock: AutomationSchedulerClock
  private readonly timers: AutomationSchedulerTimerLifecycle
  private readonly leaseDurationMs: number
  private readonly batchSize: number
  private readonly maxSleepMs: number
  private readonly createId: () => string
  private timer: unknown | null = null
  private unsubscribeClockChange: (() => void) | null = null
  private started = false
  private pass: Promise<void> | null = null

  constructor(private readonly options: AutomationSchedulerOptions) {
    if (!options.owner.trim()) throw new Error("Automation scheduler owner is required.")
    this.clock = options.clock ?? systemClock
    this.timers = options.timers ?? systemTimers
    this.leaseDurationMs = positiveInteger(options.leaseDurationMs ?? 60_000, "leaseDurationMs")
    this.batchSize = positiveInteger(options.batchSize ?? 25, "batchSize")
    this.maxSleepMs = positiveInteger(options.maxSleepMs ?? 60_000, "maxSleepMs")
    this.createId = options.createId ?? randomUUID
  }

  async start(): Promise<void> {
    if (this.started) return this.pass ?? Promise.resolve()
    this.started = true
    this.unsubscribeClockChange =
      this.timers.onClockChange?.(() => void this.handleClockChange()) ?? null
    await this.runPass("startup")
  }

  async stop(): Promise<void> {
    this.started = false
    this.clearTimer()
    this.unsubscribeClockChange?.()
    this.unsubscribeClockChange = null
    await this.pass
  }

  async handleClockChange(): Promise<void> {
    if (!this.started) return
    this.clearTimer()
    await this.runPass("clock-change")
  }

  async drainDueOccurrences(): Promise<LeasedAutomationOccurrence[]> {
    const leased: LeasedAutomationOccurrence[] = []
    for (let index = 0; index < this.batchSize; index += 1) {
      const occurrence = this.acquireNextDueOccurrence()
      if (!occurrence) break
      leased.push(occurrence)
      try {
        await this.options.dispatch?.(occurrence)
      } catch (error) {
        // The persisted lease is deliberately retained. Restart/expiry recovery
        // decides whether this occurrence can retry; an in-memory error cannot.
        this.options.onError?.(error)
      }
    }
    return leased
  }

  reconcileExpiredLeases(now = this.clock.now()): AutomationLeaseRecoveryResult {
    return this.withDatabase((database) => {
      const recover = database.transaction(() => {
        const result: AutomationLeaseRecoveryResult = { released: 0, retryable: 0, terminal: 0 }
        const leases = database
          .prepare(
            `SELECT l.occurrence_id, o.state occurrence_state, o.automation_id,
                    o.created_at occurrence_created_at, o.scheduled_for,
                    COALESCE(r.mode, 'none') retry_mode,
                    COALESCE(r.max_attempts, 1) max_attempts,
                    COALESCE(r.deadline_ms, 0) deadline_ms
             FROM automation_leases l
             JOIN automation_occurrences o ON o.id = l.occurrence_id
             LEFT JOIN automation_retry_policies r ON r.automation_id = o.automation_id
             WHERE l.expires_at <= ?
             ORDER BY l.expires_at, l.occurrence_id`,
          )
          .all(now) as Row[]

        for (const lease of leases) {
          const occurrenceId = String(lease.occurrence_id)
          const occurrenceState = String(lease.occurrence_state)
          if (["completed", "cancelled", "skipped"].includes(occurrenceState)) {
            database
              .prepare("DELETE FROM automation_leases WHERE occurrence_id = ?")
              .run(occurrenceId)
            result.released += 1
            result.terminal += 1
            continue
          }

          database
            .prepare(
              `UPDATE automation_executions
               SET state = 'failed', stop_reason = 'lease-expired', completed_at = ?
               WHERE occurrence_id = ? AND state IN ('pending', 'running')`,
            )
            .run(now, occurrenceId)

          const latest = database
            .prepare(
              `SELECT state, attempt, created_at
               FROM automation_executions
               WHERE occurrence_id = ?
               ORDER BY attempt DESC
               LIMIT 1`,
            )
            .get(occurrenceId) as Row | undefined
          const latestState = latest ? String(latest.state) : null
          const attempt = latest ? Number(latest.attempt) : 0
          const firstAttempt = database
            .prepare(
              "SELECT MIN(created_at) created_at FROM automation_executions WHERE occurrence_id = ?",
            )
            .get(occurrenceId) as Row
          const startedAt =
            nullableNumber(firstAttempt.created_at) ??
            nullableNumber(lease.occurrence_created_at) ??
            Number(lease.scheduled_for)
          const canRetry =
            latestState !== null &&
            RETRYABLE_EXECUTION_STATES.has(latestState) &&
            String(lease.retry_mode) === "exponential" &&
            attempt < Number(lease.max_attempts) &&
            now - startedAt <= Number(lease.deadline_ms)

          if (!latest || canRetry) {
            database
              .prepare(
                `UPDATE automation_occurrences
                 SET state = 'pending', terminal_at = NULL
                 WHERE id = ? AND state IN ('leased', 'running')`,
              )
              .run(occurrenceId)
            result.retryable += 1
          } else if (latestState !== null && TERMINAL_EXECUTION_STATES.has(latestState)) {
            database
              .prepare(
                `UPDATE automation_occurrences
                 SET state = 'completed', terminal_at = ?
                 WHERE id = ? AND state IN ('leased', 'running')`,
              )
              .run(now, occurrenceId)
            result.terminal += 1
          }
          database
            .prepare("DELETE FROM automation_leases WHERE occurrence_id = ?")
            .run(occurrenceId)
          result.released += 1
        }
        return result
      })
      return recover.immediate()
    })
  }

  reconcileSchedules(
    mode: "startup" | "tick" | "clock-change",
    now = this.clock.now(),
  ): AutomationScheduleReconciliationResult {
    return this.withDatabase((database) => {
      const reconcile = database.transaction(() => {
        const result: AutomationScheduleReconciliationResult = {
          queued: 0,
          skipped: 0,
          initialized: 0,
        }
        const triggers = database
          .prepare(
            `SELECT t.id, t.automation_id, t.cron, t.timezone, t.catch_up, t.next_fire_at,
                    a.scope_type, a.project_id, a.task_id, a.chat_id
             FROM automation_triggers t
             JOIN automations a ON a.id = t.automation_id
             WHERE t.type = 'schedule' AND t.enabled = 1
               AND a.enabled = 1 AND a.state = 'active' AND a.approval_state = 'approved'
               AND (t.next_fire_at IS NULL OR t.next_fire_at <= ?)
             ORDER BY t.next_fire_at, t.id`,
          )
          .all(now) as Row[]

        for (const row of triggers) {
          const trigger: AutomationScheduleTrigger = {
            id: String(row.id),
            automationId: String(row.automation_id),
            cron: String(row.cron),
            timezone: String(row.timezone),
          }
          const currentFireAt = nullableNumber(row.next_fire_at)
          if (currentFireAt === null) {
            const nextFireAt = this.calculateNextFire(trigger, now)
            database
              .prepare(
                `UPDATE automation_triggers SET next_fire_at = ?, updated_at = ?
                 WHERE id = ? AND next_fire_at IS NULL`,
              )
              .run(nextFireAt, now, trigger.id)
            result.initialized += 1
            continue
          }

          if (
            !isAutomationTargetActive(database, {
              scopeType: String(row.scope_type),
              projectId: nullableString(row.project_id),
              taskId: nullableString(row.task_id),
              chatId: nullableString(row.chat_id),
            })
          ) {
            const nextFireAt = this.calculateNextFire(trigger, now)
            database
              .prepare(
                `UPDATE automation_triggers SET next_fire_at = ?, updated_at = ?
                 WHERE id = ? AND next_fire_at = ?`,
              )
              .run(nextFireAt, now, trigger.id, currentFireAt)
            result.skipped += 1
            continue
          }

          const shouldQueue = mode !== "startup" || String(row.catch_up) === "one"
          if (shouldQueue) {
            const inserted = database
              .prepare(
                `INSERT INTO automation_occurrences (
                   id, automation_id, trigger_id, dedupe_key, state,
                   scheduled_for, payload, created_at
                 ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
                 ON CONFLICT(automation_id, dedupe_key) DO NOTHING`,
              )
              .run(
                this.createId(),
                trigger.automationId,
                trigger.id,
                scheduleDedupeKey(trigger.id, currentFireAt),
                currentFireAt,
                JSON.stringify({
                  source: "schedule",
                  scheduledFor: currentFireAt,
                  catchUp: mode !== "tick",
                }),
                now,
              )
            result.queued += inserted.changes
          } else {
            result.skipped += 1
          }

          const nextFireAt = this.calculateNextFire(trigger, now)
          database
            .prepare(
              `UPDATE automation_triggers SET next_fire_at = ?, updated_at = ?
               WHERE id = ? AND next_fire_at = ?`,
            )
            .run(nextFireAt, now, trigger.id, currentFireAt)
        }
        return result
      })
      return reconcile.immediate()
    })
  }

  private calculateNextFire(trigger: AutomationScheduleTrigger, afterMs: number): number | null {
    const nextFireAt = this.options.nextFireCalculator.nextFireAfter(trigger, afterMs)
    if (nextFireAt !== null && (!Number.isSafeInteger(nextFireAt) || nextFireAt <= afterMs)) {
      throw new Error(`Next fire for automation trigger ${trigger.id} must be after ${afterMs}.`)
    }
    return nextFireAt
  }

  private acquireNextDueOccurrence(): LeasedAutomationOccurrence | null {
    const now = this.clock.now()
    return this.withDatabase((database) => {
      const acquire = database.transaction(() => {
        while (true) {
          const row = database
            .prepare(
              `SELECT o.id, o.automation_id, o.trigger_id, o.dedupe_key,
                    o.scheduled_for, o.payload,
                    a.scope_type, a.project_id, a.task_id, a.chat_id
             FROM automation_occurrences o
             JOIN automations a ON a.id = o.automation_id
             JOIN automation_triggers t ON t.id = o.trigger_id
             LEFT JOIN automation_leases l ON l.occurrence_id = o.id
             WHERE o.state = 'pending' AND o.scheduled_for <= ? AND l.occurrence_id IS NULL
               AND t.enabled = 1
               AND a.enabled = 1 AND a.state = 'active' AND a.approval_state = 'approved'
             ORDER BY o.scheduled_for, o.id
             LIMIT 1`,
            )
            .get(now) as Row | undefined
          if (!row) return null

          if (
            !isAutomationTargetActive(database, {
              scopeType: String(row.scope_type),
              projectId: nullableString(row.project_id),
              taskId: nullableString(row.task_id),
              chatId: nullableString(row.chat_id),
            })
          ) {
            database
              .prepare(
                `UPDATE automation_occurrences
                 SET state = 'skipped', terminal_at = ?
                 WHERE id = ? AND state = 'pending'`,
              )
              .run(now, String(row.id))
            continue
          }

          const occurrenceId = String(row.id)
          const token = this.createId()
          const expiresAt = now + this.leaseDurationMs
          const updated = database
            .prepare(
              `UPDATE automation_occurrences
             SET state = 'leased'
             WHERE id = ? AND state = 'pending' AND scheduled_for <= ?`,
            )
            .run(occurrenceId, now)
          if (updated.changes !== 1) continue
          database
            .prepare(
              `INSERT INTO automation_leases (occurrence_id, owner, token, acquired_at, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
            )
            .run(occurrenceId, this.options.owner, token, now, expiresAt)

          return {
            id: occurrenceId,
            automationId: String(row.automation_id),
            triggerId: String(row.trigger_id),
            dedupeKey: String(row.dedupe_key),
            scheduledFor: Number(row.scheduled_for),
            payload: parsePayload(row.payload),
            lease: {
              owner: this.options.owner,
              token,
              acquiredAt: now,
              expiresAt,
            },
          }
        }
      })
      return acquire.immediate()
    })
  }

  private async runPass(mode: "startup" | "tick" | "clock-change"): Promise<void> {
    if (this.pass) return this.pass
    const pass = (async () => {
      try {
        this.reconcileExpiredLeases()
        this.reconcileSchedules(mode)
        await this.drainDueOccurrences()
      } catch (error) {
        this.options.onError?.(error)
        if (!this.options.onError) throw error
      } finally {
        if (this.started) this.scheduleNextWake()
      }
    })()
    this.pass = pass
    try {
      await pass
    } finally {
      if (this.pass === pass) this.pass = null
    }
  }

  private scheduleNextWake(): void {
    this.clearTimer()
    const now = this.clock.now()
    const nextAt = this.nextPersistedWakeAt()
    const delay = Math.max(
      0,
      Math.min(this.maxSleepMs, nextAt === null ? this.maxSleepMs : nextAt - now),
    )
    this.timer = this.timers.setTimeout(() => {
      this.timer = null
      if (this.started) void this.runPass("tick")
    }, delay)
  }

  private nextPersistedWakeAt(): number | null {
    return this.withDatabase((database) => {
      const row = database
        .prepare(
          `SELECT MIN(candidate) next_at FROM (
             SELECT MIN(o.scheduled_for) candidate
             FROM automation_occurrences o
             JOIN automations a ON a.id = o.automation_id
             JOIN automation_triggers t ON t.id = o.trigger_id
             WHERE o.state = 'pending' AND t.enabled = 1
               AND a.enabled = 1 AND a.state = 'active' AND a.approval_state = 'approved'
             UNION ALL
             SELECT MIN(t.next_fire_at) candidate
             FROM automation_triggers t
             JOIN automations a ON a.id = t.automation_id
             WHERE t.type = 'schedule' AND t.enabled = 1
               AND a.enabled = 1 AND a.state = 'active' AND a.approval_state = 'approved'
             UNION ALL
             SELECT MIN(expires_at) candidate FROM automation_leases
           )`,
        )
        .get() as Row
      return nullableNumber(row.next_at)
    })
  }

  private clearTimer(): void {
    if (this.timer === null) return
    this.timers.clearTimeout(this.timer)
    this.timer = null
  }

  private withDatabase<T>(operation: (database: Sqlite) => T): T {
    const database = new Database(this.options.databasePath)
    try {
      database.pragma("foreign_keys = ON")
      database.pragma("busy_timeout = 5000")
      return operation(database)
    } finally {
      database.close()
    }
  }
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${field} must be a positive integer.`)
  return value
}
