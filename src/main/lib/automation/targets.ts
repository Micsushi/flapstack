import type Database from "better-sqlite3"

type Sqlite = Database.Database

export interface AutomationTargetReference {
  scopeType: string
  projectId: string | null
  taskId: string | null
  chatId: string | null
}

export interface ResolvedAutomationTarget extends AutomationTargetReference {
  projectPath: string | null
  taskPrimaryWorktreePath: string | null
  taskPrimaryBranch: string | null
  chatWorktreePath: string | null
  chatBranch: string | null
  subChatId: string | null
  targetPermissionMode: string | null
  targetCustomPermissions: string | null
}

export function resolveAutomationTarget(
  database: Sqlite,
  target: AutomationTargetReference,
): ResolvedAutomationTarget | null {
  switch (target.scopeType) {
    case "global":
      return {
        ...target,
        projectPath: null,
        taskPrimaryWorktreePath: null,
        taskPrimaryBranch: null,
        chatWorktreePath: null,
        chatBranch: null,
        subChatId: null,
        targetPermissionMode: null,
        targetCustomPermissions: null,
      }
    case "project": {
      const row = database
        .prepare(
          `SELECT id, path, default_permission_mode, default_custom_permissions
           FROM projects WHERE id = ? AND archived_at IS NULL`,
        )
        .get(target.projectId) as Row | undefined
      return row
        ? resolved(target, {
            projectId: String(row.id),
            projectPath: String(row.path),
            permissionMode: row.default_permission_mode,
            customPermissions: row.default_custom_permissions,
          })
        : null
    }
    case "task": {
      const row = database
        .prepare(
          `SELECT t.id, t.project_id, t.primary_worktree_path, t.primary_branch,
                  t.default_permission_mode, t.default_custom_permissions, p.path project_path
           FROM tasks t
           JOIN projects p ON p.id = t.project_id
           WHERE t.id = ? AND t.archived_at IS NULL AND p.archived_at IS NULL`,
        )
        .get(target.taskId) as Row | undefined
      return row
        ? resolved(target, {
            projectId: String(row.project_id),
            taskId: String(row.id),
            projectPath: String(row.project_path),
            taskPrimaryWorktreePath: stringOrNull(row.primary_worktree_path),
            taskPrimaryBranch: stringOrNull(row.primary_branch),
            permissionMode: row.default_permission_mode,
            customPermissions: row.default_custom_permissions,
          })
        : null
    }
    case "chat": {
      const row = database
        .prepare(
          `SELECT c.id, c.project_id, c.task_id, c.worktree_path, c.branch,
                  c.permission_mode, c.custom_permissions, p.path project_path,
                  t.primary_worktree_path, t.primary_branch,
                  (SELECT id FROM sub_chats WHERE chat_id = c.id ORDER BY created_at, id LIMIT 1)
                    sub_chat_id
           FROM chats c
           LEFT JOIN projects p ON p.id = c.project_id
           LEFT JOIN tasks t ON t.id = c.task_id
           WHERE c.id = ? AND c.archived_at IS NULL
             AND (c.project_id IS NULL OR p.archived_at IS NULL)
             AND (c.task_id IS NULL OR t.archived_at IS NULL)`,
        )
        .get(target.chatId) as Row | undefined
      return row
        ? resolved(target, {
            projectId: stringOrNull(row.project_id),
            taskId: stringOrNull(row.task_id),
            chatId: String(row.id),
            projectPath: stringOrNull(row.project_path),
            taskPrimaryWorktreePath: stringOrNull(row.primary_worktree_path),
            taskPrimaryBranch: stringOrNull(row.primary_branch),
            chatWorktreePath: stringOrNull(row.worktree_path),
            chatBranch: stringOrNull(row.branch),
            subChatId: stringOrNull(row.sub_chat_id),
            permissionMode: row.permission_mode,
            customPermissions: row.custom_permissions,
          })
        : null
    }
    default:
      return null
  }
}

export function isAutomationTargetActive(
  database: Sqlite,
  target: AutomationTargetReference,
): boolean {
  return resolveAutomationTarget(database, target) !== null
}

type Row = Record<string, unknown>

function resolved(
  target: AutomationTargetReference,
  overrides: Partial<ResolvedAutomationTarget> & {
    permissionMode?: unknown
    customPermissions?: unknown
  },
): ResolvedAutomationTarget {
  return {
    ...target,
    projectId: overrides.projectId ?? target.projectId,
    taskId: overrides.taskId ?? target.taskId,
    chatId: overrides.chatId ?? target.chatId,
    projectPath: overrides.projectPath ?? null,
    taskPrimaryWorktreePath: overrides.taskPrimaryWorktreePath ?? null,
    taskPrimaryBranch: overrides.taskPrimaryBranch ?? null,
    chatWorktreePath: overrides.chatWorktreePath ?? null,
    chatBranch: overrides.chatBranch ?? null,
    subChatId: overrides.subChatId ?? null,
    targetPermissionMode:
      typeof overrides.permissionMode === "string" ? overrides.permissionMode : null,
    targetCustomPermissions:
      typeof overrides.customPermissions === "string" ? overrides.customPermissions : null,
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}
