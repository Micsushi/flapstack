// Stage 2 Track B — U3: platform install helpers for the background daemon.
//
// Mac-first this pass (launchd LaunchAgent), with explicit extension points for
// Windows (Scheduled Task / service) and Linux (systemd user service). These
// helpers generate and install the macOS LaunchAgent. Windows and Linux return
// an honest unsupported status until their native user-service adapters land.

import { homedir, platform } from "node:os"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { execFileSync } from "node:child_process"

export type DaemonPlatform = "darwin" | "win32" | "linux" | "unsupported"

export function currentDaemonPlatform(): DaemonPlatform {
  const p = platform()
  if (p === "darwin" || p === "win32" || p === "linux") return p
  return "unsupported"
}

export const LAUNCH_AGENT_LABEL = "dev.flapstack.usage-daemon"

function launchctlDomain(): string {
  const uid = process.getuid?.()
  if (uid == null) throw new Error("Unable to determine the current user for launchctl")
  return `gui/${uid}`
}

/** Path of the macOS LaunchAgent plist for the current user. */
export function launchAgentPlistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`)
}

/** Build a macOS LaunchAgent plist that runs the daemon at login. */
export function buildLaunchAgentPlist(params: {
  nodePath: string
  daemonEntryPath: string
  dbPath: string
  configDir: string
  cadenceSeconds: number
}): string {
  const xml = (value: string | number) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&apos;")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(params.nodePath)}</string>
    <string>${xml(params.daemonEntryPath)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FLAPSTACK_DB_PATH</key><string>${xml(params.dbPath)}</string>
    <key>FLAPSTACK_CONFIG_DIR</key><string>${xml(params.configDir)}</string>
    <key>FLAPSTACK_USAGE_CADENCE_SECONDS</key><string>${xml(params.cadenceSeconds)}</string>
    <!-- process.execPath is Electron in packaged builds. This makes it execute
         the standalone daemon bundle as Node rather than opening the app UI. -->
    <key>ELECTRON_RUN_AS_NODE</key><string>1</string>
  </dict>
<key>RunAtLoad</key><true/>
<!-- The app controls installation/removal. Do not restart forever when a user
disables the daemon and it exits cleanly. -->
<key>KeepAlive</key><false/>
</dict>
</plist>
`
}

/** Describe the install support available on the current platform. */
export function describeInstall(): { platform: DaemonPlatform; supported: boolean; note: string } {
  const p = currentDaemonPlatform()
  switch (p) {
    case "darwin":
      return { platform: p, supported: true, note: `LaunchAgent at ${launchAgentPlistPath()}` }
    case "win32":
      return {
        platform: p,
        supported: false,
        note: "Windows Scheduled Task install is a reserved extension point (U3).",
      }
    case "linux":
      return {
        platform: p,
        supported: false,
        note: "systemd user service install is a reserved extension point (U3).",
      }
    default:
      return { platform: p, supported: false, note: "Unsupported platform for background daemon." }
  }
}

export function installMacLaunchAgent(params: Parameters<typeof buildLaunchAgentPlist>[0]): void {
  if (currentDaemonPlatform() !== "darwin")
    throw new Error("Usage daemon install is currently supported on macOS only")
  const path = launchAgentPlistPath()
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true })
  writeFileSync(path, buildLaunchAgentPlist(params), { mode: 0o600 })
  try {
    execFileSync("launchctl", ["bootout", launchctlDomain(), path], { stdio: "ignore" })
  } catch {}
  execFileSync("launchctl", ["bootstrap", launchctlDomain(), path])
}

export function uninstallMacLaunchAgent(): void {
  if (currentDaemonPlatform() !== "darwin")
    throw new Error("Usage daemon install is currently supported on macOS only")
  const path = launchAgentPlistPath()
  uninstallLaunchAgent({
    path,
    domain: launchctlDomain(),
    run: (args, options) => execFileSync("launchctl", args, options),
    remove: (target) => rmSync(target, { force: true }),
  })
}

export function uninstallLaunchAgent(params: {
  path: string
  domain: string
  run: (args: string[], options: { stdio: "ignore" }) => unknown
  remove: (path: string) => void
}): void {
  const serviceTarget = `${params.domain}/${LAUNCH_AGENT_LABEL}`
  try {
    params.run(["bootout", params.domain, params.path], { stdio: "ignore" })
  } catch (bootoutError) {
    try {
      params.run(["print", serviceTarget], { stdio: "ignore" })
    } catch {
      // launchctl confirms that no job remains loaded. A bootout error is
      // expected when the plist exists but was already stopped.
      params.remove(params.path)
      return
    }
    throw new Error(
      `Unable to stop the usage daemon; its LaunchAgent is still loaded: ${String(
        (bootoutError as Error)?.message ?? bootoutError,
      )}`,
    )
  }

  try {
    params.run(["print", serviceTarget], { stdio: "ignore" })
  } catch {
    params.remove(params.path)
    return
  }
  throw new Error("Unable to stop the usage daemon; launchctl still reports it as loaded")
}
