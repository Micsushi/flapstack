import { spawnSync } from "node:child_process"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const expectedElectron = `${root}/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`
const expectedProfile = `--user-data-dir=${homedir()}/Library/Application Support/Flapstack Dev`
const packagedPrefix = `${root}/release/`

if (process.platform !== "darwin") {
  console.error("[dev:verify] Live-instance verification currently supports macOS only.")
  process.exit(1)
}

const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
if (result.status !== 0) {
  console.error(`[dev:verify] Could not inspect processes: ${result.stderr.trim()}`)
  process.exit(1)
}

const lines = result.stdout.split("\n").map((line) => line.trim())
const devMain = lines.find((line) => line.includes(expectedElectron) && !line.includes("--type="))
const devRenderer = lines.find(
  (line) => line.includes(`${root}/node_modules/electron/dist/`) && line.includes(expectedProfile),
)
const packaged = lines.filter(
  (line) => line.includes(packagedPrefix) && line.includes("Flapstack.app/Contents/"),
)

if (packaged.length > 0) {
  console.error("[dev:verify] FAIL: a packaged release build is running from this checkout.")
  for (const line of packaged) console.error(`  ${line}`)
  process.exit(1)
}

if (!devMain || !devRenderer) {
  console.error(
    "[dev:verify] FAIL: the exact dev checkout and Flapstack Dev profile are not active.",
  )
  console.error(`[dev:verify] Start it with: npm run dev`)
  process.exit(1)
}

console.log("[dev:verify] PASS")
console.log(`[dev:verify] checkout: ${root}`)
console.log("[dev:verify] profile: ~/Library/Application Support/Flapstack Dev")
console.log(`[dev:verify] main: ${devMain}`)
