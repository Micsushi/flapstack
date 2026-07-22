import { spawnSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
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

function verifyMac() {
  const expectedElectron = realpathSync(
    `${root}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`,
  )
  const expectedElectronRoot = realpathSync(`${root}/node_modules/electron/dist`)
  const expectedProfile = `--user-data-dir=${homedir()}/Library/Application Support/${profileName}`
  const packagedPrefixes = [`${root}/release/`, `${root}/release-preview/`]
  const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
  if (result.status !== 0) {
    fail(`could not inspect processes: ${String(result.stderr ?? "").trim()}`)
  }
  const lines = result.stdout.split("\n").map((line) => line.trim())
  const devMain = lines.find((line) => line.includes(expectedElectron) && !line.includes("--type="))
  const devRenderer = lines.find(
    (line) =>
      line.includes(expectedElectronRoot) &&
      line.includes(expectedProfile) &&
      line.includes(`--app-path=${root}`),
  )
  const packaged = lines.filter(
    (line) =>
      packagedPrefixes.some((prefix) => line.includes(prefix)) && line.includes(".app/Contents/"),
  )
  if (packaged.length > 0) fail("a packaged release build is running from this checkout")
  if (!devMain || !devRenderer)
    fail("the exact dev checkout and Flapstack Dev profile are not active")
  console.log("[dev:verify] PASS")
  console.log(`[dev:verify] checkout: ${root}`)
  console.log(`[dev:verify] profile: ~/Library/Application Support/${profileName}`)
  console.log(`[dev:verify] main: ${devMain}`)
}

if (process.platform === "win32") verifyWindows()
else if (process.platform === "darwin") verifyMac()
else fail(`live-instance verification does not support ${process.platform}`)
