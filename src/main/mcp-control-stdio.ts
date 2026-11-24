import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { readMcpLaunch } from "./lib/mcp-control/identity"
import { openDesktopMcpEndpoint, relayDesktopMcpStdio } from "./lib/mcp-control/stdio-relay"
import { MCP_REQUEST_BYTES } from "./lib/mcp-control/http-auth"

async function main(): Promise<void> {
  // stdout is reserved for newline-delimited MCP messages.
  console.log = console.error
  const { caller, resolveExternal, exposure } = readMcpLaunch(process.argv.slice(2))
  const endpoint = await openDesktopMcpEndpoint()
  const stdio = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: MCP_REQUEST_BYTES,
  })
  let connection
  if (endpoint) {
    connection = await relayDesktopMcpStdio(endpoint, caller, exposure, stdio)
  } else {
    if (!resolveExternal) throw new Error("The selected Flapstack profile must be running.")
    const { connectOfflineMcpControlServer } = await import("./lib/mcp-control/server")
    connection = await connectOfflineMcpControlServer(stdio, resolveExternal, exposure)
  }

  let closing = false
  const shutdown = (): void => {
    if (closing) return
    closing = true
    void connection.close().finally(() => process.exit(0))
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
  process.stdin.once("end", shutdown)
  process.stdin.once("error", shutdown)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Flapstack MCP failed to start.")
  process.exitCode = 1
})
