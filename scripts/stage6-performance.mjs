#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { build } from "esbuild"
import { ensureNativeAbi } from "./ensure-native-abi.mjs"
import { queryWindowsProcesses, windowsTaskkillArgs } from "./lib/windows-processes.mjs"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
if (resolve(process.cwd()) !== repositoryRoot) {
  throw new Error("Run the Stage 6 performance CLI from the canonical repository root.")
}

const runtimeDirectory = resolve(
  repositoryRoot,
  ".local-evidence",
  "stage6-performance",
  ".runtime",
)
const runtimeId = `${process.pid}-${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`
const runtimeEntry = resolve(runtimeDirectory, `cli-entry-${runtimeId}.cjs`)
const completionPath = resolve(runtimeDirectory, `completion-${runtimeId}.json`)
mkdirSync(runtimeDirectory, { recursive: true })
await build({
  entryPoints: [resolve(repositoryRoot, "src/main/lib/performance/cli-entry.ts")],
  outfile: runtimeEntry,
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  packages: "external",
  logLevel: "silent",
})

const args = process.argv.slice(2)
const boundedCi = args.includes("--ci")
let result
if (boundedCi) {
  result = spawnSync(process.execPath, [runtimeEntry, ...args], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  })
} else {
  const nodeExecutable = process.execPath
  const electronExecutable = createRequire(import.meta.url)("electron")
  const runToken = `s6-cli-${runtimeId}`
  const applicationBuild = spawnSync(
    nodeExecutable,
    [resolve(repositoryRoot, "scripts", "build.mjs")],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    },
  )
  if (applicationBuild.error) throw applicationBuild.error
  if (applicationBuild.status !== 0) {
    throw new Error(`Stage 6 prebuilt application build failed (${applicationBuild.status ?? 1}).`)
  }
  let completion = null
  const launchedAtEpoch = Date.now()
  try {
    ensureNativeAbi("electron")
    const launcherResult = spawnSync(electronExecutable, [runtimeEntry, ...args], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        FLAPSTACK_STAGE6_NODE_EXECUTABLE: nodeExecutable,
        FLAPSTACK_STAGE6_ELECTRON_EXECUTABLE: electronExecutable,
        FLAPSTACK_STAGE6_ELECTRON_HOSTED: "1",
        FLAPSTACK_STAGE6_COMPLETION_PATH: completionPath,
        FLAPSTACK_STAGE6_RUN_TOKEN: runToken,
      },
      stdio: "inherit",
      windowsHide: true,
    })
    if (launcherResult.error) throw launcherResult.error
    completion = waitForHostedCompletion({
      completionPath,
      electronExecutable,
      launchedAtEpoch,
      nodeExecutable,
      runToken,
      runtimeEntry,
    })
    waitForHostedProcessesGone({
      electronExecutable,
      launchedAtEpoch,
      nodeExecutable,
      runToken,
      runtimeEntry,
    })
    result = { status: completion.exitCode, error: null }
  } finally {
    cleanupHostedProcesses({
      electronExecutable,
      launchedAtEpoch,
      nodeExecutable,
      runToken,
      runtimeEntry,
    })
    ensureNativeAbi("node")
    rmSync(completionPath, { force: true })
  }
}
rmSync(runtimeEntry, { force: true })
if (result.error) throw result.error
process.exitCode = result.status ?? 1

function waitForHostedCompletion(options) {
  const deadline = Date.now() + 90 * 60 * 1_000
  let missingSince = null
  while (Date.now() < deadline) {
    if (existsSync(options.completionPath)) {
      const completion = JSON.parse(readFileSync(options.completionPath, "utf8"))
      if (
        completion?.schemaVersion !== 1 ||
        (completion.exitCode !== 0 && completion.exitCode !== 1) ||
        !Number.isInteger(completion.pid) ||
        completion.pid <= 0 ||
        completion.runToken !== options.runToken ||
        normalize(completion.runtimeEntry) !== normalize(options.runtimeEntry)
      ) {
        throw new Error("Stage 6 hosted CLI wrote invalid completion evidence.")
      }
      return completion
    }
    if (findHostedProcesses(options).length === 0) {
      missingSince ??= Date.now()
      if (Date.now() - missingSince >= 2_000) {
        throw new Error("Stage 6 hosted CLI exited without bound completion evidence.")
      }
    } else {
      missingSince = null
    }
    sleepSync(100)
  }
  throw new Error("Stage 6 hosted CLI completion timed out.")
}

function waitForHostedProcessesGone(options) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (findHostedProcesses(options).length === 0) return
    sleepSync(100)
  }
  throw new Error("Stage 6 hosted CLI left owned processes after completion.")
}

function cleanupHostedProcesses(options) {
  if (process.platform !== "win32") return
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const owned = findHostedProcesses(options)
    if (owned.length === 0) return
    for (const entry of owned) {
      spawnSync("taskkill.exe", windowsTaskkillArgs(Number(entry.ProcessId), true, true), {
        windowsHide: true,
        encoding: "utf8",
      })
    }
    sleepSync(100)
  }
  throw new Error("Stage 6 hosted CLI could not clean its exact owned process trees.")
}

function findHostedProcesses(options) {
  if (process.platform !== "win32") return []
  const executable = normalize(options.electronExecutable)
  const nodeExecutable = normalize(options.nodeExecutable)
  const runtimeEntry = normalize(options.runtimeEntry)
  const runToken = normalize(options.runToken)
  return queryWindowsProcesses().filter((entry) => {
    const createdAtMatch = /\/Date\((\d+)/.exec(String(entry.CreationDate ?? ""))
    const createdAt = createdAtMatch ? Number(createdAtMatch[1]) : Date.parse(entry.CreationDate)
    const command = normalize(entry.CommandLine)
    return (
      (normalize(entry.ExecutablePath) === executable ||
        normalize(entry.ExecutablePath) === nodeExecutable) &&
      Number.isFinite(createdAt) &&
      createdAt >= options.launchedAtEpoch - 1_000 &&
      (command.includes(runtimeEntry) || command.includes(runToken))
    )
  })
}

function normalize(value) {
  return String(value ?? "")
    .replaceAll("/", "\\")
    .toLowerCase()
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}
