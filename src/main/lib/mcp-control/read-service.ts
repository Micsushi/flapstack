import Database from "better-sqlite3"
import { z } from "zod"
import type { McpCallerIdentity } from "./types"

const PAGE_MAX = 50
const pageShape = {
  limit: z.number().int().min(1).max(PAGE_MAX).default(20),
  cursor: z.string().max(64).optional(),
}
const listProjectsSchema = z
  .object({ ...pageShape, includeArchived: z.boolean().default(false) })
  .strict()
const listTasksSchema = z
  .object({
    ...pageShape,
    projectId: z.string().min(1).optional(),
    includeArchived: z.boolean().default(false),
  })
  .strict()
const listChatsSchema = z
  .object({
    ...pageShape,
    projectId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    includeArchived: z.boolean().default(false),
  })
  .strict()
const listRunsSchema = z.object({ ...pageShape, chatId: z.string().min(1).optional() }).strict()
const listWorktreesSchema = z
  .object({ ...pageShape, projectId: z.string().min(1).optional() })
  .strict()
const listArtifactsSchema = z
  .object({
    ...pageShape,
    chatId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
  })
  .strict()
const searchSchema = z
  .object({
    ...pageShape,
    query: z.string().trim().min(1).max(200),
    projectId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    chatId: z.string().min(1).optional(),
    includeArchived: z.boolean().default(false),
  })
  .strict()

export const mcpReadInputShapes: Record<string, z.ZodRawShape | undefined> = {
  list_projects: listProjectsSchema.shape,
  list_tasks: listTasksSchema.shape,
  list_chats: listChatsSchema.shape,
  list_runs: listRunsSchema.shape,
  list_worktrees: listWorktreesSchema.shape,
  list_artifacts: listArtifactsSchema.shape,
  search: searchSchema.shape,
}

type Row = Record<string, unknown>
type Scope = { chatId: string; kind: string; taskId: string | null; projectId: string | null }
type Query = { sql: string; params: unknown[] }

export type McpReadStore = {
  get(sql: string, params: unknown[]): Row | undefined
  all(sql: string, params: unknown[]): Row[]
}

export type McpReadService = {
  invoke(name: string, caller: McpCallerIdentity, input: unknown): unknown
}

class McpReadError extends Error {
  override name = "McpReadError"
}

function fail(code: "invalid-input" | "out-of-scope" | "not-found", message: string): never {
  throw new McpReadError(`${code}:${message}`)
}

function offset(cursor?: string): number {
  if (!cursor) return 0
  const value = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10)
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid-input", "Invalid pagination cursor.")
  return value
}

function page(rows: Row[], start: number, limit: number) {
  const items = rows.slice(0, limit)
  return {
    items,
    nextCursor:
      rows.length > limit ? Buffer.from(String(start + limit)).toString("base64url") : null,
  }
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "number") return null
  return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString()
}

function scopeFor(store: McpReadStore, caller: McpCallerIdentity): Scope {
  const row = store.get("SELECT id, scope, task_id, project_id FROM chats WHERE id = ?", [
    caller.chatId,
  ])
  if (!row) fail("not-found", "Caller chat no longer exists.")
  return {
    chatId: String(row.id),
    kind: String(row.scope),
    taskId: row.task_id ? String(row.task_id) : null,
    projectId: row.project_id ? String(row.project_id) : null,
  }
}

function requireScope(
  scope: Scope,
  requested: { projectId?: string; taskId?: string; chatId?: string },
) {
  if (requested.chatId && requested.chatId !== scope.chatId)
    fail("out-of-scope", "Chat is outside the caller scope.")
  if (scope.taskId && requested.taskId && requested.taskId !== scope.taskId)
    fail("out-of-scope", "Task is outside the caller scope.")
  if (scope.projectId && requested.projectId && requested.projectId !== scope.projectId)
    fail("out-of-scope", "Project is outside the caller scope.")
}

function visible(scope: Scope, alias = "c"): Query {
  if (scope.taskId) return { sql: `${alias}.task_id = ?`, params: [scope.taskId] }
  if (scope.projectId) return { sql: `${alias}.project_id = ?`, params: [scope.projectId] }
  if (scope.kind === "global") return { sql: "1 = 1", params: [] }
  return { sql: `${alias}.id = ?`, params: [scope.chatId] }
}

function queryPage(
  store: McpReadStore,
  sql: string,
  params: unknown[],
  start: number,
  limit: number,
) {
  return page(store.all(`${sql} LIMIT ? OFFSET ?`, [...params, limit + 1, start]), start, limit)
}

export function createMcpReadService(store: McpReadStore = openReadStore()): McpReadService {
  return {
    invoke(name, caller, rawInput) {
      const scope = scopeFor(store, caller)
      if (name === "list_projects") {
        const input = listProjectsSchema.parse(rawInput)
        const start = offset(input.cursor)
        const conditions = [input.includeArchived ? "1 = 1" : "p.archived_at IS NULL"]
        const params: unknown[] = []
        if (scope.projectId) {
          conditions.push("p.id = ?")
          params.push(scope.projectId)
        } else if (scope.taskId) {
          conditions.push("p.id = (SELECT project_id FROM tasks WHERE id = ?)")
          params.push(scope.taskId)
        } else if (scope.kind !== "global") {
          conditions.push("0 = 1")
        }
        const result = queryPage(
          store,
          `SELECT p.id, p.name, p.archived_at, p.updated_at FROM projects p WHERE ${conditions.join(" AND ")} ORDER BY p.updated_at DESC, p.id`,
          params,
          start,
          input.limit,
        )
        return {
          ...result,
          items: result.items.map((r) => ({
            id: r.id,
            name: r.name,
            archived: r.archived_at != null,
            updatedAt: timestamp(r.updated_at),
          })),
        }
      }
      if (name === "list_tasks") {
        const input = listTasksSchema.parse(rawInput)
        requireScope(scope, input)
        const start = offset(input.cursor)
        const conditions = [
          input.includeArchived ? "1 = 1" : "t.archived_at IS NULL",
          "p.archived_at IS NULL",
        ]
        const params: unknown[] = []
        const projectId = input.projectId ?? scope.projectId
        if (scope.taskId) {
          conditions.push("t.id = ?")
          params.push(scope.taskId)
        } else if (projectId) {
          conditions.push("t.project_id = ?")
          params.push(projectId)
        } else if (scope.kind !== "global") conditions.push("0 = 1")
        const result = queryPage(
          store,
          `SELECT t.id, t.name, t.status, t.project_id, p.name project_name, t.archived_at, t.updated_at FROM tasks t JOIN projects p ON p.id=t.project_id WHERE ${conditions.join(" AND ")} ORDER BY t.updated_at DESC, t.id`,
          params,
          start,
          input.limit,
        )
        return {
          ...result,
          items: result.items.map((r) => ({
            id: r.id,
            name: r.name,
            status: r.status,
            archived: r.archived_at != null,
            project: { id: r.project_id, name: r.project_name },
            updatedAt: timestamp(r.updated_at),
          })),
        }
      }
      if (name === "list_chats") {
        const input = listChatsSchema.parse(rawInput)
        requireScope(scope, input)
        const start = offset(input.cursor)
        const v = visible(scope)
        const conditions = [v.sql, input.includeArchived ? "1 = 1" : "c.archived_at IS NULL"]
        const params = [...v.params]
        if (input.projectId) {
          conditions.push("c.project_id = ?")
          params.push(input.projectId)
        }
        if (input.taskId) {
          conditions.push("c.task_id = ?")
          params.push(input.taskId)
        }
        const result = queryPage(
          store,
          `SELECT c.id, COALESCE(c.name,'Untitled chat') name, c.scope, c.harness, c.project_id, p.name project_name, c.task_id, t.name task_name, c.archived_at, c.updated_at FROM chats c LEFT JOIN projects p ON p.id=c.project_id LEFT JOIN tasks t ON t.id=c.task_id WHERE ${conditions.join(" AND ")} ORDER BY c.updated_at DESC, c.id`,
          params,
          start,
          input.limit,
        )
        return {
          ...result,
          items: result.items.map((r) => ({
            id: r.id,
            name: r.name,
            scope: r.scope,
            harness: r.harness,
            archived: r.archived_at != null,
            project: r.project_id ? { id: r.project_id, name: r.project_name } : null,
            task: r.task_id ? { id: r.task_id, name: r.task_name } : null,
            updatedAt: timestamp(r.updated_at),
          })),
        }
      }
      if (name === "list_runs") {
        const input = listRunsSchema.parse(rawInput)
        requireScope(scope, input)
        const start = offset(input.cursor)
        const v = visible(scope)
        const params = [...v.params]
        let condition = v.sql
        if (input.chatId) {
          condition += " AND c.id = ?"
          params.push(input.chatId)
        }
        const result = queryPage(
          store,
          `SELECT r.id, r.chat_id, COALESCE(c.name,'Untitled chat') chat_name, r.harness, r.model, r.status, r.started_at, r.completed_at FROM agent_runs r JOIN chats c ON c.id=r.chat_id WHERE ${condition} ORDER BY r.started_at DESC, r.id`,
          params,
          start,
          input.limit,
        )
        return {
          ...result,
          items: result.items.map((r) => ({
            id: r.id,
            chat: { id: r.chat_id, name: r.chat_name },
            harness: r.harness,
            model: r.model,
            status: r.status,
            startedAt: timestamp(r.started_at),
            completedAt: timestamp(r.completed_at),
          })),
        }
      }
      if (name === "list_worktrees") {
        const input = listWorktreesSchema.parse(rawInput)
        requireScope(scope, input)
        const start = offset(input.cursor)
        const v = visible(scope)
        const params = [...v.params]
        let condition = `${v.sql} AND c.worktree_path IS NOT NULL`
        if (input.projectId) {
          condition += " AND c.project_id = ?"
          params.push(input.projectId)
        }
        const result = queryPage(
          store,
          `SELECT c.id chat_id, COALESCE(c.name,'Untitled chat') chat_name, c.project_id, p.name project_name, c.worktree_path path, c.branch, c.base_branch FROM chats c LEFT JOIN projects p ON p.id=c.project_id WHERE ${condition} ORDER BY c.updated_at DESC, c.id`,
          params,
          start,
          input.limit,
        )
        return {
          ...result,
          items: result.items.map((r) => ({
            chat: { id: r.chat_id, name: r.chat_name },
            project: r.project_id ? { id: r.project_id, name: r.project_name } : null,
            path: r.path,
            branch: r.branch,
            baseBranch: r.base_branch,
          })),
        }
      }
      if (name === "list_artifacts") {
        const input = listArtifactsSchema.parse(rawInput)
        requireScope(scope, input)
        const start = offset(input.cursor)
        const v = visible(scope)
        const attachmentParams = [...v.params]
        const runParams = [...v.params]
        const attachmentConditions = [v.sql]
        const runConditions = [v.sql]
        if (input.chatId) {
          attachmentConditions.push("c.id = ?")
          runConditions.push("c.id = ?")
          attachmentParams.push(input.chatId)
          runParams.push(input.chatId)
        }
        if (input.runId) {
          attachmentConditions.push("0 = 1")
          runConditions.push("r.id = ?")
          runParams.push(input.runId)
        }
        const fetchLimit = start + input.limit + 1
        const result = [
          ...store.all(
            `SELECT a.id, 'attachment' kind, a.name, a.chat_id, NULL run_id, a.created_at, NULL change_type, NULL additions, NULL deletions FROM attachments a JOIN chats c ON c.id=a.chat_id WHERE ${attachmentConditions.join(" AND ")} ORDER BY a.created_at DESC LIMIT ?`,
            [...attachmentParams, fetchLimit],
          ),
          ...store.all(
            `SELECT f.id, 'file-change' kind, f.file_path name, r.chat_id, f.run_id, r.started_at created_at, f.change_type, f.additions, f.deletions FROM file_change_manifests f JOIN agent_runs r ON r.id=f.run_id JOIN chats c ON c.id=r.chat_id WHERE ${runConditions.join(" AND ")} ORDER BY r.started_at DESC LIMIT ?`,
            [...runParams, fetchLimit],
          ),
        ]
          .sort(
            (a, b) =>
              Number(b.created_at) - Number(a.created_at) ||
              String(a.id).localeCompare(String(b.id)),
          )
          .slice(start, start + input.limit + 1)
        const paged = page(result, start, input.limit)
        return {
          ...paged,
          items: paged.items.map((r) => ({
            id: r.id,
            kind: r.kind,
            name: r.name,
            chatId: r.chat_id,
            runId: r.run_id,
            changeType: r.change_type,
            additions: r.additions,
            deletions: r.deletions,
            createdAt: timestamp(r.created_at),
          })),
        }
      }
      if (name === "search") {
        const input = searchSchema.parse(rawInput)
        requireScope(scope, input)
        const start = offset(input.cursor)
        const v = visible(scope)
        const pattern = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`
        const conditions = [
          v.sql,
          input.includeArchived ? "1 = 1" : "c.archived_at IS NULL",
          "(c.name LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\')",
        ]
        const params = [...v.params, pattern, pattern, pattern]
        if (input.projectId) {
          conditions.push("c.project_id = ?")
          params.push(input.projectId)
        }
        if (input.taskId) {
          conditions.push("c.task_id = ?")
          params.push(input.taskId)
        }
        if (input.chatId) {
          conditions.push("c.id = ?")
          params.push(input.chatId)
        }
        const result = queryPage(
          store,
          `SELECT c.id, COALESCE(c.name,'Untitled chat') title, 'chat' type, c.project_id, p.name project_name, c.task_id, t.name task_name FROM chats c LEFT JOIN projects p ON p.id=c.project_id LEFT JOIN tasks t ON t.id=c.task_id WHERE ${conditions.join(" AND ")} ORDER BY c.updated_at DESC, c.id`,
          params,
          start,
          input.limit,
        )
        return {
          ...result,
          items: result.items.map((r) => ({
            type: r.type,
            id: r.id,
            title: r.title,
            project: r.project_id ? { id: r.project_id, name: r.project_name } : null,
            task: r.task_id ? { id: r.task_id, name: r.task_name } : null,
          })),
        }
      }
      fail("invalid-input", `Unsupported read operation: ${name}`)
    },
  }
}

function openReadStore(): McpReadStore {
  const path = process.env.FLAPSTACK_DB_PATH
  if (!path) throw new Error("FLAPSTACK_DB_PATH is required for read operations.")
  const db = new Database(path, { readonly: true, fileMustExist: true })
  db.pragma("query_only = ON")
  db.pragma("busy_timeout = 5000")
  return {
    get: (sql, params) => db.prepare(sql).get(...params) as Row | undefined,
    all: (sql, params) => db.prepare(sql).all(...params) as Row[],
  }
}
