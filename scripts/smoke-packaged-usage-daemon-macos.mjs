import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { build } from "esbuild"

if (process.platform !== "darwin") {
  throw new Error("Packaged usage daemon lifecycle smoke requires macOS")
}

const root = resolve(import.meta.dirname, "..")
const appArgument = process.argv.find((value) => value.startsWith("--app="))
const appPath = resolve(root, appArgument?.slice("--app=".length) || "")
if (!appArgument || !existsSync(appPath)) {
  throw new Error("Pass an existing packaged app with --app=/path/to/App.app")
}

const appName = basename(appPath, ".app")
const executable = join(appPath, "Contents", "MacOS", appName)
const daemonEntry = join(
  appPath,
  "Contents",
  "Resources",
  "app.asar",
  "out",
  "main",
  "usage-daemon.js",
)
if (!existsSync(executable) || !existsSync(join(appPath, "Contents", "Resources", "app.asar"))) {
  throw new Error(`Packaged app is incomplete: ${appPath}`)
}

const temp = mkdtempSync(join(tmpdir(), "flapstack-packaged-usage-daemon-"))
const profileDir = join(temp, "Flapstack Preview Usage Exit Smoke")
const configDir = join(profileDir, "data")
const dbPath = join(configDir, "agents.db")
const settingsPath = join(configDir, "usage-settings.json")
const bundledPlatform = join(temp, "usage-daemon-platform.mjs")
const secretNamespace = "package-usage-daemon-smoke"
let platformHelpers
let serviceId
let plistPath

try {
  await build({
    entryPoints: [join(root, "src/main/lib/usage-daemon/platform.ts")],
    outfile: bundledPlatform,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
  })
  platformHelpers = await import(`${pathToFileURL(bundledPlatform).href}?${Date.now()}`)
  serviceId = platformHelpers.daemonServiceIdForConfig(configDir)
  plistPath = platformHelpers.launchAgentPlistPath(serviceId)

  mkdirSync(configDir, { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec("CREATE TABLE agent_runs (id text PRIMARY KEY)")
  db.exec(
    readFileSync(join(root, "drizzle/0009_exotic_red_wolf.sql"), "utf8").replaceAll(
      "--> statement-breakpoint",
      "",
    ),
  )
  db.close()
  writeFileSync(
    settingsPath,
    JSON.stringify({ daemonEnabled: true, daemonStartAtLogin: true, cadenceSeconds: 30 }),
  )

  const install = () =>
    platformHelpers.installUsageDaemon({
      nodePath: executable,
      daemonEntryPath: daemonEntry,
      dbPath,
      configDir,
      cadenceSeconds: 30,
      secretNamespace,
    })

  install()
  const first = await waitForRunning(dbPath)
  assertLaunchAgent(serviceId, plistPath, executable, daemonEntry, secretNamespace)

  platformHelpers.uninstallUsageDaemon(configDir)
  await waitForStopped(first.pid)
  assertLaunchAgentRemoved(serviceId, plistPath)

  install()
  const restarted = await waitForRunning(dbPath, first.pid)
  assertLaunchAgent(serviceId, plistPath, executable, daemonEntry, secretNamespace)

  writeFileSync(
    settingsPath,
    JSON.stringify({ daemonEnabled: false, daemonStartAtLogin: false, cadenceSeconds: 30 }),
  )
  platformHelpers.uninstallUsageDaemon(configDir)
  await waitForStopped(restarted.pid)
  assertLaunchAgentRemoved(serviceId, plistPath)

  console.log(
    `packaged usage daemon smoke passed (closed-app launch, stop, restart, cleanup): ${serviceId}`,
  )
} finally {
  if (platformHelpers && serviceId) {
    try {
      platformHelpers.uninstallUsageDaemon(configDir)
    } catch {}
  }
  rmSync(temp, { recursive: true, force: true })
}

function readStatus(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db
      .prepare(
        "SELECT running, pid, last_heartbeat_at, last_poll_at FROM usage_daemon_status WHERE id = 'singleton'",
      )
      .get()
  } finally {
    db.close()
  }
}

async function waitForRunning(dbPath, previousPid = null) {
  return waitFor(() => {
    const status = readStatus(dbPath)
    if (
      status?.running === 1 &&
      status.pid != null &&
      status.pid !== previousPid &&
      status.last_heartbeat_at != null &&
      status.last_poll_at != null
    ) {
      return status
    }
    return null
  }, "packaged usage daemon to start and poll")
}

async function waitForStopped(pid) {
  await waitFor(() => {
    try {
      process.kill(pid, 0)
      return null
    } catch {
      return true
    }
  }, `packaged usage daemon pid ${pid} to stop`)
}

function assertLaunchAgent(serviceId, plistPath, executable, daemonEntry, secretNamespace) {
  if (!existsSync(plistPath)) throw new Error(`LaunchAgent plist missing: ${plistPath}`)
  const plist = readFileSync(plistPath, "utf8")
  for (const value of [executable, daemonEntry, secretNamespace]) {
    if (!plist.includes(value)) throw new Error(`LaunchAgent plist is missing ${value}`)
  }
  execFileSync(
    "launchctl",
    ["print", `gui/${process.getuid()}/dev.flapstack.usage-daemon.${serviceId}`],
    {
      stdio: "ignore",
    },
  )
}

function assertLaunchAgentRemoved(serviceId, plistPath) {
  if (existsSync(plistPath)) throw new Error(`LaunchAgent plist survived cleanup: ${plistPath}`)
  try {
    execFileSync(
      "launchctl",
      ["print", `gui/${process.getuid()}/dev.flapstack.usage-daemon.${serviceId}`],
      { stdio: "ignore" },
    )
  } catch {
    return
  }
  throw new Error(`LaunchAgent survived cleanup: ${serviceId}`)
}

async function waitFor(predicate, description, timeoutMs = 15_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const result = predicate()
    if (result) return result
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Timed out waiting for ${description}`)
}
