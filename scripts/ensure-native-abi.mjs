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

import { execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const NATIVE_MODULES = ["better-sqlite3", "node-pty"]
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const markerPath = join(root, "node_modules", ".native-abi")

const target = process.argv[2]
if (target !== "node" && target !== "electron") {
  console.error("[native-abi] usage: ensure-native-abi.mjs <node|electron>")
  process.exit(1)
}

// For Node we key the marker on the ABI (process.versions.modules) so switching
// Node versions also triggers a rebuild. Electron always rebuilds for the
// installed Electron, so a plain tag is enough (postinstall reruns on upgrade).
const desired = target === "node" ? `node-${process.versions.modules}` : "electron"

const current = existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : ""
if (current === desired) {
  console.log(`[native-abi] already built for ${target} (${desired}) — skipping rebuild`)
  process.exit(0)
}

console.log(
  `[native-abi] rebuilding ${NATIVE_MODULES.join(", ")} for ${target} (was: ${current || "unknown"})`,
)

try {
  if (target === "electron") {
    // electron-rebuild does a pure node-gyp compile against the installed
    // Electron ABI — no package lifecycle scripts, so node-pty's own broken tsc
    // build step is never invoked.
    execSync(`npx electron-rebuild -f -w ${NATIVE_MODULES.join(",")}`, {
      cwd: root,
      stdio: "inherit",
    })
  } else {
    // Rebuild against the current Node, per module:
    // - better-sqlite3 has a custom build that emits into lib/binding/, so use
    //   its own `npm rebuild` script.
    // - node-pty's `npm rebuild` runs a `tsc` step that fails on its bundled
    //   test files, so compile the native addon directly with node-gyp instead.
    // CXXFLAGS keeps better-sqlite3's C++20 build happy on these toolchains.
    const env = { ...process.env, CXXFLAGS: "-std=c++20" }
    execSync("npm rebuild better-sqlite3", { cwd: root, stdio: "inherit", env })
    execSync("npx node-gyp rebuild", {
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
