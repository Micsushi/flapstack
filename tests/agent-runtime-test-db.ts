import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { getFlapstackNativeDiagnostics } from "../src/main/lib/agent-runtime/flapstack-native"

export function createLegacyRuntimeDatabase(filename = ":memory:"): Database.Database {
  const database = new Database(filename)
  database.pragma("foreign_keys = OFF")
  database.exec(`
    CREATE TABLE projects (
      id text PRIMARY KEY NOT NULL,
      archived_at integer
    );
    CREATE TABLE chats (
      id text PRIMARY KEY NOT NULL,
      project_id text,
      archived_at integer,
      harness text,
      model text,
      permission_mode text,
      custom_permissions text,
      worktree_path text
    );
    CREATE TABLE sub_chats (
      id text PRIMARY KEY NOT NULL,
      chat_id text NOT NULL,
      session_id text,
      messages text NOT NULL DEFAULT '[]'
    );
    CREATE TABLE agent_runs (
      id text PRIMARY KEY NOT NULL,
      chat_id text NOT NULL,
      sub_chat_id text,
      harness text NOT NULL,
      model text,
      permission_mode text NOT NULL,
      custom_permissions text,
      worktree_path text,
      prompt_message_id text,
      initial_prompt text,
      status text NOT NULL,
      started_at integer,
      completed_at integer
    );
  `)
  return database
}

export function applyRuntimeMigration(database: Database.Database): void {
  const migration = readFileSync(resolve(process.cwd(), "drizzle/0032_agent_runtime.sql"), "utf8")
  const transaction = database.transaction(() => {
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) database.exec(statement)
    }
  })
  transaction.immediate()
}

export function applyActivityMigration(database: Database.Database): void {
  const migration = readFileSync(resolve(process.cwd(), "drizzle/0033_agent_activity.sql"), "utf8")
  const transaction = database.transaction(() => {
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) database.exec(statement)
    }
  })
  transaction.immediate()
}

export function seedRuntimeRun(
  database: Database.Database,
  input: { runId?: string; chatId?: string; subChatId?: string } = {},
): { runId: string; chatId: string; subChatId: string } {
  const runId = input.runId ?? "run-1"
  const chatId = input.chatId ?? "chat-1"
  const subChatId = input.subChatId ?? "subchat-1"
  database
    .prepare("INSERT OR IGNORE INTO projects (id, archived_at) VALUES ('project-1', NULL)")
    .run()
  database
    .prepare(
      `INSERT OR IGNORE INTO chats
       (id, project_id, archived_at, harness, model, permission_mode, runtime_preference)
       VALUES (?, 'project-1', NULL, 'codex', 'gpt-test', 'read-only', 'codex')`,
    )
    .run(chatId)
  database
    .prepare(
      "INSERT OR IGNORE INTO sub_chats (id, chat_id, session_id, messages) VALUES (?, ?, NULL, '[]')",
    )
    .run(subChatId, chatId)
  database
    .prepare(
      `INSERT INTO agent_runs (
         id, chat_id, sub_chat_id, harness, model, permission_mode, status,
         runtime_snapshot_version, runtime_preference, runtime_preference_source,
         resolved_runtime, runtime_adapter_version, runtime_protocol_version,
         runtime_capability_snapshot, runtime_control_snapshot
       ) VALUES (?, ?, ?, 'codex', 'gpt-test', 'read-only', 'running',
         1, 'codex', 'chat', 'codex', 'test-adapter', 'test-protocol',
         '{"schemaVersion":1}', '{"schemaVersion":1}')`,
    )
    .run(runId, chatId, subChatId)
  return { runId, chatId, subChatId }
}

export function testRuntimeSnapshotSqlValues(
  harness: "codex" | "claude-code" = "codex",
  runtime: "codex" | "claude-code" | "flapstack-native" = "flapstack-native",
): readonly unknown[] {
  const versions =
    runtime === "flapstack-native"
      ? getFlapstackNativeDiagnostics(harness).versions
      : {
          adapterVersion: `${runtime}-test-adapter`,
          protocolVersion: `${harness}-test-protocol`,
        }
  return [
    1,
    runtime,
    "chat",
    runtime,
    versions.adapterVersion,
    versions.protocolVersion,
    JSON.stringify({
      schemaVersion: 1,
      status: "available",
      capturedAt: "2026-07-14T00:00:00.000Z",
      controls: {},
      limitations: [],
      unavailableReason: null,
    }),
    JSON.stringify({ schemaVersion: 1 }),
  ]
}
