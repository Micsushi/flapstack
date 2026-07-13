#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertAllowlistedRegularFiles,
  assertBundledBinary,
  ensureRealDirectory,
  replaceDirectoryAtomically,
  verifyCachedBinaryDigest,
} from "./lib/packaged-binary.mjs"
import { whisperResourceFiles } from "./prepare-whisper-binary.mjs"

export const CLAUDE_VERSION = "2.1.207"
export const CODEX_VERSION = "0.144.1"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const resourcesDirectory = path.join(root, "resources")
const binDirectory = path.join(resourcesDirectory, "bin")
const supportedTargets = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
])

export function resolvePackageTargets(requested = []) {
  if (requested.length === 0) {
    throw new Error("Package resource targets must include an explicit platform and architecture")
  }
  const uniqueTargets = [...new Set(requested)]
  const unsupported = uniqueTargets.find((target) => !supportedTargets.has(target))
  if (unsupported) throw new Error(`Unsupported package target: ${unsupported}`)
  return uniqueTargets
}

function parseRequestedTargets(args) {
  const requested = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument.startsWith("--target=")) requested.push(argument.slice("--target=".length))
    else if (argument === "--target" && args[index + 1]) requested.push(args[++index])
  }
  return requested
}

function runScript(script, args) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), ...args], {
    cwd: root,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}`)
}

function expectedTargetFiles(target) {
  const windows = target.startsWith("win32-")
  return [
    ".codex-asset.sha256",
    ".codex-binary.sha256",
    windows ? "claude.exe" : "claude",
    windows ? "codex.exe" : "codex",
    ...whisperResourceFiles(target),
    windows ? "flapstack-stt-sidecar.exe" : "flapstack-stt-sidecar",
    "flapstack-stt-sidecar-LICENSE",
    "transcribe.cpp-LICENSE",
    ".transcribe-version",
  ]
}

export async function validatePreparedTarget(target, rootDirectory = binDirectory) {
  const directory = path.join(rootDirectory, target)
  const windows = target.startsWith("win32-")
  assertAllowlistedRegularFiles(directory, expectedTargetFiles(target))
  const binaries = [
    windows ? "claude.exe" : "claude",
    windows ? "codex.exe" : "codex",
    windows ? "flapstack-stt-sidecar.exe" : "flapstack-stt-sidecar",
  ]
  for (const binary of binaries) assertBundledBinary(path.join(directory, binary), target)
  if (
    !(await verifyCachedBinaryDigest(
      path.join(directory, windows ? "codex.exe" : "codex"),
      target,
      path.join(directory, ".codex-binary.sha256"),
    ))
  ) {
    throw new Error(`${directory}: Codex binary digest validation failed`)
  }
}

export async function preparePackageResources(targets) {
  targets = resolvePackageTargets(targets)
  ensureRealDirectory(resourcesDirectory)
  const stagingRoot = fs.mkdtempSync(path.join(resourcesDirectory, ".bin-stage-"))
  const platformArgs = targets.map((target) => `--platform=${target}`)
  const outputArg = `--output-root=${stagingRoot}`
  try {
    runScript("prepare-whisper-binary.mjs", [outputArg, ...platformArgs])
    for (const target of targets)
      runScript("prepare-stt-sidecar.mjs", [outputArg, `--platform=${target}`])
    runScript("download-claude-binary.mjs", [
      outputArg,
      `--version=${CLAUDE_VERSION}`,
      ...platformArgs,
    ])
    runScript("download-codex-binary.mjs", [
      outputArg,
      `--version=${CODEX_VERSION}`,
      ...platformArgs,
    ])
    const rootEntries = fs.readdirSync(stagingRoot).sort()
    const expectedRootEntries = [...targets, "VERSION"].sort()
    if (JSON.stringify(rootEntries) !== JSON.stringify(expectedRootEntries)) {
      throw new Error(
        `Unexpected package resource root entries: expected ${expectedRootEntries.join(", ")}; found ${rootEntries.join(", ")}`,
      )
    }
    if (!fs.lstatSync(path.join(stagingRoot, "VERSION")).isFile()) {
      throw new Error("Staged resources/bin/VERSION must be a regular file")
    }
    for (const target of targets) await validatePreparedTarget(target, stagingRoot)
    replaceDirectoryAtomically(stagingRoot, binDirectory)
    for (const target of targets) await validatePreparedTarget(target)
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true })
  }
}

async function main() {
  const targets = resolvePackageTargets(parseRequestedTargets(process.argv.slice(2)))
  console.log(`Preparing pinned package resources: ${targets.join(", ")}`)
  await preparePackageResources(targets)
  console.log("Pinned package resources verified")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
