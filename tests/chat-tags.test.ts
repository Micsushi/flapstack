import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { createChatTagStore } from "../src/main/lib/chat-tags"

let directory = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-chat-tags-"))
  sqlite = new Database(join(directory, "tags.db"))
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite.pragma("foreign_keys = ON")
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, permission_mode) VALUES ('chat-a', 'A', 'global', 'read-only')",
    )
    .run()
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("chat tags", () => {
  it("creates reusable labels and persists assignments", () => {
    const store = createChatTagStore(sqlite)
    const tag = store.create({ name: "Needs review", color: "violet" })
    store.assign({ chatId: "chat-a", tagId: tag.id })

    expect(store.list()).toEqual([
      expect.objectContaining({ name: "Needs review", color: "violet" }),
    ])
    expect(store.listForChats(["chat-a"]).get("chat-a")).toEqual([
      expect.objectContaining({ id: tag.id, name: "Needs review" }),
    ])

    store.unassign({ chatId: "chat-a", tagId: tag.id })
    expect(store.listForChats(["chat-a"]).get("chat-a")).toEqual([])
  })

  it("normalizes names and rejects duplicate labels case-insensitively", () => {
    const store = createChatTagStore(sqlite)
    store.create({ name: "  Important  ", color: "amber" })
    expect(() => store.create({ name: "important", color: "blue" })).toThrow(/already exists/i)
  })
})
