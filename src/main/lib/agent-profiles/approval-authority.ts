import { randomUUID } from "node:crypto"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type * as schema from "../db/schema"
import { appendMcpAuditRecord } from "../mcp-control/audit-storage"
import { createSqliteMcpApprovalCoordinator } from "../mcp-control/approval-coordinator"
import {
  buildMcpApprovalContextHash,
  McpApprovalLifecycle,
} from "../mcp-control/approval-lifecycle"
import { publishProductMcpInvalidation } from "../mcp-control/invalidation-bridge"

export const AGENT_PROFILE_CAPABILITY_APPROVAL_TOOL = "agent-profile.capability.widen"

type Database = BetterSQLite3Database<typeof schema>

export async function requestAgentProfileCapabilityApproval(
  database: Database,
  input: {
    callerChatId: string
    callerRunId?: string | null
    authority: unknown
  },
) {
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
    toolName: AGENT_PROFILE_CAPABILITY_APPROVAL_TOOL,
    tier: 3,
    input: input.authority,
  })
  try {
    const wait = lifecycle.request({
      id: invocationId,
      invocationId,
      caller,
      toolName: AGENT_PROFILE_CAPABILITY_APPROVAL_TOOL,
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
        toolName: AGENT_PROFILE_CAPABILITY_APPROVAL_TOOL,
        tier: 3,
        input: input.authority,
        result: { decision },
      })
      throw new Error(`Agent Profile capability approval ${decision.state}.`)
    }
    const auditId = randomUUID()
    appendMcpAuditRecord(database, {
      id: auditId,
      invocationId,
      status: "completed",
      caller,
      toolName: AGENT_PROFILE_CAPABILITY_APPROVAL_TOOL,
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

export function agentProfileApprovalContextHash(input: {
  callerChatId: string
  callerRunId?: string | null
  authority: unknown
}) {
  return buildMcpApprovalContextHash({
    caller: { chatId: input.callerChatId, runId: input.callerRunId ?? undefined },
    toolName: AGENT_PROFILE_CAPABILITY_APPROVAL_TOOL,
    tier: 3,
    input: input.authority,
  })
}
