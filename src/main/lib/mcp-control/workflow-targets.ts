import type Database from "better-sqlite3"
import { createChatTagStore } from "../chat-tags"
import { canonicalMcpChatScope } from "./scope"
import { parsePermissionMode, parseCustomPermissionToggles } from "../permissions"
import { intersectAgentProfilePermissions } from "../agent-profiles/resolver"
import type { McpCallerIdentity, McpControlErrorCode } from "./types"

export class WorkflowError extends Error {
  constructor(
    readonly code: McpControlErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/** Caller identity has already been revalidated by the desktop bridge. Resolve the selected
 * chat independently so a conversation or run ID can never substitute for scope. */
export function requireWorkflowChat(
  db: Database.Database,
  caller: McpCallerIdentity,
  chatId: string,
) {
  const row = db
    .prepare(
      `SELECT c.id, c.scope, c.project_id, c.task_id, c.permission_mode, c.custom_permissions,
       p.id valid_project_id, t.project_id task_project_id
     FROM chats c LEFT JOIN projects p ON p.id=c.project_id AND p.archived_at IS NULL
     LEFT JOIN tasks t ON t.id=c.task_id AND t.archived_at IS NULL
     WHERE c.id=? AND c.archived_at IS NULL`,
    )
    .get(chatId) as Record<string, unknown> | undefined
  const scope = row && canonicalMcpChatScope(row)
  if (!scope || !row) throw new WorkflowError("stale-target", "Chat is missing or archived.")
  if (
    (caller.projectId && scope.projectId !== caller.projectId) ||
    (caller.taskId && scope.taskId !== caller.taskId)
  ) {
    throw new WorkflowError("out-of-scope", "Chat is outside the caller's scope.")
  }
  return row
}

export function requireWorkflowAuthority(caller: McpCallerIdentity, chat: Record<string, unknown>) {
  const mode = parsePermissionMode(chat.permission_mode)
  const custom =
    typeof chat.custom_permissions === "string"
      ? parseCustomPermissionToggles(JSON.parse(chat.custom_permissions))
      : null
  if (
    !mode ||
    !caller.permissionMode ||
    (mode === "custom" && !custom) ||
    intersectAgentProfilePermissions(
      mode,
      custom,
      caller.permissionMode,
      caller.customPermissions ?? null,
    ).narrowed
  ) {
    throw new WorkflowError(
      "permission-denied",
      "Target chat authority exceeds the caller's permission ceiling.",
    )
  }
}

export function workflowConversation(db: Database.Database, chatId: string, subChatId?: string) {
  const row = db
    .prepare(
      "SELECT id FROM sub_chats WHERE chat_id=? AND (? IS NULL OR id=?) ORDER BY created_at, id LIMIT 1",
    )
    .get(chatId, subChatId ?? null, subChatId ?? null) as { id: string } | undefined
  if (!row) throw new WorkflowError("stale-target", "Conversation is missing from this chat.")
  return row.id
}

export function replaceWorkflowTags(db: Database.Database, chatId: string, names: string[]) {
  return db
    .transaction(() => {
      const tags = createChatTagStore(db)
      const previous = tags.listForChats([chatId]).get(chatId) ?? []
      const catalog = new Map(tags.list().map((tag) => [tag.normalizedName, tag]))
      const selected = new Set<string>()
      for (const name of names) {
        const normalized = name.trim().replace(/\s+/g, " ").toLocaleLowerCase()
        const tag = catalog.get(normalized) ?? tags.create({ name, color: "slate" })
        catalog.set(normalized, tag)
        selected.add(tag.id)
        tags.assign({ chatId, tagId: tag.id })
      }
      for (const tag of previous)
        if (!selected.has(tag.id)) tags.unassign({ chatId, tagId: tag.id })
      return {
        chatId,
        previousTags: previous.map((tag) => tag.name),
        tags:
          tags
            .listForChats([chatId])
            .get(chatId)
            ?.map((tag) => tag.name) ?? [],
      }
    })
    .immediate()
}
