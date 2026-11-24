import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { eq } from "drizzle-orm"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  migrateDatabase,
  normalizeRelocatedMobilePairingIdentityMigration,
} from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import { recoverInterruptedMcpRuns } from "../src/main/lib/run-launch-service"

const sourceMigrations = resolve(process.cwd(), "drizzle")
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("SQLite profile upgrade and recovery", () => {
  it("reopens a 0.1.3 profile through 0.1.4 and 0.1.5 without losing chat or Records data", () => {
    const { directory, path, sqlite } = database("release-upgrade")
    const transcript = JSON.stringify([
      { id: "prompt", role: "user", parts: [{ type: "text", text: "Keep this exchange" }] },
    ])
    try {
      const migrations013 = migrationSubset(directory, 78)
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, migrations013)
      sqlite.exec(
        "INSERT INTO chats (id, name, scope, harness) VALUES ('chat', 'Existing chat', 'global', 'codex')",
      )
      sqlite
        .prepare(
          "INSERT INTO sub_chats (id, chat_id, harness, session_id, messages) VALUES (?, ?, ?, ?, ?)",
        )
        .run("conversation", "chat", "codex", "native-thread", transcript)
    } finally {
      sqlite.close()
    }

    const sqlite014 = new Database(path)
    try {
      sqlite014.pragma("foreign_keys = ON")
      const migrations014 = migrationSubset(directory, 80)
      migrateDatabase(drizzle(sqlite014, { schema }), sqlite014, migrations014)
      sqlite014
        .prepare("UPDATE sub_chats SET reasoning_effort = 'high' WHERE id = ?")
        .run("conversation")
      sqlite014
        .prepare(
          `INSERT INTO record_chat_links
           (chat_id, store_identity, record_path, record_id, canonical_project_id, source_revision)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run("chat", "test-store", "projects/example/task.md", "task", "example", "1")
    } finally {
      sqlite014.close()
    }

    const current = new Database(path)
    try {
      current.pragma("foreign_keys = ON")
      const db = drizzle(current, { schema })
      migrateDatabase(db, current, sourceMigrations)
      const row = () =>
        current
          .prepare(
            `SELECT chats.name, session_id, messages, sub_chats.reasoning_effort, record_id, codex_rewind_intent
             FROM chats JOIN sub_chats ON sub_chats.chat_id = chats.id
             JOIN record_chat_links ON record_chat_links.chat_id = chats.id
             WHERE chats.id = 'chat'`,
          )
          .get()
      const expected = {
        name: "Existing chat",
        session_id: "native-thread",
        messages: transcript,
        reasoning_effort: "high",
        record_id: "task",
        codex_rewind_intent: null,
      }
      expect(row()).toEqual(expected)
      current
        .prepare("UPDATE sub_chats SET codex_rewind_intent = ? WHERE id = ?")
        .run("pending-rewind", "conversation")
      expect(() =>
        current.prepare("UPDATE sub_chats SET messages = '[]' WHERE id = ?").run("conversation"),
      ).toThrow(/unconfirmed Codex rewind/)
      const migrationCount = current
        .prepare("SELECT count(*) FROM __drizzle_migrations")
        .pluck()
        .get()
      migrateDatabase(db, current, sourceMigrations)
      expect(current.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get()).toBe(
        migrationCount,
      )
      expect(row()).toEqual({ ...expected, codex_rewind_intent: "pending-rewind" })
      expect(current.pragma("foreign_key_check")).toEqual([])
      expect(current.pragma("quick_check", { simple: true })).toBe("ok")
    } finally {
      current.close()
    }
  })

  it("builds a fresh profile with safe defaults and append-only audit", async () => {
    const { path, sqlite } = database("fresh")
    try {
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)
      sqlite
        .prepare(
          "INSERT INTO chats (id, name, scope, permission_mode) VALUES ('fresh-chat', 'Fresh', 'global', 'read-only')",
        )
        .run()

      expectStage3Schema(sqlite, "fresh-chat")
      expect(await recoverInterruptedMcpRuns(path)).toBe(0)
    } finally {
      sqlite.close()
    }
  })

  it("replays the two migrations shadowed in the November Preview exactly once", () => {
    const { sqlite, directory } = database("november-preview")
    try {
      const db = drizzle(sqlite, { schema })
      migrate(db, { migrationsFolder: migrationSubset(directory, 76) })
      const legacy = [
        ["0077_run_timings", "ae85a9ca097369dcd9f9b02b9b5a56bf6e2617ac0358193cba7ca3ec118b1563"],
        [
          "0078_retired_codex_selections",
          "6e9ea433a477ef0be2de5902f1360943005a2d8ac6c0d84d693dfcd05a603bb4",
        ],
      ] as const
      for (const [tag, hash] of legacy) {
        sqlite
          .prepare("INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)")
          .run(hash, migrationEntry(tag).when)
      }
      sqlite.exec(
        "INSERT INTO chats(id,scope,harness,model) VALUES ('prior','global','codex','gpt-5.5/high')",
      )

      migrateDatabase(db, sqlite, sourceMigrations)
      migrateDatabase(db, sqlite, sourceMigrations)

      expect(sqlite.prepare("SELECT model FROM chats WHERE id='prior'").get()).toEqual({
        model: "gpt-5.6-sol/high",
      })
      expect(sqlite.prepare("SELECT sdk_message_uuid FROM checkpoints").all()).toEqual([])
      expect(tableNames(sqlite)).toContain("agent_run_timing_marks")
      for (const [tag, hash] of legacy) {
        expect(
          sqlite
            .prepare("SELECT hash FROM __drizzle_migrations WHERE created_at=? ORDER BY rowid")
            .all(migrationEntry(tag).when),
        ).toEqual([{ hash }, { hash: migrationHash(tag) }])
      }
    } finally {
      sqlite.close()
    }
  })

  it("repairs the relocated canonical mobile identity migration without skipping work", () => {
    const { sqlite, directory } = database("relocated-mobile-identity")
    try {
      migrate(drizzle(sqlite, { schema }), {
        migrationsFolder: migrationSubset(directory, 41),
      })
      installRelocatedMobileIdentityMigration(sqlite)
      sqlite
        .prepare(
          `INSERT INTO mobile_devices
             (id, name, public_key_algorithm, public_key, public_key_fingerprint, created_at)
           VALUES ('preserved-device', 'Preserved', 'Ed25519', 'key', 'fingerprint', 1)`,
        )
        .run()

      expect(normalizeRelocatedMobilePairingIdentityMigration(sqlite, sourceMigrations)).toBe(true)
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)
      expect(normalizeRelocatedMobilePairingIdentityMigration(sqlite, sourceMigrations)).toBe(false)

      expect(tableNames(sqlite)).toEqual(
        expect.arrayContaining([
          "project_vault_graph_nodes",
          "visual_artifacts",
          "mobile_auth_challenges",
          "mobile_event_log",
          "chat_waits",
        ]),
      )
      expect(
        sqlite.prepare("SELECT name FROM mobile_devices WHERE id = ?").get("preserved-device"),
      ).toEqual({ name: "Preserved" })
      const current = migrationEntry("0047_mobile_pairing_identity")
      expect(
        sqlite
          .prepare("SELECT hash, created_at FROM __drizzle_migrations WHERE hash = ?")
          .all(migrationHash(current.tag)),
      ).toEqual([{ hash: migrationHash(current.tag), created_at: current.when }])
    } finally {
      sqlite.close()
    }
  })

  it("fails closed for malformed relocated mobile identity authority", () => {
    const { sqlite, directory } = database("malformed-relocated-mobile-identity")
    try {
      migrate(drizzle(sqlite, { schema }), {
        migrationsFolder: migrationSubset(directory, 41),
      })
      installRelocatedMobileIdentityMigration(sqlite)
      sqlite.exec("DROP INDEX mobile_auth_challenges_hash_idx")

      expect(() =>
        normalizeRelocatedMobilePairingIdentityMigration(sqlite, sourceMigrations),
      ).toThrow(/malformed or partial authority/i)
      expect(tableNames(sqlite)).not.toContain("project_vault_graph_nodes")
      expect(
        sqlite
          .prepare("SELECT count(*) count FROM __drizzle_migrations WHERE created_at = ?")
          .get(migrationEntry("0047_mobile_pairing_identity").when),
      ).toEqual({ count: 0 })
    } finally {
      sqlite.close()
    }
  })

  it("recovers legacy pending prompts transactionally from a pre-0020 profile", () => {
    const { sqlite, directory } = database("queued-prompts")
    try {
      migrate(drizzle(sqlite, { schema }), {
        migrationsFolder: migrationSubset(directory, 19),
      })
      seedLegacyQueuedPrompts(sqlite)

      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)
      expectRecoveredQueuedPrompts(sqlite)
      const messagesAfterFirstRepair = sqlite
        .prepare("SELECT messages FROM sub_chats WHERE id = 'legacy-queue-sub'")
        .get()

      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)
      expectRecoveredQueuedPrompts(sqlite)
      expect(
        sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'legacy-queue-sub'").get(),
      ).toEqual(messagesAfterFirstRepair)
    } finally {
      sqlite.close()
    }
  })

  it("repairs millisecond and text timestamps before Drizzle reads shared rows", () => {
    const { sqlite, directory } = database("timestamp-units")
    try {
      migrate(drizzle(sqlite, { schema }), {
        migrationsFolder: migrationSubset(directory, 22),
      })
      const milliseconds = Date.UTC(2026, 6, 14, 12, 0, 0)
      sqlite
        .prepare(
          `INSERT INTO projects (id, name, path, created_at, updated_at, pinned_at)
           VALUES ('timestamp-project', 'Timestamp', '/tmp/timestamp', ?, '2026-07-14 12:00:00', ?)`,
        )
        .run(milliseconds, milliseconds)
      sqlite
        .prepare(
          `INSERT INTO tasks (id, project_id, name, created_at, updated_at)
           VALUES ('timestamp-task', 'timestamp-project', 'Task', ?, ?)`,
        )
        .run(milliseconds, milliseconds)
      sqlite
        .prepare(
          `INSERT INTO chats (
             id, name, scope, project_id, task_id, permission_mode, created_at, updated_at
           ) VALUES (
             'timestamp-chat', 'Chat', 'task', 'timestamp-project', 'timestamp-task',
             'read-only', ?, '2026-07-14 12:00:00'
           )`,
        )
        .run(milliseconds)
      sqlite
        .prepare(
          `INSERT INTO mcp_audit_records (
             id, invocation_id, status, caller_chat_id, tool_name, tier, caller_snapshot,
             chat_snapshot, run_snapshot, input_summary, result_summary, duration_ms, created_at
           ) VALUES (
             'timestamp-audit', 'timestamp-invocation', 'completed', 'timestamp-chat',
             'ping', 0, '{}', '{}', '{}', '{}', '{}', 1, NULL
           )`,
        )
        .run()

      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)

      expect(
        sqlite
          .prepare(
            `SELECT typeof(created_at) created_type, created_at, typeof(updated_at) updated_type,
              updated_at, pinned_at FROM projects WHERE id = 'timestamp-project'`,
          )
          .get(),
      ).toEqual({
        created_type: "integer",
        created_at: 1784030400,
        updated_type: "integer",
        updated_at: 1784030400,
        pinned_at: 1784030400,
      })
      const chat = drizzle(sqlite, { schema })
        .select()
        .from(schema.chats)
        .where(eq(schema.chats.id, "timestamp-chat"))
        .get()
      expect(chat?.updatedAt?.toISOString()).toBe("2026-07-14T12:00:00.000Z")
      expect(
        sqlite
          .prepare("SELECT typeof(created_at) type FROM mcp_audit_records WHERE id = ?")
          .get("timestamp-audit"),
      ).toEqual({ type: "integer" })
      expect(() =>
        sqlite
          .prepare("UPDATE mcp_audit_records SET status = 'failed' WHERE id = ?")
          .run("timestamp-audit"),
      ).toThrow(/append-only/)
    } finally {
      sqlite.close()
    }
  })
})

function database(name: string): {
  directory: string
  path: string
  sqlite: Database.Database
} {
  const directory = mkdtempSync(join(tmpdir(), `flapstack-stage3-${name}-`))
  directories.push(directory)
  const path = join(directory, "agents.db")
  const sqlite = new Database(path)
  sqlite.pragma("foreign_keys = ON")
  return { directory, path, sqlite }
}

function migrationSubset(directory: string, lastIndex: number): string {
  const target = join(directory, `migrations-through-${lastIndex}`)
  mkdirSync(join(target, "meta"), { recursive: true })
  const journal = JSON.parse(
    readFileSync(join(sourceMigrations, "meta", "_journal.json"), "utf8"),
  ) as {
    version: string
    dialect: string
    entries: Array<{ idx: number; tag: string }>
  }
  const subset = { ...journal, entries: journal.entries.filter((entry) => entry.idx <= lastIndex) }
  writeFileSync(join(target, "meta", "_journal.json"), `${JSON.stringify(subset, null, 2)}\n`)
  for (const entry of subset.entries) {
    cpSync(join(sourceMigrations, `${entry.tag}.sql`), join(target, `${entry.tag}.sql`))
  }
  return target
}

function preSyncStage4MigrationSubset(directory: string, lastIndex: number): string {
  const target = join(directory, `pre-sync-stage4-through-${lastIndex}`)
  mkdirSync(join(target, "meta"), { recursive: true })
  const journal = JSON.parse(
    readFileSync(join(sourceMigrations, "meta", "_journal.json"), "utf8"),
  ) as {
    version: string
    dialect: string
    entries: Array<{
      idx: number
      version: string
      when: number
      tag: string
      breakpoints: boolean
    }>
  }
  const entries = [
    ...journal.entries.filter((entry) => entry.idx <= 22),
    {
      ...journal.entries.find((entry) => entry.idx === 23)!,
      when: 1784010172812,
      tag: "0023_equal_zzzax",
    },
    ...journal.entries
      .filter((entry) => entry.idx >= 26 && entry.idx <= lastIndex + 2)
      .map((entry) => ({
        ...entry,
        idx: entry.idx - 2,
        tag: renumberMigrationTag(entry.tag, -2),
      })),
  ]
  writeFileSync(
    join(target, "meta", "_journal.json"),
    `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
  )

  for (const entry of entries) {
    if (entry.idx === 23) {
      writeFileSync(join(target, `${entry.tag}.sql`), PRE_SYNC_STAGE4_0023_SQL)
      continue
    }
    const currentTag = entry.idx >= 24 ? renumberMigrationTag(entry.tag, 2) : entry.tag
    const sql = readFileSync(join(sourceMigrations, `${currentTag}.sql`), "utf8")
    if (entry.idx === 24) {
      const taskProposalStart = sql.indexOf("CREATE TABLE `task_proposals`")
      if (taskProposalStart < 0) throw new Error("Missing Stage 4 0024 task proposal SQL")
      writeFileSync(join(target, `${entry.tag}.sql`), sql.slice(taskProposalStart))
      continue
    }
    writeFileSync(join(target, `${entry.tag}.sql`), sql)
  }
  return target
}

function renumberMigrationTag(tag: string, offset: number): string {
  const match = /^(\d{4})(_.+)$/.exec(tag)
  if (!match) throw new Error(`Invalid migration tag: ${tag}`)
  return `${String(Number(match[1]) + offset).padStart(4, "0")}${match[2]}`
}

const PRE_SYNC_STAGE4_0023_SQL = `CREATE TABLE \`project_vault_policies\` (
  \`project_id\` text PRIMARY KEY NOT NULL,
  \`location_mode\` text DEFAULT 'app-managed' NOT NULL,
  \`central_path\` text NOT NULL,
  \`project_owned_path\` text,
  \`git_tracking_enabled\` integer DEFAULT false NOT NULL,
  \`portability_mode\` text DEFAULT 'export-required' NOT NULL,
  \`worktree_mode\` text DEFAULT 'shared-across-worktrees' NOT NULL,
  \`deletion_mode\` text DEFAULT 'retain-until-explicit-delete' NOT NULL,
  \`created_at\` integer,
  \`updated_at\` integer,
  FOREIGN KEY (\`project_id\`) REFERENCES \`projects\`(\`id\`) ON UPDATE no action ON DELETE cascade
);\n`

function seedPreSyncStage4Data(sqlite: Database.Database, lastMigration: number): void {
  const milliseconds = Date.UTC(2026, 6, 14, 12, 0, 0)
  sqlite
    .prepare(
      `INSERT INTO projects (id, name, path, created_at, updated_at)
       VALUES ('stage4-project', 'Stage 4', '/tmp/stage4', ?, ?)`,
    )
    .run(milliseconds, milliseconds)
  sqlite
    .prepare(
      `INSERT INTO project_vault_policies (
        project_id, central_path, created_at, updated_at
      ) VALUES ('stage4-project', '/tmp/stage4-vault', ?, ?)`,
    )
    .run(milliseconds, milliseconds)

  if (lastMigration >= 24) {
    sqlite
      .prepare(
        `INSERT INTO task_proposals (
          id, project_id, proposed_by_chat_id, name, created_at, updated_at
        ) VALUES ('stage4-proposal', 'stage4-project', 'stage4-chat', 'Keep me', ?, ?)`,
      )
      .run(milliseconds, milliseconds)
  }
  if (lastMigration >= 25) {
    sqlite
      .prepare(
        `INSERT INTO project_vaults (project_id, root_path, created_at, updated_at)
         VALUES ('stage4-project', '/tmp/stage4-vault', ?, ?)`,
      )
      .run(milliseconds, milliseconds)
  }
  if (lastMigration >= 26) {
    sqlite
      .prepare(
        `INSERT INTO plan_source_registrations (
          id, project_id, relative_path, created_at, updated_at
        ) VALUES ('stage4-plan', 'stage4-project', 'PLAN.md', ?, ?)`,
      )
      .run(milliseconds, milliseconds)
  }
  if (lastMigration >= 29) {
    sqlite
      .prepare(
        `INSERT INTO usage_budgets (
          id, name, scope_type, threshold_type, threshold_value, action, created_at, updated_at
        ) VALUES (
          'stage4-budget', 'Budget', 'global', 'total-tokens', 1000, 'soft-alert', ?, ?
        )`,
      )
      .run(milliseconds, milliseconds)
  }
  if (lastMigration >= 30) {
    sqlite
      .prepare(
        `INSERT INTO extension_enablement_policies (
          extension_id, harness, kind, native_scope, scope_type, scope_id, enabled,
          created_at, updated_at
        ) VALUES ('stage4-extension', 'codex', 'skill', 'user', 'user', 'user', 1, ?, ?)`,
      )
      .run(milliseconds, milliseconds)
  }
}

function expectStage4Data(sqlite: Database.Database, lastMigration: number): void {
  expect(tableNames(sqlite)).toEqual(
    expect.arrayContaining([
      "project_vault_policies",
      "task_proposals",
      "project_vaults",
      "plan_source_registrations",
      "automation_executions",
      "usage_budgets",
      "extension_enablement_policies",
    ]),
  )
  expect(sqlite.prepare("SELECT central_path FROM project_vault_policies").all()).toEqual([
    { central_path: "/tmp/stage4-vault" },
  ])
  if (lastMigration >= 24) {
    expect(sqlite.prepare("SELECT name FROM task_proposals").all()).toEqual([{ name: "Keep me" }])
  }
  if (lastMigration >= 25) {
    expect(sqlite.prepare("SELECT root_path FROM project_vaults").all()).toEqual([
      { root_path: "/tmp/stage4-vault" },
    ])
  }
  if (lastMigration >= 26) {
    expect(sqlite.prepare("SELECT relative_path FROM plan_source_registrations").all()).toEqual([
      { relative_path: "PLAN.md" },
    ])
  }
  if (lastMigration >= 29) {
    expect(sqlite.prepare("SELECT name FROM usage_budgets").all()).toEqual([{ name: "Budget" }])
  }
  if (lastMigration >= 30) {
    expect(sqlite.prepare("SELECT extension_id FROM extension_enablement_policies").all()).toEqual([
      { extension_id: "stage4-extension" },
    ])
  }
}

function expectStage3Schema(sqlite: Database.Database, chatId: string): void {
  expect(
    sqlite
      .prepare("SELECT mcp_exposure_enabled, custom_permissions FROM chats WHERE id = ?")
      .get(chatId),
  ).toEqual({ mcp_exposure_enabled: 0, custom_permissions: null })
  expect(tableNames(sqlite)).toEqual(
    expect.arrayContaining([
      "filesystem_root_registrations",
      "mcp_approval_requests",
      "mcp_audit_records",
      "task_orchestrations",
      "orchestration_agents",
    ]),
  )
  expect(columns(sqlite, "task_orchestrations")).toEqual(
    expect.arrayContaining(["max_parallel_agents", "stop_conditions", "blocker_count"]),
  )
  expect(columns(sqlite, "orchestration_agents")).toEqual(
    expect.arrayContaining([
      "ancestor_agent_ids",
      "dependency_agent_ids",
      "cost_quality",
      "blocker_count",
    ]),
  )
  expect(triggerNames(sqlite)).toEqual(
    expect.arrayContaining(["mcp_audit_records_no_update", "mcp_audit_records_no_delete"]),
  )
  const auditId = `append-only-${chatId}`
  sqlite
    .prepare(
      `INSERT INTO mcp_audit_records (
        id, invocation_id, status, caller_chat_id, tool_name, tier,
        caller_snapshot, chat_snapshot, run_snapshot, input_summary,
        result_summary, duration_ms
      ) VALUES (?, ?, 'completed', ?, 'ping', 0, '{}', '{}', '{}', '{}', '{}', 0)`,
    )
    .run(auditId, auditId, chatId)
  expect(() => sqlite.prepare("DELETE FROM mcp_audit_records WHERE id = ?").run(auditId)).toThrow(
    /append-only/i,
  )
}

function seedLegacyQueuedPrompts(sqlite: Database.Database): void {
  sqlite
    .prepare(
      `INSERT INTO chats (id, name, scope, permission_mode, harness, worktree_path)
       VALUES ('legacy-queue-chat', 'Legacy queue', 'global', 'full-access', 'codex', '/tmp')`,
    )
    .run()
  const messages = [
    { id: "history", role: "assistant", parts: [{ type: "text", text: "History" }] },
    { id: "mcp-legacy-a", role: "user", parts: [{ type: "text", text: "A" }] },
    { id: "mcp-legacy-b", role: "user", parts: [{ type: "text", text: "B" }] },
    { id: "mcp-finished", role: "user", parts: [{ type: "text", text: "Finished" }] },
    { id: "ordinary-pending", role: "user", parts: [{ type: "text", text: "Ordinary" }] },
  ]
  sqlite
    .prepare(
      `INSERT INTO sub_chats (
        id, chat_id, harness, permission_mode, worktree_path, run_status, messages
       ) VALUES ('legacy-queue-sub', 'legacy-queue-chat', 'codex', 'full-access', '/tmp',
         'pending', ?)`,
    )
    .run(JSON.stringify(messages))
  const insert = sqlite.prepare(
    `INSERT INTO agent_runs (
      id, chat_id, sub_chat_id, harness, permission_mode, worktree_path,
      prompt_message_id, status, started_at
    ) VALUES (?, 'legacy-queue-chat', 'legacy-queue-sub', 'codex', 'full-access', '/tmp', ?, ?, ?)`,
  )
  insert.run("legacy-a", "mcp-legacy-a", "pending", 1)
  insert.run("legacy-b", "mcp-legacy-b", "pending", 2)
  insert.run("legacy-finished", "mcp-finished", "success", 3)
  insert.run("ordinary-queued", "ordinary-pending", "pending", 4)
}

function expectRecoveredQueuedPrompts(sqlite: Database.Database): void {
  expect(
    sqlite.prepare("SELECT id, initial_prompt FROM agent_runs ORDER BY started_at").all(),
  ).toEqual([
    { id: "legacy-a", initial_prompt: "A" },
    { id: "legacy-b", initial_prompt: "B" },
    { id: "legacy-finished", initial_prompt: null },
    { id: "ordinary-queued", initial_prompt: null },
  ])
  const row = sqlite
    .prepare("SELECT messages FROM sub_chats WHERE id = 'legacy-queue-sub'")
    .get() as { messages: string }
  expect(JSON.parse(row.messages).map((message: { id: string }) => message.id)).toEqual([
    "history",
    "mcp-finished",
    "ordinary-pending",
  ])
}

function expectCanonicalInitialPromptMigration(sqlite: Database.Database): void {
  const entry = initialPromptMigrationEntry()
  expect(
    sqlite
      .prepare("SELECT hash, created_at FROM __drizzle_migrations WHERE created_at = ?")
      .all(entry.when),
  ).toEqual([{ hash: initialPromptMigrationHash(), created_at: entry.when }])
}

function initialPromptMigrationEntry(): { tag: string; when: number } {
  return migrationEntry("0020_silky_sphinx")
}

function migrationEntry(tag: string): { tag: string; when: number } {
  const journal = JSON.parse(
    readFileSync(join(sourceMigrations, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string; when: number }> }
  const entry = journal.entries.find((candidate) => candidate.tag === tag)
  if (!entry) throw new Error(`Missing ${tag} migration metadata`)
  return entry
}

function installRelocatedMobileIdentityMigration(sqlite: Database.Database): void {
  const tag = "0047_mobile_pairing_identity"
  const sql = readFileSync(join(sourceMigrations, `${tag}.sql`), "utf8")
  const install = sqlite.transaction(() => {
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) sqlite.exec(statement)
    }
    sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run(migrationHash(tag), 1784054923088)
  })
  install.immediate()
}

function migrationHash(tag: string): string {
  return createHash("sha256")
    .update(readFileSync(join(sourceMigrations, `${tag}.sql`), "utf8"))
    .digest("hex")
}

function initialPromptMigrationHash(): string {
  return migrationHash("0020_silky_sphinx")
}

function columns(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (column) => column.name,
  )
}

function tableNames(sqlite: Database.Database): string[] {
  return (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string
    }>
  ).map((row) => row.name)
}

function sqliteSchema(sqlite: Database.Database): Array<{
  type: string
  name: string
  table: string
  sql: string | null
}> {
  return sqlite
    .prepare("SELECT type, name, tbl_name AS 'table', sql FROM sqlite_master ORDER BY type, name")
    .all() as Array<{ type: string; name: string; table: string; sql: string | null }>
}

function triggerNames(sqlite: Database.Database): string[] {
  return (
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{
      name: string
    }>
  ).map((row) => row.name)
}

function applyLegacyStage3Migrations(sqlite: Database.Database): void {
  const legacy = [
    {
      when: 1783848465220,
      sql: `
        CREATE TABLE mcp_audit_records (
          id text PRIMARY KEY NOT NULL, status text NOT NULL, caller_chat_id text NOT NULL,
          caller_run_id text, tool_name text NOT NULL, tier integer NOT NULL,
          caller_snapshot text NOT NULL, chat_snapshot text NOT NULL, run_snapshot text NOT NULL,
          input_summary text NOT NULL, result_summary text NOT NULL, created_at integer
        );
        CREATE INDEX mcp_audit_records_created_at_idx ON mcp_audit_records (created_at);
        CREATE INDEX mcp_audit_records_caller_chat_id_idx ON mcp_audit_records (caller_chat_id);
        CREATE INDEX mcp_audit_records_tool_name_idx ON mcp_audit_records (tool_name);
        CREATE INDEX mcp_audit_records_status_idx ON mcp_audit_records (status);
        CREATE TRIGGER mcp_audit_records_no_update BEFORE UPDATE ON mcp_audit_records BEGIN
          SELECT RAISE(ABORT, 'mcp_audit_records is append-only');
        END;
        CREATE TRIGGER mcp_audit_records_no_delete BEFORE DELETE ON mcp_audit_records BEGIN
          SELECT RAISE(ABORT, 'mcp_audit_records is append-only');
        END;
      `,
    },
    {
      when: 1783853847569,
      sql: `
        ALTER TABLE mcp_audit_records ADD invocation_id text NOT NULL DEFAULT '';
        ALTER TABLE mcp_audit_records ADD duration_ms integer NOT NULL DEFAULT 0;
        CREATE INDEX mcp_audit_records_invocation_id_idx ON mcp_audit_records (invocation_id);
      `,
    },
    {
      when: 1783857523275,
      sql: `
        ALTER TABLE chats ADD parent_chat_id text;
        ALTER TABLE chats ADD initiator_chat_id text;
        ALTER TABLE chats ADD parent_run_id text;
        ALTER TABLE chats ADD ancestor_chat_ids text;
      `,
    },
    {
      when: 1783874753036,
      sql: `
        CREATE TABLE mcp_approval_requests (
          id text PRIMARY KEY NOT NULL, invocation_id text NOT NULL, caller_chat_id text NOT NULL,
          caller_run_id text, tool_name text NOT NULL, tier integer NOT NULL,
          target_summary text NOT NULL, input_summary text NOT NULL, decision text,
          grant_session integer DEFAULT false NOT NULL, created_at integer NOT NULL,
          expires_at integer NOT NULL
        );
        CREATE INDEX mcp_approval_requests_pending_idx ON mcp_approval_requests (decision, expires_at);
        CREATE INDEX mcp_approval_requests_chat_id_idx ON mcp_approval_requests (caller_chat_id);
      `,
    },
    { when: 1783875539776, sql: "ALTER TABLE chats ADD custom_permissions text;" },
  ]
  for (const [index, migration] of legacy.entries()) {
    sqlite.exec(migration.sql)
    sqlite
      .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run(`legacy-stage3-${index}`, migration.when)
  }
}
