#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { preparePackageResources, resolvePackageTargets } from "./prepare-package-resources.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const platformFlags = { darwin: "--mac", win32: "--win", linux: "--linux" }
const supportedArchitectures = new Set(["arm64", "x64"])
const defaultNativeAbiMarker = path.join(root, "node_modules", ".native-abi")

function valuesFor(args, name) {
  const values = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument.startsWith(`${name}=`)) values.push(argument.slice(name.length + 1))
    else if (argument === name && args[index + 1]) values.push(args[++index])
  }
  return values
}

export function resolvePackageBuild(
  options = {},
  host = { platform: process.platform, arch: process.arch },
) {
  const explicitPlatform = options.platform
  const platform = explicitPlatform ?? host.platform
  if (!platformFlags[platform]) throw new Error(`Unsupported package platform: ${platform}`)
  let architectures = options.architectures ?? []
  if (explicitPlatform && architectures.length === 0) {
    throw new Error(`Package platform ${platform} requires an explicit architecture`)
  }
  if (architectures.length === 0) {
    architectures =
      platform === "darwin" ? ["arm64", "x64"] : [host.arch === "arm64" ? "arm64" : "x64"]
  }
  architectures = [...new Set(architectures)]
  const unsupportedArchitecture = architectures.find(
    (architecture) => !supportedArchitectures.has(architecture),
  )
  if (unsupportedArchitecture) {
    throw new Error(`Unsupported package architecture: ${unsupportedArchitecture}`)
  }
  if (platform === "win32" && architectures.some((architecture) => architecture !== "x64")) {
    throw new Error("Windows packaging currently supports x64 only")
  }
  const targets = resolvePackageTargets(
    architectures.map((architecture) => `${platform}-${architecture}`),
  )
  const builderArgs = [
    platformFlags[platform],
    ...architectures.map((architecture) => `--${architecture}`),
    ...(options.dir ? ["--dir"] : []),
  ]
  return { platform, architectures, targets, builderArgs }
}

function parseBuild(args) {
  const platforms = valuesFor(args, "--platform")
  if (platforms.length > 1) throw new Error("Package one operating system per command")
  return resolvePackageBuild({
    platform: platforms[0],
    architectures: valuesFor(args, "--arch"),
    dir: args.includes("--dir"),
  })
}

export function runBuilder(args, options = {}) {
  const markerPath = options.markerPath ?? defaultNativeAbiMarker
  const cli = options.cli ?? path.join(root, "node_modules", "electron-builder", "cli.js")
  const runner = options.spawn ?? spawnSync
  // Invalidate before electron-builder can mutate native modules. A hard
  // interruption cannot leave a previously valid Node marker behind.
  rmSync(markerPath, { force: true })
  try {
    const result = runner(options.runtime ?? process.execPath, [cli, ...args], {
      cwd: options.cwd ?? root,
      stdio: options.stdio ?? "inherit",
    })
    if (result.error) throw result.error
    if (result.signal) throw new Error(`electron-builder terminated by ${result.signal}`)
    if (result.status !== 0)
      throw new Error(`electron-builder failed with exit code ${result.status}`)
  } finally {
    // Builder may rebuild multiple architectures in shared node_modules. Never
    // claim either Node or Electron compatibility after success or failure.
    rmSync(markerPath, { force: true })
  }
}

async function main() {
  const build = parseBuild(process.argv.slice(2))
  console.log(`Packaging exact targets: ${build.targets.join(", ")}`)
  await preparePackageResources(build.targets)
  runBuilder(build.builderArgs)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
