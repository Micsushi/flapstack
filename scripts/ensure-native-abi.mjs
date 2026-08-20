#!/usr/bin/env node
// Keep shared native modules loadable by the runtime about to use them.
// The marker is only a cache hint: real better-sqlite3/node-pty loads are
// probed before a skip and after every rebuild.

import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { delimiter, dirname, join, resolve } from "node:path"
import { nativeAbiMarker } from "./native-abi-key.mjs"
import { packageBinStep, runCommandSequence } from "./lib/project-command.mjs"

const NATIVE_MODULES = ["better-sqlite3", "node-pty"]
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const nativeAbiMarkerPath = join(root, "node_modules", ".native-abi")
const require = createRequire(import.meta.url)
const probeSource = `
const Database = require("better-sqlite3")
const db = new Database(":memory:")
db.prepare("select 1").get()
db.close()
const pty = require("node-pty")
if (typeof pty.spawn !== "function") throw new Error("node-pty native API unavailable")
const runPtyProbe = (useConpty) => new Promise((resolve, reject) => {
  let terminal
  const timer = setTimeout(() => {
    try { terminal?.kill() } catch {}
    reject(new Error("node-pty native launch timed out"))
  }, 5_000)
  try {
    const windows = process.platform === "win32"
    terminal = pty.spawn(
      windows ? (process.env.ComSpec || "cmd.exe") : "/bin/sh",
      windows ? ["/d", "/s", "/c", "exit", "0"] : ["-c", "exit 0"],
      {
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: process.env,
        ...(windows ? { useConpty } : {}),
      },
    )
    terminal.onExit(() => {
      clearTimeout(timer)
      resolve()
    })
  } catch (error) {
    clearTimeout(timer)
    reject(error)
  }
})
;(async () => {
  if (process.platform === "win32") {
    await runPtyProbe(true)
    await runPtyProbe(false)
  } else {
    await runPtyProbe(undefined)
  }
  process.stdout.write(String(process.versions.modules || "unknown"))
  // node-pty keeps pipe/worker handles alive after the child exits on Windows.
  // The probe is complete at this point, so terminate the isolated runtime.
  process.exit(0)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
`

const packageVersion = (name) => {
  try {
    return JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"))
      .version
  } catch {
    return "missing"
  }
}

/**
 * Node 24.19.0 added per-instance environment cleanup hooks to the public
 * `node_object_wrap.h`. Every `node::ObjectWrap` destructor then calls
 * `node::RemoveEnvironmentCleanupHook(Isolate::GetCurrent(), ...)`, which
 * asserts `env != nullptr`. better-sqlite3 wraps Database/Statement with that
 * base class, so a binary compiled against those headers aborts (exit 134,
 * "src\\api\\hooks.cc:142 Assertion failed: (env) != nullptr") whenever a
 * wrapper is destroyed during isolate teardown, with no JS context entered.
 *
 * NODE_MODULE_VERSION is stable inside a major, so building against the last
 * unaffected release of the running major keeps the binary loadable while
 * removing the aborting call entirely. Returns null when no pin is needed.
 */
export function nodeHeaderTarget(nodeVersion = process.versions.node) {
  const [major, minor] = nodeVersion.split(".").map(Number)
  if (major !== 24) return null
  return minor >= 19 ? "24.18.0" : null
}

export function desiredNativeAbiMarker(target, options = {}) {
  const nodeVersion = options.nodeVersion ?? process.versions.node
  return nativeAbiMarker({
    target,
    nodeAbi: process.versions.modules,
    electronVersion: packageVersion("electron"),
    nodeHeaderTarget: nodeHeaderTarget(nodeVersion) ?? nodeVersion,
    nativeModuleVersions: Object.fromEntries(
      NATIVE_MODULES.map((name) => [name, packageVersion(name)]),
    ),
  })
}

export function betterSqlite3NodeBinaryPath(projectRoot = root) {
  return join(
    projectRoot,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node",
  )
}

/**
 * A regressed binary still loads and still passes the runtime probe; it only
 * aborts later, at isolate teardown. Detect it directly from the imported
 * symbol so a stale build can never be waved through as "verified".
 * Both Windows (`?RemoveEnvironmentCleanupHook@node@@...`) and Itanium
 * (`_ZN4node28RemoveEnvironmentCleanupHook...`) manglings contain this name.
 */
export function nativeTeardownSafe(binaryPath = betterSqlite3NodeBinaryPath()) {
  if (!existsSync(binaryPath)) return true
  return !readFileSync(binaryPath, "latin1").includes("RemoveEnvironmentCleanupHook")
}

export function nativeAbiAction({ current, desired, probeOk, teardownSafe = true }) {
  if (!probeOk || !teardownSafe) return "rebuild"
  return current === desired ? "verified" : "repair-marker"
}

export function probeNativeModules(target, options = {}) {
  const runtime =
    options.runtime ?? (target === "electron" ? require("electron") : process.execPath)
  const runner = options.spawn ?? spawnSync
  const platform = options.platform ?? process.platform
  const env = {
    ...process.env,
    ...(target === "electron" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...options.env,
  }
  const result = runner(runtime, ["-e", probeSource], {
    cwd: options.cwd ?? root,
    env,
    encoding: "utf8",
    timeout: options.timeout ?? (target === "electron" && platform === "win32" ? 45_000 : 15_000),
  })
  return {
    ok: !result.error && result.status === 0,
    abi: String(result.stdout ?? "").trim(),
    error: result.error?.message ?? String(result.stderr ?? "").trim(),
    status: result.status,
    signal: result.signal,
  }
}

function probeErrorSummary(probe) {
  const lines = String(probe.error || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  return (
    lines.find((line) => line.includes("NODE_MODULE_VERSION")) ??
    lines.find((line) => line.startsWith("Error:")) ??
    lines[0] ??
    `status ${probe.status}`
  )
}

export function nativeRebuildSteps(target, options = {}) {
  const projectRoot = resolve(options.root ?? root)
  if (target === "electron") {
    return [
      packageBinStep(
        "rebuild Electron native modules",
        "@electron/rebuild",
        "electron-rebuild",
        ["-f", "-w", NATIVE_MODULES.join(",")],
        { root: projectRoot },
      ),
    ]
  }
  if (target !== "node") throw new Error(`Unsupported native rebuild target: ${target}`)
  const headerTarget = nodeHeaderTarget(options.nodeVersion ?? process.versions.node)
  const headerArgs = headerTarget ? [`--target=${headerTarget}`] : []
  const nodeGyp = packageBinStep(
    "build better-sqlite3 for Node",
    "node-gyp",
    "node-gyp",
    ["rebuild", "--release", ...headerArgs],
    { root: projectRoot },
  )
  return [
    {
      ...nodeGyp,
      cwd: join(projectRoot, "node_modules", "better-sqlite3"),
    },
    {
      ...nodeGyp,
      label: "build node-pty for Node",
      args: [nodeGyp.args[0], "rebuild", ...headerArgs],
      cwd: join(projectRoot, "node_modules", "node-pty"),
    },
  ]
}

export function nativeElectronRecoverySteps(options = {}) {
  const projectRoot = resolve(options.root ?? root)
  const nodeGyp = packageBinStep(
    "finish interrupted node-pty Electron build",
    "node-gyp",
    "node-gyp",
    ["build", "--release"],
    { root: projectRoot },
  )
  return [
    {
      ...nodeGyp,
      cwd: join(projectRoot, "node_modules", "node-pty"),
    },
  ]
}

export function windowsPython311Environment(options = {}) {
  const platform = options.platform ?? process.platform
  if (platform !== "win32") return {}
  const runner = options.spawn ?? spawnSync
  const result = runner("py.exe", ["-3.11", "-c", "import sys; print(sys.executable)"], {
    encoding: "utf8",
    windowsHide: true,
  })
  const executable = String(result.stdout ?? "").trim()
  if (result.error || result.status !== 0 || !executable) {
    throw new Error("[native-abi] Python 3.11 is required and must be available through py -3.11")
  }
  return {
    NODE_GYP_FORCE_PYTHON: executable,
    PYTHON: executable,
    npm_config_python: executable,
  }
}

function rebuildNativeModules(target, toolEnv) {
  const env = {
    ...toolEnv,
    ...(target === "node" && process.platform !== "win32" ? { CXXFLAGS: "-std=c++20" } : {}),
  }
  try {
    runCommandSequence(nativeRebuildSteps(target), { cwd: root, env })
  } catch (error) {
    if (target !== "electron" || process.platform !== "win32") throw error
    console.warn(
      `[native-abi] Electron rebuild stopped partway through node-pty; attempting one incremental completion: ${error instanceof Error ? error.message : String(error)}`,
    )
    runCommandSequence(nativeElectronRecoverySteps(), { cwd: root, env })
  }
}

export function ensureNativeAbi(target) {
  if (target !== "node" && target !== "electron") {
    throw new Error("[native-abi] usage: ensure-native-abi.mjs <node|electron>")
  }
  const nodeMajor = Number(process.versions.node.split(".")[0])
  if (target === "node" && nodeMajor > 24) {
    throw new Error(
      `[native-abi] Node ${process.versions.node} is not supported. Use Node 22 from CI, or Node 24 for local testing.`,
    )
  }
  const desired = desiredNativeAbiMarker(target)
  const current = existsSync(nativeAbiMarkerPath)
    ? readFileSync(nativeAbiMarkerPath, "utf8").trim()
    : ""
  const initialProbe = probeNativeModules(target)
  // Only the Node target is rebuilt from source here, so only it can be repaired
  // when the teardown-unsafe ObjectWrap import is present.
  const teardownSafe = target !== "node" || nativeTeardownSafe()
  if (!teardownSafe) {
    console.log(
      "[native-abi] better-sqlite3 imports node::RemoveEnvironmentCleanupHook and would abort at teardown; rebuilding against pinned headers",
    )
  }
  const action = nativeAbiAction({ current, desired, probeOk: initialProbe.ok, teardownSafe })
  if (action === "verified") {
    console.log(
      `[native-abi] verified actual ${target} load ABI ${initialProbe.abi} (${desired}) - skipping rebuild`,
    )
    return { action, marker: desired, probe: initialProbe }
  }
  if (action === "repair-marker") {
    writeFileSync(nativeAbiMarkerPath, desired)
    console.log(
      `[native-abi] actual ${target} load ABI ${initialProbe.abi} passed; repaired marker (${desired})`,
    )
    return { action, marker: desired, probe: initialProbe }
  }

  const toolEnv = {
    ...process.env,
    ...windowsPython311Environment(),
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
  }
  rmSync(nativeAbiMarkerPath, { force: true })
  console.log(
    `[native-abi] rebuilding ${NATIVE_MODULES.join(", ")} for ${target}; ${
      teardownSafe
        ? `actual load failed (${probeErrorSummary(initialProbe)})`
        : "binary is teardown-unsafe"
    }`,
  )
  try {
    rebuildNativeModules(target, toolEnv)
  } catch (error) {
    rmSync(nativeAbiMarkerPath, { force: true })
    console.error(`[native-abi] rebuild for ${target} failed; marker remains invalidated.`)
    throw error
  }
  const finalProbe = probeNativeModules(target)
  if (!finalProbe.ok) {
    rmSync(nativeAbiMarkerPath, { force: true })
    throw new Error(
      `[native-abi] rebuilt ${target} modules still fail their real load probe: ${probeErrorSummary(finalProbe)}`,
    )
  }
  if (target === "node" && !nativeTeardownSafe()) {
    rmSync(nativeAbiMarkerPath, { force: true })
    throw new Error(
      "[native-abi] rebuilt better-sqlite3 still imports node::RemoveEnvironmentCleanupHook; it would abort at isolate teardown.",
    )
  }
  writeFileSync(nativeAbiMarkerPath, desired)
  console.log(
    `[native-abi] rebuilt and verified actual ${target} load ABI ${finalProbe.abi} (${desired})`,
  )
  return { action, marker: desired, probe: finalProbe }
}

function main() {
  const target = process.argv[2]
  try {
    ensureNativeAbi(target)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
