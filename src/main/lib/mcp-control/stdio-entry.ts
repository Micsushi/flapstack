import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { readMcpCallerIdentity } from "./identity"
import { connectMcpControlServer } from "./server"

async function main(): Promise<void> {
  const connection = await connectMcpControlServer(
    readMcpCallerIdentity(),
    new StdioServerTransport(),
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
