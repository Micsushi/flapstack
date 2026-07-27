import {
  parsePermissionMode,
  type CustomPermissionToggles,
  type PermissionMode,
} from "../permissions"
import { FLAPSTACK_MCP_SERVER_NAME } from "./registration"
import { getMcpControlTool } from "./registry"
import type { McpControlTool } from "./types"

export type ProviderMcpToolReference = {
  serverName: string
  toolName: string
}

export type ProviderMcpPermissionDecision = {
  source: "product" | "third-party" | "unknown-product"
  decision: "allow" | "deny" | "provider-approval"
  correlationId: string
  providerPromptRequired: boolean
  productGateRequired: boolean
  productApprovalRequired: boolean
  tool: McpControlTool | null
  reason: string
}

export function resolveProviderMcpPermission(input: {
  permissionMode: PermissionMode | string | null | undefined
  correlationId: string
  providerToolName?: string | null
  serverName?: string | null
  toolName?: string | null
  metadata?: unknown
  isMcpToolApproval?: boolean
  /** Product identity copied from the launcher-owned MCP registration snapshot. */
  trustedProductServerName?: string | null
  customPermissions?: CustomPermissionToggles | null
}): ProviderMcpPermissionDecision | null {
  const reference =
    explicitReference(input.serverName, input.toolName) ??
    parseProviderMcpToolName(input.providerToolName) ??
    parseProviderMcpMetadata(input.metadata)
  const permissionMode = parsePermissionMode(input.permissionMode)
  if (!reference && input.isMcpToolApproval) {
    const serverName = mcpApprovalServerName(input.metadata)
    if (!serverName) return null
    const trustedProduct = isTrustedProductServer(serverName, input.trustedProductServerName)
    if (!permissionMode) {
      return denied(
        { serverName, toolName: "unknown" },
        input.correlationId,
        null,
        "Provider permission mode is missing.",
        trustedProduct ? "product" : "third-party",
      )
    }
    if (!trustedProduct) {
      return resolveThirdParty(
        { serverName, toolName: "unknown" },
        permissionMode,
        input.correlationId,
        input.customPermissions,
      )
    }
    return {
      source: "product",
      decision: "allow",
      correlationId: input.correlationId,
      providerPromptRequired: false,
      productGateRequired: true,
      productApprovalRequired: false,
      tool: null,
      reason:
        "Pinned Codex ACP identified the Flapstack product server; its registry gate remains authoritative for the exact tool and tier.",
    }
  }
  if (!reference) return null

  if (!permissionMode) {
    return denied(reference, input.correlationId, null, "Provider permission mode is missing.")
  }

  if (!isTrustedProductServer(reference.serverName, input.trustedProductServerName)) {
    return resolveThirdParty(
      reference,
      permissionMode,
      input.correlationId,
      input.customPermissions,
    )
  }

  const tool = getMcpControlTool(reference.toolName)
  if (!tool || tool.status !== "implemented") {
    return denied(
      reference,
      input.correlationId,
      null,
      `Unknown Flapstack product MCP tool: ${reference.toolName}.`,
      "unknown-product",
    )
  }

  if (permissionMode === "read-only" && tool.tier !== 0) {
    return denied(
      reference,
      input.correlationId,
      tool,
      "Read-only mode permits only registry-classified Tier 0 product tools.",
    )
  }

  if (permissionMode === "custom") {
    const capability =
      tool.tier === 0 ? "productMcpRead" : tool.tier === 3 ? "productMcpTier3" : "productMcpWrite"
    if (!input.customPermissions?.[capability]) {
      return denied(reference, input.correlationId, tool, `Custom permissions deny ${capability}.`)
    }
  }

  return {
    source: "product",
    decision: "allow",
    correlationId: input.correlationId,
    providerPromptRequired: false,
    productGateRequired: true,
    productApprovalRequired:
      permissionMode !== "full-access" &&
      (tool.tier === 3 || (permissionMode === "ask-before-edits" && tool.tier > 0)),
    tool,
    reason:
      tool.tier === 0
        ? "Registry-classified Tier 0 product read may reach the product gate."
        : "Known product call bypasses a duplicate provider prompt and remains subject to the product gate.",
  }
}

function isTrustedProductServer(
  serverName: string,
  trustedProductServerName: string | null | undefined,
): boolean {
  return (
    trustedProductServerName === FLAPSTACK_MCP_SERVER_NAME &&
    serverName === trustedProductServerName
  )
}

export function parseProviderMcpToolName(
  value: string | null | undefined,
): ProviderMcpToolReference | null {
  const normalized = value?.trim()
  if (!normalized) return null

  if (normalized.startsWith("mcp__")) {
    const [serverName, ...toolParts] = normalized.slice(5).split("__")
    const toolName = toolParts.join("__")
    return explicitReference(serverName, toolName)
  }

  const match = normalized.match(/^([a-zA-Z0-9_-]+)[./:]([a-zA-Z0-9_-]+)$/)
  return match ? explicitReference(match[1], match[2]) : null
}

export function parseProviderMcpMetadata(value: unknown): ProviderMcpToolReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const serverName = firstString(record, ["serverName", "server_name", "server"])
  const toolName = firstString(record, ["toolName", "tool_name", "tool"])
  return explicitReference(serverName, toolName)
}

export function buildProductMcpInvocationId(
  caller: { chatId: string; runId?: string },
  requestId: string | number,
): string {
  return ["mcp", caller.chatId, caller.runId ?? "chat", String(requestId)].join(":")
}

function resolveThirdParty(
  reference: ProviderMcpToolReference,
  permissionMode: PermissionMode,
  correlationId: string,
  customPermissions?: CustomPermissionToggles | null,
): ProviderMcpPermissionDecision {
  if (
    permissionMode === "read-only" ||
    (permissionMode === "custom" && !customPermissions?.thirdPartyMcp)
  ) {
    return denied(
      reference,
      correlationId,
      null,
      "Read-only product access does not authorize third-party MCP tools.",
      "third-party",
    )
  }
  if (permissionMode === "full-access") {
    return {
      source: "third-party",
      decision: "allow",
      correlationId,
      providerPromptRequired: false,
      productGateRequired: false,
      productApprovalRequired: false,
      tool: null,
      reason: "Third-party MCP remains governed by the provider's full-access mode.",
    }
  }
  return {
    source: "third-party",
    decision: "provider-approval",
    correlationId,
    providerPromptRequired: true,
    productGateRequired: false,
    productApprovalRequired: false,
    tool: null,
    reason: "Third-party MCP remains governed by the provider approval bridge.",
  }
}

function denied(
  _reference: ProviderMcpToolReference,
  correlationId: string,
  tool: McpControlTool | null,
  reason: string,
  source: ProviderMcpPermissionDecision["source"] = "product",
): ProviderMcpPermissionDecision {
  return {
    source,
    decision: "deny",
    correlationId,
    providerPromptRequired: false,
    productGateRequired: source === "product" || source === "unknown-product",
    productApprovalRequired: false,
    tool,
    reason,
  }
}

function explicitReference(
  serverName: string | null | undefined,
  toolName: string | null | undefined,
): ProviderMcpToolReference | null {
  // Preserve case. The product launcher owns one exact reserved registration;
  // case-insensitive user collisions are third-party even if a provider reports
  // them in a shape that otherwise resembles the product tool name.
  const server = serverName?.trim()
  const tool = toolName?.trim()
  if (!server || !tool || !/^[a-zA-Z0-9_-]+$/.test(server) || !/^[a-zA-Z0-9_-]+$/.test(tool)) {
    return null
  }
  return { serverName: server, toolName: tool }
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return null
}

function mcpApprovalServerName(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const serverName = firstString(value as Record<string, unknown>, [
    "serverName",
    "server_name",
    "server",
  ])
  const normalized = serverName?.trim()
  return normalized && /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized : null
}
