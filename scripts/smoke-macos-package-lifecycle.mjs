#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "esbuild"
import { inspectMacApp } from "./inspect-packaged-binaries.mjs"
import { sha256File } from "./lib/packaged-binary.mjs"

if (process.platform !== "darwin") {
  throw new Error("macOS package lifecycle smoke requires macOS")
}

const root = path.resolve(import.meta.dirname, "..")
const appArgument = process.argv.find((value) => value.startsWith("--app="))
const platformArgument = process.argv.find((value) => value.startsWith("--platform="))
const appPath = path.resolve(root, appArgument?.slice("--app=".length) || "")
const platformKey = platformArgument?.slice("--platform=".length) || ""
if (!appArgument || !existsSync(appPath) || !/^darwin-(?:arm64|x64)$/.test(platformKey)) {
  throw new Error("Pass --app=/path/to/App.app and --platform=darwin-arm64|darwin-x64")
}

const temp = mkdtempSync(path.join(tmpdir(), "flapstack-macos-lifecycle-"))
const applications = path.join(temp, "Applications")
const installedApp = path.join(applications, path.basename(appPath))
const previousApp = path.join(temp, "Previous.app")
const stagingApp = path.join(applications, `.${path.basename(appPath)}.staging`)
const backupApp = path.join(applications, `.${path.basename(appPath)}.rollback`)
const profile = path.join(temp, "Library", "Application Support", "Flapstack Lifecycle", "data")
const profileMarker = path.join(profile, "preserved-profile.json")
const launchAgents = path.join(temp, "Library", "LaunchAgents")
const launchAgent = path.join(launchAgents, "dev.flapstack.usage-daemon.lifecycle.plist")
const bundledPlatform = path.join(temp, "usage-daemon-platform.mjs")

try {
  mkdirSync(applications, { recursive: true })
  cpSync(appPath, previousApp, { recursive: true, dereference: false, preserveTimestamps: true })
  setBundleVersion(previousApp, "0.0.0-lifecycle")

  cpSync(previousApp, installedApp, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
  })
  assertBundleVersion(installedApp, "0.0.0-lifecycle")
  mkdirSync(profile, { recursive: true })
  writeFileSync(profileMarker, '{"preserve":true}\n')

  cpSync(appPath, stagingApp, { recursive: true, dereference: false, preserveTimestamps: true })
  renameSync(installedApp, backupApp)
  renameSync(stagingApp, installedApp)
  await assertSameAsar(appPath, installedApp)
  inspectMacApp(installedApp, platformKey)

  renameSync(installedApp, stagingApp)
  renameSync(backupApp, installedApp)
  assertBundleVersion(installedApp, "0.0.0-lifecycle")
  rmSync(stagingApp, { recursive: true })

  cpSync(appPath, stagingApp, { recursive: true, dereference: false, preserveTimestamps: true })
  renameSync(installedApp, backupApp)
  renameSync(stagingApp, installedApp)
  await assertSameAsar(appPath, installedApp)
  rmSync(backupApp, { recursive: true })

  await build({
    entryPoints: [path.join(root, "src/main/lib/usage-daemon/platform.ts")],
    outfile: bundledPlatform,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  })
  const platformHelpers = await import(`${pathToFileURL(bundledPlatform).href}?${Date.now()}`)
  mkdirSync(launchAgents, { recursive: true })
  writeFileSync(launchAgent, "<plist/>")
  platformHelpers.uninstallLaunchAgent({
    path: launchAgent,
    domain: "gui/501",
    label: "dev.flapstack.usage-daemon.lifecycle",
    run: (args) => {
      if (args[0] === "bootout") return
      const error = new Error("service not loaded")
      error.status = 113
      throw error
    },
    remove: (target) => rmSync(target, { force: true }),
  })
  if (existsSync(launchAgent)) throw new Error("LaunchAgent cleanup left an owned plist")

  rmSync(installedApp, { recursive: true })
  if (existsSync(installedApp)) throw new Error("Sandbox uninstall left the app bundle")
  if (readFileSync(profileMarker, "utf8") !== '{"preserve":true}\n') {
    throw new Error("Sandbox uninstall did not preserve the user profile")
  }
  console.log(
    "macOS package lifecycle smoke passed (isolated install, upgrade, rollback, reinstall, LaunchAgent cleanup, uninstall, profile preservation)",
  )
} finally {
  rmSync(temp, { recursive: true, force: true })
}

function setBundleVersion(app, version) {
  const plist = path.join(app, "Contents", "Info.plist")
  for (const key of ["CFBundleShortVersionString", "CFBundleVersion"]) {
    const result = spawnSync("/usr/bin/plutil", ["-replace", key, "-string", version, plist], {
      encoding: "utf8",
    })
    if (result.error || result.status !== 0) {
      throw new Error(
        `Could not prepare lifecycle version fixture: ${result.error?.message || result.stderr}`,
      )
    }
  }
}

function assertBundleVersion(app, expected) {
  const result = spawnSync(
    "/usr/bin/plutil",
    ["-extract", "CFBundleShortVersionString", "raw", path.join(app, "Contents", "Info.plist")],
    { encoding: "utf8" },
  )
  if (result.error || result.status !== 0 || result.stdout.trim() !== expected) {
    throw new Error(`Expected sandbox app version ${expected}`)
  }
}

async function assertSameAsar(source, installed) {
  const relative = path.join("Contents", "Resources", "app.asar")
  if (
    (await sha256File(path.join(source, relative))) !==
    (await sha256File(path.join(installed, relative)))
  ) {
    throw new Error("Installed app.asar does not match the source package")
  }
}
