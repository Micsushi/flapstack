import { execFileSync } from "node:child_process"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { build } from "esbuild"
import { usageDaemonSmokeProfilePath } from "./lib/profile-paths.mjs"

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
const expectProviderArgument = process.argv.find((value) => value.startsWith("--expect-provider="))
const expectedProvider = expectProviderArgument?.slice("--expect-provider=".length).trim() || null
const expectAlert = process.argv.includes("--expect-alert")
if (
  expectedProvider &&
  !["codex", "anthropic", "cursor", "openrouter", "nanogpt"].includes(expectedProvider)
) {
  throw new Error(`Unsupported expected provider: ${expectedProvider}`)
}
if (expectAlert && !expectedProvider) {
  throw new Error("--expect-alert requires --expect-provider")
}
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
const profileDir = usageDaemonSmokeProfilePath(temp)
const configDir = join(profileDir, "data")
const dbPath = join(configDir, "agents.db")
const settingsPath = join(configDir, "usage-settings.json")
const bundledPlatform = join(temp, "usage-daemon-platform.mjs")
const secretNamespace = "package-usage-daemon-smoke"
let platformHelpers
let serviceId
let plistPath
let installationAttempted = false
const failures = []

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
  for (const migration of readdirSync(join(root, "drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(
      readFileSync(join(root, "drizzle", migration), "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    )
  }
  db.close()
  writeFileSync(
    settingsPath,
    JSON.stringify({
      daemonEnabled: true,
      daemonStartAtLogin: true,
      cadenceSeconds: 30,
      discordAlertsEnabled: expectAlert,
      ...(expectedProvider
        ? {
            providers: {
              [expectedProvider]: {
                enabled: true,
                ...(expectAlert
                  ? {
                      thresholds: {
                        quotaPercent: expectedProvider === "openrouter" ? [] : [0],
                        spendUsd: expectedProvider === "openrouter" ? [0] : [],
                      },
                    }
                  : {}),
              },
            },
          }
        : {}),
    }),
  )

  const install = () => {
    assertLaunchAgentRemoved(serviceId, plistPath)
    installationAttempted = true
    platformHelpers.installUsageDaemon({
      nodePath: executable,
      daemonEntryPath: daemonEntry,
      dbPath,
      configDir,
      cadenceSeconds: 30,
      secretNamespace,
    })
  }

  install()
  const first = await waitForRunning(dbPath, null, serviceId)
  if (expectedProvider) await waitForProviderSample(dbPath, expectedProvider)
  if (expectAlert) await waitForSentAlert(dbPath, expectedProvider)
  assertLaunchAgent(serviceId, plistPath, executable, daemonEntry, secretNamespace)

  platformHelpers.uninstallUsageDaemon(configDir)
  await waitForStopped(first.pid)
  assertLaunchAgentRemoved(serviceId, plistPath)
  installationAttempted = false

  install()
  const restarted = await waitForRunning(dbPath, first.pid, serviceId)
  assertLaunchAgent(serviceId, plistPath, executable, daemonEntry, secretNamespace)

  writeFileSync(
    settingsPath,
    JSON.stringify({ daemonEnabled: false, daemonStartAtLogin: false, cadenceSeconds: 30 }),
  )
  platformHelpers.uninstallUsageDaemon(configDir)
  await waitForStopped(restarted.pid)
  assertLaunchAgentRemoved(serviceId, plistPath)
  installationAttempted = false
} catch (error) {
  failures.push(error)
} finally {
  let serviceCleanupFailed = false
  if (installationAttempted) {
    try {
      platformHelpers.uninstallUsageDaemon(configDir)
      assertLaunchAgentRemoved(serviceId, plistPath)
    } catch (error) {
      serviceCleanupFailed = true
      failures.push(
        new Error(`Smoke service cleanup failed; recovery files retained at ${temp}`, {
          cause: error,
        }),
      )
    }
  }
  if (!serviceCleanupFailed) {
    try {
      rmSync(temp, { recursive: true, force: true })
    } catch (error) {
      failures.push(error)
    }
  }
}
if (failures.length === 1) throw failures[0]
if (failures.length > 1) throw new AggregateError(failures, "Packaged usage daemon smoke failed")
console.log(
  `packaged usage daemon smoke passed (closed-app launch, poll${expectedProvider ? `, ${expectedProvider} sample` : ""}${expectAlert ? ", persisted Discord alert" : ""}, stop, restart, cleanup): ${serviceId}`,
)

function readStatus(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db
      .prepare(
        "SELECT running, pid, last_heartbeat_at, last_poll_at, last_error FROM usage_daemon_status WHERE id = 'singleton'",
      )
      .get()
  } finally {
    db.close()
  }
}

function readProviderSampleCount(dbPath, providerId) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db
      .prepare("SELECT count(*) AS count FROM usage_samples WHERE provider_id = ?")
      .get(providerId).count
  } finally {
    db.close()
  }
}

function readProviderState(dbPath, providerId) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db
      .prepare(
        "SELECT status, configured, status_detail, last_error FROM usage_provider_states WHERE provider_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(providerId)
  } finally {
    db.close()
  }
}

function readSentAlertCount(dbPath, providerId) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db
      .prepare(
        "SELECT count(*) AS count FROM usage_alert_events WHERE provider_id = ? AND delivery_status = 'sent' AND channel = 'discord'",
      )
      .get(providerId).count
  } finally {
    db.close()
  }
}

async function waitForProviderSample(dbPath, providerId) {
  try {
    await waitFor(
      () => (readProviderSampleCount(dbPath, providerId) > 0 ? true : null),
      `packaged usage daemon to persist a ${providerId} sample`,
    )
  } catch (error) {
    const state = readProviderState(dbPath, providerId)
    throw new Error(`${error.message}; sanitized provider state: ${JSON.stringify(state ?? null)}`)
  }
}

async function waitForSentAlert(dbPath, providerId) {
  await waitFor(
    () => (readSentAlertCount(dbPath, providerId) > 0 ? true : null),
    `packaged usage daemon to persist a sent ${providerId} Discord alert`,
  )
}

async function waitForRunning(dbPath, previousPid, serviceId) {
  try {
    return await waitFor(() => {
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
  } catch (error) {
    const status = readStatus(dbPath)
    let launchAgent = "unavailable"
    try {
      execFileSync(
        "launchctl",
        ["print", `gui/${process.getuid()}/dev.flapstack.usage-daemon.${serviceId}`],
        { stdio: "ignore" },
      )
      launchAgent = "loaded"
    } catch (inspectionError) {
      launchAgent = platformHelpers.isLaunchctlServiceNotFound(inspectionError)
        ? "not-loaded"
        : "inspection-failed"
    }
    throw new Error(
      `${error.message}; daemon status: ${JSON.stringify(status ?? null)}; launchd: ${launchAgent}`,
    )
  }
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
  if (lstatSync(plistPath, { throwIfNoEntry: false }))
    throw new Error(`LaunchAgent plist already exists or survived cleanup: ${plistPath}`)
  try {
    execFileSync(
      "launchctl",
      ["print", `gui/${process.getuid()}/dev.flapstack.usage-daemon.${serviceId}`],
      { stdio: "ignore" },
    )
  } catch (error) {
    if (!platformHelpers.isLaunchctlServiceNotFound(error)) throw error
    return
  }
  throw new Error(`LaunchAgent survived cleanup: ${serviceId}`)
}

async function waitFor(predicate, description, timeoutMs = 15_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const result = predicate()
      if (result) return result
    } catch (error) {
      if (!/SQLITE_BUSY|database is locked/i.test(error instanceof Error ? error.message : "")) {
        throw error
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`Timed out waiting for ${description}`)
}
