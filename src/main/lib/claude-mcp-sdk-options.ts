export function strictClaudeMcpSdkOptions<T = never>(mcpServers?: Record<string, T>) {
  return {
    mcpServers: mcpServers ?? {},
    strictMcpConfig: true as const,
  }
}
