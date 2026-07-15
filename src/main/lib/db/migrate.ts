import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"

const STAGE3_MIGRATION_TAG = "0017_third_molecule_man"
const VOICE_ARTIFACT_MIGRATION_TAG = "0010_voice_artifacts"
const INITIAL_PROMPT_MIGRATION_TAG = "0020_silky_sphinx"
const STAGE3_TIMESTAMP_MIGRATION_TAG = "0023_stage3_timestamp_seconds"
const MULTI_AGENT_OPERATIONS_MIGRATION_TAG = "0035_multi_agent_operations"

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
  normalizeLateVoiceArtifactMigration(sqlite, migrationsFolder)
  // Drizzle wraps migrations in a transaction. SQLite ignores an in-migration
  // `PRAGMA foreign_keys=OFF`, so generated table rebuilds would otherwise run
  // cascading delete actions against durable child rows. Toggle before Drizzle
  // starts, restore on every path, then prove the rebuilt graph is intact.
  const foreignKeysEnabled = Boolean(sqlite.pragma("foreign_keys", { simple: true }))
  if (foreignKeysEnabled) sqlite.pragma("foreign_keys = OFF")
  try {
    normalizeLegacyStage3Migration(sqlite, migrationsFolder)
    normalizeInitialPromptMigration(sqlite, migrationsFolder)
    normalizeStage3TimestampMigration(sqlite, migrationsFolder)
    normalizeMultiAgentOperationsTransitionMigration(sqlite, migrationsFolder)
    migrate(database, { migrationsFolder })
    recoverLegacyQueuedRunPrompts(sqlite)
  } finally {
    if (foreignKeysEnabled) sqlite.pragma("foreign_keys = ON")
  }

  const violations = sqlite.pragma("foreign_key_check") as Array<Record<string, unknown>>
  if (violations.length > 0) {
    throw new Error(`Database migration left ${violations.length} foreign key violation(s).`)
  }
}

/**
 * Repairs supported Dev profiles that recorded an earlier in-place 0035 but
 * never received the transition table later required by the pending-run
 * scheduler. Replaying only the missing canonical statements is idempotent and
 * preserves every existing orchestration row.
 */
export function normalizeMultiAgentOperationsTransitionMigration(
  sqlite: Database.Database,
  migrationsFolder: string,
): boolean {
  if (!tableExists(sqlite, "__drizzle_migrations")) return false

  const journal = readJournal(migrationsFolder)
  const current = journal.entries.find(
    (entry) => entry.tag === MULTI_AGENT_OPERATIONS_MIGRATION_TAG,
  )
  if (!current) {
    throw new Error(`Missing ${MULTI_AGENT_OPERATIONS_MIGRATION_TAG} migration metadata.`)
  }
  if (!migrationRecorded(sqlite, current.when)) return false

  const statements = multiAgentTransitionStatements(migrationsFolder)
  const canonicalTableSql = statements[0]

  if (tableExists(sqlite, "orchestration_transition_events")) {
    if (!transitionAuthorityComplete(sqlite, canonicalTableSql)) {
      throw new Error("Recorded multi-agent transition authority is malformed or partial.")
    }
    return false
  }
  if (!tableExists(sqlite, "task_orchestrations") || !taskOrchestrationAuthorityComplete(sqlite)) {
    throw new Error(
      "Recorded multi-agent operations migration is missing task_orchestrations authority.",
    )
  }

  const repair = sqlite.transaction(() => {
    for (const statement of statements) sqlite.exec(statement)
  })
  repair.immediate()
  if (!transitionAuthorityComplete(sqlite, canonicalTableSql)) {
    throw new Error("Multi-agent transition authority repair did not produce canonical storage.")
  }
  return true
}

function taskOrchestrationAuthorityComplete(sqlite: Database.Database): boolean {
  const taskId = (
    sqlite.pragma("table_info('task_orchestrations')") as Array<{
      name: string
      type: string
      notnull: number
      pk: number
    }>
  ).find((column) => column.name === "task_id")
  return Boolean(
    taskId && taskId.type.toUpperCase() === "TEXT" && taskId.notnull === 1 && taskId.pk === 1,
  )
}

function multiAgentTransitionStatements(migrationsFolder: string): string[] {
  const migrationSql = readFileSync(
    join(migrationsFolder, `${MULTI_AGENT_OPERATIONS_MIGRATION_TAG}.sql`),
    "utf8",
  )
  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(
      (statement) =>
        statement.includes("CREATE TABLE `orchestration_transition_events`") ||
        statement.includes("CREATE UNIQUE INDEX `orchestration_transition_dedup_idx`") ||
        statement.includes("CREATE INDEX `orchestration_transition_task_order_idx`"),
    )
  if (statements.length !== 3) {
    throw new Error("Canonical multi-agent transition migration statements are incomplete.")
  }
  return statements
}

function transitionAuthorityComplete(
  sqlite: Database.Database,
  canonicalTableSql: string,
): boolean {
  const expectedColumns = [
    { name: "id", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
    { name: "dedup_key", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "task_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "entity_type", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "entity_id", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "agent_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
    { name: "run_id", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
    { name: "kind", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "phase", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
    { name: "summary", type: "TEXT", notnull: 0, dflt_value: null, pk: 0 },
    { name: "created_at", type: "INTEGER", notnull: 1, dflt_value: null, pk: 0 },
  ]
  const actualColumns = (
    sqlite.pragma("table_info('orchestration_transition_events')") as Array<{
      cid: number
      name: string
      type: string
      notnull: number
      dflt_value: unknown
      pk: number
    }>
  ).map(({ name, type, notnull, dflt_value, pk }) => ({
    name,
    type: type.toUpperCase(),
    notnull,
    dflt_value,
    pk,
  }))
  if (JSON.stringify(actualColumns) !== JSON.stringify(expectedColumns)) {
    return false
  }

  const foreignKeys = sqlite.pragma(
    "foreign_key_list('orchestration_transition_events')",
  ) as Array<{
    table: string
    from: string
    to: string
    on_update: string
    on_delete: string
  }>
  if (
    foreignKeys.length !== 1 ||
    foreignKeys[0].table !== "task_orchestrations" ||
    foreignKeys[0].from !== "task_id" ||
    foreignKeys[0].to !== "task_id" ||
    foreignKeys[0].on_update.toUpperCase() !== "NO ACTION" ||
    foreignKeys[0].on_delete.toUpperCase() !== "CASCADE"
  ) {
    return false
  }

  const indexes = new Map(
    (
      sqlite.pragma("index_list('orchestration_transition_events')") as Array<{
        name: string
        unique: number
      }>
    ).map((row) => [row.name, row.unique]),
  )
  if (
    indexes.get("orchestration_transition_dedup_idx") !== 1 ||
    indexes.get("orchestration_transition_task_order_idx") !== 0 ||
    indexColumns(sqlite, "orchestration_transition_dedup_idx").join(",") !== "dedup_key" ||
    indexColumns(sqlite, "orchestration_transition_task_order_idx").join(",") !==
      "task_id,created_at,id"
  ) {
    return false
  }

  const stored = sqlite
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get("orchestration_transition_events") as { sql: string } | undefined
  return Boolean(
    stored?.sql && normalizeSchemaSql(stored.sql) === normalizeSchemaSql(canonicalTableSql),
  )
}

function indexColumns(sqlite: Database.Database, name: string): string[] {
  return (sqlite.pragma(`index_info('${name}')`) as Array<{ seqno: number; name: string }>)
    .sort((left, right) => left.seqno - right.seqno)
    .map((row) => row.name)
}

function normalizeSchemaSql(sql: string): string {
  return sql.trim().replace(/;$/, "").replace(/\s+/g, " ")
}

/**
 * Stage 4 briefly shipped a different 0023 migration with a later timestamp.
 * Those profiles are already past the canonical Stage 3 0023 entry, so Drizzle
 * would skip its epoch-second repair. Apply and record the canonical migration
 * once before continuing with the stable Stage 4 0024-0030 chain.
 */
export function normalizeStage3TimestampMigration(
  sqlite: Database.Database,
  migrationsFolder: string,
): boolean {
  if (!tableExists(sqlite, "__drizzle_migrations")) return false

  const journal = readJournal(migrationsFolder)
  const current = journal.entries.find((entry) => entry.tag === STAGE3_TIMESTAMP_MIGRATION_TAG)
  if (!current) {
    throw new Error(`Missing ${STAGE3_TIMESTAMP_MIGRATION_TAG} migration metadata.`)
  }
  if (migrationRecorded(sqlite, current.when) || latestMigrationTime(sqlite) < current.when) {
    return false
  }

  applyMigration(sqlite, migrationsFolder, current)
  return true
}

/**
 * Migration 0010 was published after 0009 with an earlier journal timestamp.
 * Drizzle compares timestamps when upgrading an existing profile, so a
 * profile last opened on 0009 skips 0010 and later fails when 0014 alters the
 * missing voice_artifacts table. Apply and record 0010 before its dependents.
 */
export function normalizeLateVoiceArtifactMigration(
  sqlite: Database.Database,
  migrationsFolder: string,
): boolean {
  if (!tableExists(sqlite, "__drizzle_migrations")) return false

  const journal = readJournal(migrationsFolder)
  const current = journal.entries.find((entry) => entry.tag === VOICE_ARTIFACT_MIGRATION_TAG)
  if (!current) throw new Error(`Missing ${VOICE_ARTIFACT_MIGRATION_TAG} migration metadata.`)
  if (latestMigrationTime(sqlite) < current.when) return false

  const recorded = migrationRecorded(sqlite, current.when)
  const tablePresent = tableExists(sqlite, "voice_artifacts")
  if (recorded && tablePresent) return false

  const repair = sqlite.transaction(() => {
    if (!tablePresent) {
      const migrationSql = readFileSync(
        join(migrationsFolder, `${VOICE_ARTIFACT_MIGRATION_TAG}.sql`),
        "utf8",
      )
      for (const statement of migrationSql.split("--> statement-breakpoint")) {
        if (statement.trim()) sqlite.exec(statement)
      }
    }
    if (!recorded) recordMigration(sqlite, migrationsFolder, current)
  })
  repair.immediate()
  return true
}

/**
 * Repairs profiles where the 0020 ALTER landed but its journal row did not (or
 * vice versa). SQLite can commit DDL before an interrupted wrapper records the
 * migration, so checking only Drizzle's journal is not sufficient here.
 */
export function normalizeInitialPromptMigration(
  sqlite: Database.Database,
  migrationsFolder: string,
): boolean {
  if (!tableExists(sqlite, "__drizzle_migrations") || !tableExists(sqlite, "agent_runs"))
    return false

  const journal = readJournal(migrationsFolder)
  const current = journal.entries.find((entry) => entry.tag === INITIAL_PROMPT_MIGRATION_TAG)
  if (!current) throw new Error(`Missing ${INITIAL_PROMPT_MIGRATION_TAG} migration metadata.`)

  const runColumns = columns(sqlite, "agent_runs")
  const latest = latestMigrationTime(sqlite)
  if (latest >= current.when) {
    let changed = false
    const normalize = sqlite.transaction(() => {
      if (!runColumns.has("initial_prompt")) {
        sqlite.exec("ALTER TABLE agent_runs ADD initial_prompt text")
        changed = true
      }
      if (!migrationRecorded(sqlite, current.when)) {
        recordMigration(sqlite, migrationsFolder, current)
        changed = true
      }
    })
    normalize.immediate()
    return changed
  }
  if (!runColumns.has("initial_prompt")) return false

  // A partial 0020 profile still needs every preceding migration before 0020
  // is recorded as complete.
  let normalizedThrough = latest
  for (const entry of journal.entries) {
    if (entry.tag === current.tag) break
    if (entry.when <= normalizedThrough) continue
    applyMigration(sqlite, migrationsFolder, entry)
    normalizedThrough = Math.max(normalizedThrough, entry.when)
  }

  recordMigration(sqlite, migrationsFolder, current)
  return true
}

/**
 * Pre-0020 MCP queues stored prompts only as already-visible transcript rows.
 * Move those prompts into their durable run rows before routing, then remove
 * only the still-pending prompt message IDs. Both changes commit together so a
 * restart can never lose the prompt or publish it twice.
 */
export function recoverLegacyQueuedRunPrompts(sqlite: Database.Database): number {
  if (!columns(sqlite, "agent_runs").has("initial_prompt")) return 0

  let recovered = 0
  const repair = sqlite.transaction(() => {
    const rows = sqlite
      .prepare(
        `SELECT r.id, r.sub_chat_id, r.prompt_message_id, r.initial_prompt, s.messages
         FROM agent_runs r
         JOIN sub_chats s ON s.id = r.sub_chat_id
         WHERE r.status = 'pending'
           AND r.prompt_message_id LIKE 'mcp-%'
         ORDER BY r.sub_chat_id, r.started_at, r.id`,
      )
      .all() as Array<{
      id: string
      sub_chat_id: string
      prompt_message_id: string
      initial_prompt: string | null
      messages: string
    }>
    const grouped = new Map<string, typeof rows>()
    for (const row of rows) {
      const group = grouped.get(row.sub_chat_id) ?? []
      group.push(row)
      grouped.set(row.sub_chat_id, group)
    }

    for (const [subChatId, runs] of grouped) {
      let messages: Array<Record<string, unknown>>
      try {
        const parsed = JSON.parse(runs[0].messages) as unknown
        if (!Array.isArray(parsed)) continue
        messages = parsed as Array<Record<string, unknown>>
      } catch {
        continue
      }

      const removableIds = new Set<string>()
      for (const run of runs) {
        const message = messages.find((candidate) => candidate?.id === run.prompt_message_id)
        const storedPrompt = run.initial_prompt?.trim() ?? ""
        const recoveredPrompt = storedPrompt || extractPrompt(message)
        if (!recoveredPrompt) continue

        let changed = false
        if (!storedPrompt) {
          const updated = sqlite
            .prepare(
              `UPDATE agent_runs SET initial_prompt = ?
               WHERE id = ? AND status = 'pending'
                 AND (initial_prompt IS NULL OR trim(initial_prompt) = '')`,
            )
            .run(recoveredPrompt, run.id)
          changed = updated.changes === 1
        }
        if (message) {
          removableIds.add(run.prompt_message_id)
          changed = true
        }
        if (changed) recovered += 1
      }

      if (removableIds.size > 0) {
        sqlite
          .prepare("UPDATE sub_chats SET messages = ? WHERE id = ?")
          .run(
            JSON.stringify(messages.filter((message) => !removableIds.has(String(message?.id)))),
            subChatId,
          )
      }
    }
  })
  repair.immediate()
  return recovered
}

export function normalizeLegacyStage3Migration(
  sqlite: Database.Database,
  migrationsFolder: string,
): boolean {
  if (!tableExists(sqlite, "__drizzle_migrations")) return false

  const journal = readJournal(migrationsFolder)
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

function readJournal(migrationsFolder: string): Journal {
  return JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as Journal
}

function extractPrompt(message: Record<string, unknown> | undefined): string {
  if (!message || !Array.isArray(message.parts)) return ""
  return message.parts
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
      ),
    )
    .map((part) => part.text)
    .join("\n")
    .trim()
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

function migrationRecorded(sqlite: Database.Database, when: number): boolean {
  return Boolean(
    sqlite.prepare("SELECT 1 FROM __drizzle_migrations WHERE created_at = ? LIMIT 1").get(when),
  )
}

function recordMigration(
  sqlite: Database.Database,
  migrationsFolder: string,
  entry: { tag: string; when: number },
): void {
  const migrationSql = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), "utf8")
  const hash = createHash("sha256").update(migrationSql).digest("hex")
  sqlite
    .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
    .run(hash, entry.when)
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
