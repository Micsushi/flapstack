import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { randomUUID } from "node:crypto"
import type { McpCallerIdentity } from "./types"
import { invokeMcpControlTool, listImplementedMcpControlTools } from "./registry"
import { workflowInputShapes } from "./workflow-contract"
import { mcpReadInputShapes } from "./read-service"
import { createMcpMutationService, mcpMutationInputShapes } from "./mutation-service"
import { createMcpProjectVaultService, mcpProjectVaultInputShapes } from "./project-vault-service"
import { createMcpAutomationService, mcpAutomationInputShapes } from "./automation-service"
import { createMcpTaskProposalService, mcpTaskProposalInputShapes } from "./task-proposal-service"
import { McpApprovalLifecycle } from "./approval-lifecycle"
import { recoverMcpDispatchClaims } from "./audit-storage"
import { productMcpAudit } from "./production-audit"
import { callDesktopMcpTool } from "./live-transport"
import { needsDesktopMcp, liveControlInputShapes } from "./live-control-contract"
import { beginDatabaseOperation, getDatabase } from "../db"
import { createSqliteMcpCallerStore, resolveTrustedMcpCaller } from "./identity"
import { createSqliteMcpApprovalCoordinator } from "./approval-coordinator"
import { publishProductMcpInvalidation } from "./invalidation-bridge"
import {
  invalidationForProductMcpMutation,
  type ProductMcpRendererInvalidation,
} from "../../../shared/product-mcp-invalidation"
import { FLAPSTACK_MCP_INSTRUCTIONS } from "./guidance"
import {
  betaFeatureForMcpTool,
  getBetaFeatureSettings,
  subscribeBetaFeatureSettings,
} from "../beta-features/settings"
import { isFrozenAgentProfileToolAllowed } from "../agent-profiles/runtime-authority"

export function createMcpControlServer(
  caller: McpCallerIdentity,
  resolveExternal?: () => McpCallerIdentity,
): McpServer {
  const callerStore = createSqliteMcpCallerStore()
  const resolveCaller =
    resolveExternal ??
    ((identity: McpCallerIdentity) => resolveTrustedMcpCaller(identity, callerStore))
  const startupCaller = resolveCaller(caller)
  recoverMcpDispatchClaims(getDatabase())
  const server = new McpServer(
    { name: "flapstack-app-control", version: "0.1.0" },
    { instructions: FLAPSTACK_MCP_INSTRUCTIONS },
  )
  const publish = (event: ProductMcpRendererInvalidation): void => {
    void publishProductMcpInvalidation(event)
  }
  const publishApprovalChange = () =>
    publish({ version: 1, source: "product-mcp", domains: ["approvals"] })
  const approvals = new McpApprovalLifecycle(
    createSqliteMcpApprovalCoordinator(getDatabase, publishApprovalChange),
    publishApprovalChange,
  )
  const mutations = createMcpMutationService()
  const projectVaults = createMcpProjectVaultService()
  const automationControls = createMcpAutomationService()
  const taskProposalControls = createMcpTaskProposalService()
  const startupProfileAuthority = startupCaller.profileRuntimeAuthority ?? null

  const betaToolRegistrations = new Map<string, { enable(): void; disable(): void }>()
  for (const tool of listImplementedMcpControlTools({ includeDisabledBeta: true }).filter(
    (candidate) =>
      !startupProfileAuthority ||
      isFrozenAgentProfileToolAllowed(startupProfileAuthority, candidate.name),
  )) {
    const registration = server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema:
          liveControlInputShapes[tool.name] ??
          workflowInputShapes[tool.name] ??
          mcpReadInputShapes[tool.name] ??
          mcpMutationInputShapes[tool.name] ??
          mcpProjectVaultInputShapes[tool.name] ??
          mcpAutomationInputShapes[tool.name] ??
          mcpTaskProposalInputShapes[tool.name],
        annotations: { readOnlyHint: tool.tier === 0, destructiveHint: tool.tier >= 2 },
      },
      async (input, extra) => {
        const releaseDatabaseOperation = beginDatabaseOperation()
        try {
          // MCP SDK callbacks with no input schema receive only the request context.
          const toolInput = extra ? input : {}
          // Provider request IDs are caller-controlled and can be replayed. Every
          // received invocation owns a fresh internal identity instead.
          const invocationId = randomUUID()
          const response = needsDesktopMcp(tool.name)
            ? await callDesktopMcpTool(tool.name, caller, toolInput)
            : await invokeMcpControlTool(tool.name, caller, toolInput, undefined, {
                approvals,
                approvalId: () => invocationId,
                invocationId: () => invocationId,
                audit: productMcpAudit(() =>
                  publish({ version: 1, source: "product-mcp", domains: ["audit"] }),
                ),
                mutations,
                projectVaults,
                automationControls,
                taskProposalControls,
                resolveCaller,
              })
          const invalidation = invalidationForProductMcpMutation(tool.name, toolInput, response)
          if (invalidation && !needsDesktopMcp(tool.name)) publish(invalidation)
          return {
            content: [{ type: "text" as const, text: JSON.stringify(response) }],
            structuredContent: response,
            isError: !response.ok,
          }
        } finally {
          releaseDatabaseOperation()
        }
      },
    )
    const betaFeature = betaFeatureForMcpTool(tool.name)
    if (betaFeature) {
      betaToolRegistrations.set(tool.name, registration)
      if (!getBetaFeatureSettings()[betaFeature]) registration.disable()
    }
  }
  const unsubscribeBetaFeatures = subscribeBetaFeatureSettings((settings) => {
    for (const [name, registration] of betaToolRegistrations) {
      const feature = betaFeatureForMcpTool(name)
      if (feature && settings[feature]) registration.enable()
      else registration.disable()
    }
  })

  const close = server.close.bind(server)
  server.close = async () => {
    unsubscribeBetaFeatures()
    approvals.shutdown()
    await close()
  }
  return server
}

export async function connectMcpControlServer(
  caller: McpCallerIdentity,
  transport: Transport,
  resolveExternal?: () => McpCallerIdentity,
): Promise<{ close: () => Promise<void> }> {
  const server = createMcpControlServer(caller, resolveExternal)
  await server.connect(transport)
  let closed = false
  return {
    close: async () => {
      if (closed) return
      closed = true
      await server.close()
    },
  }
}
