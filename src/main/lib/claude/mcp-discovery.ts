import type { McpServerConfig } from "../claude-config"
import { fetchMcpTools, fetchMcpToolsStdio, type McpToolInfo } from "../mcp-auth"
import { hydrateMcpServerSecrets } from "../mcp-secrets"

/** Discover tools with the same deadline for both transports, cancelling pending requests. */
export async function fetchToolsForServer(serverConfig: McpServerConfig): Promise<McpToolInfo[]> {
  const resolvedConfig = hydrateMcpServerSecrets(serverConfig)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 40_000)
  try {
    if (resolvedConfig.url) {
      return await fetchMcpTools(
        resolvedConfig.url,
        resolvedConfig.headers as Record<string, string> | undefined,
        controller.signal,
      )
    }
    const command = resolvedConfig.command
    if (command) {
      return await fetchMcpToolsStdio(
        {
          command,
          args: resolvedConfig.args,
          env: resolvedConfig.env as Record<string, string> | undefined,
        },
        controller.signal,
      )
    }
    return []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
