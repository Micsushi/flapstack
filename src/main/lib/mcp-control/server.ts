import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { McpCallerIdentity } from "./types"
import { invokeMcpControlTool, listImplementedMcpControlTools } from "./registry"
import { mcpReadInputShapes } from "./read-service"
import { McpApprovalLifecycle } from "./approval-lifecycle"
import { createSqliteMcpCallerStore, resolveTrustedMcpCaller } from "./identity"

export function createMcpControlServer(caller: McpCallerIdentity): McpServer {
  const server = new McpServer({ name: "flapstack-app-control", version: "0.1.0" })
  const approvals = new McpApprovalLifecycle()
  const callerStore = createSqliteMcpCallerStore()

  for (const tool of listImplementedMcpControlTools()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: mcpReadInputShapes[tool.name],
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (input) => {
        const response = await invokeMcpControlTool(tool.name, caller, input, undefined, {
          approvals,
          resolveCaller: (launchIdentity) => resolveTrustedMcpCaller(launchIdentity, callerStore),
        })
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
