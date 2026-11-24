import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { readMcpLaunch } from "./lib/mcp-control/identity"

async function main(): Promise<void> {
  // stdout is reserved for newline-delimited MCP messages.
  console.log = console.error
  const { caller, resolveExternal } = readMcpLaunch(process.argv.slice(2))
  const { connectMcpControlServer } = await import("./lib/mcp-control/server")
  const connection = await connectMcpControlServer(
    caller,
    new StdioServerTransport(),
    resolveExternal,
  )
  const shutdown = (): void => {
    void connection.close().finally(() => process.exit(0))
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Flapstack MCP failed to start.")
  process.exitCode = 1
})
