import { spawnSync } from "node:child_process"
import { win32 as windowsPath } from "node:path"

const PROCESS_QUERY =
  "$utf8 = [System.Text.UTF8Encoding]::new($false); [Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine | ConvertTo-Json -Compress"

function normalized(value) {
  return String(value ?? "")
    .replaceAll("/", "\\")
    .toLowerCase()
}

function processText(process) {
  return `${process.ExecutablePath ?? ""}\n${process.CommandLine ?? ""}`
}

export function windowsProcessCreationEpoch(process) {
  const value = process?.CreationDate
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  const powershellEpoch = /\/Date\((\d+)(?:[+-]\d+)?\)\//.exec(String(value ?? ""))
  const parsed = powershellEpoch ? Number(powershellEpoch[1]) : Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : null
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
  const entriesByPid = new Map(processes.map((entry) => [Number(entry.ProcessId), entry]))

  for (const entry of processes) {
    const pid = Number(entry.ProcessId)
    const executable = normalized(entry.ExecutablePath)
    const command = normalized(entry.CommandLine)
    const ownedExecutable = [
      `${root}node_modules\\electron\\dist\\`,
      `${root}release\\`,
      `${root}release-preview\\`,
      `${root}resources\\bin\\`,
    ].some((prefix) => executable.startsWith(prefix))
    const ownedLauncher =
      windowsPath.basename(executable) === "node.exe" &&
      command.includes(`${root}node_modules\\electron-vite\\`)
    if (pid > 0 && pid !== selfPid && (ownedExecutable || ownedLauncher)) {
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
      const createdAt = windowsProcessCreationEpoch(entry)
      const parentCreatedAt = windowsProcessCreationEpoch(entriesByPid.get(parentPid))
      const verifiedAncestry =
        createdAt !== null && parentCreatedAt !== null && createdAt >= parentCreatedAt
      if (
        pid > 0 &&
        pid !== selfPid &&
        owned.has(parentPid) &&
        !owned.has(pid) &&
        (verifiedAncestry || text.includes(root))
      ) {
        owned.add(pid)
        changed = true
      }
    }
  }
  const depth = (pid, seen = new Set()) => {
    if (seen.has(pid)) return 0
    seen.add(pid)
    const parentPid = Number(entriesByPid.get(pid)?.ParentProcessId)
    return owned.has(parentPid) ? 1 + depth(parentPid, seen) : 0
  }
  return [...owned].sort((left, right) => depth(right) - depth(left) || left - right)
}

export async function drainWindowsOwnedProcessIds({
  findOwned,
  kill,
  wait,
  now = Date.now,
  timeoutMs = 10_000,
}) {
  const deadline = now() + timeoutMs
  const killStatuses = []
  let emptyObservations = 0
  let remaining = []

  while (true) {
    remaining = findOwned()
    if (remaining.length === 0) {
      emptyObservations += 1
      if (emptyObservations >= 2) {
        return { stable: true, remaining: [], killStatuses }
      }
    } else {
      emptyObservations = 0
      if (now() >= deadline) {
        return { stable: false, remaining, killStatuses }
      }
      killStatuses.push(await kill(remaining[0]))
    }
    if (now() >= deadline) {
      return { stable: false, remaining, killStatuses }
    }
    await wait()
  }
}

export function findIsolatedWindowsProcessIds(processes, options = {}) {
  const owned = new Set(
    (options.ancestorPids ?? []).map(Number).filter((pid) => Number.isInteger(pid) && pid > 0),
  )
  const fragments = (options.commandFragments ?? []).map(normalized).filter(Boolean)

  for (const entry of processes) {
    const pid = Number(entry.ProcessId)
    const text = normalized(processText(entry))
    if (pid > 0 && fragments.some((fragment) => text.includes(fragment))) owned.add(pid)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const entry of processes) {
      const pid = Number(entry.ProcessId)
      const parentPid = Number(entry.ParentProcessId)
      if (pid > 0 && owned.has(parentPid) && !owned.has(pid)) {
        owned.add(pid)
        changed = true
      }
    }
  }

  const present = new Set(processes.map((entry) => Number(entry.ProcessId)))
  return [...owned].filter((pid) => present.has(pid)).sort((left, right) => left - right)
}

export function findStage6IsolatedWindowsProcessIds(processes, options) {
  const root = normalized(windowsPath.resolve(options.root))
  const electronRoot = `${root}\\node_modules\\electron\\dist\\`
  const profile = normalized(options.profilePath)
  const instance = normalized(options.instance)
  const launchedAtEpoch = Number(options.launchedAtEpoch)
  const descriptorCreationDate = String(options.descriptorCreationDate ?? "")
  const launcherPid = Number(options.launcherPid)
  const descriptorPid = Number(options.descriptorPid)
  const launchFloor = launchedAtEpoch - 1_000
  const entriesByPid = new Map(processes.map((entry) => [Number(entry.ProcessId), entry]))
  const creationByPid = new Map(
    processes.map((entry) => [Number(entry.ProcessId), windowsProcessCreationEpoch(entry)]),
  )
  const candidates = new Set()

  for (const entry of processes) {
    const pid = Number(entry.ProcessId)
    const executable = normalized(entry.ExecutablePath)
    const createdAt = creationByPid.get(pid)
    if (
      pid > 0 &&
      executable.startsWith(electronRoot) &&
      Number.isFinite(createdAt) &&
      createdAt >= launchFloor
    ) {
      candidates.add(pid)
    }
  }

  const owned = new Set()
  for (const pid of candidates) {
    const entry = entriesByPid.get(pid)
    const text = normalized(processText(entry))
    if ((profile && text.includes(profile)) || (instance && text.includes(instance))) owned.add(pid)
  }
  if (
    descriptorCreationDate &&
    candidates.has(descriptorPid) &&
    String(entriesByPid.get(descriptorPid)?.CreationDate ?? "") === descriptorCreationDate
  ) {
    owned.add(descriptorPid)
  }
  if (
    options.launcherExited !== true &&
    candidates.has(launcherPid) &&
    creationByPid.get(launcherPid) <= launchedAtEpoch + 10_000
  ) {
    owned.add(launcherPid)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const pid of candidates) {
      if (owned.has(pid)) continue
      const parentPid = Number(entriesByPid.get(pid)?.ParentProcessId)
      if (owned.has(parentPid) && creationByPid.get(pid) >= creationByPid.get(parentPid)) {
        owned.add(pid)
        changed = true
      }
    }
    for (const pid of candidates) {
      if (!owned.has(pid)) continue
      const parentPid = Number(entriesByPid.get(pid)?.ParentProcessId)
      if (
        candidates.has(parentPid) &&
        !owned.has(parentPid) &&
        creationByPid.get(parentPid) <= creationByPid.get(pid)
      ) {
        owned.add(parentPid)
        changed = true
      }
    }
  }

  if (options.launcherExited === true) owned.delete(launcherPid)
  const depth = (pid, seen = new Set()) => {
    if (seen.has(pid)) return 0
    seen.add(pid)
    const parentPid = Number(entriesByPid.get(pid)?.ParentProcessId)
    return owned.has(parentPid) ? 1 + depth(parentPid, seen) : 0
  }
  return [...owned].sort((left, right) => depth(left) - depth(right) || left - right)
}

export function windowsTaskkillArgs(pid, force = false, tree = false) {
  return ["/PID", String(pid), ...(tree ? ["/T"] : []), ...(force ? ["/F"] : [])]
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
