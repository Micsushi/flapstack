#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { preparePackageResources, resolvePackageTargets } from "./prepare-package-resources.mjs"
import { writePackageProvenance } from "./lib/package-provenance.mjs"
import { prepareDependencyLicenseNotices } from "./lib/dependency-license-notices.mjs"
import { prepareDarwinTargetDependencies } from "./lib/darwin-target-dependencies.mjs"
import { ensureNativeAbi } from "./ensure-native-abi.mjs"
import {
  acquirePackageOutput,
  completePackageOutput,
  failPackageOutput,
} from "./lib/package-output-lock.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const scriptPath = fileURLToPath(import.meta.url)
const heavyJobLockScript = path.join(root, "scripts", "with-heavy-job-lock.mjs")
const platformFlags = { darwin: "--mac", win32: "--win", linux: "--linux" }
const supportedArchitectures = new Set(["arm64", "x64"])
const channelConfigs = {
  darwin: {
    preview: "electron-builder.preview.mac.cjs",
    release: "electron-builder.release.mac.cjs",
  },
  win32: {
    preview: "electron-builder.preview.win.cjs",
    release: "electron-builder.release.win.cjs",
  },
}
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
  const channelConfig = options.channel ? channelConfigs[platform]?.[options.channel] : undefined
  if (options.channel && !channelConfig) {
    throw new Error(`Unsupported ${platform} package channel: ${options.channel}`)
  }
  const builderArgs = [
    platformFlags[platform],
    ...architectures.map((architecture) => `--${architecture}`),
    ...(options.dir ? ["--dir"] : []),
    ...(channelConfig ? [`--config=${channelConfig}`] : []),
    ...(options.channel === "release" ? ["--publish=never"] : []),
  ]
  return {
    platform,
    architectures,
    targets,
    builderArgs,
    channel: options.channel ?? "development",
    outputDirectory: path.join(root, options.channel === "preview" ? "release-preview" : "release"),
  }
}

function parseBuild(args) {
  const platforms = valuesFor(args, "--platform")
  if (platforms.length > 1) throw new Error("Package one operating system per command")
  return resolvePackageBuild({
    platform: platforms[0],
    architectures: valuesFor(args, "--arch"),
    dir: args.includes("--dir"),
    channel: valuesFor(args, "--channel")[0],
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

export function runAppBuild(options = {}) {
  const runner = options.spawn ?? spawnSync
  const command = options.command ?? (process.platform === "win32" ? "npm.cmd" : "npm")
  const result = runner(command, ["run", "build"], {
    cwd: options.cwd ?? root,
    stdio: options.stdio ?? "inherit",
  })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`Application build terminated by ${result.signal}`)
  if (result.status !== 0)
    throw new Error(`Application build failed with exit code ${result.status}`)
}

export async function executePackageBuild(build, options = {}) {
  const rootDirectory = options.root ?? root
  const buildApp = options.buildApp ?? runAppBuild
  const writeProvenance = options.writeProvenance ?? writePackageProvenance
  const prepareNotices = options.prepareNotices ?? prepareDependencyLicenseNotices
  const prepareTargetDependencies =
    options.prepareTargetDependencies ?? prepareDarwinTargetDependencies
  const prepareResources = options.prepareResources ?? preparePackageResources
  const builder = options.builder ?? runBuilder
  // Build before touching the previous package so a source-build failure keeps
  // the last known-good output intact.
  buildApp({ cwd: rootDirectory })
  // Capture the source before the output transaction moves a previous package
  // into its temporary backup. The backup is build state, not source input.
  writeProvenance(build, {
    root: rootDirectory,
    productName: build.channel === "preview" ? "Flapstack Preview" : undefined,
  })
  const handle = acquirePackageOutput({
    root: rootDirectory,
    outputDirectory: build.outputDirectory,
  })
  try {
    await prepareTargetDependencies(build.targets, { root: rootDirectory })
    prepareNotices({ root: rootDirectory })
    await prepareResources(build.targets)
    builder(build.builderArgs)
    completePackageOutput(handle)
  } catch (error) {
    failPackageOutput(handle)
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (!process.env.FLAPSTACK_HEAVY_JOB_LOCK_TOKEN) {
    const result = spawnSync(
      process.execPath,
      [heavyJobLockScript, "package", "--", process.execPath, scriptPath, ...args],
      { cwd: root, stdio: "inherit" },
    )
    if (result.error) throw result.error
    if (result.signal) throw new Error(`Package coordinator terminated by ${result.signal}`)
    if (result.status !== 0) {
      throw new Error(`Package coordinator failed with exit code ${result.status}`)
    }
    return
  }
  const ensureElectronAbi = args.includes("--ensure-native-abi")
  const build = parseBuild(args.filter((argument) => argument !== "--ensure-native-abi"))
  if (ensureElectronAbi) ensureNativeAbi("electron")
  console.log(`Packaging exact targets: ${build.targets.join(", ")}`)
  await executePackageBuild(build)
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
