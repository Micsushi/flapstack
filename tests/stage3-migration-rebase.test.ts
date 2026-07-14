import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import { recoverInterruptedMcpRuns } from "../src/main/lib/run-launch-service"

const sourceMigrations = resolve(process.cwd(), "drizzle")
const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("Stage 3 migration rebase", () => {
  it("builds a fresh profile with safe Stage 3 defaults and append-only audit", () => {
    const { path, sqlite } = database("fresh")
    try {
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)
      sqlite
        .prepare(
          "INSERT INTO chats (id, name, scope, permission_mode) VALUES ('fresh-chat', 'Fresh', 'global', 'read-only')",
        )
        .run()

      expectStage3Schema(sqlite, "fresh-chat")
      expect(recoverInterruptedMcpRuns(path)).toBe(0)
    } finally {
      sqlite.close()
    }
  })

  it("upgrades the current main-era migration state once without duplicate schema", () => {
    const { path, sqlite, directory } = database("main-era")
    try {
      const mainMigrations = migrationSubset(directory, 16)
      migrate(drizzle(sqlite, { schema }), { migrationsFolder: mainMigrations })
      sqlite
        .prepare(
          "INSERT INTO chats (id, name, scope, permission_mode) VALUES ('main-chat', 'Main', 'global', 'read-only')",
        )
        .run()

      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)

      expectStage3Schema(sqlite, "main-chat")
      expect(recoverInterruptedMcpRuns(path)).toBe(0)
    } finally {
      sqlite.close()
    }
  })

  it("repairs profiles frozen after 0009 despite the older 0010 timestamp", () => {
    const { sqlite, directory } = database("post-0009")
    try {
      migrate(drizzle(sqlite, { schema }), {
        migrationsFolder: migrationSubset(directory, 9),
      })
      expect(tableNames(sqlite)).not.toContain("voice_artifacts")

      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)

      expect(columns(sqlite, "voice_artifacts")).toEqual(
        expect.arrayContaining([
          "duration_ms",
          "model_id",
          "origin_kind",
          "origin_id",
          "origin_label",
        ]),
      )
      const voiceEntry = migrationEntry("0010_voice_artifacts")
      expect(
        sqlite
          .prepare("SELECT count(*) count FROM __drizzle_migrations WHERE created_at = ?")
          .get(voiceEntry.when),
      ).toEqual({ count: 1 })
    } finally {
      sqlite.close()
    }
  })

  it.each([
    { name: "pre-0020", lastMigration: 19 },
    { name: "current-0020", lastMigration: 20 },
  ])(
    "recovers legacy pending prompts transactionally from a $name profile",
    ({ name, lastMigration }) => {
      const { sqlite, directory } = database(name)
      try {
        migrate(drizzle(sqlite, { schema }), {
          migrationsFolder: migrationSubset(directory, lastMigration),
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
    },
  )

  it("normalizes a partial 0020 column and records the canonical migration metadata", () => {
    const { sqlite, directory } = database("partial-0020-column")
    try {
      migrate(drizzle(sqlite, { schema }), {
        migrationsFolder: migrationSubset(directory, 19),
      })
      sqlite.exec("ALTER TABLE agent_runs ADD initial_prompt text")
      seedLegacyQueuedPrompts(sqlite)

      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)

      expectRecoveredQueuedPrompts(sqlite)
      expectCanonicalInitialPromptMigration(sqlite)
    } finally {
      sqlite.close()
    }
  })

  it("repairs a partial 0020 journal entry whose column is missing", () => {
    const { sqlite, directory } = database("partial-0020-journal")
    try {
      migrate(drizzle(sqlite, { schema }), {
        migrationsFolder: migrationSubset(directory, 19),
      })
      const entry = initialPromptMigrationEntry()
      sqlite
        .prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
        .run(initialPromptMigrationHash(), entry.when)

      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)

      expect(columns(sqlite, "agent_runs")).toContain("initial_prompt")
      expectCanonicalInitialPromptMigration(sqlite)
    } finally {
      sqlite.close()
    }
  })

  it("reconciles the legacy Stage 3 chain after applying its missing main-era migration", () => {
    const { path, sqlite, directory } = database("legacy")
    try {
      const preVoiceDurationMigrations = migrationSubset(directory, 15)
      migrate(drizzle(sqlite, { schema }), { migrationsFolder: preVoiceDurationMigrations })
      sqlite
        .prepare(
          "INSERT INTO chats (id, name, scope, permission_mode) VALUES ('legacy-chat', 'Legacy', 'global', 'custom')",
        )
        .run()
      applyLegacyStage3Migrations(sqlite)
      sqlite
        .prepare(
          `INSERT INTO mcp_audit_records (
            id, invocation_id, status, caller_chat_id, tool_name, tier,
            caller_snapshot, chat_snapshot, run_snapshot, input_summary,
            result_summary, duration_ms
          ) VALUES ('legacy-audit', 'legacy-invocation', 'completed', 'legacy-chat',
            'ping', 0, '{}', '{}', '{}', '{}', '{}', 1)`,
        )
        .run()

      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)
      migrateDatabase(drizzle(sqlite, { schema }), sqlite, sourceMigrations)

      expectStage3Schema(sqlite, "legacy-chat")
      expect(columns(sqlite, "voice_artifacts")).toContain("duration_ms")
      expect(
        sqlite.prepare("SELECT id FROM mcp_audit_records WHERE id = 'legacy-audit'").all(),
      ).toEqual([{ id: "legacy-audit" }])
      expect(recoverInterruptedMcpRuns(path)).toBe(0)
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

function initialPromptMigrationHash(): string {
  return createHash("sha256")
    .update(readFileSync(join(sourceMigrations, "0020_silky_sphinx.sql"), "utf8"))
    .digest("hex")
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
