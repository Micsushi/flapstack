// Stage 2 Track B — U3: daemon lifecycle helpers used by the app side.
//
// The app uses these to detect whether the background daemon is running / stale /
// missing and to render daemon status. Health is derived from the heartbeat row
// the daemon writes to the shared DB (usage_daemon_status).

import type { UsageDb } from "../usage/store"
import { getDaemonStatus } from "../usage/store"

/** How long without a heartbeat before we consider the daemon stale. */
export const HEARTBEAT_STALE_MS = 3 * 60_000

export type DaemonHealth = "running" | "stale" | "stopped" | "disabled" | "unknown"

export interface DaemonStatusView {
  health: DaemonHealth
  enabled: boolean
  running: boolean
  pid: number | null
  cadenceSeconds: number
  lastHeartbeatAt: Date | null
  lastPollAt: Date | null
  lastAlertAt: Date | null
  lastError: string | null
}

export async function readDaemonStatus(
  db: UsageDb,
  now: Date = new Date(),
): Promise<DaemonStatusView> {
  const row = await getDaemonStatus(db)
  if (!row) {
    return {
      health: "unknown",
      enabled: false,
      running: false,
      pid: null,
      cadenceSeconds: 300,
      lastHeartbeatAt: null,
      lastPollAt: null,
      lastAlertAt: null,
      lastError: null,
    }
  }
  const heartbeat = row.lastHeartbeatAt ?? null
  const stale = heartbeat ? now.getTime() - heartbeat.getTime() > HEARTBEAT_STALE_MS : true
  let health: DaemonHealth
  if (!row.enabled) health = "disabled"
  else if (!row.running) health = "stopped"
  else health = stale ? "stale" : "running"
  return {
    health,
    enabled: row.enabled,
    running: row.running,
    pid: row.pid ?? null,
    cadenceSeconds: row.cadenceSeconds,
    lastHeartbeatAt: heartbeat,
    lastPollAt: row.lastPollAt ?? null,
    lastAlertAt: row.lastAlertAt ?? null,
    lastError: row.lastError ?? null,
  }
}
