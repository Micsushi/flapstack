/** External registrations belong to the owner's harness, never to an app-launched agent. */
export function isOwnerRegistration(name: string, config: unknown): boolean {
  if (name.toLowerCase() === "flapstack-app-control") return true
  if (!config || typeof config !== "object") return false
  const server = config as Record<string, unknown>
  const env =
    server.env && typeof server.env === "object"
      ? (server.env as Record<string, unknown>)
      : undefined
  return (
    (Array.isArray(server.args) &&
      server.args.includes("--external") &&
      server.args.some(
        (arg) => typeof arg === "string" && /(?:^|[/\\])mcp-control-stdio\.js$/i.test(arg),
      )) ||
    !!(
      env &&
      ("FLAPSTACK_MCP_OWNER_TOKEN" in env || env.FLAPSTACK_MCP_CALLER_MODE === "external")
    ) ||
    (Array.isArray(server.env_vars) && server.env_vars.includes("FLAPSTACK_MCP_OWNER_TOKEN"))
  )
}

export function childHarnessEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...environment }
  for (const key of Object.keys(env)) {
    if (/^FLAPSTACK_MCP_(OWNER_TOKEN|CALLER_MODE)$/i.test(key)) delete env[key]
  }
  return env
}
