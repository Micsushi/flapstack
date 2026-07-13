import { join } from "node:path"
import { PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV } from "../../../shared/product-mcp-invalidation"
import { getProductMcpInvalidationEndpoint } from "./invalidation-bridge"

export const FLAPSTACK_MCP_SERVER_NAME = "flapstack"

export type McpLaunchIdentity = {
  chatId: string
  runId?: string
  permissionMode: string
}

export type McpStdioRegistration = {
  command: string
  args: string[]
  env: Record<string, string>
}

export function buildMcpStdioRegistration(
  identity: McpLaunchIdentity,
  runtime: { executablePath: string; mainDirectory: string; databasePath: string },
): McpStdioRegistration {
  const invalidationEndpoint = getProductMcpInvalidationEndpoint()
  return {
    command: runtime.executablePath,
    args: [join(runtime.mainDirectory, "mcp-control-stdio.js")],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      FLAPSTACK_MCP_CHAT_ID: identity.chatId,
      ...(identity.runId ? { FLAPSTACK_MCP_RUN_ID: identity.runId } : {}),
      FLAPSTACK_MCP_PERMISSION_MODE: identity.permissionMode,
      FLAPSTACK_DB_PATH: runtime.databasePath,
      ...(invalidationEndpoint
        ? { [PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV]: invalidationEndpoint }
        : {}),
    },
  }
}
