import { homedir } from "node:os"
import { join } from "node:path"

export function electronAppDataRoot(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  if (platform === "win32") return env.APPDATA || join(home, "AppData", "Roaming")
  if (platform === "darwin") return join(home, "Library", "Application Support")
  return env.XDG_CONFIG_HOME || join(home, ".config")
}

export function flapstackProfilePath(profile, options = {}) {
  return join(electronAppDataRoot(options), profile)
}

export function resolveDevMcpProfile(env = process.env) {
  const explicit = env.FLAPSTACK_DEV_MCP_PROFILE?.trim()
  if (explicit) return explicit
  const instance = env.FLAPSTACK_DEV_INSTANCE?.trim()
  return instance ? `Flapstack Dev ${instance.replace(/[^a-zA-Z0-9_-]/g, "-")}` : "Flapstack Dev"
}

export function resolveDevMcpDescriptorPath(profile, options = {}) {
  const env = options.env ?? process.env
  return (
    env.FLAPSTACK_DEV_MCP_DESCRIPTOR ||
    join(flapstackProfilePath(profile, options), "dev-test-control-mcp.json")
  )
}
