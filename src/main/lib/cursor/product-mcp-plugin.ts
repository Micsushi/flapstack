import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FLAPSTACK_MCP_SERVER_NAME, type McpStdioRegistration } from "../mcp-control/registration"

export type CursorProductMcpPlugin = {
  directory: string
  cleanup(): void
}

/** Build one isolated Cursor plugin so product MCP identity never touches user config. */
export function writeCursorProductMcpPlugin(
  registration: McpStdioRegistration,
): CursorProductMcpPlugin {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-cursor-mcp-"))
  const manifestDirectory = join(directory, ".cursor-plugin")
  mkdirSync(manifestDirectory, { recursive: true, mode: 0o700 })
  writeFileSync(
    join(manifestDirectory, "plugin.json"),
    JSON.stringify(
      {
        name: "flapstack-product-mcp",
        displayName: "Flapstack Product MCP",
        version: "1.0.0",
        description: "Run-scoped Flapstack app-control tools.",
        mcpServers: {
          [FLAPSTACK_MCP_SERVER_NAME]: {
            type: "stdio",
            command: registration.command,
            args: registration.args,
            env: registration.env,
          },
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
  return {
    directory,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  }
}
