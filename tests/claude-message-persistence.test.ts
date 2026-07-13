import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  clearClaudeStreamIfOwned,
  persistClaudeMessagesForStream,
} from "../src/main/lib/claude/message-persistence"
import * as schema from "../src/main/lib/db/schema"

let directory = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-claude-persistence-"))
  sqlite = new Database(join(directory, "agents.db"))
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare(
      `INSERT INTO chats (id, name, scope, permission_mode, harness)
       VALUES ('chat', 'Claude', 'global', 'full-access', 'claude-code')`,
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO sub_chats (id, chat_id, harness, permission_mode, stream_id, messages)
       VALUES ('sub', 'chat', 'claude-code', 'full-access', 'stream-a', ?)`,
    )
    .run(JSON.stringify([message("a", "user", "A")]))
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("Claude run-authoritative message persistence", () => {
  it("rejects stale completion and cleanup without deleting the newer transcript", () => {
    const db = drizzle(sqlite, { schema })
    const newer = [message("a", "user", "A"), message("b", "user", "B")]
    sqlite
      .prepare(
        "UPDATE sub_chats SET stream_id = 'stream-b', session_id = 'session-b', messages = ?",
      )
      .run(JSON.stringify(newer))

    expect(
      persistClaudeMessagesForStream(db, {
        subChatId: "sub",
        streamId: "stream-a",
        incomingMessages: [message("a", "user", "A"), message("a-response", "assistant", "old")],
        sessionId: "session-a",
      }),
    ).toBe(false)
    expect(clearClaudeStreamIfOwned(db, { subChatId: "sub", streamId: "stream-a" })).toBe(false)
    expect(readState()).toEqual({
      messages: newer,
      session_id: "session-b",
      stream_id: "stream-b",
    })

    expect(
      persistClaudeMessagesForStream(db, {
        subChatId: "sub",
        streamId: "stream-b",
        incomingMessages: [...newer, message("b-response", "assistant", "new")],
        sessionId: "session-b",
      }),
    ).toBe(true)
    expect(readState()).toEqual({
      messages: [...newer, message("b-response", "assistant", "new")],
      session_id: "session-b",
      stream_id: null,
    })
  })
})

function message(id: string, role: string, text: string) {
  return { id, role, parts: [{ type: "text", text }] }
}

function readState() {
  const row = sqlite
    .prepare("SELECT messages, session_id, stream_id FROM sub_chats WHERE id = 'sub'")
    .get() as { messages: string; session_id: string | null; stream_id: string | null }
  return { ...row, messages: JSON.parse(row.messages) }
}
