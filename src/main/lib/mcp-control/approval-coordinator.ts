import { and, eq, gt, isNull } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type * as schema from "../db/schema"
import { mcpApprovalRequests } from "../db/schema"
import { redactMcpAuditSummary, summarizeMcpAuditInput } from "./audit-storage"
import type { McpApprovalCoordinator, McpPendingApproval } from "./approval-lifecycle"

type Database = BetterSQLite3Database<typeof schema>

export function createSqliteMcpApprovalCoordinator(
  database: Database,
  onPublished?: () => void,
): McpApprovalCoordinator {
  return {
    publish(pending) {
      const result = database
        .insert(mcpApprovalRequests)
        .values({
          id: pending.id,
          invocationId: pending.invocationId,
          callerChatId: pending.caller.chatId,
          callerRunId: pending.caller.runId ?? null,
          toolName: pending.toolName,
          tier: pending.tier,
          targetSummary: summarizeTarget(pending.input),
          inputSummary: redactMcpAuditSummary({
            contextHash: pending.contextHash,
            summary: summarizeMcpAuditInput(pending.toolName, pending.input),
          }),
          createdAt: pending.createdAt,
          expiresAt: pending.expiresAt,
        })
        .run()
      if (result.changes === 1) onPublished?.()
    },
    readDecision(pending) {
      const row = database
        .select({
          invocationId: mcpApprovalRequests.invocationId,
          callerChatId: mcpApprovalRequests.callerChatId,
          callerRunId: mcpApprovalRequests.callerRunId,
          toolName: mcpApprovalRequests.toolName,
          tier: mcpApprovalRequests.tier,
          inputSummary: mcpApprovalRequests.inputSummary,
          decision: mcpApprovalRequests.decision,
          grantSession: mcpApprovalRequests.grantSession,
        })
        .from(mcpApprovalRequests)
        .where(eq(mcpApprovalRequests.id, pending.id))
        .get()
      if (!row || !approvalRowMatches(row, pending)) {
        throw new Error("MCP approval identity or context mismatch.")
      }
      if (row?.decision !== "approve" && row?.decision !== "deny") return null
      return { decision: row.decision, grantSession: row.grantSession }
    },
  }
}

function approvalRowMatches(
  row: {
    invocationId: string
    callerChatId: string
    callerRunId: string | null
    toolName: string
    tier: number
    inputSummary: string
  },
  pending: McpPendingApproval,
): boolean {
  let contextHash: unknown
  try {
    contextHash = (JSON.parse(row.inputSummary) as { contextHash?: unknown }).contextHash
  } catch {
    return false
  }
  return (
    row.invocationId === pending.invocationId &&
    row.callerChatId === pending.caller.chatId &&
    row.callerRunId === (pending.caller.runId ?? null) &&
    row.toolName === pending.toolName &&
    row.tier === pending.tier &&
    contextHash === pending.contextHash
  )
}

export function listPendingMcpApprovals(database: Database) {
  const now = new Date()
  return database
    .select()
    .from(mcpApprovalRequests)
    .where(and(isNull(mcpApprovalRequests.decision), gt(mcpApprovalRequests.expiresAt, now)))
    .all()
    .map((row) => ({
      id: row.id,
      chatId: row.callerChatId,
      chatName: `Chat ${row.callerChatId}`,
      callerLabel: row.callerRunId
        ? `Chat ${row.callerChatId} / run ${row.callerRunId}`
        : `Chat ${row.callerChatId}`,
      toolName: row.toolName,
      risk: row.tier as 1 | 2 | 3,
      targetLabel: row.targetSummary,
      inputSummary: row.inputSummary,
      requestedAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      state: "pending" as const,
      sessionGrantOptions:
        row.tier < 3 ? (["Approve this tool for this chat session"] as const) : [],
    }))
}

export function decideMcpApproval(
  database: Database,
  input: { id: string; decision: "approve" | "deny"; grantSession: boolean },
): boolean {
  const result = database
    .update(mcpApprovalRequests)
    .set({
      decision: input.decision,
      grantSession: input.decision === "approve" && input.grantSession,
    })
    .where(
      and(
        eq(mcpApprovalRequests.id, input.id),
        isNull(mcpApprovalRequests.decision),
        gt(mcpApprovalRequests.expiresAt, new Date()),
      ),
    )
    .run()
  return result.changes === 1
}

function summarizeTarget(input: unknown): string {
  if (!input || typeof input !== "object") return "Flapstack app state"
  const record = input as Record<string, unknown>
  for (const key of ["target", "chatId", "taskId", "projectId", "runId", "worktreeId", "path"]) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) {
      const safe = JSON.parse(redactMcpAuditSummary(value)) as string
      return `${key}: ${safe.slice(0, 256)}`
    }
  }
  return "Target described by bounded input"
}
