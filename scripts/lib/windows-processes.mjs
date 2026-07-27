import { spawnSync } from "node:child_process"
import { win32 as windowsPath } from "node:path"

const PROCESS_QUERY =
  "$utf8 = [System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"

function normalized(value) {
  return String(value ?? "")
    .replaceAll("/", "\\")
    .toLowerCase()
}

function processText(process) {
  return `${process.ExecutablePath ?? ""}\n${process.CommandLine ?? ""}`
}

export function parseWindowsProcessJson(output) {
  const value = String(output ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
  if (!value) return []
  const parsed = JSON.parse(value)
  return Array.isArray(parsed) ? parsed : [parsed]
}

export function queryWindowsProcesses(options = {}) {
  const runner = options.spawn ?? spawnSync
  const shell = options.shell ?? "powershell.exe"
  const result = runner(
    shell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", PROCESS_QUERY],
    { encoding: "utf8", windowsHide: true },
  )
  if (result.error)
    throw new Error(`Could not start Windows process inspection: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(
      `Windows process inspection failed with exit code ${result.status}: ${String(result.stderr ?? "").trim()}`,
    )
  }
  return parseWindowsProcessJson(result.stdout)
}

export function findOwnedWindowsProcessIds(processes, options) {
  const root = `${normalized(windowsPath.resolve(options.root))}\\`
  const selfPid = Number(options.selfPid ?? process.pid)
  const owned = new Set()
  const ownershipSegments = [
    "\\node_modules\\electron-vite\\",
    "\\node_modules\\electron\\dist\\",
    "\\release\\",
    "\\release-preview\\",
    "\\resources\\bin\\",
  ]

  for (const entry of processes) {
    const pid = Number(entry.ProcessId)
    const text = normalized(processText(entry))
    if (
      pid > 0 &&
      pid !== selfPid &&
      text.includes(root) &&
      ownershipSegments.some((segment) => text.includes(segment))
    ) {
      owned.add(pid)
    }
  }

  let changed = true
  while (changed) {
    changed = false
    for (const entry of processes) {
      const pid = Number(entry.ProcessId)
      const parentPid = Number(entry.ParentProcessId)
      const text = normalized(processText(entry))
      if (
        pid > 0 &&
        pid !== selfPid &&
        owned.has(parentPid) &&
        !owned.has(pid) &&
        text.includes(root)
      ) {
        owned.add(pid)
        changed = true
      }
    }
  }
  const entriesByPid = new Map(processes.map((entry) => [Number(entry.ProcessId), entry]))
  const depth = (pid, seen = new Set()) => {
    if (seen.has(pid)) return 0
    seen.add(pid)
    const parentPid = Number(entriesByPid.get(pid)?.ParentProcessId)
    return owned.has(parentPid) ? 1 + depth(parentPid, seen) : 0
  }
  return [...owned].sort((left, right) => depth(right) - depth(left) || left - right)
}

export function windowsTaskkillArgs(pid, force = false) {
  return ["/PID", String(pid), ...(force ? ["/F"] : [])]
}

export function classifyWindowsFlapstackProcesses(processes, options) {
  const root = normalized(windowsPath.resolve(options.root))
  const electronRoot = `${root}\\node_modules\\electron\\dist\\`
  const profile = normalized(options.profilePath)
  let mainPid = null
  let rendererPid = null
  const packagedPids = []

  for (const entry of processes) {
    const pid = Number(entry.ProcessId)
    const text = normalized(processText(entry))
    const command = normalized(entry.CommandLine)
    if (text.includes(`${root}\\release\\`) || text.includes(`${root}\\release-preview\\`)) {
      packagedPids.push(pid)
      continue
    }
    if (!text.includes(electronRoot)) continue
    if (!command.includes("--type=")) mainPid ??= pid
    if (
      command.includes(profile) &&
      command.includes("--type=renderer") &&
      (command.includes(`--app-path=${root}`) || command.includes(`--app-path="${root}"`))
    ) {
      rendererPid ??= pid
    }
  }
  return { mainPid, rendererPid, packagedPids: packagedPids.sort((a, b) => a - b) }
}
