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
import { redactUsageDiagnostic } from "../usage/diagnostics"
import { openDaemonDb } from "./db"
import { acquireDaemonInstanceLock } from "./instance-lock"

const HEARTBEAT_INTERVAL_MS = 60_000

/** Keychain-backed on macOS; file/safeStorage fallback remains available for
 * development and future platform adapters. */
async function daemonGetSecret(key: string): Promise<string | null> {
  return getUsageSecret(key)
}

export async function runDaemon(): Promise<void> {
  const instanceLock = acquireDaemonInstanceLock()
  let opened: ReturnType<typeof openDaemonDb>
  try {
    opened = openDaemonDb()
  } catch (error) {
    instanceLock.release()
    throw error
  }
  const { db, close } = opened
  const settings = getUsageSettings()
  if (!settings.daemonEnabled) {
    try {
      await updateDaemonStatus(db, {
        enabled: false,
        running: false,
        lastHeartbeatAt: new Date(),
        lastError: null,
      })
    } finally {
      try {
        close()
      } finally {
        instanceLock.release()
      }
    }
    return
  }
  const engine = new UsageEngine("daemon", { db, getSecret: daemonGetSecret })

  try {
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
  } catch (error) {
    try {
      close()
    } finally {
      instanceLock.release()
    }
    throw error
  }

  const heartbeat = setInterval(() => {
    void updateDaemonStatus(db, { lastHeartbeatAt: new Date(), running: true }).catch(() => {})
  }, HEARTBEAT_INTERVAL_MS)

  const scheduler = new UsageScheduler(engine, {
    getCadenceSeconds: () => resolveSchedulerCadenceSeconds(getUsageSettings()),
    onTickComplete: () => {
      void updateDaemonStatus(db, { lastPollAt: new Date() }).catch(() => {})
    },
    onTickError: (err) => {
      void updateDaemonStatus(db, { lastError: redactUsageDiagnostic(err) }).catch(() => {})
    },
  })

  let shuttingDown = false
  let finishShutdown: (() => void) | null = null
  const shutdown = (error?: unknown) => {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(heartbeat)
    void scheduler
      .stopAndWait()
      .then(() =>
        updateDaemonStatus(db, {
          running: false,
          pid: null,
          ...(error ? { lastError: redactUsageDiagnostic(error) } : {}),
        }),
      )
      .catch(() => {})
      .finally(() => {
        try {
          close()
        } catch {}
        try {
          instanceLock.release()
        } catch {}
        finishShutdown?.()
      })
  }
  const onSignal = () => shutdown()
  process.on("SIGTERM", onSignal)
  process.on("SIGINT", onSignal)

  const stopped = new Promise<void>((resolve) => {
    finishShutdown = resolve
  })
  scheduler.start()
  await stopped
  process.off("SIGTERM", onSignal)
  process.off("SIGINT", onSignal)
}
