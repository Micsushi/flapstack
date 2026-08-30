import { spawnSync } from "node:child_process"
import {
  queryWindowsProcesses,
  windowsProcessCreationEpoch,
  windowsTaskkillArgs,
} from "./windows-processes.mjs"

function normalized(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .toLowerCase()
}

function processText(entry) {
  return `${entry?.ExecutablePath ?? ""}\n${entry?.CommandLine ?? ""}`
}

export function parseDarwinProcessList(output) {
  const processes = []
  for (const line of String(output ?? "").split("\n")) {
    const match =
      /^\s*(\d+)\s+(\d+)\s+([A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(
        line,
      )
    if (!match) continue
    processes.push({
      ProcessId: Number(match[1]),
      ParentProcessId: Number(match[2]),
      CreationDate: match[3],
      ExecutablePath: "",
      CommandLine: match[4],
    })
  }
  return processes
}

export function queryDarwinProcesses(options = {}) {
  const runner = options.spawn ?? spawnSync
  const result = runner("ps", ["-axo", "pid=,ppid=,lstart=,command="], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  })
  if (result.error) {
    throw new Error(`Could not start macOS process inspection: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(
      `macOS process inspection failed with exit code ${result.status}: ${String(result.stderr ?? "").trim()}`,
    )
  }
  return parseDarwinProcessList(result.stdout)
}

export function queryNativeProcesses(options = {}) {
  const platform = options.platform ?? process.platform
  if (platform === "win32") return queryWindowsProcesses(options)
  if (platform === "darwin") return queryDarwinProcesses(options)
  throw new Error(`Native process inspection is unsupported on ${platform}.`)
}

export function nativeProcessCreationEpoch(entry) {
  return windowsProcessCreationEpoch(entry)
}

export function processDescendsFromNative(processes, processId, ancestorId) {
  const byPid = new Map(processes.map((entry) => [Number(entry.ProcessId), entry]))
  let current = Number(processId)
  const seen = new Set()
  while (current > 0 && !seen.has(current)) {
    if (current === Number(ancestorId)) return true
    seen.add(current)
    current = Number(byPid.get(current)?.ParentProcessId)
  }
  return false
}

export function classifyNativeFlapstackProcesses(processes, options) {
  const root = normalized(options.root)
  const electronRoot = `${root}/node_modules/electron/dist/`
  const profile = normalized(options.profilePath)
  let mainPid = null
  let rendererPid = null
  const packagedPids = []

  for (const entry of processes) {
    const pid = Number(entry.ProcessId)
    const text = normalized(processText(entry))
    const command = normalized(entry.CommandLine)
    if (text.includes(`${root}/release/`) || text.includes(`${root}/release-preview/`)) {
      packagedPids.push(pid)
      continue
    }
    if (!text.includes(electronRoot)) continue
    if (!command.includes("--type=")) mainPid ??= pid
    if (
      command.includes(profile) &&
      command.includes("--type=renderer") &&
      (command.includes(`--app-path=${root}`) || command.includes(`--app-path=\"${root}\"`))
    ) {
      rendererPid ??= pid
    }
  }
  return { mainPid, rendererPid, packagedPids: packagedPids.sort((a, b) => a - b) }
}

export function findStage6IsolatedNativeProcessIds(processes, options) {
  const root = normalized(options.root)
  const electronRoot = `${root}/node_modules/electron/dist/`
  const profile = normalized(options.profilePath)
  const instance = normalized(options.instance)
  const runToken = normalized(options.runToken)
  const launchedAtEpoch = Number(options.launchedAtEpoch)
  const descriptorCreationDate = String(options.descriptorCreationDate ?? "")
  const launcherPid = Number(options.launcherPid)
  const descriptorPid = Number(options.descriptorPid)
  const launchFloor = launchedAtEpoch - 1_000
  const entriesByPid = new Map(processes.map((entry) => [Number(entry.ProcessId), entry]))
  const creationByPid = new Map(
    processes.map((entry) => [Number(entry.ProcessId), nativeProcessCreationEpoch(entry)]),
  )
  const candidates = new Set()

  for (const entry of processes) {
    const pid = Number(entry.ProcessId)
    const text = normalized(processText(entry))
    const createdAt = creationByPid.get(pid)
    if (
      pid > 0 &&
      text.includes(electronRoot) &&
      Number.isFinite(createdAt) &&
      createdAt >= launchFloor
    ) {
      candidates.add(pid)
    }
  }

  const owned = new Set()
  for (const pid of candidates) {
    const text = normalized(processText(entriesByPid.get(pid)))
    if (
      (profile && text.includes(profile)) ||
      (instance && text.includes(instance)) ||
      (runToken && text.includes(runToken))
    ) {
      owned.add(pid)
    }
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

  expandOwnedTree(candidates, owned, entriesByPid, creationByPid)
  if (options.launcherExited === true) owned.delete(launcherPid)
  return sortRootFirst(owned, entriesByPid)
}

export function findStage6SupervisorOwnedNativeProcesses(processes, options) {
  const launchedAtEpoch = Number(options.launchedAtEpoch)
  const launchFloor = launchedAtEpoch - 1_000
  const startupScript = normalized(options.startupScript)
  const runToken = normalized(options.runToken)
  const electronRoot = `${normalized(options.electronRoot).replace(/\/$/, "")}/`
  const startupCandidate = processes.find(
    (entry) => Number(entry.ProcessId) === Number(options.startupPid),
  )
  const startupCreatedAt = nativeProcessCreationEpoch(startupCandidate)
  const startupCommand = normalized(startupCandidate?.CommandLine)
  const startup =
    startupCandidate &&
    Number.isFinite(startupCreatedAt) &&
    startupCreatedAt >= launchFloor &&
    startupCreatedAt <= launchedAtEpoch + 10_000 &&
    startupCommand.includes(startupScript) &&
    startupCommand.includes(runToken)
      ? startupCandidate
      : null

  const entriesByPid = new Map(processes.map((entry) => [Number(entry.ProcessId), entry]))
  const creationByPid = new Map(
    processes.map((entry) => [Number(entry.ProcessId), nativeProcessCreationEpoch(entry)]),
  )
  const candidates = new Set()
  const owned = new Set()
  for (const entry of processes) {
    const pid = Number(entry.ProcessId)
    const text = normalized(processText(entry))
    const createdAt = creationByPid.get(pid)
    if (
      pid > 0 &&
      text.includes(electronRoot) &&
      Number.isFinite(createdAt) &&
      createdAt >= launchFloor
    ) {
      candidates.add(pid)
      if (text.includes(runToken) || Number(entry.ParentProcessId) === Number(options.startupPid)) {
        owned.add(pid)
      }
    }
  }
  expandOwnedTree(candidates, owned, entriesByPid, creationByPid)
  return {
    startup,
    electron: sortRootFirst(owned, entriesByPid).map((pid) => entriesByPid.get(pid)),
  }
}

function expandOwnedTree(candidates, owned, entriesByPid, creationByPid) {
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
}

function sortRootFirst(owned, entriesByPid) {
  const depth = (pid, seen = new Set()) => {
    if (seen.has(pid)) return 0
    seen.add(pid)
    const parentPid = Number(entriesByPid.get(pid)?.ParentProcessId)
    return owned.has(parentPid) ? 1 + depth(parentPid, seen) : 0
  }
  return [...owned].sort((left, right) => depth(left) - depth(right) || left - right)
}

export function killNativeProcess(pid, options = {}) {
  const platform = options.platform ?? process.platform
  const force = options.force === true
  if (platform === "win32") {
    const runner = options.spawn ?? spawnSync
    const result = runner("taskkill.exe", windowsTaskkillArgs(pid, force, options.tree === true), {
      windowsHide: true,
      encoding: "utf8",
    })
    return `${pid}:${String(result.status)}:${String(result.stderr ?? "").trim()}`.slice(0, 500)
  }
  if (platform !== "darwin") {
    throw new Error(`Native process termination is unsupported on ${platform}.`)
  }
  try {
    const killer = options.kill ?? process.kill
    killer(Number(pid), force ? "SIGKILL" : "SIGTERM")
    return `${pid}:0:`
  } catch (error) {
    if (error?.code === "ESRCH") return `${pid}:0:not-found`
    throw error
  }
}

export async function drainOwnedProcessIds({
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
