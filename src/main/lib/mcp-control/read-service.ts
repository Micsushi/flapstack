import type Database from "better-sqlite3"
import { openAppDatabase } from "../db/access"
import { z } from "zod"
import { AGENT_HARNESSES } from "../../../shared/harness-types"
import { parseStoredCustomPermissionCapabilities } from "../../../shared/permission-capabilities"
import { sanitizeRuntimeText } from "../agent-runtime/sanitizer"
import { orchestrationFleetQuerySchema } from "../../../shared/agent-orchestration"
import { queryOrchestrationFleet } from "../agent-orchestration/fleet"
import { isBetaFeatureEnabled } from "../beta-features/settings"
import type { McpCallerIdentity } from "./types"
import { canonicalMcpChatScope } from "./scope"

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
const listOrchestrationsSchema = orchestrationFleetQuerySchema.extend({
  limit: z.number().int().min(1).max(PAGE_MAX).default(20),
})
const listChatsSchema = z
  .object({
    ...pageShape,
    projectId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    includeArchived: z.boolean().default(false),
  })
  .strict()
const listRunsSchema = z.object({ ...pageShape, chatId: z.string().min(1).optional() }).strict()
const historySchema = z.object({ chatId: z.string().min(1).max(128), ...pageShape }).strict()
const runSchema = z.object({ runId: z.string().min(1).max(128), ...pageShape }).strict()
export const providerCatalogSchema = z
  .object({ provider: z.enum(AGENT_HARNESSES).optional() })
  .strict()
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
  list_orchestrations: listOrchestrationsSchema.shape,
  list_chats: listChatsSchema.shape,
  list_runs: listRunsSchema.shape,
  list_models: providerCatalogSchema.shape,
  list_providers: {},
  read_chat: historySchema.shape,
  read_messages: historySchema.shape,
  read_run: runSchema.shape,
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
  if ("callerKind" in caller && caller.callerKind === "external-owner") {
    return { chatId: caller.chatId, kind: "global", projectId: null, taskId: null }
  }
  const row = store.get(
    `SELECT c.id, c.scope, c.task_id, c.project_id, p.id valid_project_id,
            t.project_id task_project_id
     FROM chats c
     LEFT JOIN projects p ON p.id = c.project_id AND p.archived_at IS NULL
     LEFT JOIN tasks t ON t.id = c.task_id AND t.archived_at IS NULL
     WHERE c.id = ?`,
    [caller.chatId],
  )
  const scope = row ? canonicalMcpChatScope(row) : null
  if (!scope) fail("not-found", "Caller chat no longer exists or has invalid scope.")
  return {
    chatId: scope.chatId,
    kind: scope.kind,
    taskId: scope.taskId,
    projectId: scope.projectId,
  }
}

function requireScope(
  store: McpReadStore,
  scope: Scope,
  requested: { projectId?: string; taskId?: string; chatId?: string },
) {
  if (requested.chatId && requested.chatId !== scope.chatId) {
    const v = visible(scope)
    if (
      !store.get(`SELECT c.id FROM chats c WHERE c.id=? AND ${v.sql}`, [
        requested.chatId,
        ...v.params,
      ])
    ) {
      fail("out-of-scope", "Chat is outside the caller scope.")
    }
  }
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
        requireScope(store, scope, input)
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
      if (name === "list_orchestrations") {
        const input = listOrchestrationsSchema.parse(rawInput)
        if (scope.taskId && input.taskIds.some((taskId) => taskId !== scope.taskId)) {
          fail("out-of-scope", "Task is outside the caller scope.")
        }
        if (
          scope.projectId &&
          input.projectIds.some((projectId) => projectId !== scope.projectId)
        ) {
          fail("out-of-scope", "Project is outside the caller scope.")
        }
        return queryOrchestrationFleet(
          {
            prepare(sql: string) {
              return {
                all: (...params: unknown[]) => store.all(sql, params),
              }
            },
          },
          input,
          {
            visibleTaskId:
              scope.taskId ??
              (scope.kind === "global" || scope.projectId ? null : "__caller-chat-only__"),
            visibleProjectId: scope.taskId ? null : scope.projectId,
            includeOperationWorkspaces: isBetaFeatureEnabled("savedWorkspaces"),
          },
        )
      }
      if (name === "list_chats") {
        const input = listChatsSchema.parse(rawInput)
        requireScope(store, scope, input)
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
      if (name === "read_chat" || name === "read_messages") {
        const input = historySchema.parse(rawInput)
        const v = visible(scope)
        const chat = store.get(
          `SELECT c.id, c.name, c.scope, c.project_id projectId, c.task_id taskId,
             coalesce(s.harness,c.harness) harness, coalesce(s.model,c.model) model,
             coalesce(s.reasoning_effort,c.reasoning_effort) reasoningEffort,
             coalesce(s.permission_mode,c.permission_mode) permissionMode, c.custom_permissions customPermissions, s.mode chatMode
           FROM chats c LEFT JOIN sub_chats s ON s.chat_id = c.id
           WHERE c.id = ? AND ${v.sql} ORDER BY s.created_at,s.id LIMIT 1`,
          [input.chatId, ...v.params],
        )
        if (!chat) fail("not-found", "Chat is missing or outside the caller scope.")
        const recordTask =
          name === "read_chat"
            ? store.get(
                `SELECT links.path, links.recordId, links.canonicalProjectId FROM (
             SELECT chat_id,record_path path,record_id recordId,canonical_project_id canonicalProjectId FROM record_chat_links
             UNION ALL
             SELECT chat_id,record_path,record_id,canonical_project_id FROM record_task_worktrees
           ) links JOIN chats c ON c.id=links.chat_id WHERE c.id=? AND ${v.sql} LIMIT 1`,
                [input.chatId, ...v.params],
              )
            : undefined
        const rows = store.all(
          `SELECT m.key position, substr(m.value ->> '$.id',1,128) id, m.value ->> '$.role' role,
             coalesce((SELECT substr(group_concat(piece,''),1,4096) FROM (
               SELECT substr(part.value ->> '$.text',1,4096) piece
               FROM json_each(m.value,'$.parts') part WHERE part.type='object'
                 AND part.value ->> '$.type'='text' AND json_type(part.value,'$.text')='text'
                 AND (part.value ->> '$.providerMetadata.runtime.phase') IS NOT 'commentary'
               ORDER BY part.key LIMIT 64
             )), CASE WHEN json_type(m.value,'$.content')='text' THEN substr(m.value ->> '$.content',1,4096) END,'') text,
             (SELECT substr(group_concat(piece,char(10)),1,1024) FROM (
               SELECT substr(part.value ->> '$.text',1,1024) piece FROM json_each(m.value,'$.parts') part
               WHERE part.type='object' AND part.value ->> '$.type'='text'
                 AND part.value ->> '$.providerMetadata.runtime.phase'='commentary'
               ORDER BY part.key LIMIT 12
             )) commentary,
             (SELECT json_group_array(name) FROM (
               SELECT substr(part.value ->> '$.type',6,128) name
               FROM json_each(m.value,'$.parts') part WHERE part.type='object'
               AND substr(part.value ->> '$.type',1,5)='tool-' ORDER BY part.key LIMIT 12
             )) tools
           FROM chats c JOIN sub_chats s ON s.id = (
             SELECT id FROM sub_chats WHERE chat_id=c.id ORDER BY created_at,id LIMIT 1)
           JOIN json_each(s.messages) m
           WHERE c.id=? AND ${v.sql} AND m.key < ? AND m.type='object' AND m.value ->> '$.role' IN ('user','assistant')
           ORDER BY m.key DESC LIMIT ?`,
          [
            input.chatId,
            ...v.params,
            input.cursor ? offset(input.cursor) : Number.MAX_SAFE_INTEGER,
            input.limit + 1,
          ],
        )
        const nextCursor =
          rows.length > input.limit
            ? Buffer.from(String(rows[input.limit - 1]!.position)).toString("base64url")
            : null
        const items = rows
          .slice(0, input.limit)
          .reverse()
          .map((row) => ({
            id: row.id,
            role: row.role,
            text: sanitizeRuntimeText(String(row.text), { mode: "agent-content", maxLength: 4096 }),
            ...(typeof row.commentary === "string"
              ? {
                  commentary: sanitizeRuntimeText(row.commentary, {
                    mode: "agent-content",
                    maxLength: 1024,
                  }),
                }
              : {}),
            tools: JSON.parse(String(row.tools)) as string[],
          }))
        return {
          ...(name === "read_chat"
            ? {
                chat: {
                  ...chat,
                  recordTask: recordTask ?? null,
                  customPermissions: parseStoredCustomPermissionCapabilities(
                    chat.customPermissions,
                  ),
                },
              }
            : {}),
          items,
          nextCursor,
        }
      }
      if (name === "read_run") {
        const input = runSchema.parse(rawInput)
        const v = visible(scope)
        const run = store.get(
          `SELECT r.id, r.chat_id chatId, r.harness, r.model, r.reasoning_effort reasoningEffort,
             r.permission_mode permissionMode, r.status, r.started_at, r.completed_at
           FROM agent_runs r JOIN chats c ON c.id=r.chat_id WHERE r.id=? AND ${v.sql}`,
          [input.runId, ...v.params],
        )
        if (!run) fail("not-found", "Run is missing or outside the caller scope.")
        const activity = queryPage(
          store,
          `SELECT a.sequence, a.kind, a.phase,
             substr(CASE a.kind WHEN 'reasoning-summary' THEN a.payload_json ->> '$.text'
                WHEN 'tool' THEN a.payload_json ->> '$.name' ELSE a.payload_json ->> '$.message' END,1,1024) summary
           FROM agent_activity_events a JOIN agent_runs r ON r.id=a.run_id JOIN chats c ON c.id=r.chat_id
           WHERE r.id=? AND ${v.sql} AND a.privacy_class='public' AND a.display_class!='private'
             AND a.redaction_state='none' AND a.kind IN ('reasoning-summary','tool','status')
           ORDER BY a.sequence DESC`,
          [input.runId, ...v.params],
          offset(input.cursor),
          input.limit,
        )
        const providerSettings = store.get(
          `SELECT a.payload_json ->> '$.eventType' event, a.payload_json ->> '$.metadata.model' model,
             a.payload_json ->> '$.metadata.effort' effort
           FROM agent_activity_events a JOIN agent_runs r ON r.id=a.run_id JOIN chats c ON c.id=r.chat_id
           WHERE r.id=? AND ${v.sql} AND a.kind='opaque-metadata' AND a.provider='flapstack'
             AND a.privacy_class='public' AND a.redaction_state='none'
             AND a.payload_json ->> '$.eventType' IN ('turn/start.settings-sent','claude/query.settings-sent','antigravity/set-session-model.settings-sent')
           ORDER BY a.sequence DESC LIMIT 1`,
          [input.runId, ...v.params],
        )
        const { started_at, completed_at, ...metadata } = run
        return {
          ...metadata,
          providerSettings: providerSettings ?? null,
          startedAt: timestamp(started_at),
          completedAt: timestamp(completed_at),
          activity: {
            ...activity,
            items: activity.items.reverse().map((item) => ({
              ...item,
              summary: typeof item.summary === "string" ? sanitizeRuntimeText(item.summary) : null,
            })),
          },
        }
      }
      if (name === "list_runs") {
        const input = listRunsSchema.parse(rawInput)
        requireScope(store, scope, input)
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
        requireScope(store, scope, input)
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
        requireScope(store, scope, input)
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
        requireScope(store, scope, input)
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
  return {
    get: (sql, params) => withReadDatabase(path, (db) => db.prepare(sql).get(...params) as Row),
    all: (sql, params) => withReadDatabase(path, (db) => db.prepare(sql).all(...params) as Row[]),
  }
}

function withReadDatabase<T>(path: string, operation: (database: Database.Database) => T): T {
  const database = openAppDatabase(path, { readonly: true, fileMustExist: true })
  try {
    database.pragma("query_only = ON")
    database.pragma("busy_timeout = 5000")
    return operation(database)
  } finally {
    database.close()
  }
}
