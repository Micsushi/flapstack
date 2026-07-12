import { mcpAuditRecords } from "../db/schema"
import { randomUUID } from "node:crypto"
import { and, desc, eq, gte, lt, lte, or } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type * as schema from "../db/schema"
import type { McpCallerIdentity, McpRiskTier } from "./types"

const MAX_DEPTH = 5
const MAX_ENTRIES = 50
const MAX_STRING_LENGTH = 1_024
const MAX_SUMMARY_LENGTH = 16_384
const redacted = "[REDACTED]"
const truncated = "[TRUNCATED]"
const secretKey =
  /(?:api[-_]?key|authorization|credential|cookie|pass(?:word)?|secret|token|private[-_]?key|session(?:[-_]?id)?|access[-_]?token|refresh[-_]?token)/i
const reasoningKey = /(?:reasoning|chain[-_]?of[-_]?thought|thinking)/i
const bearerValue = /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/gi
const tokenValue = /\b(?:sk|rk|pk|ghp|gho|github_pat)_[a-z0-9_-]+\b/gi

export type McpAuditStatus =
  "allowed" | "denied" | "approval-required" | "timed-out" | "stale" | "failed" | "completed"

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
      chatSnapshot: redactMcpAuditSummary(record.chatSnapshot ?? null),
      runSnapshot: redactMcpAuditSummary(record.runSnapshot ?? null),
      inputSummary: redactMcpAuditSummary(record.input ?? null),
      resultSummary: redactMcpAuditSummary(record.result ?? null),
      durationMs: Math.max(0, Math.floor(record.durationMs ?? 0)),
      ...(record.createdAt ? { createdAt: record.createdAt } : {}),
    })
    .run()
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
  if (typeof value === "string") return redactString(value)
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "undefined") return "[UNDEFINED]"
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value))
    return value.slice(0, MAX_ENTRIES).map((item) => redactValue(item, depth + 1))
  if (typeof value === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value).slice(0, MAX_ENTRIES)) {
      output[key] =
        secretKey.test(key) || reasoningKey.test(key) ? redacted : redactValue(item, depth + 1)
    }
    return output
  }
  return String(value)
}

function redactString(value: string): string {
  const bounded =
    value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}${truncated}` : value
  return bounded.replace(bearerValue, redacted).replace(tokenValue, redacted)
}
