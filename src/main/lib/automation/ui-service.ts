import Database from "better-sqlite3"

type Row = Record<string, unknown>

export type AutomationHistoryItem = {
  executionId: string
  occurrenceId: string
  automationId: string
  attempt: number
  state: string
  triggerType: string
  runId: string | null
  chatId: string | null
  taskId: string | null
  projectId: string | null
  scheduledFor: number
  startedAt: number | null
  completedAt: number | null
  stopReason: string | null
  resultSummary: Record<string, unknown> | null
  authoritySnapshot: Record<string, unknown>
  budgetSnapshot: Record<string, unknown>
}

export type AutomationInboxItem = {
  id: string
  automationId: string
  automationName: string
  occurrenceId: string | null
  executionId: string | null
  kind: string
  title: string
  body: string | null
  unread: boolean
  createdAt: number
  readAt: number | null
  runId: string | null
  chatId: string | null
  taskId: string | null
  projectId: string | null
}

export class AutomationUiService {
  constructor(
    private readonly databasePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  listHistory(automationId: string, limit = 50): AutomationHistoryItem[] {
    return this.withDatabase((database) => {
      const rows = database
        .prepare(
          `SELECT e.id execution_id, e.occurrence_id, o.automation_id, e.attempt, e.state,
                  t.type trigger_type, e.run_id, r.chat_id run_chat_id,
                  COALESCE(c.task_id, a.task_id) task_id,
                  COALESCE(c.project_id, task.project_id, a.project_id) project_id,
                  COALESCE(r.chat_id, a.chat_id) chat_id,
                  o.scheduled_for, e.started_at, e.completed_at, e.stop_reason,
                  e.result_summary, e.authority_snapshot, e.budget_snapshot
           FROM automation_executions e
           JOIN automation_occurrences o ON o.id = e.occurrence_id
           JOIN automation_triggers t ON t.id = o.trigger_id
           JOIN automations a ON a.id = o.automation_id
           LEFT JOIN agent_runs r ON r.id = e.run_id
           LEFT JOIN chats c ON c.id = r.chat_id
           LEFT JOIN tasks task ON task.id = COALESCE(c.task_id, a.task_id)
           WHERE o.automation_id = ?
           ORDER BY COALESCE(e.started_at, o.scheduled_for) DESC, e.attempt DESC
           LIMIT ?`,
        )
        .all(automationId, clampLimit(limit)) as Row[]
      return rows.map(historyItem)
    })
  }

  listInbox(
    input: {
      automationId?: string
      unreadOnly?: boolean
      limit?: number
    } = {},
  ): { items: AutomationInboxItem[]; unreadCount: number } {
    return this.withDatabase((database) => {
      const filters: string[] = []
      const values: unknown[] = []
      if (input.automationId) {
        filters.push("i.automation_id = ?")
        values.push(input.automationId)
      }
      if (input.unreadOnly) filters.push("i.unread = 1")
      const where = filters.length ? `WHERE ${filters.join(" AND ")}` : ""
      const rows = database
        .prepare(
          `SELECT i.id, i.automation_id, a.name automation_name, i.occurrence_id,
                  i.execution_id, i.kind, i.title, i.body, i.unread, i.created_at,
                  i.read_at, e.run_id, COALESCE(r.chat_id, a.chat_id) chat_id,
                  COALESCE(c.task_id, a.task_id) task_id,
                  COALESCE(c.project_id, task.project_id, a.project_id) project_id
           FROM automation_inbox_items i
           JOIN automations a ON a.id = i.automation_id
           LEFT JOIN automation_executions e ON e.id = i.execution_id
           LEFT JOIN agent_runs r ON r.id = e.run_id
           LEFT JOIN chats c ON c.id = r.chat_id
           LEFT JOIN tasks task ON task.id = COALESCE(c.task_id, a.task_id)
           ${where}
           ORDER BY i.created_at DESC, i.id
           LIMIT ?`,
        )
        .all(...values, clampLimit(input.limit ?? 100)) as Row[]
      const count = database
        .prepare("SELECT COUNT(*) count FROM automation_inbox_items WHERE unread = 1")
        .get() as { count: number }
      return { items: rows.map(inboxItem), unreadCount: Number(count.count) }
    })
  }

  markInboxRead(ids: string[], unread: boolean): { changed: number } {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
    if (unique.length === 0) return { changed: 0 }
    return this.withDatabase((database) => {
      const placeholders = unique.map(() => "?").join(",")
      const result = database
        .prepare(
          `UPDATE automation_inbox_items
           SET unread = ?, read_at = ?
           WHERE id IN (${placeholders}) AND unread <> ?`,
        )
        .run(unread ? 1 : 0, unread ? null : this.now(), ...unique, unread ? 1 : 0)
      return { changed: result.changes }
    })
  }

  markAllInboxRead(): { changed: number } {
    return this.withDatabase((database) => {
      const result = database
        .prepare("UPDATE automation_inbox_items SET unread = 0, read_at = ? WHERE unread = 1")
        .run(this.now())
      return { changed: result.changes }
    })
  }

  manualTriggerId(automationId: string): string | null {
    return this.withDatabase((database) => {
      const row = database
        .prepare(
          `SELECT id FROM automation_triggers
           WHERE automation_id = ? AND type = 'manual' AND enabled = 1 LIMIT 1`,
        )
        .get(automationId) as { id: string } | undefined
      return row?.id ?? null
    })
  }

  assertOccurrenceOwner(automationId: string, occurrenceId: string): void {
    this.withDatabase((database) => {
      const row = database
        .prepare("SELECT 1 ok FROM automation_occurrences WHERE id = ? AND automation_id = ?")
        .get(occurrenceId, automationId)
      if (!row) throw new Error("Automation occurrence not found.")
    })
  }

  private withDatabase<T>(operation: (database: Database.Database) => T): T {
    const database = new Database(this.databasePath)
    try {
      database.pragma("foreign_keys = ON")
      database.pragma("busy_timeout = 5000")
      return operation(database)
    } finally {
      database.close()
    }
  }
}

function historyItem(row: Row): AutomationHistoryItem {
  return {
    executionId: String(row.execution_id),
    occurrenceId: String(row.occurrence_id),
    automationId: String(row.automation_id),
    attempt: Number(row.attempt),
    state: String(row.state),
    triggerType: String(row.trigger_type),
    runId: nullableString(row.run_id),
    chatId: nullableString(row.chat_id),
    taskId: nullableString(row.task_id),
    projectId: nullableString(row.project_id),
    scheduledFor: timestamp(row.scheduled_for),
    startedAt: nullableTimestamp(row.started_at),
    completedAt: nullableTimestamp(row.completed_at),
    stopReason: nullableString(row.stop_reason),
    resultSummary: objectOrNull(row.result_summary),
    authoritySnapshot: objectOrEmpty(row.authority_snapshot),
    budgetSnapshot: objectOrEmpty(row.budget_snapshot),
  }
}

function inboxItem(row: Row): AutomationInboxItem {
  return {
    id: String(row.id),
    automationId: String(row.automation_id),
    automationName: String(row.automation_name),
    occurrenceId: nullableString(row.occurrence_id),
    executionId: nullableString(row.execution_id),
    kind: String(row.kind),
    title: String(row.title),
    body: nullableString(row.body),
    unread: Number(row.unread) === 1,
    createdAt: timestamp(row.created_at),
    readAt: nullableTimestamp(row.read_at),
    runId: nullableString(row.run_id),
    chatId: nullableString(row.chat_id),
    taskId: nullableString(row.task_id),
    projectId: nullableString(row.project_id),
  }
}

function clampLimit(value: number): number {
  return Math.max(1, Math.min(Math.trunc(value), 200))
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function timestamp(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  return Number(value)
}

function nullableTimestamp(value: unknown): number | null {
  return value === null || value === undefined ? null : timestamp(value)
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return objectOrNull(value) ?? {}
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}
