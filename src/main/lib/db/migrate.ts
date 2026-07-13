import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"

const STAGE3_MIGRATION_TAG = "0017_third_molecule_man"

type Journal = {
  entries: Array<{ tag: string; when: number }>
}

/**
 * Runs the current migration chain while accepting profiles that briefly ran
 * the pre-rebase, multi-file Stage 3 migration sequence.
 */
export function migrateDatabase(
  database: Parameters<typeof migrate>[0],
  sqlite: Database.Database,
  migrationsFolder: string,
): void {
  normalizeLegacyStage3Migration(sqlite, migrationsFolder)
  migrate(database, { migrationsFolder })
}

export function normalizeLegacyStage3Migration(
  sqlite: Database.Database,
  migrationsFolder: string,
): boolean {
  if (!tableExists(sqlite, "__drizzle_migrations")) return false

  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as Journal
  const current = journal.entries.find((entry) => entry.tag === STAGE3_MIGRATION_TAG)
  if (!current) throw new Error(`Missing ${STAGE3_MIGRATION_TAG} migration metadata.`)

  const chatColumns = columns(sqlite, "chats")
  const hasLegacyStage3State =
    tableExists(sqlite, "mcp_audit_records") ||
    tableExists(sqlite, "mcp_approval_requests") ||
    [
      "custom_permissions",
      "mcp_exposure_enabled",
      "parent_chat_id",
      "initiator_chat_id",
      "parent_run_id",
      "ancestor_chat_ids",
    ].some((column) => chatColumns.has(column))
  if (!hasLegacyStage3State) return false

  let latest = latestMigrationTime(sqlite)
  if (latest >= current.when) {
    const repair = sqlite.transaction(() => {
      ensureAuditStorage(sqlite)
      ensureApprovalStorage(sqlite)
      ensureChatColumns(sqlite, chatColumns)
    })
    repair()
    return false
  }

  // Old Stage 3 branches briefly had migrations 0017-0021 before newer main
  // migration 0016 landed. Apply any missing main-era entries first so marking
  // the consolidated Stage 3 migration cannot skip them.
  for (const entry of journal.entries) {
    if (entry.tag === current.tag) break
    if (entry.when <= latest) continue
    applyMigration(sqlite, migrationsFolder, entry)
    latest = Math.max(latest, entry.when)
  }

  const migrationSql = readFileSync(join(migrationsFolder, `${current.tag}.sql`), "utf8")
  const hash = createHash("sha256").update(migrationSql).digest("hex")
  const normalize = sqlite.transaction(() => {
    ensureAuditStorage(sqlite)
    ensureApprovalStorage(sqlite)
    ensureChatColumns(sqlite, chatColumns)
    sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run(hash, current.when)
  })
  normalize()
  return true
}

function ensureChatColumns(sqlite: Database.Database, chatColumns: Set<string>): void {
  addColumn(sqlite, "chats", chatColumns, "custom_permissions", "text")
  addColumn(sqlite, "chats", chatColumns, "mcp_exposure_enabled", "integer DEFAULT false NOT NULL")
  addColumn(sqlite, "chats", chatColumns, "parent_chat_id", "text")
  addColumn(sqlite, "chats", chatColumns, "initiator_chat_id", "text")
  addColumn(sqlite, "chats", chatColumns, "parent_run_id", "text")
  addColumn(sqlite, "chats", chatColumns, "ancestor_chat_ids", "text")
}

function latestMigrationTime(sqlite: Database.Database): number {
  const row = sqlite
    .prepare("SELECT max(created_at) created_at FROM __drizzle_migrations")
    .get() as { created_at: number | null }
  return row.created_at ?? 0
}

function applyMigration(
  sqlite: Database.Database,
  migrationsFolder: string,
  entry: { tag: string; when: number },
): void {
  const sql = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), "utf8")
  const hash = createHash("sha256").update(sql).digest("hex")
  const apply = sqlite.transaction(() => {
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement)
    }
    sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run(hash, entry.when)
  })
  apply()
}

function ensureAuditStorage(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS mcp_audit_records (
      id text PRIMARY KEY NOT NULL,
      invocation_id text NOT NULL,
      status text NOT NULL,
      caller_chat_id text NOT NULL,
      caller_run_id text,
      tool_name text NOT NULL,
      tier integer NOT NULL,
      caller_snapshot text NOT NULL,
      chat_snapshot text NOT NULL,
      run_snapshot text NOT NULL,
      input_summary text NOT NULL,
      result_summary text NOT NULL,
      duration_ms integer NOT NULL,
      created_at integer
    )
  `)
  const auditColumns = columns(sqlite, "mcp_audit_records")
  addColumn(sqlite, "mcp_audit_records", auditColumns, "invocation_id", "text NOT NULL DEFAULT ''")
  addColumn(sqlite, "mcp_audit_records", auditColumns, "duration_ms", "integer NOT NULL DEFAULT 0")
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS mcp_audit_records_created_at_idx ON mcp_audit_records (created_at);
    CREATE INDEX IF NOT EXISTS mcp_audit_records_caller_chat_id_idx ON mcp_audit_records (caller_chat_id);
    CREATE INDEX IF NOT EXISTS mcp_audit_records_tool_name_idx ON mcp_audit_records (tool_name);
    CREATE INDEX IF NOT EXISTS mcp_audit_records_status_idx ON mcp_audit_records (status);
    CREATE INDEX IF NOT EXISTS mcp_audit_records_invocation_id_idx ON mcp_audit_records (invocation_id);
    CREATE TRIGGER IF NOT EXISTS mcp_audit_records_no_update
    BEFORE UPDATE ON mcp_audit_records
    BEGIN
      SELECT RAISE(ABORT, 'mcp_audit_records is append-only');
    END;
    CREATE TRIGGER IF NOT EXISTS mcp_audit_records_no_delete
    BEFORE DELETE ON mcp_audit_records
    BEGIN
      SELECT RAISE(ABORT, 'mcp_audit_records is append-only');
    END;
  `)
}

function ensureApprovalStorage(sqlite: Database.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS mcp_approval_requests (
      id text PRIMARY KEY NOT NULL,
      invocation_id text NOT NULL,
      caller_chat_id text NOT NULL,
      caller_run_id text,
      tool_name text NOT NULL,
      tier integer NOT NULL,
      target_summary text NOT NULL,
      input_summary text NOT NULL,
      decision text,
      grant_session integer DEFAULT false NOT NULL,
      created_at integer NOT NULL,
      expires_at integer NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mcp_approval_requests_pending_idx
      ON mcp_approval_requests (decision, expires_at);
    CREATE INDEX IF NOT EXISTS mcp_approval_requests_chat_id_idx
      ON mcp_approval_requests (caller_chat_id);
  `)
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  return Boolean(
    sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(name),
  )
}

function columns(sqlite: Database.Database, table: string): Set<string> {
  if (!tableExists(sqlite, table)) return new Set()
  return new Set(
    (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )
}

function addColumn(
  sqlite: Database.Database,
  table: string,
  existing: Set<string>,
  column: string,
  definition: string,
): void {
  if (existing.has(column)) return
  sqlite.exec(`ALTER TABLE ${table} ADD ${column} ${definition}`)
  existing.add(column)
}
