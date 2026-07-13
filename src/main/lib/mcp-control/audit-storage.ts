import { mcpAuditRecords } from "../db/schema"
import { createHash, randomUUID } from "node:crypto"
import { and, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type * as schema from "../db/schema"
import type { McpCallerIdentity, McpRiskTier } from "./types"

const MAX_DEPTH = 5
const MAX_ENTRIES = 50
const MAX_SUMMARY_LENGTH = 16_384
const redacted = "[REDACTED]"
const truncated = "[TRUNCATED]"
const secretKey =
  /(?:api[-_]?key|authorization|credential|cookie|pass(?:word)?|secret|token|private[-_]?key|session(?:[-_]?id)?|access[-_]?token|refresh[-_]?token)/i
const reasoningKey = /(?:reasoning|chain[-_]?of[-_]?thought|thinking)/i
const safeAuditKeys = new Set([
  "archived",
  "byteLength",
  "caller",
  "chatId",
  "content",
  "contextHash",
  "created",
  "customPermissions",
  "data",
  "decision",
  "dryRun",
  "error",
  "harness",
  "id",
  "input",
  "itemCount",
  "keys",
  "limit",
  "name",
  "ok",
  "overwrite",
  "permissionMode",
  "pinned",
  "projectId",
  "result",
  "runId",
  "scope",
  "sha256",
  "source",
  "state",
  "status",
  "summary",
  "taskId",
  "tier",
  "type",
])
export type McpAuditStatus =
  | "allowed"
  | "dispatch-started"
  | "denied"
  | "approval-required"
  | "timed-out"
  | "stale"
  | "failed"
  | "completed"

export type McpAuditSnapshot = Record<string, unknown> | null

export type AppendMcpAuditRecord = {
  id?: string
  invocationId?: string
  status: McpAuditStatus
  caller: McpCallerIdentity
  toolName: string
  tier: McpRiskTier
  chatSnapshot?: McpAuditSnapshot
  runSnapshot?: McpAuditSnapshot
  input?: unknown
  result?: unknown
  durationMs?: number
  createdAt?: Date
}

type AuditDatabase = Pick<BetterSQLite3Database<typeof schema>, "insert">

export type McpAuditDetailDto = {
  callerSummary: string
  chatSummary: string
  runSummary: string
  inputSummary: string
  resultSummary: string
}

/**
 * The only audit shape exposed outside storage. It deliberately contains the
 * already-redacted summaries, never raw invocation snapshots or payloads.
 */
export type McpAuditRecordDto = {
  id: string
  invocationId: string
  decision: McpAuditStatus
  callerChatId: string
  callerRunId: string | null
  toolName: string
  tier: McpRiskTier
  durationMs: number
  occurredAt: string
  detail: McpAuditDetailDto
}

export type McpAuditQuery = {
  callerChatId?: string
  toolName?: string
  decision?: McpAuditStatus
  from?: Date
  to?: Date
  cursor?: string
  limit?: number
}

export type McpAuditPage = {
  entries: McpAuditRecordDto[]
  nextCursor: string | null
}

type QueryDatabase = Pick<BetterSQLite3Database<typeof schema>, "select">

export type McpDispatchLookup = {
  caller: Pick<McpCallerIdentity, "chatId" | "runId">
  toolName: string
  input: unknown
}

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

/** Store bounded, non-recoverable JSON suitable for durable audit summaries. */
export function redactMcpAuditSummary(value: unknown): string {
  const summary = JSON.stringify(redactValue(value, 0))
  return summary.length <= MAX_SUMMARY_LENGTH ? summary : JSON.stringify(truncated)
}

/**
 * Storage only. Invocation/approval paths own when records are appended.
 * Snapshot fields are serialized at write time and intentionally have no FKs.
 */
export function appendMcpAuditRecord(database: AuditDatabase, record: AppendMcpAuditRecord): void {
  database
    .insert(mcpAuditRecords)
    .values({
      ...(record.id ? { id: record.id } : {}),
      invocationId: record.invocationId ?? record.id ?? randomUUID(),
      status: record.status,
      callerChatId: record.caller.chatId,
      callerRunId: record.caller.runId ?? null,
      toolName: record.toolName,
      tier: record.tier,
      callerSnapshot: redactMcpAuditSummary({
        chatId: record.caller.chatId,
        runId: record.caller.runId ?? null,
        permissionMode: record.caller.permissionMode ?? null,
        customPermissions: record.caller.customPermissions ?? null,
      }),
      chatSnapshot: redactMcpAuditSummary(summarizeSnapshot(record.chatSnapshot)),
      runSnapshot: redactMcpAuditSummary(summarizeSnapshot(record.runSnapshot)),
      inputSummary: redactMcpAuditSummary(summarizeMcpAuditInput(record.toolName, record.input)),
      resultSummary: redactMcpAuditSummary(summarizeMcpAuditResult(record.result)),
      durationMs: Math.max(0, Math.floor(record.durationMs ?? 0)),
      ...(record.createdAt ? { createdAt: record.createdAt } : {}),
    })
    .run()
}

/** Operation-specific allowlist. Arbitrary content is represented only by size and hash. */
export function summarizeMcpAuditInput(toolName: string, value: unknown): unknown {
  const input = asRecord(value)
  if (!input) return null
  const textDigest = (key: string) => summarizeText(input[key])
  const safe = (...keys: string[]) => {
    const entries: Array<[string, unknown]> = []
    for (const key of keys) {
      const item = input[key]
      if (typeof item === "boolean" || typeof item === "number") entries.push([key, item])
      if (typeof item === "string" && item.trim()) entries.push([key, summarizeText(item)])
    }
    return Object.fromEntries(entries)
  }

  switch (toolName) {
    case "create_chat":
      return {
        ...safe("scope", "projectId", "taskId", "harness", "model"),
        name: textDigest("name"),
      }
    case "create_task":
      return {
        ...safe("projectId"),
        name: textDigest("name"),
        description: textDigest("description"),
      }
    case "add_attachment":
      return {
        ...safe("chatId", "kind"),
        name: summarizeText(input.name),
        content: textDigest("contentText"),
      }
    case "write_attachment_to_worktree":
      return safe("attachmentId", "worktreePath", "targetRelativePath", "overwrite")
    case "launch_run":
      return {
        ...safe("chatId", "idempotencyKey"),
        initialPrompt: textDigest("initialPrompt"),
      }
    case "create_automation_draft":
      return { ...safe("trigger", "dryRun"), name: textDigest("name") }
    case "search":
      return { ...safe("scope", "scopeId", "cursor", "limit"), query: textDigest("query") }
    case "rename_item":
      return { ...safe("kind", "id"), name: textDigest("name") }
    case "move_chat":
      return safe("id", "scope", "projectId", "taskId")
    case "archive_item":
    case "restore_item":
    case "pin_item":
      return safe("kind", "id", "pinned")
    case "list_projects":
    case "list_tasks":
    case "list_chats":
    case "list_runs":
    case "list_worktrees":
    case "list_artifacts":
      return safe("projectId", "taskId", "chatId", "runId", "cursor", "limit")
    case "ping":
    case "describe":
      return null
    default:
      return { keys: Object.keys(input).sort().slice(0, MAX_ENTRIES) }
  }
}

function summarizeMcpAuditResult(value: unknown): unknown {
  const result = asRecord(value)
  if (!result) return value === null ? null : { type: typeof value }
  const error = asRecord(result.error)
  const data = asRecord(result.data)
  const decision = asRecord(result.decision)
  return {
    ok: result.ok === true,
    ...(decision
      ? {
          decision: Object.fromEntries(
            ["id", "state", "source"].flatMap((key) =>
              typeof decision[key] === "string" ? [[key, summarizeText(decision[key])]] : [],
            ),
          ),
        }
      : {}),
    ...(error
      ? {
          error: {
            ...(typeof error.code === "string" ? { code: summarizeText(error.code) } : {}),
            ...(typeof error.message === "string" ? { message: summarizeText(error.message) } : {}),
          },
        }
      : {}),
    ...(data
      ? {
          data: {
            keys: Object.keys(data).sort().slice(0, MAX_ENTRIES),
            ...(typeof data.id === "string" ? { id: summarizeText(data.id) } : {}),
            ...(typeof data.runId === "string" ? { runId: summarizeText(data.runId) } : {}),
            ...(Array.isArray(data.items) ? { itemCount: data.items.length } : {}),
          },
        }
      : {}),
    ...(!error && !data ? { keys: Object.keys(result).sort().slice(0, MAX_ENTRIES) } : {}),
  }
}

function summarizeSnapshot(value: unknown): unknown {
  const snapshot = asRecord(value)
  if (!snapshot) return null
  const allowed = [
    "id",
    "chatId",
    "runId",
    "projectId",
    "taskId",
    "status",
    "scope",
    "harness",
    "permissionMode",
    "archived",
  ]
  return Object.fromEntries(
    allowed.flatMap((key) => {
      const item = snapshot[key]
      return typeof item === "string" || typeof item === "boolean" || typeof item === "number"
        ? [[key, item]]
        : []
    }),
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function summarizeText(value: unknown): unknown {
  if (typeof value !== "string") return null
  return {
    byteLength: Buffer.byteLength(value),
    sha256: createHash("sha256").update(value).digest("hex"),
  }
}

/** Query append-only audit storage in a stable newest-first order. */
export function listMcpAuditRecords(
  database: QueryDatabase,
  query: McpAuditQuery = {},
): McpAuditPage {
  const limit = Math.max(1, Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE))
  const cursor = query.cursor ? decodeCursor(query.cursor) : null
  const conditions = [
    query.callerChatId ? eq(mcpAuditRecords.callerChatId, query.callerChatId) : undefined,
    query.toolName ? eq(mcpAuditRecords.toolName, query.toolName) : undefined,
    query.decision ? eq(mcpAuditRecords.status, query.decision) : undefined,
    query.from ? gte(mcpAuditRecords.createdAt, query.from) : undefined,
    query.to ? lte(mcpAuditRecords.createdAt, query.to) : undefined,
    cursor
      ? or(
          lt(mcpAuditRecords.createdAt, cursor.occurredAt),
          and(eq(mcpAuditRecords.createdAt, cursor.occurredAt), lt(mcpAuditRecords.id, cursor.id)),
        )
      : undefined,
  ]
  const rows = database
    .select()
    .from(mcpAuditRecords)
    .where(and(...conditions))
    .orderBy(desc(mcpAuditRecords.createdAt), desc(mcpAuditRecords.id))
    .limit(limit + 1)
    .all()
  const page = rows.slice(0, limit).map(toAuditDto)

  return {
    entries: page,
    nextCursor: rows.length > limit && page.length > 0 ? encodeCursor(page.at(-1)!) : null,
  }
}

function toAuditDto(row: typeof mcpAuditRecords.$inferSelect): McpAuditRecordDto {
  return {
    id: row.id,
    invocationId: row.invocationId,
    decision: row.status as McpAuditStatus,
    callerChatId: row.callerChatId,
    callerRunId: row.callerRunId,
    toolName: row.toolName,
    tier: row.tier as McpRiskTier,
    durationMs: row.durationMs,
    occurredAt: (row.createdAt ?? new Date(0)).toISOString(),
    detail: {
      callerSummary: row.callerSnapshot,
      chatSummary: row.chatSnapshot,
      runSummary: row.runSnapshot,
      inputSummary: row.inputSummary,
      resultSummary: row.resultSummary,
    },
  }
}

function encodeCursor(entry: McpAuditRecordDto): string {
  return Buffer.from(
    JSON.stringify({ occurredAt: entry.occurredAt, id: entry.id }),
    "utf8",
  ).toString("base64url")
}

function decodeCursor(cursor: string): { occurredAt: Date; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { occurredAt?: unknown }).occurredAt !== "string" ||
      typeof (parsed as { id?: unknown }).id !== "string"
    ) {
      throw new Error("invalid cursor")
    }
    const occurredAt = new Date((parsed as { occurredAt: string }).occurredAt)
    if (Number.isNaN(occurredAt.getTime())) throw new Error("invalid cursor")
    return { occurredAt, id: (parsed as { id: string }).id }
  } catch {
    throw new Error("Invalid audit cursor")
  }
}

function redactValue(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEPTH) return truncated
  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return summarizeText(value)
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "undefined") return "[UNDEFINED]"
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value))
    return value.slice(0, MAX_ENTRIES).map((item) => redactValue(item, depth + 1))
  if (typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, MAX_ENTRIES)) {
      const outputKey = safeAuditKeys.has(key)
        ? key
        : `field_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`
      output[outputKey] =
        secretKey.test(key) || reasoningKey.test(key)
          ? redacted
          : isSafeDigestField(key, item)
            ? item
            : redactValue(item, depth + 1)
    }
    return output
  }
  return String(value)
}

function isSafeDigestField(key: string, value: unknown): value is string {
  return (
    (key === "sha256" || key === "contextHash") &&
    typeof value === "string" &&
    /^[a-f0-9]{64}$/i.test(value)
  )
}

/**
 * Returns a durable claim with no terminal audit for the same caller, tool,
 * and redacted input. Callers must reconcile it instead of blindly retrying.
 */
export function findUnresolvedMcpDispatch(
  database: QueryDatabase,
  lookup: McpDispatchLookup,
): string | null {
  const rows = database
    .select({
      invocationId: mcpAuditRecords.invocationId,
      status: mcpAuditRecords.status,
      inputSummary: mcpAuditRecords.inputSummary,
      createdAt: mcpAuditRecords.createdAt,
    })
    .from(mcpAuditRecords)
    .where(
      and(
        eq(mcpAuditRecords.callerChatId, lookup.caller.chatId),
        lookup.caller.runId
          ? eq(mcpAuditRecords.callerRunId, lookup.caller.runId)
          : isNull(mcpAuditRecords.callerRunId),
        eq(mcpAuditRecords.toolName, lookup.toolName),
      ),
    )
    .orderBy(desc(mcpAuditRecords.createdAt), desc(mcpAuditRecords.id))
    .all()
  const terminal = new Set(
    rows
      .filter((row) => row.status === "completed" || row.status === "failed")
      .map((row) => row.invocationId),
  )
  const inputSummary = redactMcpAuditSummary(summarizeMcpAuditInput(lookup.toolName, lookup.input))
  return (
    rows.find(
      (row) =>
        row.status === "dispatch-started" &&
        row.inputSummary === inputSummary &&
        !terminal.has(row.invocationId),
    )?.invocationId ?? null
  )
}
