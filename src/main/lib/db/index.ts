import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { app } from "electron"
import { join } from "path"
import { existsSync, mkdirSync } from "fs"
import { migrateDatabase } from "./migrate"
import { recoverPendingAllChatPermissionChange } from "../permissions"
import * as schema from "./schema"

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

  // Create SQLite connection
  sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  // The background usage daemon can write this same DB while the app is open.
  sqlite.pragma("busy_timeout = 5000")

  // Create Drizzle instance
  db = drizzle(sqlite, { schema })

  // The Electron app owns migrations. Headless MCP children receive its already
  // migrated database explicitly and must not depend on Electron runtime state.
  if (process.env.FLAPSTACK_DB_PATH) {
    recoverPendingAllChatPermissionChange(sqlite)
    return db
  }

  // Run migrations
  const migrationsPath = getMigrationsPath()
  console.log(`[DB] Running migrations from: ${migrationsPath}`)

  try {
    migrateDatabase(db, sqlite, migrationsPath)
    recoverPendingAllChatPermissionChange(sqlite)
    console.log("[DB] Migrations completed")
  } catch (error) {
    console.error("[DB] Migration error:", error)
    throw error
  }

  return db
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
