import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { app } from "electron"
import { join } from "path"
import { existsSync, mkdirSync } from "fs"
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
  if (process.env.FLAPSTACK_DB_PATH) return db

  // Run migrations
  const migrationsPath = getMigrationsPath()
  console.log(`[DB] Running migrations from: ${migrationsPath}`)

  try {
    migrate(db, { migrationsFolder: migrationsPath })
    console.log("[DB] Migrations completed")

    // No run can still be live before this process has created a harness.
    // Reconcile rows left behind by a crash or forced shutdown so the UI does
    // not display an endless run after restart.
    const interruptedAt = new Date()
    const tableExists = (name: string) =>
      Boolean(
        sqlite
          ?.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
          .get(name),
      )
    const cancelledRuns = tableExists("agent_runs")
      ? db
          .update(schema.agentRuns)
          .set({ status: "cancelled", completedAt: interruptedAt })
          .where(eq(schema.agentRuns.status, "running"))
          .run().changes
      : 0
    const cancelledChats = tableExists("sub_chats")
      ? db
          .update(schema.subChats)
          .set({ runStatus: "cancelled", updatedAt: interruptedAt })
          .where(eq(schema.subChats.runStatus, "running"))
          .run().changes
      : 0
    if (cancelledRuns || cancelledChats) {
      console.log(
        `[DB] Reconciled interrupted agent state: ${cancelledRuns} runs, ${cancelledChats} chats`,
      )
    }
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
