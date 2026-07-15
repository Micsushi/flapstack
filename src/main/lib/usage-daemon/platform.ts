// Stage 2 Track B - U3: platform install helpers for the background daemon.
//
// Per-user lifecycle adapters: launchd on macOS, Scheduled Tasks on Windows,
// and systemd user services on Linux. All run the same standalone daemon bundle.

import { homedir, platform } from "node:os"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { execFileSync } from "node:child_process"

export type DaemonPlatform = "darwin" | "win32" | "linux" | "unsupported"

export function currentDaemonPlatform(): DaemonPlatform {
  const p = platform()
  if (p === "darwin" || p === "win32" || p === "linux") return p
  return "unsupported"
}

export const LAUNCH_AGENT_LABEL = "dev.flapstack.usage-daemon"
export const WINDOWS_TASK_NAME = "Flapstack Usage Daemon"
export const SYSTEMD_UNIT_NAME = "flapstack-usage-daemon.service"

export interface DaemonInstallParams {
  nodePath: string
  daemonEntryPath: string
  dbPath: string
  configDir: string
  cadenceSeconds: number
  serviceId?: string | null
  secretNamespace?: string | null
}

export type DaemonCommandRunner = (command: string, args: string[]) => string
const runDaemonCommand: DaemonCommandRunner = (command, args) =>
  execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })

function sanitizeServiceId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function daemonServiceIdForConfig(configDir: string): string | null {
  const profile = basename(dirname(configDir))
  if (!profile || profile === "Flapstack") return null
  return sanitizeServiceId(profile) || null
}

function serviceLabel(base: string, serviceId?: string | null): string {
  const normalized = serviceId ? sanitizeServiceId(serviceId) : ""
  return normalized ? `${base}.${normalized}` : base
}

function windowsTaskName(serviceId?: string | null): string {
  const normalized = serviceId ? sanitizeServiceId(serviceId) : ""
  return normalized ? `${WINDOWS_TASK_NAME} (${normalized})` : WINDOWS_TASK_NAME
}

function systemdUnitName(serviceId?: string | null): string {
  const normalized = serviceId ? sanitizeServiceId(serviceId) : ""
  return normalized ? `flapstack-usage-daemon-${normalized}.service` : SYSTEMD_UNIT_NAME
}

function launchctlDomain(): string {
  const uid = process.getuid?.()
  if (uid == null) throw new Error("Unable to determine the current user for launchctl")
  return `gui/${uid}`
}

/** Path of the macOS LaunchAgent plist for the current user. */
export function launchAgentPlistPath(serviceId?: string | null): string {
  return join(
    homedir(),
    "Library",
    "LaunchAgents",
    `${serviceLabel(LAUNCH_AGENT_LABEL, serviceId)}.plist`,
  )
}

/** Build a macOS LaunchAgent plist that runs the daemon at login. */
export function buildLaunchAgentPlist(params: DaemonInstallParams): string {
  const label = serviceLabel(LAUNCH_AGENT_LABEL, params.serviceId)
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
  <key>Label</key><string>${label}</string>
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
    ${params.secretNamespace ? `<key>FLAPSTACK_USAGE_SECRET_NAMESPACE</key><string>${xml(params.secretNamespace)}</string>` : ""}
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
export function describeInstall(configDir?: string): {
  platform: DaemonPlatform
  supported: boolean
  note: string
} {
  const p = currentDaemonPlatform()
  const serviceId = configDir ? daemonServiceIdForConfig(configDir) : null
  switch (p) {
    case "darwin":
      return {
        platform: p,
        supported: true,
        note: `LaunchAgent at ${launchAgentPlistPath(serviceId)}`,
      }
    case "win32":
      return {
        platform: p,
        supported: true,
        note: `Per-user Scheduled Task: ${windowsTaskName(serviceId)}`,
      }
    case "linux":
      return {
        platform: p,
        supported: true,
        note: `systemd user service: ${systemdUnitName(serviceId)}`,
      }
    default:
      return { platform: p, supported: false, note: "Unsupported platform for background daemon." }
  }
}

export function installMacLaunchAgent(params: DaemonInstallParams): void {
  if (currentDaemonPlatform() !== "darwin")
    throw new Error("Usage daemon install is currently supported on macOS only")
  const serviceId = params.serviceId ?? daemonServiceIdForConfig(params.configDir)
  const path = launchAgentPlistPath(serviceId)
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true })
  writeFileSync(path, buildLaunchAgentPlist({ ...params, serviceId }), { mode: 0o600 })
  try {
    execFileSync("launchctl", ["bootout", launchctlDomain(), path], { stdio: "ignore" })
  } catch {}
  execFileSync("launchctl", ["bootstrap", launchctlDomain(), path])
}

export function windowsDaemonScriptPath(configDir: string): string {
  return join(configDir, "usage-daemon.cmd")
}

export function buildWindowsDaemonScript(params: DaemonInstallParams): string {
  const set = (key: string, value: string | number) =>
    `set "${key}=${String(value).replace(/%/g, "%%").replace(/\r?\n/g, "")}"`
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
  return [
    "@echo off",
    set("FLAPSTACK_DB_PATH", params.dbPath),
    set("FLAPSTACK_CONFIG_DIR", params.configDir),
    set("FLAPSTACK_USAGE_CADENCE_SECONDS", params.cadenceSeconds),
    set("ELECTRON_RUN_AS_NODE", "1"),
    ...(params.secretNamespace
      ? [set("FLAPSTACK_USAGE_SECRET_NAMESPACE", params.secretNamespace)]
      : []),
    `${quote(params.nodePath)} ${quote(params.daemonEntryPath)}`,
    "",
  ].join("\r\n")
}

export function installWindowsScheduledTask(params: DaemonInstallParams): void {
  if (currentDaemonPlatform() !== "win32")
    throw new Error("Windows usage daemon install requires Windows")
  mkdirSync(params.configDir, { recursive: true })
  const scriptPath = windowsDaemonScriptPath(params.configDir)
  const taskName = windowsTaskName(params.serviceId ?? daemonServiceIdForConfig(params.configDir))
  writeFileSync(scriptPath, buildWindowsDaemonScript(params), { mode: 0o600 })
  execFileSync("schtasks.exe", [
    "/Create",
    "/TN",
    taskName,
    "/SC",
    "ONLOGON",
    "/RL",
    "LIMITED",
    "/TR",
    scriptPath,
    "/F",
  ])
  execFileSync("schtasks.exe", ["/Run", "/TN", taskName])
}

export function uninstallWindowsScheduledTask(configDir: string): void {
  if (currentDaemonPlatform() !== "win32")
    throw new Error("Windows usage daemon uninstall requires Windows")
  const taskName = windowsTaskName(daemonServiceIdForConfig(configDir))
  try {
    execFileSync("schtasks.exe", ["/End", "/TN", taskName], { stdio: "ignore" })
  } catch {}
  try {
    execFileSync("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], {
      stdio: "ignore",
    })
  } catch {}
  rmSync(windowsDaemonScriptPath(configDir), { force: true })
}

export function systemdUserUnitPath(serviceId?: string | null): string {
  return join(homedir(), ".config", "systemd", "user", systemdUnitName(serviceId))
}

export function buildSystemdUserUnit(params: DaemonInstallParams): string {
  const escape = (value: string | number) =>
    String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%")
  return `[Unit]
Description=Flapstack usage daemon
After=network-online.target

[Service]
Type=simple
Environment="FLAPSTACK_DB_PATH=${escape(params.dbPath)}"
Environment="FLAPSTACK_CONFIG_DIR=${escape(params.configDir)}"
Environment="FLAPSTACK_USAGE_CADENCE_SECONDS=${escape(params.cadenceSeconds)}"
Environment="ELECTRON_RUN_AS_NODE=1"
${params.secretNamespace ? `Environment="FLAPSTACK_USAGE_SECRET_NAMESPACE=${escape(params.secretNamespace)}"` : ""}
ExecStart="${escape(params.nodePath)}" "${escape(params.daemonEntryPath)}"
Restart=on-failure
RestartSec=30

[Install]
WantedBy=default.target
`
}

export function installLinuxSystemdUserService(params: DaemonInstallParams): void {
  if (currentDaemonPlatform() !== "linux")
    throw new Error("Linux usage daemon install requires Linux")
  const serviceId = params.serviceId ?? daemonServiceIdForConfig(params.configDir)
  const unitName = systemdUnitName(serviceId)
  const path = systemdUserUnitPath(serviceId)
  mkdirSync(join(homedir(), ".config", "systemd", "user"), { recursive: true })
  writeFileSync(path, buildSystemdUserUnit(params), { mode: 0o600 })
  execFileSync("systemctl", ["--user", "daemon-reload"])
  execFileSync("systemctl", ["--user", "enable", "--now", unitName])
}

export function uninstallLinuxSystemdUserService(configDir: string): void {
  if (currentDaemonPlatform() !== "linux")
    throw new Error("Linux usage daemon uninstall requires Linux")
  const serviceId = daemonServiceIdForConfig(configDir)
  const unitName = systemdUnitName(serviceId)
  try {
    execFileSync("systemctl", ["--user", "disable", "--now", unitName], {
      stdio: "ignore",
    })
  } catch {}
  rmSync(systemdUserUnitPath(serviceId), { force: true })
  execFileSync("systemctl", ["--user", "daemon-reload"])
}

export function installUsageDaemon(params: DaemonInstallParams): void {
  switch (currentDaemonPlatform()) {
    case "darwin":
      return installMacLaunchAgent(params)
    case "win32":
      return installWindowsScheduledTask(params)
    case "linux":
      return installLinuxSystemdUserService(params)
    default:
      throw new Error("Background usage daemon is unsupported on this platform")
  }
}

export function uninstallUsageDaemon(configDir: string): void {
  switch (currentDaemonPlatform()) {
    case "darwin":
      return uninstallMacLaunchAgent(daemonServiceIdForConfig(configDir))
    case "win32":
      return uninstallWindowsScheduledTask(configDir)
    case "linux":
      return uninstallLinuxSystemdUserService(configDir)
    default:
      throw new Error("Background usage daemon is unsupported on this platform")
  }
}

export function startInstalledUsageDaemon(
  configDir: string,
  run: DaemonCommandRunner = runDaemonCommand,
): void {
  const serviceId = daemonServiceIdForConfig(configDir)
  switch (currentDaemonPlatform()) {
    case "darwin":
      run("launchctl", ["bootstrap", launchctlDomain(), launchAgentPlistPath(serviceId)])
      return
    case "win32":
      run("schtasks.exe", ["/Run", "/TN", windowsTaskName(serviceId)])
      return
    case "linux":
      run("systemctl", ["--user", "start", systemdUnitName(serviceId)])
      return
    default:
      throw new Error("Background usage daemon is unsupported on this platform")
  }
}

export async function stopInstalledUsageDaemon(
  configDir: string,
  run: DaemonCommandRunner = runDaemonCommand,
): Promise<boolean> {
  const serviceId = daemonServiceIdForConfig(configDir)
  switch (currentDaemonPlatform()) {
    case "darwin": {
      const target = `${launchctlDomain()}/${serviceLabel(LAUNCH_AGENT_LABEL, serviceId)}`
      let description: string
      try {
        description = run("launchctl", ["print", target])
      } catch {
        return false
      }
      if (!/(?:state\s*=\s*running|pid\s*=\s*\d+)/.test(description)) return false
      run("launchctl", ["bootout", launchctlDomain(), launchAgentPlistPath(serviceId)])
      await waitUntilStopped(() => {
        try {
          run("launchctl", ["print", target])
          return false
        } catch {
          return true
        }
      })
      return true
    }
    case "win32": {
      const taskName = windowsTaskName(serviceId)
      let description: string
      try {
        description = run("schtasks.exe", ["/Query", "/TN", taskName, "/FO", "LIST", "/V"])
      } catch {
        return false
      }
      if (!/^Status:\s+Running\s*$/im.test(description)) return false
      run("schtasks.exe", ["/End", "/TN", taskName])
      await waitUntilStopped(() => {
        try {
          return !/^Status:\s+Running\s*$/im.test(
            run("schtasks.exe", ["/Query", "/TN", taskName, "/FO", "LIST", "/V"]),
          )
        } catch {
          return true
        }
      })
      return true
    }
    case "linux": {
      const unitName = systemdUnitName(serviceId)
      try {
        run("systemctl", ["--user", "is-active", "--quiet", unitName])
      } catch {
        return false
      }
      run("systemctl", ["--user", "stop", unitName])
      await waitUntilStopped(() => {
        try {
          run("systemctl", ["--user", "is-active", "--quiet", unitName])
          return false
        } catch {
          return true
        }
      })
      return true
    }
    default:
      return false
  }
}

async function waitUntilStopped(probe: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (probe()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("Timed out stopping the installed usage daemon service.")
}

export function uninstallMacLaunchAgent(serviceId?: string | null): void {
  if (currentDaemonPlatform() !== "darwin")
    throw new Error("Usage daemon install is currently supported on macOS only")
  const path = launchAgentPlistPath(serviceId)
  uninstallLaunchAgent({
    path,
    domain: launchctlDomain(),
    label: serviceLabel(LAUNCH_AGENT_LABEL, serviceId),
    run: (args, options) => execFileSync("launchctl", args, options),
    remove: (target) => rmSync(target, { force: true }),
  })
}

export function uninstallLaunchAgent(params: {
  path: string
  domain: string
  label?: string
  run: (args: string[], options: { stdio: "ignore" }) => unknown
  remove: (path: string) => void
}): void {
  const serviceTarget = `${params.domain}/${params.label ?? LAUNCH_AGENT_LABEL}`
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
