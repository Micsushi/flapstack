/** External registrations belong to the owner's harness, never to an app-launched agent. */
export function isOwnerRegistration(name, config) {
  if (name.toLowerCase() === "flapstack-app-control") return true
  if (!config || typeof config !== "object") return false
  const env = config.env ?? {}
  const ownerTokenName = (key) => /^FLAPSTACK_MCP_OWNER_TOKEN(?:_FILE)?$/i.test(key)
  return (
    (Array.isArray(config.args) &&
      config.args.includes("--external") &&
      config.args.some(
        (arg) => typeof arg === "string" && /(?:^|[/\\])mcp-control-stdio\.js$/i.test(arg),
      )) ||
    Object.entries(env).some(
      ([key, value]) =>
        ownerTokenName(key) ||
        (key.toUpperCase() === "FLAPSTACK_MCP_CALLER_MODE" && value === "external"),
    ) ||
    (Array.isArray(config.env_vars) && config.env_vars.some(ownerTokenName))
  )
}

// Codex merges nested configuration tables. Omitting a server leaves it inherited.
export function disabledCodexMcpServers(native, overrides = {}, disableAll = false) {
  if (!Array.isArray(native?.layers))
    throw new Error("Codex did not expose its configuration layers.")
  const disabled = new Map()
  function inspect(servers) {
    for (const [name, server] of Object.entries(servers ?? {})) {
      if (disableAll || isOwnerRegistration(name, server)) disabled.set(name, { enabled: false })
    }
  }
  for (const layer of native.layers) {
    // The ACP adapter can grant workspace trust while constructing its session.
    // Inspect inactive layers for owner registrations even before trust changes.
    if (!disableAll || !layer?.disabledReason) inspect(layer?.config?.mcp_servers)
  }
  inspect(native.config?.mcp_servers)
  inspect(overrides)
  return Object.fromEntries(disabled)
}
