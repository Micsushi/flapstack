import { mcpAuditRecords } from "../db/schema"
import { randomUUID } from "node:crypto"
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
