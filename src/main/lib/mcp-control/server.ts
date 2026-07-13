import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { randomUUID } from "node:crypto"
import type { McpCallerIdentity } from "./types"
import { invokeMcpControlTool, listImplementedMcpControlTools } from "./registry"
import { mcpReadInputShapes } from "./read-service"
import { createMcpMutationService, mcpMutationInputShapes } from "./mutation-service"
import { McpApprovalLifecycle } from "./approval-lifecycle"
import { appendMcpAuditRecord } from "./audit-storage"
import { getDatabase } from "../db"
import { createSqliteMcpCallerStore, resolveTrustedMcpCaller } from "./identity"
import { createSqliteMcpApprovalCoordinator } from "./approval-coordinator"
import { buildProductMcpInvocationId } from "./provider-permissions"
import { publishProductMcpInvalidation } from "./invalidation-bridge"
import {
  invalidationForProductMcpMutation,
  type ProductMcpRendererInvalidation,
} from "../../../shared/product-mcp-invalidation"

export function createMcpControlServer(caller: McpCallerIdentity): McpServer {
  const server = new McpServer({ name: "flapstack-app-control", version: "0.1.0" })
  const publish = (event: ProductMcpRendererInvalidation): void => {
    void publishProductMcpInvalidation(event)
  }
  const approvals = new McpApprovalLifecycle(
    createSqliteMcpApprovalCoordinator(getDatabase(), () =>
      publish({ version: 1, source: "product-mcp", domains: ["approvals"] }),
    ),
  )
  const callerStore = createSqliteMcpCallerStore()
  const mutations = createMcpMutationService()

  for (const tool of listImplementedMcpControlTools()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: mcpReadInputShapes[tool.name] ?? mcpMutationInputShapes[tool.name],
        annotations: { readOnlyHint: tool.tier === 0, destructiveHint: tool.tier >= 2 },
      },
      async (input, extra) => {
        // MCP SDK callbacks with no input schema receive only the request context.
        const requestId = extra?.requestId ?? readRequestId(input) ?? randomUUID()
        const toolInput = extra ? input : {}
        const invocationId = buildProductMcpInvocationId(caller, requestId)
        const response = await invokeMcpControlTool(tool.name, caller, toolInput, undefined, {
          approvals,
          approvalId: () => invocationId,
          invocationId: () => invocationId,
          audit: {
            append: (record) => {
              appendMcpAuditRecord(getDatabase(), record)
              publish({ version: 1, source: "product-mcp", domains: ["audit"] })
            },
          },
          mutations,
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

function readRequestId(value: unknown): string | number | null {
  if (!value || typeof value !== "object") return null
  const requestId = (value as { requestId?: unknown }).requestId
  return typeof requestId === "string" || typeof requestId === "number" ? requestId : null
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
