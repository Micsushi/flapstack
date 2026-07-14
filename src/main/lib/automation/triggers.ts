import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { isAutomationTargetActive, type AutomationTargetReference } from "./targets"

type Sqlite = Database.Database
type Row = Record<string, unknown>

export type AutomationTerminalRunStatus = "success" | "failure" | "cancelled"

export interface AutomationTriggerClock {
  now(): number
}

export interface AutomationTriggerServiceOptions {
  databasePath: string
  clock?: AutomationTriggerClock
  createId?: () => string
}

export interface AutomationOccurrenceReference {
  id: string
  automationId: string
  triggerId: string
  dedupeKey: string
  scheduledFor: number
}

export type ManualFireResult =
  | { status: "created" | "duplicate"; occurrence: AutomationOccurrenceReference }
  | { status: "ignored"; reason: "inactive" | "archived-target" }

export type RunTerminalTriggerResult =
  | {
      status: "handled"
      runId: string
      created: AutomationOccurrenceReference[]
      duplicates: AutomationOccurrenceReference[]
      archivedTargets: number
    }
  | {
      status: "ignored"
      runId: string
      reason: "run-not-found" | "non-terminal" | "archived-source"
    }

export class AutomationTriggerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AutomationTriggerError"
  }
}

const systemClock: AutomationTriggerClock = { now: () => Date.now() }

export class AutomationTriggerService {
  private readonly clock: AutomationTriggerClock
  private readonly createId: () => string

  constructor(private readonly options: AutomationTriggerServiceOptions) {
    this.clock = options.clock ?? systemClock
    this.createId = options.createId ?? randomUUID
  }

  fireManual(input: {
    triggerId: string
    idempotencyKey: string
    firedAt?: number
  }): ManualFireResult {
    const triggerId = requiredIdentifier(input.triggerId, "Manual trigger ID")
    const idempotencyKey = requiredIdentifier(input.idempotencyKey, "Manual idempotency key")
    const firedAt = safeTimestamp(input.firedAt ?? this.clock.now(), "Manual fire time")

    return this.withDatabase((database) => {
      const fire = database.transaction((): ManualFireResult => {
        const row = triggerRow(database, triggerId)
        if (!row) throw new AutomationTriggerError(`Automation trigger not found: ${triggerId}`)
        if (String(row.type) !== "manual") {
          throw new AutomationTriggerError(`Automation trigger ${triggerId} is not manual.`)
        }
        if (!isRunnable(row)) return { status: "ignored", reason: "inactive" }
        if (!isAutomationTargetActive(database, targetReference(row))) {
          return { status: "ignored", reason: "archived-target" }
        }

        return insertOccurrence(database, {
          id: this.createId(),
          automationId: String(row.automation_id),
          triggerId,
          dedupeKey: manualDedupeKey(triggerId, idempotencyKey),
          scheduledFor: firedAt,
          payload: { source: "manual", idempotencyKey, firedAt },
          createdAt: this.clock.now(),
        })
      })
      return fire.immediate()
    })
  }

  handleRunTerminal(input: { runId: string }): RunTerminalTriggerResult {
    const runId = requiredIdentifier(input.runId, "Run ID")
    return this.withDatabase((database) => {
      const handle = database.transaction((): RunTerminalTriggerResult => {
        const run = database
          .prepare(
            `SELECT r.id, r.status, r.completed_at, c.id chat_id, c.project_id, c.task_id,
                  c.archived_at chat_archived_at, p.archived_at project_archived_at,
                  task.archived_at task_archived_at
           FROM agent_runs r
           JOIN chats c ON c.id = r.chat_id
           LEFT JOIN projects p ON p.id = c.project_id
           LEFT JOIN tasks task ON task.id = c.task_id
           WHERE r.id = ?`,
          )
          .get(runId) as Row | undefined
        if (!run) return { status: "ignored", runId, reason: "run-not-found" }
        const status = terminalRunStatus(run.status)
        const completedAt = nullableSafeTimestamp(run.completed_at)
        if (!status || completedAt === null) {
          return { status: "ignored", runId, reason: "non-terminal" }
        }
        if (
          run.chat_archived_at !== null ||
          run.chat_archived_at === undefined ||
          (run.project_id !== null && run.project_archived_at !== null) ||
          (run.task_id !== null && run.task_archived_at !== null)
        ) {
          return { status: "ignored", runId, reason: "archived-source" }
        }

        const triggers = database
          .prepare(
            `SELECT t.id, t.automation_id, t.run_statuses,
                  a.scope_type, a.project_id, a.task_id, a.chat_id
           FROM automation_triggers t
           JOIN automations a ON a.id = t.automation_id
           WHERE t.type = 'run-complete' AND t.enabled = 1
             AND a.enabled = 1 AND a.state = 'active' AND a.approval_state = 'approved'
             AND ((t.run_project_id IS NOT NULL AND t.run_project_id = ?)
               OR (t.run_task_id IS NOT NULL AND t.run_task_id = ?)
               OR (t.run_chat_id IS NOT NULL AND t.run_chat_id = ?))
           ORDER BY t.id`,
          )
          .all(run.project_id, run.task_id, run.chat_id) as Row[]

        const created: AutomationOccurrenceReference[] = []
        const duplicates: AutomationOccurrenceReference[] = []
        let archivedTargets = 0
        for (const trigger of triggers) {
          if (!parseRunStatuses(trigger.run_statuses).has(status)) continue
          if (!isAutomationTargetActive(database, targetReference(trigger))) {
            archivedTargets += 1
            continue
          }
          const result = insertOccurrence(database, {
            id: this.createId(),
            automationId: String(trigger.automation_id),
            triggerId: String(trigger.id),
            dedupeKey: runCompleteDedupeKey(String(trigger.id), runId, status),
            scheduledFor: completedAt,
            payload: {
              source: "run-complete",
              runId,
              status,
              completedAt,
              projectId: nullableString(run.project_id),
              taskId: nullableString(run.task_id),
              chatId: String(run.chat_id),
            },
            createdAt: this.clock.now(),
          })
          ;(result.status === "created" ? created : duplicates).push(result.occurrence)
        }
        return { status: "handled", runId, created, duplicates, archivedTargets }
      })
      return handle.immediate()
    })
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

export class AutomationRunTerminalEventBridge {
  constructor(private readonly triggers: AutomationTriggerService) {}

  onRunTerminal(event: { runId: string }): RunTerminalTriggerResult {
    return this.triggers.handleRunTerminal(event)
  }
}

export function manualDedupeKey(triggerId: string, idempotencyKey: string): string {
  return `manual:${triggerId}:${idempotencyKey}`
}

export function scheduleDedupeKey(triggerId: string, scheduledFor: number): string {
  return `schedule:${triggerId}:${scheduledFor}`
}

export function runCompleteDedupeKey(
  triggerId: string,
  runId: string,
  status: AutomationTerminalRunStatus,
): string {
  return `run-complete:${triggerId}:${runId}:${status}`
}

function triggerRow(database: Sqlite, triggerId: string): Row | undefined {
  return database
    .prepare(
      `SELECT t.id, t.automation_id, t.type, t.enabled,
              a.scope_type, a.project_id, a.task_id, a.chat_id,
              a.enabled automation_enabled, a.state, a.approval_state
       FROM automation_triggers t
       JOIN automations a ON a.id = t.automation_id
       WHERE t.id = ?`,
    )
    .get(triggerId) as Row | undefined
}

function isRunnable(row: Row): boolean {
  return (
    Number(row.enabled) === 1 &&
    Number(row.automation_enabled) === 1 &&
    row.state === "active" &&
    row.approval_state === "approved"
  )
}

function targetReference(row: Row): AutomationTargetReference {
  return {
    scopeType: String(row.scope_type),
    projectId: nullableString(row.project_id),
    taskId: nullableString(row.task_id),
    chatId: nullableString(row.chat_id),
  }
}

function insertOccurrence(
  database: Sqlite,
  input: {
    id: string
    automationId: string
    triggerId: string
    dedupeKey: string
    scheduledFor: number
    payload: Record<string, unknown>
    createdAt: number
  },
): { status: "created" | "duplicate"; occurrence: AutomationOccurrenceReference } {
  const insert = database.transaction(() => {
    const result = database
      .prepare(
        `INSERT INTO automation_occurrences (
           id, automation_id, trigger_id, dedupe_key, state,
           scheduled_for, payload, created_at
         ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
         ON CONFLICT(automation_id, dedupe_key) DO NOTHING`,
      )
      .run(
        input.id,
        input.automationId,
        input.triggerId,
        input.dedupeKey,
        input.scheduledFor,
        JSON.stringify(input.payload),
        input.createdAt,
      )
    const occurrence = database
      .prepare(
        `SELECT id, automation_id, trigger_id, dedupe_key, scheduled_for
         FROM automation_occurrences
         WHERE automation_id = ? AND dedupe_key = ?`,
      )
      .get(input.automationId, input.dedupeKey) as Row
    return {
      status: result.changes === 1 ? ("created" as const) : ("duplicate" as const),
      occurrence: occurrenceReference(occurrence),
    }
  })
  return insert.immediate()
}

function occurrenceReference(row: Row): AutomationOccurrenceReference {
  return {
    id: String(row.id),
    automationId: String(row.automation_id),
    triggerId: String(row.trigger_id),
    dedupeKey: String(row.dedupe_key),
    scheduledFor: Number(row.scheduled_for),
  }
}

function parseRunStatuses(value: unknown): Set<AutomationTerminalRunStatus> {
  if (typeof value !== "string") return new Set()
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map(terminalRunStatus).filter((status) => status !== null))
  } catch {
    return new Set()
  }
}

function terminalRunStatus(value: unknown): AutomationTerminalRunStatus | null {
  return value === "success" || value === "failure" || value === "cancelled" ? value : null
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function requiredIdentifier(value: string, name: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 200) {
    throw new AutomationTriggerError(`${name} must contain 1-200 characters.`)
  }
  return normalized
}

function safeTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AutomationTriggerError(`${name} must be a non-negative safe integer.`)
  }
  return value
}

function nullableSafeTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const timestamp = Number(value)
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null
}
