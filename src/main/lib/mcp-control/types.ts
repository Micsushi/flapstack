export type McpRiskTier = 0 | 1 | 2 | 3
export type McpGateDecision = "allowed" | "denied" | "approval-required"

export type McpControlTool = {
  name: string
  description: string
  tier: McpRiskTier
  status: "scaffolded" | "implemented" | "stubbed"
}

export type McpCallerIdentity = {
  chatId: string
  runId?: string
  permissionMode?: string | null
}

export type McpControlErrorCode =
  "invalid-caller" | "tool-not-found" | "tool-unavailable" | "invalid-input"

export type McpControlResponse<T = unknown> =
  { ok: true; data: T } | { ok: false; error: { code: McpControlErrorCode; message: string } }

export type McpGateResult = {
  decision: McpGateDecision
  reason: string
  requiresApproval: boolean
}
