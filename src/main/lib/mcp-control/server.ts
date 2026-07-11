import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import type { McpCallerIdentity } from "./types"
import { invokeMcpControlTool, listImplementedMcpControlTools } from "./registry"
import { mcpReadInputShapes } from "./read-service"

export function createMcpControlServer(caller: McpCallerIdentity): McpServer {
  const server = new McpServer({ name: "flapstack-app-control", version: "0.1.0" })

  for (const tool of listImplementedMcpControlTools()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: mcpReadInputShapes[tool.name],
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      async (input) => {
        const response = await invokeMcpControlTool(tool.name, caller, input)
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response) }],
          structuredContent: response,
          isError: !response.ok,
        }
      },
    )
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
