// Stage 2 Track B - U3/U4: daemon-side connection to the shared usage DB.
//
// The daemon runs outside Electron, so it cannot call app.getPath(). It resolves
// the same SQLite file the app uses via FLAPSTACK_DB_PATH (set in the LaunchAgent
// env). Pragmas match store.applyUsageStorePragmas so app reads + daemon writes
// coexist safely.

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { existsSync } from "node:fs"
import * as schema from "../db/schema"
import { applyUsageStorePragmas, type UsageDb } from "../usage/store"

export function resolveSharedDbPath(): string {
  const explicit = process.env.FLAPSTACK_DB_PATH
  if (explicit) return explicit
  throw new Error(
    "FLAPSTACK_DB_PATH is not set; the daemon needs the app's SQLite path to write usage samples.",
  )
}

export function openDaemonDb(): { db: UsageDb; close: () => void } {
  const path = resolveSharedDbPath()
  if (!existsSync(path)) {
    throw new Error(`Shared usage DB not found at ${path}; launch the app once to create it.`)
  }
  const sqlite = new Database(path)
  applyUsageStorePragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  return { db, close: () => sqlite.close() }
}
