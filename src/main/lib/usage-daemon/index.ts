// Stage 2 Track B - U3: background usage daemon entry point.
//
// Runs as a standalone Node process (spawned by launchd/Scheduled Task/systemd),
// NOT an Electron process. It opens the shared usage DB, polls configured
// providers on the configured cadence, writes a heartbeat, and sends Discord
// alerts while the Flapstack app is closed. It never opens the Flapstack UI.
//
// On macOS the app and the per-user LaunchAgent share the user Keychain. Other
// platforms use the existing settings fallback and report unavailable secrets
// honestly if OS encryption cannot be reached from the daemon process.

import { UsageEngine } from "../usage/engine"
import { UsageScheduler } from "../usage/scheduler"
import { getUsageSettings, resolveSchedulerCadenceSeconds } from "../usage/settings"
import { getUsageSecret } from "../usage/secrets"
import { updateDaemonStatus } from "../usage/store"
import { openDaemonDb } from "./db"

const HEARTBEAT_INTERVAL_MS = 60_000

/** Keychain-backed on macOS; file/safeStorage fallback remains available for
 * development and future platform adapters. */
async function daemonGetSecret(key: string): Promise<string | null> {
  return getUsageSecret(key)
}

export async function runDaemon(): Promise<void> {
  const { db, close } = openDaemonDb()
  const settings = getUsageSettings()
  if (!settings.daemonEnabled) {
    await updateDaemonStatus(db, {
      enabled: false,
      running: false,
      lastHeartbeatAt: new Date(),
      lastError: null,
    })
    close()
    return
  }
  const engine = new UsageEngine("daemon", { db, getSecret: daemonGetSecret })

  await updateDaemonStatus(db, {
    host: process.env.HOSTNAME ?? null,
    pid: process.pid,
    enabled: settings.daemonEnabled,
    running: true,
    cadenceSeconds: settings.cadenceSeconds,
    startedAt: new Date(),
    lastHeartbeatAt: new Date(),
    lastError: null,
  })

  const heartbeat = setInterval(() => {
    void updateDaemonStatus(db, { lastHeartbeatAt: new Date(), running: true }).catch(() => {})
  }, HEARTBEAT_INTERVAL_MS)

  const scheduler = new UsageScheduler(engine, {
    getCadenceSeconds: () => resolveSchedulerCadenceSeconds(getUsageSettings()),
    onTickComplete: () => {
      void updateDaemonStatus(db, { lastPollAt: new Date() }).catch(() => {})
    },
    onTickError: (err) => {
      void updateDaemonStatus(db, { lastError: String((err as Error)?.message ?? err) }).catch(
        () => {},
      )
    },
  })

  const shutdown = () => {
    clearInterval(heartbeat)
    scheduler.stop()
    void updateDaemonStatus(db, { running: false }).finally(() => {
      close()
      process.exit(0)
    })
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  scheduler.start()
}
