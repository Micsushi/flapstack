import type Database from "better-sqlite3"
import { createChatTagStore } from "../chat-tags"
import { canonicalMcpChatScope } from "./scope"
import { relative } from "node:path"
import { getPermissionPreferences } from "../permissions"
import { mcpTargetPermissionAllowed } from "./permission-ceiling"
import { assertRegisteredFilesystemRoot } from "../git/security/path-validation"
import { createGit } from "../git/git-factory"
import { isManagedFlapstackWorktreePath } from "../worktree-resolver"
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
       p.id valid_project_id, t.project_id task_project_id, p.path project_path,
       t.primary_worktree_path task_path, c.worktree_path chat_path
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

/** A scoped caller may restore only the checkout its current project or task authorizes.
 * A chat can keep an explicit checkout when moved. Its historical run alone grants no access. */
export async function requireWorkflowCheckout(
  db: Database.Database,
  caller: McpCallerIdentity,
  chatId: string,
  runId: string,
  checkout: string,
) {
  const denied = () =>
    new WorkflowError(
      "out-of-scope",
      "The checkpoint checkout is outside the caller's current scope.",
    )
  const target = requireWorkflowChat(db, caller, chatId)
  const run = db
    .prepare(
      `SELECT r.worktree_path, s.worktree_path sub_path FROM agent_runs r
     LEFT JOIN sub_chats s ON s.id=r.sub_chat_id AND s.chat_id=r.chat_id WHERE r.id=? AND r.chat_id=?`,
    )
    .get(runId, chatId) as { worktree_path: string | null; sub_path: string | null } | undefined
  if (!run || run.worktree_path !== checkout || typeof target.project_path !== "string")
    throw denied()
  const canonical = (path: string) => assertRegisteredFilesystemRoot(path).canonicalPath
  const same = (left: string, right: string) => relative(left, right) === ""
  const actual = canonical(checkout)
  const checkpoints = db
    .prepare(
      "SELECT DISTINCT worktree_path FROM checkpoints WHERE run_id=? AND worktree_path IS NOT NULL",
    )
    .all(runId) as { worktree_path: string }[]
  if (checkpoints.some((row) => !same(actual, canonical(row.worktree_path)))) throw denied()
  const project = canonical(target.project_path)
  if (caller.taskId) {
    const taskCheckout =
      typeof target.task_path === "string" ? canonical(target.task_path) : project
    if (!same(actual, taskCheckout)) {
      // Managed chat checkouts are detached from the chat when its task changes.
      if (
        typeof target.chat_path !== "string" ||
        !same(actual, canonical(target.chat_path)) ||
        !isManagedFlapstackWorktreePath(actual)
      )
        throw denied()
      const otherTask = db
        .prepare(
          `SELECT 1 FROM tasks t JOIN filesystem_root_registrations f ON t.primary_worktree_path=f.path
         WHERE t.id<>? AND f.canonical_path=? LIMIT 1`,
        )
        .get(caller.taskId, actual)
      if (otherTask) throw denied()
    }
  }
  if (!same(actual, project)) {
    if (
      ![target.chat_path, run.sub_path, target.task_path].some(
        (path) => typeof path === "string" && same(actual, canonical(path)),
      )
    )
      throw denied()
    const list = await createGit(project).raw(["worktree", "list", "--porcelain", "-z"])
    if (
      !list
        .split("\0")
        .some((field) => field.startsWith("worktree ") && same(field.slice(9), actual))
    )
      throw denied()
    const otherProject = db
      .prepare(
        `SELECT 1 FROM projects p JOIN filesystem_root_registrations f ON p.path=f.path
       WHERE p.id<>? AND f.canonical_path=? LIMIT 1`,
      )
      .get(caller.projectId, actual)
    if (otherProject) throw denied()
    // The caller may have moved while Git was resolving linked checkouts.
    const current = requireWorkflowChat(db, caller, chatId)
    if (
      current.project_path !== target.project_path ||
      current.chat_path !== target.chat_path ||
      current.task_path !== target.task_path
    )
      throw denied()
  }
}

export function requireWorkflowAuthority(
  db: Database.Database,
  caller: McpCallerIdentity,
  chat: Record<string, unknown>,
  subChatId?: string,
) {
  const mode =
    chat.permission_mode === null ? getPermissionPreferences().globalDefault : chat.permission_mode
  const overrides = db
    .prepare(
      "SELECT DISTINCT permission_mode FROM sub_chats WHERE chat_id=? AND (? IS NULL OR id=?) AND permission_mode IS NOT NULL",
    )
    .all(chat.id, subChatId ?? null, subChatId ?? null) as { permission_mode: string }[]
  if (
    ![mode, ...overrides.map((row) => row.permission_mode)].every((value) =>
      mcpTargetPermissionAllowed(caller, value, chat.custom_permissions),
    )
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
