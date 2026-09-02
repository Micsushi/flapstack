#!/usr/bin/env node

import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readPackageSourceState } from "./lib/package-provenance.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
ensureSupportedNodeRuntime()
const evidenceRoot = path.join(root, ".local-evidence")
const args = process.argv.slice(2)
const outputArgument = readArg(args, "--output")
const outputDirectory = path.resolve(outputArgument ?? path.join(evidenceRoot, "macos-local"))
if (outputDirectory !== evidenceRoot && !outputDirectory.startsWith(`${evidenceRoot}${path.sep}`)) {
  throw new Error("macOS local evidence output must stay inside .local-evidence")
}
if (process.platform !== "darwin") throw new Error("macOS local verification requires macOS")

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const armApp = "release-preview/mac-arm64/Flapstack Preview.app"
const x64App = "release-preview/mac/Flapstack Preview.app"
const commands = [
  {
    name: "production dependency audit",
    command: npm,
    args: ["audit", "--omit=dev", "--audit-level=high"],
  },
  { name: "repository acceptance", command: npm, args: ["run", "check"] },
  {
    name: "Apple Silicon Preview package",
    command: process.execPath,
    args: [
      "scripts/package-app.mjs",
      "--ensure-native-abi",
      "--platform=darwin",
      "--arch=arm64",
      "--dir",
      "--channel=preview",
    ],
    env: { CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  },
  {
    name: "Apple Silicon package smoke",
    command: process.execPath,
    args: [
      "scripts/inspect-packaged-binaries.mjs",
      `--app=${armApp}`,
      "--platform=darwin-arm64",
      "--smoke",
    ],
  },
  {
    name: "Apple Silicon usage daemon smoke",
    command: process.execPath,
    args: ["scripts/smoke-packaged-usage-daemon-macos.mjs", `--app=${armApp}`],
  },
  {
    name: "Apple Silicon isolated lifecycle smoke",
    command: process.execPath,
    args: [
      "scripts/smoke-macos-package-lifecycle.mjs",
      `--app=${armApp}`,
      "--platform=darwin-arm64",
    ],
  },
  {
    name: "Apple Silicon package security audit",
    command: process.execPath,
    args: [
      "scripts/audit-macos-package.mjs",
      `--app=${armApp}`,
      "--platform=darwin-arm64",
      "--channel=preview",
      `--output=${path.relative(root, path.join(outputDirectory, "macos-security-arm64.json"))}`,
    ],
  },
  {
    name: "Intel Preview package",
    command: process.execPath,
    args: [
      "scripts/package-app.mjs",
      "--ensure-native-abi",
      "--platform=darwin",
      "--arch=x64",
      "--dir",
      "--channel=preview",
    ],
    env: { CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  },
  {
    name: "Intel package and native module smoke",
    command: process.execPath,
    args: [
      "scripts/inspect-packaged-binaries.mjs",
      `--app=${x64App}`,
      "--platform=darwin-x64",
      "--native-modules-smoke",
    ],
  },
  {
    name: "Intel usage daemon smoke",
    command: process.execPath,
    args: ["scripts/smoke-packaged-usage-daemon-macos.mjs", `--app=${x64App}`],
  },
  {
    name: "Intel package security audit",
    command: process.execPath,
    args: [
      "scripts/audit-macos-package.mjs",
      `--app=${x64App}`,
      "--platform=darwin-x64",
      "--channel=preview",
      `--output=${path.relative(root, path.join(outputDirectory, "macos-security-x64.json"))}`,
    ],
  },
]

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(outputDirectory, { recursive: true })
const startedAt = new Date()
const initialSource = readPackageSourceState(root)
const results = []
let failure
try {
  for (const entry of commands) {
    const commandStartedAt = Date.now()
    console.log(`[macos-local] ${entry.name}`)
    const result = spawnSync(entry.command, entry.args, {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, ...entry.env },
    })
    const record = {
      name: entry.name,
      status: result.status ?? null,
      signal: result.signal ?? null,
      durationMs: Date.now() - commandStartedAt,
    }
    results.push(record)
    if (result.error) throw result.error
    if (result.signal) throw new Error(`${entry.name} terminated by ${result.signal}`)
    if (result.status !== 0) throw new Error(`${entry.name} failed with exit code ${result.status}`)
  }
  const finalSource = readPackageSourceState(root)
  if (finalSource.fingerprint !== initialSource.fingerprint) {
    throw new Error("Source changed while macOS local evidence was collected")
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
} finally {
  const reportPaths = ["macos-security-arm64.json", "macos-security-x64.json"]
  const reports = reportPaths.flatMap((name) => {
    try {
      const bytes = readFileSync(path.join(outputDirectory, name))
      return [{ name, sha256: createHash("sha256").update(bytes).digest("hex") }]
    } catch {
      return []
    }
  })
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt: startedAt.toISOString(),
    status: failure ? "failed" : "pass",
    source: initialSource,
    host: {
      platform: process.platform,
      architecture: process.arch,
      node: process.version,
    },
    commands: results,
    reports,
    ...(failure ? { failure } : {}),
  }
  const bytes = `${JSON.stringify(report, null, 2)}\n`
  const reportPath = path.join(outputDirectory, "macos-local-evidence.json")
  writeFileSync(reportPath, bytes)
  writeFileSync(
    `${reportPath}.sha256`,
    `${createHash("sha256").update(bytes).digest("hex")}  ${path.basename(reportPath)}\n`,
  )
}

if (failure) throw new Error(failure)
console.log(`macOS local evidence passed: ${path.relative(root, outputDirectory)}`)

function readArg(values, name) {
  const direct = values.find((value) => value.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = values.indexOf(name)
  return index >= 0 ? values[index + 1] : undefined
}

function ensureSupportedNodeRuntime() {
  const supportedMajors = new Set([22, 24])
  const currentMajor = Number(process.versions.node.split(".")[0])
  if (supportedMajors.has(currentMajor)) return

  const candidates = [
    process.env.FLAPSTACK_MACOS_VERIFY_NODE,
    "/opt/homebrew/opt/node@22/bin/node",
    "/usr/local/opt/node@22/bin/node",
  ].filter(Boolean)
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const version = spawnSync(candidate, ["--version"], { encoding: "utf8" })
    const major = Number(/^v(\d+)/.exec(String(version.stdout).trim())?.[1])
    if (version.status !== 0 || !supportedMajors.has(major)) continue
    const result = spawnSync(
      candidate,
      [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          PATH: `${path.dirname(candidate)}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    )
    if (result.error) throw result.error
    process.exit(result.status ?? 1)
  }
  throw new Error(
    `macOS local verification requires Node 22 or 24; current runtime is ${process.version}`,
  )
}
