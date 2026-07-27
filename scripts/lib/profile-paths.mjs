import { homedir } from "node:os"
import { posix, win32 } from "node:path"

function pathForPlatform(platform) {
  return platform === "win32" ? win32 : posix
}

export function electronAppDataRoot(options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const paths = pathForPlatform(platform)
  if (platform === "win32") return env.APPDATA || paths.join(home, "AppData", "Roaming")
  if (platform === "darwin") return paths.join(home, "Library", "Application Support")
  return env.XDG_CONFIG_HOME || paths.join(home, ".config")
}

export function flapstackProfilePath(profile, options = {}) {
  return pathForPlatform(options.platform ?? process.platform).join(
    electronAppDataRoot(options),
    profile,
  )
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
    pathForPlatform(options.platform ?? process.platform).join(
      flapstackProfilePath(profile, options),
      "dev-test-control-mcp.json",
    )
  )
}
