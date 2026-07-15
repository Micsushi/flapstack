import {
  parsePermissionMode,
  type CustomPermissionToggles,
  type PermissionMode,
} from "../permissions"
import type { McpCapability, McpControlTool, McpGateResult, McpRiskTier } from "./types"

export function evaluateMcpGate(input: {
  tier: McpRiskTier
  permissionMode?: string | null
  requiredCapabilities?: readonly McpCapability[]
  customPermissions?: CustomPermissionToggles | null
  approved?: boolean
}): McpGateResult {
  const mode = parsePermissionMode(input.permissionMode)
  if (!mode) {
    return denied("Caller permission mode is missing or unsupported.")
  }

  if (mode === "custom") {
    if (!input.customPermissions) {
      return denied("Custom permission mode requires stored capability toggles.")
    }
    const productCapability: McpCapability =
      input.tier === 0 ? "productMcpRead" : input.tier === 3 ? "productMcpTier3" : "productMcpWrite"
    const deniedCapabilities = [productCapability, ...(input.requiredCapabilities ?? [])].filter(
      (capability) => !input.customPermissions?.[capability],
    )
    if (deniedCapabilities.length > 0) {
      return denied(`Custom permissions deny: ${deniedCapabilities.join(", ")}.`)
    }
  }

  if (input.tier === 0) {
    return allowed("Read-only app-control operation.")
  }

  if (mode === "read-only") {
    return denied("Read-only callers can only use Tier 0 app-control tools.")
  }

  if (input.tier === 3) {
    return input.approved
      ? allowed("Tier 3 operation was explicitly approved.")
      : approvalRequired("Tier 3 app-control tools always require explicit approval.")
  }

  if (mode === "ask-before-edits") {
    return input.approved
      ? allowed("Operation was explicitly approved.")
      : approvalRequired("Permission mode requires approval for mutating app-control tools.")
  }

  return allowed(`Permission mode ${mode} allows this app-control tier.`)
}

export function evaluateMcpToolGate(input: {
  tool: McpControlTool
  caller: {
    permissionMode?: PermissionMode
    customPermissions?: CustomPermissionToggles
  }
  approved?: boolean
}): McpGateResult {
  return evaluateMcpGate({
    tier: input.tool.tier,
    permissionMode: input.caller.permissionMode,
    requiredCapabilities: input.tool.requiredCapabilities,
    customPermissions: input.caller.customPermissions,
    approved: input.approved,
  })
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
