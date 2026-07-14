import type Database from "better-sqlite3"

type Sqlite = Database.Database

export interface AutomationTargetReference {
  scopeType: string
  projectId: string | null
  taskId: string | null
  chatId: string | null
}

export function isAutomationTargetActive(
  database: Sqlite,
  target: AutomationTargetReference,
): boolean {
  switch (target.scopeType) {
    case "global":
      return true
    case "project":
      return hasRow(
        database,
        "SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL",
        target.projectId,
      )
    case "task":
      return hasRow(
        database,
        `SELECT 1
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         WHERE t.id = ? AND t.archived_at IS NULL AND p.archived_at IS NULL`,
        target.taskId,
      )
    case "chat":
      return hasRow(
        database,
        `SELECT 1
         FROM chats c
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN tasks t ON t.id = c.task_id
         WHERE c.id = ? AND c.archived_at IS NULL
           AND (c.project_id IS NULL OR p.archived_at IS NULL)
           AND (c.task_id IS NULL OR t.archived_at IS NULL)`,
        target.chatId,
      )
    default:
      return false
  }
}

function hasRow(database: Sqlite, sql: string, id: string | null): boolean {
  return id !== null && database.prepare(sql).get(id) !== undefined
}
