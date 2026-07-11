#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assertBundledBinary } from "./lib/packaged-binary.mjs"
import { CLAUDE_VERSION, CODEX_VERSION } from "./prepare-package-resources.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function readArg(args, name) {
  const equals = args.find((argument) => argument.startsWith(`${name}=`))
  if (equals) return equals.slice(name.length + 1)
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function runSmoke(label, binary, args, expected) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    // First Rosetta translation on Apple Silicon can take 15-35 seconds.
    timeout: 60_000,
    env: {
      ...process.env,
      NO_COLOR: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    },
  })
  if (result.error) throw new Error(`${label} smoke failed: ${result.error.message}`)
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim()
  if (result.status !== 0) {
    const exit = result.signal ? `signal ${result.signal}` : `status ${result.status}`
    throw new Error(`${label} smoke exited with ${exit}: ${output}`)
  }
  if (expected && !expected.test(output)) {
    throw new Error(`${label} smoke returned unexpected output: ${output}`)
  }
  console.log(`${label} smoke: ${output.split("\n")[0]}`)
}

function readElectronVersion(appPath) {
  const plist = path.join(
    appPath,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Resources",
    "Info.plist",
  )
  for (const key of ["CFBundleShortVersionString", "CFBundleVersion"]) {
    const result = spawnSync("/usr/bin/plutil", ["-extract", key, "raw", plist], {
      encoding: "utf8",
    })
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()
  }
  throw new Error(`Unable to read packaged Electron version from ${plist}`)
}

export function inspectMacApp(appPath, platformKey, options = {}) {
  if (!/^darwin-(arm64|x64)$/.test(platformKey)) {
    throw new Error(`Unsupported macOS package platform: ${platformKey}`)
  }
  const contents = path.join(appPath, "Contents")
  const resources = path.join(contents, "Resources")
  const binaries = {
    Flapstack: path.join(contents, "MacOS", "Flapstack"),
    Electron: path.join(
      contents,
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Electron Framework",
    ),
    Claude: path.join(resources, "bin", "claude"),
    Codex: path.join(resources, "bin", "codex"),
    Whisper: path.join(resources, "bin", "whisper-cli"),
    "better-sqlite3": path.join(
      resources,
      "app.asar.unpacked",
      "node_modules",
      "better-sqlite3",
      "build",
      "Release",
      "better_sqlite3.node",
    ),
  }

  for (const [label, binary] of Object.entries(binaries)) {
    const inspection = assertBundledBinary(binary, platformKey, {
      requireExecutable: label !== "better-sqlite3",
    })
    console.log(`${label}: regular ${inspection.format} ${inspection.architectures.join("+")}`)
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
  const expectedElectronVersion = String(packageJson.devDependencies.electron).replace(
    /^[^0-9]*/,
    "",
  )
  const electronVersion = readElectronVersion(appPath)
  if (electronVersion !== expectedElectronVersion) {
    throw new Error(
      `Electron version mismatch: expected ${expectedElectronVersion}, found ${electronVersion}`,
    )
  }
  console.log(`Electron version: ${electronVersion}`)

  if (options.smoke) {
    runSmoke(
      "Claude",
      binaries.Claude,
      ["--version"],
      new RegExp(CLAUDE_VERSION.replaceAll(".", "\\.")),
    )
    runSmoke(
      "Codex",
      binaries.Codex,
      ["--version"],
      new RegExp(CODEX_VERSION.replaceAll(".", "\\.")),
    )
    runSmoke("Whisper", binaries.Whisper, ["--help"], /whisper|usage:/i)
  }
  return { appPath, platformKey, electronVersion, binaries }
}

function main() {
  const args = process.argv.slice(2)
  const app = readArg(args, "--app")
  const platform = readArg(args, "--platform")
  if (!app || !platform)
    throw new Error("Usage: --app=<Flapstack.app> --platform=darwin-arm64|darwin-x64 [--smoke]")
  inspectMacApp(path.resolve(app), platform, { smoke: args.includes("--smoke") })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
