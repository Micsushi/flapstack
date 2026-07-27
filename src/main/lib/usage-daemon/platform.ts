// Stage 2 Track B - U3: platform install helpers for the background daemon.
//
// Per-user lifecycle adapters: launchd on macOS, Scheduled Tasks on Windows,
// and systemd user services on Linux. All run the same standalone daemon bundle.

import { homedir, platform } from "node:os"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { execFileSync } from "node:child_process"
import { sleep } from "../../../shared/sleep"
import { clearUsageDaemonStopRequest, requestUsageDaemonStop } from "./stop-request"

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

function commandExitStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("status" in error)) return null
  const status = (error as { status?: unknown }).status
  return typeof status === "number" ? status : null
}

function isLaunchctlServiceNotFound(error: unknown): boolean {
  return commandExitStatus(error) === 113
}

function isSystemdUnitInactive(error: unknown): boolean {
  const status = commandExitStatus(error)
  return status === 3 || status === 4
}

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
  return join(configDir, "usage-daemon.ps1")
}

export function buildWindowsDaemonScript(params: DaemonInstallParams): string {
  const literal = (value: string | number) =>
    `'${String(value).replace(/\r?\n/g, "").replace(/'/g, "''")}'`
  return [
    "$ErrorActionPreference = 'Stop'",
    `$env:FLAPSTACK_DB_PATH = ${literal(params.dbPath)}`,
    `$env:FLAPSTACK_CONFIG_DIR = ${literal(params.configDir)}`,
    `$env:FLAPSTACK_USAGE_CADENCE_SECONDS = ${literal(params.cadenceSeconds)}`,
    "$env:ELECTRON_RUN_AS_NODE = '1'",
    ...(params.secretNamespace
      ? [`$env:FLAPSTACK_USAGE_SECRET_NAMESPACE = ${literal(params.secretNamespace)}`]
      : []),
    `& ${literal(params.nodePath)} ${literal(params.daemonEntryPath)}`,
    "exit $LASTEXITCODE",
    "",
  ].join("\r\n")
}

function windowsPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT
  if (!systemRoot) throw new Error("Windows usage daemon install requires SystemRoot")
  const shell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
  if (!existsSync(shell)) throw new Error(`Windows PowerShell was not found at ${shell}`)
  return shell
}

function powerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function registerWindowsTaskScript(taskName: string, scriptPath: string): string {
  const shell = windowsPowerShellPath()
  const actionArguments = `-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`
  return [
    "$ErrorActionPreference = 'Stop'",
    `$action = New-ScheduledTaskAction -Execute ${powerShellLiteral(shell)} -Argument ${powerShellLiteral(actionArguments)}`,
    "$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)",
    "$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Days 3)",
    `Register-ScheduledTask -TaskName ${powerShellLiteral(taskName)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
    `Start-ScheduledTask -TaskName ${powerShellLiteral(taskName)}`,
  ].join("; ")
}

const WINDOWS_TASK_STATE_RUNNING = 4
const WINDOWS_TASK_NOT_FOUND = "not-found" as const
type WindowsTaskState = number | typeof WINDOWS_TASK_NOT_FOUND

function queryWindowsTaskState(taskName: string, run: DaemonCommandRunner): WindowsTaskState {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$service = New-Object -ComObject 'Schedule.Service'",
    "$service.Connect()",
    "$folder = $service.GetFolder('\\')",
    "try {",
    `  $task = $folder.GetTask(${powerShellLiteral(taskName)})`,
    "} catch {",
    "  if ($_.Exception.HResult -eq -2147024894) {",
    `    [Console]::Out.Write('${WINDOWS_TASK_NOT_FOUND}')`,
    "    exit 0",
    "  }",
    "  throw",
    "}",
    "[Console]::Out.Write([int]$task.State)",
  ].join("; ")
  const encoded = Buffer.from(script, "utf16le").toString("base64")
  const output = run(windowsPowerShellPath(), [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    encoded,
  ]).trim()
  if (output === WINDOWS_TASK_NOT_FOUND) return WINDOWS_TASK_NOT_FOUND
  if (!/^\d+$/.test(output)) throw new Error("Task Scheduler returned an invalid task state")
  return Number.parseInt(output, 10)
}

export function installWindowsScheduledTask(params: DaemonInstallParams): void {
  if (currentDaemonPlatform() !== "win32")
    throw new Error("Windows usage daemon install requires Windows")
  mkdirSync(params.configDir, { recursive: true })
  const scriptPath = windowsDaemonScriptPath(params.configDir)
  const taskName = windowsTaskName(params.serviceId ?? daemonServiceIdForConfig(params.configDir))
  // Windows PowerShell 5.1 treats BOM-less scripts as the active ANSI code page.
  // The UTF-8 BOM preserves Unicode profile and database paths without requiring
  // a machine-global code-page change.
  writeFileSync(scriptPath, `\uFEFF${buildWindowsDaemonScript(params)}`, {
    mode: 0o600,
  })
  const registration = registerWindowsTaskScript(taskName, scriptPath)
  const encoded = Buffer.from(registration, "utf16le").toString("base64")
  execFileSync(
    windowsPowerShellPath(),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { stdio: "ignore", windowsHide: true },
  )
  rmSync(join(params.configDir, "usage-daemon.cmd"), { force: true })
}

export function uninstallWindowsScheduledTask(
  configDir: string,
  run: DaemonCommandRunner = runDaemonCommand,
): void {
  if (currentDaemonPlatform() !== "win32")
    throw new Error("Windows usage daemon uninstall requires Windows")
  const taskName = windowsTaskName(daemonServiceIdForConfig(configDir))
  let state = queryWindowsTaskState(taskName, run)
  if (state === WINDOWS_TASK_STATE_RUNNING) {
    let endError: unknown
    try {
      run("schtasks.exe", ["/End", "/TN", taskName])
    } catch (error) {
      endError = error
    }
    state = queryWindowsTaskState(taskName, run)
    if (state === WINDOWS_TASK_STATE_RUNNING) {
      if (endError) throw endError
      throw new Error(`Scheduled Task did not stop: ${taskName}`)
    }
  }
  if (state !== WINDOWS_TASK_NOT_FOUND) {
    let deleteError: unknown
    try {
      run("schtasks.exe", ["/Delete", "/TN", taskName, "/F"])
    } catch (error) {
      deleteError = error
    }
    state = queryWindowsTaskState(taskName, run)
    if (state !== WINDOWS_TASK_NOT_FOUND) {
      if (deleteError) throw deleteError
      throw new Error(`Scheduled Task was not deleted: ${taskName}`)
    }
  }
  rmSync(windowsDaemonScriptPath(configDir), { force: true })
  rmSync(join(configDir, "usage-daemon.cmd"), { force: true })
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

export function uninstallLinuxSystemdUserServiceWithRunner(
  configDir: string,
  run: DaemonCommandRunner,
  remove: (path: string) => void = (path) => rmSync(path, { force: true }),
): void {
  const serviceId = daemonServiceIdForConfig(configDir)
  const unitName = systemdUnitName(serviceId)
  try {
    run("systemctl", ["--user", "disable", "--now", unitName])
  } catch (error) {
    // An inactive unit can still be enabled for the next login. Preserve the
    // unit file unless disable itself succeeded, so repair remains possible.
    throw error
  }
  try {
    run("systemctl", ["--user", "is-active", "--quiet", unitName])
  } catch (error) {
    if (!isSystemdUnitInactive(error)) throw error
    remove(systemdUserUnitPath(serviceId))
    run("systemctl", ["--user", "daemon-reload"])
    return
  }
  throw new Error(`systemd user service is still active: ${unitName}`)
}

export function uninstallLinuxSystemdUserService(
  configDir: string,
  run: DaemonCommandRunner = runDaemonCommand,
): void {
  if (currentDaemonPlatform() !== "linux")
    throw new Error("Linux usage daemon uninstall requires Linux")
  uninstallLinuxSystemdUserServiceWithRunner(configDir, run)
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
    case "win32": {
      const taskName = windowsTaskName(serviceId)
      run("schtasks.exe", ["/Change", "/TN", taskName, "/ENABLE"])
      try {
        run("schtasks.exe", ["/Run", "/TN", taskName])
      } catch (startError) {
        try {
          run("schtasks.exe", ["/Change", "/TN", taskName, "/DISABLE"])
        } catch (rollbackError) {
          throw new AggregateError(
            [startError, rollbackError],
            `Failed to start and re-disable Windows scheduled task "${taskName}"`,
          )
        }
        throw startError
      }
      return
    }
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
      return stopLaunchAgent(target, launchctlDomain(), launchAgentPlistPath(serviceId), run)
    }
    case "win32": {
      const taskName = windowsTaskName(serviceId)
      const initialState = queryWindowsTaskState(taskName, run)
      if (initialState === WINDOWS_TASK_NOT_FOUND) return false
      run("schtasks.exe", ["/Change", "/TN", taskName, "/DISABLE"])
      if (queryWindowsTaskState(taskName, run) !== WINDOWS_TASK_STATE_RUNNING) return true
      const stopped = () => queryWindowsTaskState(taskName, run) !== WINDOWS_TASK_STATE_RUNNING
      requestUsageDaemonStop(configDir)
      try {
        try {
          await waitUntilStopped(stopped)
        } catch {
          run("schtasks.exe", ["/End", "/TN", taskName])
          await waitUntilStopped(stopped)
        }
      } finally {
        // A forced fallback can terminate the daemon before it consumes the
        // sentinel. Never let that stale request stop the next launch.
        clearUsageDaemonStopRequest(configDir)
      }
      return true
    }
    case "linux": {
      return stopLinuxSystemdUserService(
        systemdUnitName(serviceId),
        run,
        systemdUserUnitPath(serviceId),
      )
    }
    default:
      return false
  }
}

export async function stopLaunchAgent(
  target: string,
  domain: string,
  path: string,
  run: DaemonCommandRunner,
): Promise<boolean> {
  let description: string
  try {
    description = run("launchctl", ["print", target])
  } catch (error) {
    if (isLaunchctlServiceNotFound(error)) return false
    throw error
  }
  if (!/(?:state\s*=\s*running|pid\s*=\s*\d+)/.test(description)) return false
  run("launchctl", ["bootout", domain, path])
  await waitUntilStopped(() => {
    try {
      run("launchctl", ["print", target])
      return false
    } catch (error) {
      if (isLaunchctlServiceNotFound(error)) return true
      throw error
    }
  })
  return true
}

export async function stopLinuxSystemdUserService(
  unitName: string,
  run: DaemonCommandRunner,
  unitPath?: string,
  pathExists: (path: string) => boolean = existsSync,
): Promise<boolean> {
  if (unitPath && !pathExists(unitPath)) return false
  try {
    run("systemctl", ["--user", "is-active", "--quiet", unitName])
  } catch (error) {
    if (isSystemdUnitInactive(error)) return false
    throw error
  }
  run("systemctl", ["--user", "stop", unitName])
  await waitUntilStopped(() => {
    try {
      run("systemctl", ["--user", "is-active", "--quiet", unitName])
      return false
    } catch (error) {
      if (isSystemdUnitInactive(error)) return true
      throw error
    }
  })
  return true
}

async function waitUntilStopped(probe: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (probe()) return
    await sleep(25)
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
    } catch (printError) {
      if (!isLaunchctlServiceNotFound(printError)) throw printError
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
  } catch (error) {
    if (!isLaunchctlServiceNotFound(error)) throw error
    params.remove(params.path)
    return
  }
  throw new Error("Unable to stop the usage daemon; launchctl still reports it as loaded")
}
