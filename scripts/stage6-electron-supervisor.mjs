#!/usr/bin/env node
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { realpathSync } from "node:fs"
import { relative, resolve, sep } from "node:path"
import {
  findStage6SupervisorOwnedNativeProcesses,
  killNativeProcess,
  queryNativeProcesses,
} from "./lib/native-processes.mjs"

const [budgetId, action, warmupText, repeatText, rootText] = process.argv.slice(2)
const repositoryRoot = realpathSync(resolve(rootText || ""))
const nodeExecutable = realpathSync(resolve(process.env.FLAPSTACK_STAGE6_NODE_EXECUTABLE || ""))
const electronExecutable = realpathSync(
  resolve(process.env.FLAPSTACK_STAGE6_ELECTRON_EXECUTABLE || ""),
)
const startupScript = realpathSync(
  resolve(repositoryRoot, "scripts", "stage6-electron-startup.mjs"),
)
const electronRoot = realpathSync(resolve(repositoryRoot, "node_modules", "electron", "dist"))
const electronRelationship = relative(electronRoot, electronExecutable)
if (
  (process.platform !== "win32" && process.platform !== "darwin") ||
  nodeExecutable !== realpathSync(process.execPath) ||
  electronExecutable === nodeExecutable ||
  !electronRelationship ||
  electronRelationship.startsWith(`..${sep}`) ||
  resolve(electronRoot, electronRelationship) !== electronExecutable
) {
  throw new Error(
    "Stage 6 Electron supervisor requires exact Node and repository Electron runtimes.",
  )
}
const warmups = boundedCount(warmupText)
const repeats = boundedCount(repeatText)
const runToken = `s6-${process.pid}-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`
const launchedAtEpoch = Date.now()
const timeoutMs = 300_000 * (warmups + repeats + 2)
const child = spawn(
  nodeExecutable,
  [startupScript, budgetId, action, String(warmups), String(repeats), repositoryRoot, runToken],
  {
    cwd: repositoryRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FLAPSTACK_STAGE6_RUN_TOKEN: runToken },
  },
)
let stdout = ""
let stderr = ""
child.stdout.on("data", (chunk) => {
  stdout = `${stdout}${String(chunk)}`.slice(-5_000_000)
})
child.stderr.on("data", (chunk) => {
  stderr = `${stderr}${String(chunk)}`.slice(-5_000_000)
})
let timedOut = false
let timeoutCleanupError = null
const timer = setTimeout(() => {
  timedOut = true
  try {
    cleanupOwnedTree()
  } catch (error) {
    timeoutCleanupError = error
  }
}, timeoutMs)
const outcome = await new Promise((resolveOutcome, rejectOutcome) => {
  child.once("error", rejectOutcome)
  child.once("close", (status, signal) => resolveOutcome({ status, signal }))
})
clearTimeout(timer)
let closeCleanupError = null
try {
  cleanupOwnedTree()
} catch (error) {
  closeCleanupError = error
}
if (stdout) process.stdout.write(stdout)
if (stderr) process.stderr.write(stderr)
if (timedOut) {
  throw new Error(
    `Stage 6 Electron supervisor timed out after ${timeoutMs} ms${
      timeoutCleanupError || closeCleanupError
        ? `; cleanup failed: ${[timeoutCleanupError, closeCleanupError]
            .filter(Boolean)
            .map((error) => (error instanceof Error ? error.message : String(error)))
            .join("; ")}`
        : "."
    }`,
  )
}
if (closeCleanupError) {
  throw new Error(
    `Stage 6 Electron supervisor cleanup failed after child exit: ${closeCleanupError instanceof Error ? closeCleanupError.message : String(closeCleanupError)}`,
  )
}
if (outcome.status !== 0) {
  throw new Error(`Stage 6 Electron orchestrator exited ${outcome.status ?? outcome.signal ?? 1}.`)
}

function cleanupOwnedTree() {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const owned = findOwnedTree()
    if (owned.startup) {
      killNativeProcess(child.pid, { force: true, tree: true })
    }
    for (const entry of owned.electron) {
      killNativeProcess(Number(entry.ProcessId), { force: true, tree: true })
    }
    if (!owned.startup && owned.electron.length === 0) return
    sleepSync(100)
  }
  const finalOwned = findOwnedTree()
  if (!finalOwned.startup && finalOwned.electron.length === 0) return
  throw new Error("Stage 6 Electron supervisor could not clean its exact owned process tree.")
}

function findOwnedTree() {
  return findStage6SupervisorOwnedNativeProcesses(queryNativeProcesses(), {
    startupPid: child.pid,
    startupScript,
    runToken,
    electronRoot,
    launchedAtEpoch,
  })
}

function boundedCount(value) {
  const count = Number(value)
  if (!Number.isInteger(count) || count < 0 || count > 100) {
    throw new Error("Stage 6 Electron supervisor sample count is out of bounds.")
  }
  return count
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}
