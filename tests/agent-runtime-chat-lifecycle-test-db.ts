import Database from "better-sqlite3"

export function createRuntimeChatLifecycleDatabase(): Database.Database {
  const database = new Database(":memory:")
  database.exec(`
    CREATE TABLE chats (
      id text PRIMARY KEY, name text, project_id text, task_id text, scope text,
      permission_mode text, custom_permissions text, harness text, model text,
      runtime_preference text, parent_chat_id text, initiator_chat_id text,
      parent_run_id text, ancestor_chat_ids text, worktree_path text, branch text,
      base_branch text, mcp_exposure_enabled integer NOT NULL DEFAULT 0,
      created_at integer, updated_at integer, archived_at integer
    );
    CREATE TABLE sub_chats (
      id text PRIMARY KEY, chat_id text NOT NULL, name text, session_id text,
      stream_id text, mode text, harness text, model text, permission_mode text,
      worktree_path text, run_status text, messages text NOT NULL,
      created_at integer, updated_at integer
    );
    CREATE TABLE agent_runs (
      id text PRIMARY KEY, chat_id text NOT NULL, sub_chat_id text, status text,
      started_at integer
    );
  `)
  return database
}

export function seedRuntimeChat(
  database: Database.Database,
  input: {
    chatId?: string
    harness?: string
    messages?: unknown[]
    sessionId?: string | null
  } = {},
): { chatId: string; subChatId: string } {
  const chatId = input.chatId ?? "source-chat"
  const subChatId = `${chatId}-conversation`
  const harness = input.harness ?? "codex"
  database
    .prepare(
      `INSERT INTO chats (
        id, name, scope, permission_mode, harness, model, runtime_preference,
        ancestor_chat_ids, created_at, updated_at
      ) VALUES (?, 'Source', 'global', 'read-only', ?, 'model', 'auto', '[]', 1, 1)`,
    )
    .run(chatId, harness)
  database
    .prepare(
      `INSERT INTO sub_chats (
        id, chat_id, name, session_id, mode, harness, model, permission_mode,
        messages, created_at, updated_at
      ) VALUES (?, ?, 'Source', ?, 'agent', ?, 'model', 'read-only', ?, 1, 1)`,
    )
    .run(subChatId, chatId, input.sessionId ?? null, harness, JSON.stringify(input.messages ?? []))
  return { chatId, subChatId }
}
