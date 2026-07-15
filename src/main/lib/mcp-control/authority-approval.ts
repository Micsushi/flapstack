import { randomUUID } from "node:crypto"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type * as schema from "../db/schema"
import { appendMcpAuditRecord } from "./audit-storage"
import { createSqliteMcpApprovalCoordinator } from "./approval-coordinator"
import { buildMcpApprovalContextHash, McpApprovalLifecycle } from "./approval-lifecycle"
import { publishProductMcpInvalidation } from "./invalidation-bridge"

type Database = BetterSQLite3Database<typeof schema>

export type AuthorityApprovalInput = {
  toolName: string
  callerChatId: string
  callerRunId?: string | null
  authority: unknown
}

export async function requestAuthorityApproval(
  database: Database,
  input: AuthorityApprovalInput & { errorLabel: string },
): Promise<string> {
  const publish = () => {
    void publishProductMcpInvalidation({
      version: 1,
      source: "product-mcp",
      domains: ["approvals", "audit"],
    })
  }
  const lifecycle = new McpApprovalLifecycle(
    createSqliteMcpApprovalCoordinator(database, publish),
    publish,
  )
  const invocationId = randomUUID()
  const caller = { chatId: input.callerChatId, runId: input.callerRunId ?? undefined }
  appendMcpAuditRecord(database, {
    invocationId,
    status: "approval-required",
    caller,
    toolName: input.toolName,
    tier: 3,
    input: input.authority,
  })
  try {
    const wait = lifecycle.request({
      id: invocationId,
      invocationId,
      caller,
      toolName: input.toolName,
      tier: 3,
      timeoutMs: 60_000,
      input: input.authority,
    })
    const decision = await wait.decision
    if (decision.state !== "approved") {
      appendMcpAuditRecord(database, {
        invocationId,
        status: decision.state === "denied" ? "denied" : "failed",
        caller,
        toolName: input.toolName,
        tier: 3,
        input: input.authority,
        result: { decision },
      })
      throw new Error(`${input.errorLabel} approval ${decision.state}.`)
    }
    const auditId = randomUUID()
    appendMcpAuditRecord(database, {
      id: auditId,
      invocationId,
      status: "completed",
      caller,
      toolName: input.toolName,
      tier: 3,
      input: input.authority,
      result: { ok: true, decision },
    })
    publish()
    return auditId
  } finally {
    lifecycle.shutdown()
  }
}

export function authorityApprovalContextHash(input: AuthorityApprovalInput): string {
  return buildMcpApprovalContextHash({
    caller: { chatId: input.callerChatId, runId: input.callerRunId ?? undefined },
    toolName: input.toolName,
    tier: 3,
    input: input.authority,
  })
}
