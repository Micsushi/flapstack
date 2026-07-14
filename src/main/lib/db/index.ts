import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { app } from "electron"
import { join } from "path"
import { existsSync, lstatSync, mkdirSync, realpathSync } from "fs"
import { migrateDatabase } from "./migrate"
import { recoverPendingAllChatPermissionChange } from "../permissions"
import * as schema from "./schema"
import { nowEpochSeconds } from "./timestamps"

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqlite: Database.Database | null = null

/**
 * Get the database path in the app's user data directory
 */
export function getDatabasePath(): string {
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
  if (db) {
    return db
  }

  const dbPath = getDatabasePath()
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

// Re-export schema for convenience
export * from "./schema"
