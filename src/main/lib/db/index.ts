import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { app } from "electron"
import { dirname, join } from "path"
import { existsSync, lstatSync, mkdirSync, realpathSync } from "fs"
import { migrateDatabase } from "./migrate"
import { recoverPendingAllChatPermissionChange } from "../permissions"
import { backfillUsageAttribution } from "../usage/attribution"
import * as schema from "./schema"
import { nowEpochSeconds } from "./timestamps"
import { startInstalledUsageDaemon, stopInstalledUsageDaemon } from "../usage-daemon/platform"
import {
  acquireAppDatabaseOperation,
  beginDatabaseAccessMaintenance,
  configureAppDatabasePath,
  type DatabaseMaintenanceAccessLease,
} from "./access"

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqlite: Database.Database | null = null
let maintenanceOwner: string | null = null
let stoppedUsageDaemonConfigDir: string | null = null
let maintenanceAccessLease: DatabaseMaintenanceAccessLease | null = null
const maintenanceParticipants = new Map<
  string,
  { pause: () => void | Promise<void>; resume: () => void | Promise<void> }
>()

/**
 * Get the database path in the app's user data directory
 */
export function getDatabasePath(): string {
  if (maintenanceOwner)
    throw new Error(`Database is paused for bounded maintenance: ${maintenanceOwner}.`)
  const explicitPath = process.env.FLAPSTACK_DB_PATH
  if (explicitPath) return explicitPath

  const userDataPath = app.getPath("userData")
  const dataDir = join(userDataPath, "data")

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  return join(dataDir, "agents.db")
}

/**
 * Get the migrations folder path
 * Handles both development and production (packaged) environments
 */
function getMigrationsPath(): string {
  if (app.isPackaged) {
    // Production: migrations bundled in resources
    return join(process.resourcesPath, "migrations")
  }
  // Development: from out/main -> apps/desktop/drizzle
  return join(__dirname, "../../drizzle")
}

/**
 * Initialize the database with Drizzle ORM
 */
export function initDatabase() {
  return initializeDatabase()
}

function initializeDatabase(maintenanceLease?: string) {
  if (maintenanceOwner && maintenanceOwner !== maintenanceLease)
    throw new Error(`Database is paused for bounded maintenance: ${maintenanceOwner}.`)
  if (db) {
    return db
  }

  const dbPath = maintenanceLease ? getDatabasePathUnsafe() : getDatabasePath()
  console.log(`[DB] Initializing database at: ${dbPath}`)

  // Do not publish either singleton until migrations and recovery succeed.
  // Callers must never observe a database that has only partially initialized.
  const nextSqlite = new Database(dbPath)
  try {
    nextSqlite.pragma("journal_mode = WAL")
    nextSqlite.pragma("foreign_keys = ON")
    // The background usage daemon can write this same DB while the app is open.
    nextSqlite.pragma("busy_timeout = 5000")

    const nextDb = drizzle(nextSqlite, { schema })
    // The Electron app owns migrations. Headless MCP children receive its already
    // migrated database explicitly and must not depend on Electron runtime state.
    if (process.env.FLAPSTACK_DB_PATH) {
      recoverPendingAllChatPermissionChange(nextSqlite)
    } else {
      const migrationsPath = getMigrationsPath()
      console.log(`[DB] Running migrations from: ${migrationsPath}`)
      migrateDatabase(nextDb, nextSqlite, migrationsPath)
      backfillFilesystemRootRegistrations(nextSqlite)
      recoverPendingAllChatPermissionChange(nextSqlite)
      console.log("[DB] Migrations completed")
    }
    backfillUsageAttribution(nextDb)

    sqlite = nextSqlite
    db = nextDb
    return db
  } catch (error) {
    console.error("[DB] Migration error:", error)
    nextSqlite.close()
    throw error
  }
}

function backfillFilesystemRootRegistrations(database: Database.Database): void {
  const tableExists = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  )
  if (
    !tableExists.get("projects") ||
    !tableExists.get("chats") ||
    !tableExists.get("filesystem_root_registrations")
  ) {
    return
  }
  const paths = database
    .prepare(
      `SELECT path FROM projects
       UNION
       SELECT worktree_path AS path FROM chats WHERE worktree_path IS NOT NULL`,
    )
    .all() as Array<{ path: string }>
  const exists = database.prepare(
    "SELECT 1 FROM filesystem_root_registrations WHERE path = ? LIMIT 1",
  )
  const insert = database.prepare(
    `INSERT INTO filesystem_root_registrations
       (path, canonical_path, device_id, inode_id, bound_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const transaction = database.transaction(() => {
    for (const { path } of paths) {
      if (exists.get(path)) continue
      try {
        const info = lstatSync(path, { bigint: true })
        if (info.isSymbolicLink() || !info.isDirectory()) continue
        const hasIdentity = info.dev !== 0n || info.ino !== 0n
        insert.run(
          path,
          realpathSync(path),
          hasIdentity ? info.dev.toString() : null,
          hasIdentity ? info.ino.toString() : null,
          nowEpochSeconds(),
        )
      } catch {
        // Missing/inaccessible legacy roots stay unbound and fail closed.
      }
    }
  })
  transaction.immediate()
}

/**
 * Get the database instance
 */
export function getDatabase() {
  if (maintenanceOwner)
    throw new Error(`Database is paused for bounded maintenance: ${maintenanceOwner}.`)
  if (!db) {
    return initDatabase()
  }
  return db
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    db = null
    console.log("[DB] Database connection closed")
  }
}

export function registerDatabaseMaintenanceParticipant(
  name: string,
  participant: { pause: () => void | Promise<void>; resume: () => void | Promise<void> },
): () => void {
  if (!name.trim() || maintenanceParticipants.has(name))
    throw new Error("Database maintenance participant must have a unique name.")
  maintenanceParticipants.set(name, participant)
  return () => maintenanceParticipants.delete(name)
}

export function beginDatabaseOperation(): () => void {
  if (maintenanceOwner)
    throw new Error(`Database is paused for bounded maintenance: ${maintenanceOwner}.`)
  return acquireAppDatabaseOperation(getDatabasePathUnsafe())
}

export async function withDatabaseOperation<T>(operation: () => T | Promise<T>): Promise<T> {
  const release = beginDatabaseOperation()
  try {
    return await operation()
  } finally {
    release()
  }
}

export async function beginDatabaseMaintenance(owner: string): Promise<void> {
  if (!owner.trim()) throw new Error("Database maintenance owner is required.")
  if (maintenanceOwner)
    throw new Error(`Database maintenance is already active: ${maintenanceOwner}.`)
  maintenanceOwner = owner
  const databasePath = getDatabasePathUnsafe()
  const paused: Array<{ resume: () => void | Promise<void> }> = []
  try {
    maintenanceAccessLease = beginDatabaseAccessMaintenance(databasePath, owner)
    await stopAndDrainUsageDaemon()
    for (const participant of maintenanceParticipants.values()) {
      await participant.pause()
      paused.push(participant)
    }
    await maintenanceAccessLease.waitForDrain()
    closeDatabase()
  } catch (error) {
    for (const participant of paused.reverse()) {
      try {
        await participant.resume()
      } catch (resumeError) {
        console.error("[DB] Failed to resume a maintenance participant:", resumeError)
      }
    }
    try {
      maintenanceAccessLease?.release()
      maintenanceAccessLease = null
      restartUsageDaemon()
    } finally {
      maintenanceOwner = null
    }
    throw error
  }
}

export async function endDatabaseMaintenance(owner: string): Promise<void> {
  if (maintenanceOwner !== owner) throw new Error("Database maintenance owner does not match.")
  let failure: unknown
  try {
    initializeDatabase(owner)
  } catch (error) {
    failure = error
  }
  for (const participant of [...maintenanceParticipants.values()].reverse()) {
    try {
      await participant.resume()
    } catch (error) {
      failure ??= error
    }
  }
  maintenanceOwner = null
  maintenanceAccessLease?.release()
  maintenanceAccessLease = null
  try {
    restartUsageDaemon()
  } catch (error) {
    failure ??= error
  }
  if (failure) throw failure
}

export function isDatabaseMaintenanceActive(): boolean {
  return maintenanceOwner !== null
}

async function stopAndDrainUsageDaemon(): Promise<void> {
  const configDir = dirname(getDatabasePathUnsafe())
  if (await stopInstalledUsageDaemon(configDir)) stoppedUsageDaemonConfigDir = configDir
}

function restartUsageDaemon(): void {
  const configDir = stoppedUsageDaemonConfigDir
  stoppedUsageDaemonConfigDir = null
  if (configDir) startInstalledUsageDaemon(configDir)
}

function getDatabasePathUnsafe(): string {
  const explicitPath = process.env.FLAPSTACK_DB_PATH
  const databasePath = explicitPath ?? join(app.getPath("userData"), "data", "agents.db")
  configureAppDatabasePath(databasePath)
  return databasePath
}

// Re-export schema for convenience
export * from "./schema"
