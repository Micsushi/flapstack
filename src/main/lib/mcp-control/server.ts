import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { randomUUID } from "node:crypto"
import type { McpCallerIdentity } from "./types"
import { invokeMcpControlTool, listImplementedMcpControlTools } from "./registry"
import { mcpReadInputShapes } from "./read-service"
import { createMcpMutationService, mcpMutationInputShapes } from "./mutation-service"
import { createMcpProjectVaultService, mcpProjectVaultInputShapes } from "./project-vault-service"
import { McpApprovalLifecycle } from "./approval-lifecycle"
import {
  appendMcpAuditRecord,
  findUnresolvedMcpDispatch,
  recoverMcpDispatchClaims,
} from "./audit-storage"
import { getDatabase } from "../db"
import { createSqliteMcpCallerStore, resolveTrustedMcpCaller } from "./identity"
import { createSqliteMcpApprovalCoordinator } from "./approval-coordinator"
import { publishProductMcpInvalidation } from "./invalidation-bridge"
import {
  invalidationForProductMcpMutation,
  type ProductMcpRendererInvalidation,
} from "../../../shared/product-mcp-invalidation"

export function createMcpControlServer(caller: McpCallerIdentity): McpServer {
  recoverMcpDispatchClaims(getDatabase())
  const server = new McpServer({ name: "flapstack-app-control", version: "0.1.0" })
  const publish = (event: ProductMcpRendererInvalidation): void => {
    void publishProductMcpInvalidation(event)
  }
  const publishApprovalChange = () =>
    publish({ version: 1, source: "product-mcp", domains: ["approvals"] })
  const approvals = new McpApprovalLifecycle(
    createSqliteMcpApprovalCoordinator(getDatabase(), publishApprovalChange),
    publishApprovalChange,
  )
  const callerStore = createSqliteMcpCallerStore()
  const mutations = createMcpMutationService()
  const projectVaults = createMcpProjectVaultService()

  for (const tool of listImplementedMcpControlTools()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema:
          mcpReadInputShapes[tool.name] ??
          mcpMutationInputShapes[tool.name] ??
          mcpProjectVaultInputShapes[tool.name],
        annotations: { readOnlyHint: tool.tier === 0, destructiveHint: tool.tier >= 2 },
      },
      async (input, extra) => {
        // MCP SDK callbacks with no input schema receive only the request context.
        const toolInput = extra ? input : {}
        // Provider request IDs are caller-controlled and can be replayed. Every
        // received invocation owns a fresh internal identity instead.
        const invocationId = randomUUID()
        const response = await invokeMcpControlTool(tool.name, caller, toolInput, undefined, {
          approvals,
          approvalId: () => invocationId,
          invocationId: () => invocationId,
          audit: {
            append: (record) => {
              appendMcpAuditRecord(getDatabase(), record)
              publish({ version: 1, source: "product-mcp", domains: ["audit"] })
            },
            findUnresolvedDispatch: (lookup) => {
              recoverMcpDispatchClaims(getDatabase(), { staleAfterMs: 0, limit: 25 })
              return findUnresolvedMcpDispatch(getDatabase(), lookup)
            },
          },
          mutations,
          projectVaults,
          resolveCaller: (launchIdentity) => resolveTrustedMcpCaller(launchIdentity, callerStore),
        })
        const invalidation = invalidationForProductMcpMutation(tool.name, toolInput, response)
        if (invalidation) publish(invalidation)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response) }],
          structuredContent: response,
          isError: !response.ok,
        }
      },
    )
  }

  const close = server.close.bind(server)
  server.close = async () => {
    approvals.shutdown()
    await close()
  }
  return server
}

export async function connectMcpControlServer(
  caller: McpCallerIdentity,
  transport: Transport,
): Promise<{ close: () => Promise<void> }> {
  const server = createMcpControlServer(caller)
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
