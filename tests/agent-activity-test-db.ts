import Database from "better-sqlite3"
import {
  applyActivityMigration,
  applyRuntimeMigration,
  createLegacyRuntimeDatabase,
  seedRuntimeRun,
} from "./agent-runtime-test-db"

export function createActivityTestDatabase(filename = ":memory:"): Database.Database {
  const database = createLegacyRuntimeDatabase(filename)
  applyRuntimeMigration(database)
  applyActivityMigration(database)
  database.pragma("foreign_keys = ON")
  return database
}

export { seedRuntimeRun }
