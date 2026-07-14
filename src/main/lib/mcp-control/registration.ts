import { join } from "node:path"
import { PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV } from "../../../shared/product-mcp-invalidation"
import { getProductMcpInvalidationEndpoint } from "./invalidation-bridge"

export const FLAPSTACK_MCP_SERVER_NAME = "flapstack"
export const FLAPSTACK_THIRD_PARTY_COLLISION_NAME = "flapstack-third-party"

export type McpLaunchIdentity = {
  chatId: string
  runId: string
  permissionMode: string
}

export type McpStdioRegistration = {
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * Keep a user-owned server that collides with the reserved product name, but
 * move it to an explicit non-product alias before installing our registration.
 * Permission classification still requires the launch-owned trusted name.
 */
export function renameProductMcpServerCollisions<T extends { name: string }>(
  servers: T[],
): string[] {
  const occupied = new Set(servers.map((server) => server.name.toLowerCase()))
  const renamed: string[] = []
  for (const server of servers) {
    if (server.name.toLowerCase() !== FLAPSTACK_MCP_SERVER_NAME) continue
    const alias = nextCollisionAlias(occupied)
    occupied.add(alias)
    server.name = alias
    renamed.push(alias)
  }
  return renamed
}

export function renameProductMcpRecordCollisions<T>(servers: Record<string, T>): string[] {
  const occupied = new Set(Object.keys(servers).map((name) => name.toLowerCase()))
  const renamed: string[] = []
  for (const collisionKey of Object.keys(servers)) {
    if (collisionKey.toLowerCase() !== FLAPSTACK_MCP_SERVER_NAME) continue
    const alias = nextCollisionAlias(occupied)
    occupied.add(alias)
    servers[alias] = servers[collisionKey]
    delete servers[collisionKey]
    renamed.push(alias)
  }
  return renamed
}

function nextCollisionAlias(occupied: Set<string>): string {
  let candidate = FLAPSTACK_THIRD_PARTY_COLLISION_NAME
  let suffix = 2
  while (occupied.has(candidate)) candidate = `${FLAPSTACK_THIRD_PARTY_COLLISION_NAME}-${suffix++}`
  return candidate
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
      FLAPSTACK_MCP_RUN_ID: identity.runId,
      FLAPSTACK_MCP_PERMISSION_MODE: identity.permissionMode,
      FLAPSTACK_DB_PATH: runtime.databasePath,
      ...(invalidationEndpoint
        ? { [PRODUCT_MCP_INVALIDATION_ENDPOINT_ENV]: invalidationEndpoint }
        : {}),
    },
  }
}
