import Database from "better-sqlite3"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("chat mode migration", () => {
  it("renames stored agent modes and normalizes the legacy database default", () => {
    const sqlite = new Database(":memory:")
    try {
      sqlite.exec(
        `CREATE TABLE chats (id text PRIMARY KEY NOT NULL);
         INSERT INTO chats (id) VALUES ('chat');
         CREATE TABLE sub_chats (
           id text PRIMARY KEY NOT NULL,
           name text,
           chat_id text NOT NULL,
           session_id text,
           stream_id text,
           mode text DEFAULT 'agent' NOT NULL,
           harness text,
           model text,
           permission_mode text,
           worktree_path text,
           run_status text,
           messages text DEFAULT '[]' NOT NULL,
           created_at integer,
           updated_at integer,
           FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
         )`,
      )
      sqlite.prepare("INSERT INTO sub_chats (id, chat_id) VALUES ('legacy', 'chat')").run()
      sqlite
        .prepare("INSERT INTO sub_chats (id, chat_id, mode) VALUES ('plan', 'chat', 'plan')")
        .run()

      const migration = readFileSync(resolve("drizzle/0040_chat_modes.sql"), "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      )
      sqlite.exec(migration)
      sqlite.prepare("INSERT INTO sub_chats (id, chat_id) VALUES ('new-default', 'chat')").run()

      expect(sqlite.prepare("SELECT id, mode FROM sub_chats ORDER BY id").all()).toEqual([
        { id: "legacy", mode: "write" },
        { id: "new-default", mode: "write" },
        { id: "plan", mode: "plan" },
      ])
    } finally {
      sqlite.close()
    }
  })
})
