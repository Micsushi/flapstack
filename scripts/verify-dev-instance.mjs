import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { classifyNativeFlapstackProcesses, queryNativeProcesses } from "./lib/native-processes.mjs"
import { flapstackProfilePath } from "./lib/profile-paths.mjs"
import {
  classifyWindowsFlapstackProcesses,
  queryWindowsProcesses,
} from "./lib/windows-processes.mjs"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const instance = process.env.FLAPSTACK_DEV_INSTANCE?.trim()
const profileName = instance
  ? `Flapstack Dev ${instance.replace(/[^a-zA-Z0-9_-]/g, "-")}`
  : "Flapstack Dev"

function fail(message) {
  console.error(`[dev:verify] FAIL: ${message}`)
  console.error("[dev:verify] Start it with: npm run dev")
  process.exit(1)
}

function verifyWindows() {
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")
  const profilePath = join(appData, profileName)
  const classification = classifyWindowsFlapstackProcesses(queryWindowsProcesses(), {
    root,
    profilePath,
  })
  if (classification.packagedPids.length > 0) {
    fail(
      `a packaged release build is running from this checkout (pid ${classification.packagedPids.join(", ")})`,
    )
  }
  if (!classification.mainPid || !classification.rendererPid) {
    fail("the exact dev checkout and Flapstack Dev profile are not active")
  }
  console.log("[dev:verify] PASS")
  console.log(`[dev:verify] checkout: ${root}`)
  console.log(`[dev:verify] profile: ${profilePath}`)
  console.log(`[dev:verify] main pid: ${classification.mainPid}`)
  console.log(`[dev:verify] renderer pid: ${classification.rendererPid}`)
}

function verifyPosix() {
  const profilePath = flapstackProfilePath(profileName)
  const classification = classifyNativeFlapstackProcesses(queryNativeProcesses(), {
    root,
    profilePath,
  })
  if (classification.packagedPids.length > 0) {
    fail(
      `a packaged release build is running from this checkout (pid ${classification.packagedPids.join(", ")})`,
    )
  }
  if (!classification.mainPid || !classification.rendererPid) {
    fail("the exact dev checkout and Flapstack Dev profile are not active")
  }
  console.log("[dev:verify] PASS")
  console.log(`[dev:verify] checkout: ${root}`)
  console.log(`[dev:verify] profile: ${profilePath}`)
  console.log(`[dev:verify] main pid: ${classification.mainPid}`)
  console.log(`[dev:verify] renderer pid: ${classification.rendererPid}`)
}

if (process.platform === "win32") verifyWindows()
else if (process.platform === "darwin" || process.platform === "linux") verifyPosix()
else fail(`live-instance verification does not support ${process.platform}`)
