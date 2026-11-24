import { version as applicationVersion } from "../../../../package.json"
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
import { agentProfileRuntimeAuthoritySchema } from "../../../shared/agent-profiles"
import { CHILD_SESSION_TOOL, callDesktopMcpTool } from "./live-transport"
import { needsDesktopMcp, liveControlInputShapes } from "./live-control-contract"
import { beginDatabaseOperation, getDatabase } from "../db"
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

async function createMcpControlServer(
  caller: McpCallerIdentity,
  resolveExternal?: () => McpCallerIdentity,
): Promise<McpServer> {
  let startupProfileAuthority = null
  if (resolveExternal) {
    const owner = resolveExternal()
    if (owner.callerKind !== "external-owner") throw new Error("Expected a verified owner grant.")
    recoverMcpDispatchClaims(getDatabase())
  } else {
    const session = await callDesktopMcpTool(CHILD_SESSION_TOOL, caller, {})
    if (!session.ok) throw new Error(session.error.message)
    startupProfileAuthority = agentProfileRuntimeAuthoritySchema.nullable().parse(session.data)
  }
  const server = new McpServer(
    { name: "flapstack-app-control", version: applicationVersion },
    { instructions: FLAPSTACK_MCP_INSTRUCTIONS },
  )
  // Only an owner-authorized external client may run database tools without a desktop.
  const offlineOwner = resolveExternal ? createOwnerDispatch(resolveExternal) : undefined

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
        // With no input schema the SDK passes only its request context.
        const toolInput = extra ? input : {}
        const { signal } = extra ?? (input as { signal?: AbortSignal })
        const response =
          offlineOwner && !needsDesktopMcp(tool.name)
            ? await offlineOwner.invoke(tool.name, toolInput)
            : await callDesktopMcpTool(tool.name, caller, toolInput, signal)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response) }],
          structuredContent: response,
          isError: !response.ok,
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
    offlineOwner?.shutdown()
    await close()
  }
  return server
}

function createOwnerDispatch(resolveCaller: () => McpCallerIdentity) {
  const owner = resolveCaller()
  const publish = (event: ProductMcpRendererInvalidation) => {
    void publishProductMcpInvalidation(event)
  }
  const publishApprovalChange = () =>
    publish({ version: 1, source: "product-mcp", domains: ["approvals"] })
  const approvals = new McpApprovalLifecycle(
    createSqliteMcpApprovalCoordinator(getDatabase, publishApprovalChange),
    publishApprovalChange,
  )
  const services = {
    mutations: createMcpMutationService(),
    projectVaults: createMcpProjectVaultService(),
    automationControls: createMcpAutomationService(),
    taskProposalControls: createMcpTaskProposalService(),
  }
  return {
    shutdown: () => approvals.shutdown(),
    async invoke(name: string, input: unknown) {
      const release = beginDatabaseOperation()
      try {
        const invocationId = randomUUID()
        const response = await invokeMcpControlTool(name, owner, input, undefined, {
          ...services,
          approvals,
          approvalId: () => invocationId,
          invocationId: () => invocationId,
          audit: productMcpAudit(() =>
            publish({ version: 1, source: "product-mcp", domains: ["audit"] }),
          ),
          resolveCaller,
        })
        const event = invalidationForProductMcpMutation(name, input, response)
        if (event) publish(event)
        return response
      } finally {
        release()
      }
    },
  }
}

export async function connectMcpControlServer(
  caller: McpCallerIdentity,
  transport: Transport,
  resolveExternal?: () => McpCallerIdentity,
): Promise<{ close: () => Promise<void> }> {
  const server = await createMcpControlServer(caller, resolveExternal)
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
