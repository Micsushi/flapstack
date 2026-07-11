#!/usr/bin/env node
// Idempotently make the native modules (better-sqlite3, node-pty) match the ABI
// of the runtime that is about to load them.
//
//   node scripts/ensure-native-abi.mjs node       # before `vitest` / node tooling
//   node scripts/ensure-native-abi.mjs electron    # before `electron-vite dev`
//
// A marker file records what the shared node_modules is currently built for, so
// repeated invocations skip the rebuild when nothing changed. This removes the
// manual "rebuild for Node to test, electron-rebuild back for dev" dance.
//
// Recovery if the native modules ever get corrupted:
//   rm node_modules/.native-abi && npm run <dev|test>   (forces a clean rebuild)

import { execFileSync, execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { delimiter, dirname, join } from "node:path"
import { nativeAbiMarker } from "./native-abi-key.mjs"

const NATIVE_MODULES = ["better-sqlite3", "node-pty"]
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const markerPath = join(root, "node_modules", ".native-abi")

const target = process.argv[2]
if (target !== "node" && target !== "electron") {
  console.error("[native-abi] usage: ensure-native-abi.mjs <node|electron>")
  process.exit(1)
}

const packageVersion = (name) => {
  try {
    return JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"))
      .version
  } catch {
    return "missing"
  }
}
const desired = nativeAbiMarker({
  target,
  nodeAbi: process.versions.modules,
  electronVersion: packageVersion("electron"),
  nativeModuleVersions: Object.fromEntries(
    NATIVE_MODULES.map((name) => [name, packageVersion(name)]),
  ),
})
const nodeMajor = Number(process.versions.node.split(".")[0])
const toolEnv = {
  ...process.env,
  PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
}

const current = existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : ""
if (current === desired) {
  console.log(`[native-abi] already built for ${target} (${desired}) — skipping rebuild`)
  process.exit(0)
}

if (target === "node" && nodeMajor > 24) {
  console.error(
    `[native-abi] Node ${process.versions.node} is not supported for native test rebuilds in this repo.`,
  )
  console.error("[native-abi] Use Node 22 from CI, or Node 24 for local testing.")
  console.error("[native-abi] Refusing to rebuild so Electron-native modules are not corrupted.")
  process.exit(1)
}

console.log(
  `[native-abi] rebuilding ${NATIVE_MODULES.join(", ")} for ${target} (was: ${current || "unknown"})`,
)

try {
  if (target === "electron") {
    // electron-rebuild does a pure node-gyp compile against the installed
    // Electron ABI — no package lifecycle scripts, so node-pty's own broken tsc
    // build step is never invoked.
    execFileSync(
      join(root, "node_modules", ".bin", "electron-rebuild"),
      ["-f", "-w", NATIVE_MODULES.join(",")],
      {
        cwd: root,
        stdio: "inherit",
        env: toolEnv,
      },
    )
  } else {
    // Rebuild against the current Node, per module:
    // - better-sqlite3 has a custom build that emits into lib/binding/, so use
    //   its own `npm rebuild` script.
    // - node-pty's `npm rebuild` runs a `tsc` step that fails on its bundled
    //   test files, so compile the native addon directly with node-gyp instead.
    // CXXFLAGS keeps better-sqlite3's C++20 build happy on these toolchains.
    const env = { ...toolEnv, CXXFLAGS: "-std=c++20" }
    execSync("npm rebuild better-sqlite3", { cwd: root, stdio: "inherit", env })
    execFileSync(join(root, "node_modules", ".bin", "node-gyp"), ["rebuild"], {
      cwd: join(root, "node_modules", "node-pty"),
      stdio: "inherit",
      env,
    })
  }
} catch (error) {
  console.error(`[native-abi] rebuild for ${target} failed.`)
  console.error(
    `[native-abi] recovery: rm node_modules/.native-abi && npm run ${target === "electron" ? "dev" : "test"}`,
  )
  throw error
}

writeFileSync(markerPath, desired)
console.log(`[native-abi] native modules now built for ${target} (${desired})`)
