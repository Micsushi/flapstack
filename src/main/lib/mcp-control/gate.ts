import { parsePermissionMode } from "../permissions"
import type { McpGateResult, McpRiskTier } from "./types"

export function evaluateMcpGate(input: {
  tier: McpRiskTier
  permissionMode?: string | null
  approved?: boolean
}): McpGateResult {
  const mode = parsePermissionMode(input.permissionMode) ?? "ask-before-edits"

  if (input.tier === 0) {
    return allowed("Read-only app-control operation.")
  }

  if (mode === "read-only") {
    return denied("Read-only callers can only use Tier 0 app-control tools.")
  }

  if (input.tier === 3) {
    return input.approved
      ? allowed("Tier 3 operation was explicitly approved.")
      : approvalRequired("Tier 3 app-control tools always require approval.")
  }

  if (mode === "ask-before-edits") {
    return input.approved
      ? allowed("Operation was explicitly approved.")
      : approvalRequired("Permission mode requires approval for mutating app-control tools.")
  }

  return allowed(`Permission mode ${mode} allows this app-control tier.`)
}

function allowed(reason: string): McpGateResult {
  return { decision: "allowed", reason, requiresApproval: false }
}

function denied(reason: string): McpGateResult {
  return { decision: "denied", reason, requiresApproval: false }
}

function approvalRequired(reason: string): McpGateResult {
  return { decision: "approval-required", reason, requiresApproval: true }
}
