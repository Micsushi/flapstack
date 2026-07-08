export type McpRiskTier = 0 | 1 | 2 | 3
export type McpGateDecision = "allowed" | "denied" | "approval-required"

export type McpControlTool = {
  name: string
  description: string
  tier: McpRiskTier
  status: "scaffolded" | "implemented" | "stubbed"
}

export type McpCallerIdentity = {
  chatId?: string
  runId?: string
  permissionMode?: string | null
}

export type McpGateResult = {
  decision: McpGateDecision
  reason: string
  requiresApproval: boolean
}
