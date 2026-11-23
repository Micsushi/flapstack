import { posix } from "node:path"
import { eq } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type * as schema from "../db/schema"
import { mcpApprovalRequests, chats, projects } from "../db/schema"
import { decideMcpApproval, listPendingMcpApprovals } from "./approval-coordinator"
import { buildMcpApprovalContextHash, type McpApprovalLifecycle } from "./approval-lifecycle"

type Database = BetterSQLite3Database<typeof schema>
const sessions = new Set<McpApprovalLifecycle>()
const localWriteTools = new Set([
  "local_model.write_file",
  "local_model.edit_file",
  "local_model.apply_patch",
])

export function isLocalWriteApprovalTool(toolName: string): boolean {
  return localWriteTools.has(toolName)
}

// Only main-process local-write sessions register here. Durable audit rows stay redacted.
export function registerLocalWriteApprovalSession(lifecycle: McpApprovalLifecycle): () => void {
  sessions.add(lifecycle)
  return () => sessions.delete(lifecycle)
}

function hasLocalWriteRequest(id: string): boolean {
  return [...sessions].some((session) =>
    session
      .listPending()
      .some((request) => request.id === id && localWriteTools.has(request.toolName)),
  )
}

function liveContext(row: typeof mcpApprovalRequests.$inferSelect) {
  if (row.decision !== null || row.expiresAt.getTime() <= Date.now()) return null
  let storedHash: unknown
  try {
    storedHash = JSON.parse(row.inputSummary).contextHash
  } catch {
    return null
  }
  const pending = [...sessions]
    .flatMap((session) => session.listPending())
    .filter((item) => item.id === row.id)
  if (pending.length !== 1) return null
  const request = pending[0]!
  if (
    request.invocationId !== row.invocationId ||
    request.caller.chatId !== row.callerChatId ||
    (request.caller.runId ?? null) !== row.callerRunId ||
    request.toolName !== row.toolName ||
    request.tier !== row.tier ||
    request.contextHash !== storedHash ||
    buildMcpApprovalContextHash(request) !== storedHash ||
    request.expiresAt.getTime() <= Date.now() ||
    Math.floor(request.createdAt.getTime() / 1000) !== Math.floor(row.createdAt.getTime() / 1000) ||
    Math.floor(request.expiresAt.getTime() / 1000) !== Math.floor(row.expiresAt.getTime() / 1000)
  )
    return null
  const input = request.input as Record<string, unknown> | null
  if (
    !input ||
    typeof input !== "object" ||
    typeof input.path !== "string" ||
    !input.path ||
    input.path.length > 4096 ||
    /^[\\/]|^[a-z]:/i.test(input.path) ||
    /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(input.path) ||
    !Number.isSafeInteger(input.byteLength) ||
    (input.byteLength as number) < 0 ||
    !(
      input.expectedSha256 === null ||
      (typeof input.expectedSha256 === "string" && /^[a-f0-9]{64}$/.test(input.expectedSha256))
    ) ||
    typeof input.nextSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.nextSha256)
  )
    return null
  const targetLabel = posix.normalize(input.path.replace(/\\/g, "/"))
  if (targetLabel === "." || targetLabel === ".." || targetLabel.startsWith("../")) return null
  return {
    targetLabel,
    inputSummary: `${request.toolName === "local_model.edit_file" ? "Edit file" : request.toolName === "local_model.apply_patch" ? "Apply patch" : input.expectedSha256 === null ? "Create file" : "Replace file"} · ${input.byteLength} bytes`,
    contextHash: request.contextHash,
  }
}

export function listPendingApprovalsWithLocalWriteContext(
  database: Database,
): Array<ReturnType<typeof listPendingMcpApprovals>[number] & { contextHash?: string }> {
  return listPendingMcpApprovals(database).flatMap((view) => {
    if (!localWriteTools.has(view.toolName) && !hasLocalWriteRequest(view.id)) return [view]
    const row = database
      .select()
      .from(mcpApprovalRequests)
      .where(eq(mcpApprovalRequests.id, view.id))
      .get()
    const context = row && liveContext(row)
    if (!context) return []
    const caller = database
      .select({ chatName: chats.name, projectName: projects.name })
      .from(chats)
      .leftJoin(projects, eq(chats.projectId, projects.id))
      .where(eq(chats.id, view.chatId))
      .get()
    const chatName = caller?.chatName?.trim() || "Untitled chat"
    const callerLabel = caller?.projectName ? `${chatName} / ${caller.projectName}` : chatName
    return [{ ...view, ...context, chatName, callerLabel }]
  })
}

export function decideApprovalWithLocalWriteContext(
  database: Database,
  input: Parameters<typeof decideMcpApproval>[1],
) {
  return database.transaction((tx) => {
    const row = tx
      .select()
      .from(mcpApprovalRequests)
      .where(eq(mcpApprovalRequests.id, input.id))
      .get()
    if (
      row &&
      (localWriteTools.has(row.toolName) || hasLocalWriteRequest(input.id)) &&
      !liveContext(row)
    )
      return false
    return decideMcpApproval(database, input)
  })
}
