import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { copyFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { z } from "zod"
import { prepareSafeWritePath } from "../path-safety"
import type { McpCallerIdentity, McpControlResponse, McpMutationService } from "./types"

const itemSchema = z.enum(["project", "task", "chat"])
const name = z.string().trim().min(1).max(200)
const id = z.string().trim().min(1).max(128)

const schemas = {
  create_chat: z
    .object({
      name,
      scope: z.enum(["global", "project", "task"]),
      projectId: id.optional(),
      taskId: id.optional(),
      harness: z.string().trim().min(1).max(80).optional(),
      model: z.string().trim().max(200).optional(),
    })
    .strict(),
  create_task: z
    .object({ projectId: id.optional(), name, description: z.string().max(20_000).optional() })
    .strict(),
  add_attachment: z
    .object({
      chatId: id,
      name,
      contentText: z.string().max(2_000_000),
      kind: z.enum(["pasted-text", "text"]).default("pasted-text"),
    })
    .strict(),
  rename_item: z.object({ kind: itemSchema, id, name }).strict(),
  move_chat: z
    .object({
      id,
      scope: z.enum(["global", "project", "task"]),
      projectId: id.optional(),
      taskId: id.optional(),
    })
    .strict(),
  pin_item: z.object({ kind: itemSchema, id, pinned: z.boolean().default(true) }).strict(),
  archive_item: z.object({ kind: itemSchema, id }).strict(),
  restore_item: z.object({ kind: itemSchema, id }).strict(),
  write_attachment_to_worktree: z
    .object({
      attachmentId: id,
      worktreePath: z.string().trim().min(1),
      targetRelativePath: z.string().trim().min(1).max(1024).optional(),
      overwrite: z.boolean().default(false),
    })
    .strict(),
  create_automation_draft: z
    .object({
      name,
      trigger: z.enum(["schedule", "file-change", "run-complete", "manual"]),
      dryRun: z.literal(true).default(true),
    })
    .strict(),
} as const

export const mcpMutationInputShapes: Record<string, z.ZodRawShape | undefined> = Object.fromEntries(
  Object.entries(schemas).map(([key, value]) => [key, value.shape]),
)

type Row = Record<string, unknown>

/**
 * The stdio MCP child cannot call renderer tRPC. This is the shared, main-free
 * mutation layer used by its registry and deliberately opens a short-lived DB
 * connection for every call, matching the caller revalidation model.
 */
export function createMcpMutationService(
  databasePath = process.env.FLAPSTACK_DB_PATH,
): McpMutationService {
  if (!databasePath) throw new Error("FLAPSTACK_DB_PATH is required for MCP mutations.")
  return {
    async invoke(operation, caller, rawInput) {
      const schema = schemas[operation as keyof typeof schemas]
      if (!schema) return fail("invalid-input", "Unsupported mutation operation.")
      const input = schema.safeParse(rawInput)
      if (!input.success)
        return fail("invalid-input", input.error.issues[0]?.message ?? "Invalid input.")
      const db = new Database(databasePath)
      try {
        db.pragma("foreign_keys = ON")
        db.pragma("busy_timeout = 5000")
        const scope = callerScope(db, caller)
        switch (operation) {
          case "create_task":
            return createTask(db, scope, input.data as z.infer<typeof schemas.create_task>)
          case "create_chat":
            return createChat(db, scope, input.data as z.infer<typeof schemas.create_chat>)
          case "add_attachment":
            return addAttachment(db, scope, input.data as z.infer<typeof schemas.add_attachment>)
          case "rename_item":
            return renameItem(db, scope, input.data as z.infer<typeof schemas.rename_item>)
          case "move_chat":
            return moveChat(db, scope, input.data as z.infer<typeof schemas.move_chat>)
          case "pin_item":
            return pinItem(db, scope, input.data as z.infer<typeof schemas.pin_item>)
          case "archive_item":
            return setArchived(db, scope, input.data as z.infer<typeof schemas.archive_item>, true)
          case "restore_item":
            return setArchived(db, scope, input.data as z.infer<typeof schemas.restore_item>, false)
          case "write_attachment_to_worktree":
            return await writeAttachment(
              db,
              scope,
              input.data as z.infer<typeof schemas.write_attachment_to_worktree>,
            )
          case "create_automation_draft":
            return {
              ok: true,
              data: {
                draft: input.data,
                runnable: false,
                reason: "Automation activation is disabled.",
              },
            }
        }
        return fail("invalid-input", "Unsupported mutation operation.")
      } catch (error) {
        const message = error instanceof Error ? error.message : "Mutation failed."
        if (message === "Caller chat is stale.")
          return { ok: false, error: { code: "stale-caller", message } }
        if (message === "Target is missing or stale.") return fail("stale-target", message)
        if (message === "Target is outside the caller scope.") return fail("out-of-scope", message)
        return fail("internal-error", message)
      } finally {
        db.close()
      }
    },
  }
}

type Scope = { chatId: string; projectId: string | null; taskId: string | null; kind: string }
function callerScope(db: Database.Database, caller: McpCallerIdentity): Scope {
  const row = db
    .prepare(
      "SELECT id, scope, project_id, task_id FROM chats WHERE id = ? AND archived_at IS NULL",
    )
    .get(caller.chatId) as Row | undefined
  if (!row) throw new Error("Caller chat is stale.")
  return {
    chatId: String(row.id),
    kind: String(row.scope),
    projectId: stringOrNull(row.project_id),
    taskId: stringOrNull(row.task_id),
  }
}
function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}
function visible(scope: Scope, row: Row): boolean {
  if (scope.taskId) return row.task_id === scope.taskId
  if (scope.projectId) return row.project_id === scope.projectId
  return scope.kind === "global"
}
function row(
  db: Database.Database,
  kind: z.infer<typeof itemSchema>,
  targetId: string,
): Row | undefined {
  const table = kind === "project" ? "projects" : kind === "task" ? "tasks" : "chats"
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(targetId) as Row | undefined
}
function target(
  db: Database.Database,
  scope: Scope,
  kind: z.infer<typeof itemSchema>,
  targetId: string,
): Row {
  const value = row(db, kind, targetId)
  if (!value) throw new Error("Target is missing or stale.")
  const scopeRow =
    kind === "project"
      ? { project_id: value.id, task_id: null }
      : kind === "task"
        ? { project_id: value.project_id, task_id: value.id }
        : value
  if (!visible(scope, scopeRow)) throw new Error("Target is outside the caller scope.")
  return value
}
function createTask(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.create_task>,
): McpControlResponse {
  const projectId = input.projectId ?? scope.projectId
  if (!projectId || (scope.projectId && projectId !== scope.projectId))
    return fail("out-of-scope", "Task project is outside the caller scope.")
  const project = db
    .prepare(
      "SELECT id, default_permission_mode FROM projects WHERE id = ? AND archived_at IS NULL",
    )
    .get(projectId) as Row | undefined
  if (!project) return fail("stale-target", "Project is missing or archived.")
  const existing = db
    .prepare("SELECT id FROM tasks WHERE project_id = ? AND name = ? AND archived_at IS NULL")
    .get(projectId, input.name) as Row | undefined
  if (existing) return { ok: true, data: { id: existing.id, created: false } }
  const taskId = randomUUID()
  db.prepare(
    "INSERT INTO tasks (id, project_id, name, description, default_permission_mode) VALUES (?, ?, ?, ?, ?)",
  ).run(taskId, projectId, input.name, input.description ?? null, project.default_permission_mode)
  return { ok: true, data: { id: taskId, created: true } }
}
function createChat(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.create_chat>,
): McpControlResponse {
  let projectId = input.projectId ?? null
  let taskId = input.taskId ?? null
  if (input.scope === "global") {
    projectId = null
    taskId = null
  }
  if (input.scope === "project" && !projectId)
    return fail("invalid-input", "Project chats require projectId.")
  if (input.scope === "task") {
    if (!taskId) return fail("invalid-input", "Task chats require taskId.")
    const task = db
      .prepare("SELECT project_id FROM tasks WHERE id = ? AND archived_at IS NULL")
      .get(taskId) as Row | undefined
    if (!task) return fail("stale-target", "Task is missing or archived.")
    projectId = String(task.project_id)
  }
  if (scope.taskId && taskId !== scope.taskId)
    return fail("out-of-scope", "Chat is outside the caller task scope.")
  if (scope.projectId && projectId !== scope.projectId)
    return fail("out-of-scope", "Chat is outside the caller project scope.")
  const existing = db
    .prepare(
      "SELECT id FROM chats WHERE name = ? AND project_id IS ? AND task_id IS ? AND archived_at IS NULL",
    )
    .get(input.name, projectId, taskId) as Row | undefined
  if (existing) return { ok: true, data: { id: existing.id, created: false } }
  const chatId = randomUUID()
  db.prepare(
    "INSERT INTO chats (id, name, scope, project_id, task_id, harness, model) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    chatId,
    input.name,
    input.scope,
    projectId,
    taskId,
    input.harness ?? null,
    input.model ?? null,
  )
  db.prepare(
    "INSERT INTO sub_chats (id, chat_id, harness, model, messages) VALUES (?, ?, ?, ?, '[]')",
  ).run(randomUUID(), chatId, input.harness ?? null, input.model ?? null)
  return { ok: true, data: { id: chatId, created: true } }
}
function addAttachment(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.add_attachment>,
): McpControlResponse {
  const chat = target(db, scope, "chat", input.chatId)
  if (chat.archived_at) return fail("stale-target", "Chat is archived.")
  const existing = db
    .prepare("SELECT id FROM attachments WHERE chat_id = ? AND name = ? AND content_text = ?")
    .get(input.chatId, input.name, input.contentText) as Row | undefined
  if (existing) return { ok: true, data: { id: existing.id, created: false } }
  const attachmentId = randomUUID()
  db.prepare(
    "INSERT INTO attachments (id, chat_id, task_id, kind, name, content_text) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    attachmentId,
    input.chatId,
    chat.task_id ?? null,
    input.kind,
    basename(input.name),
    input.contentText,
  )
  return { ok: true, data: { id: attachmentId, created: true } }
}
function renameItem(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.rename_item>,
): McpControlResponse {
  const current = target(db, scope, input.kind, input.id)
  if (current.name === input.name) return { ok: true, data: { id: input.id, changed: false } }
  const table = input.kind === "project" ? "projects" : input.kind === "task" ? "tasks" : "chats"
  db.prepare(`UPDATE ${table} SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    input.name,
    input.id,
  )
  return { ok: true, data: { id: input.id, changed: true } }
}
function moveChat(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.move_chat>,
): McpControlResponse {
  target(db, scope, "chat", input.id)
  let projectId = input.projectId ?? null
  let taskId = input.taskId ?? null
  if (input.scope === "global") {
    projectId = null
    taskId = null
  }
  if (input.scope === "project" && !projectId)
    return fail("invalid-input", "Project move requires projectId.")
  if (input.scope === "task") {
    const task =
      taskId &&
      (db
        .prepare("SELECT project_id FROM tasks WHERE id = ? AND archived_at IS NULL")
        .get(taskId) as Row | undefined)
    if (!task) return fail("stale-target", "Task is missing or archived.")
    projectId = String(task.project_id)
  }
  if (scope.taskId || (scope.projectId && projectId !== scope.projectId))
    return fail("out-of-scope", "Move is outside caller scope.")
  db.prepare(
    "UPDATE chats SET scope = ?, project_id = ?, task_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(input.scope, projectId, taskId, input.id)
  return { ok: true, data: { id: input.id, moved: true } }
}
function pinItem(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.pin_item>,
): McpControlResponse {
  const current = target(db, scope, input.kind, input.id)
  const already = input.pinned ? current.pinned_at != null : current.pinned_at == null
  if (already) return { ok: true, data: { id: input.id, changed: false } }
  const table = input.kind === "project" ? "projects" : input.kind === "task" ? "tasks" : "chats"
  db.prepare(`UPDATE ${table} SET pinned_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    input.pinned ? Date.now() : null,
    input.id,
  )
  return { ok: true, data: { id: input.id, changed: true } }
}
function setArchived(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.archive_item>,
  archived: boolean,
): McpControlResponse {
  const current = target(db, scope, input.kind, input.id)
  const already = archived ? current.archived_at != null : current.archived_at == null
  if (already) return { ok: true, data: { id: input.id, changed: false } }
  const table = input.kind === "project" ? "projects" : input.kind === "task" ? "tasks" : "chats"
  db.prepare(
    `UPDATE ${table} SET archived_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(archived ? Date.now() : null, input.id)
  return { ok: true, data: { id: input.id, changed: true } }
}
async function writeAttachment(
  db: Database.Database,
  scope: Scope,
  input: z.infer<typeof schemas.write_attachment_to_worktree>,
): Promise<McpControlResponse> {
  const attachment = db
    .prepare("SELECT * FROM attachments WHERE id = ?")
    .get(input.attachmentId) as Row | undefined
  if (!attachment) return fail("stale-target", "Attachment is missing.")
  const chat = target(db, scope, "chat", String(attachment.chat_id))
  const project = chat.project_id
    ? (db.prepare("SELECT path FROM projects WHERE id = ?").get(chat.project_id) as Row | undefined)
    : undefined
  const roots = [chat.worktree_path, project?.path]
    .filter((value): value is string => typeof value === "string")
    .map((value) => resolve(value))
  if (!roots.includes(resolve(input.worktreePath)))
    return fail("out-of-scope", "Worktree is not a known target for this attachment.")
  const destination = await prepareSafeWritePath(
    input.worktreePath,
    input.targetRelativePath ?? String(attachment.name),
  )
  const source = stringOrNull(attachment.stored_path) ?? stringOrNull(attachment.source_path)
  const write = async (path: string, exclusive: boolean) =>
    source
      ? copyFile(source, path, exclusive ? constants.COPYFILE_EXCL : 0)
      : typeof attachment.content_text === "string"
        ? writeFile(path, attachment.content_text, {
            encoding: "utf8",
            flag: exclusive ? "wx" : "w",
          })
        : Promise.reject(new Error("Attachment has no content."))
  if (!input.overwrite) await write(destination, true)
  else {
    const temporary = join(dirname(destination), `.flapstack-${randomUUID()}.tmp`)
    try {
      await write(temporary, true)
      await rm(destination, { force: true })
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  return { ok: true, data: { targetPath: destination, byteLength: (await stat(destination)).size } }
}
function fail(
  code: "invalid-input" | "out-of-scope" | "stale-target" | "internal-error",
  message: string,
): McpControlResponse {
  return { ok: false, error: { code, message } }
}
