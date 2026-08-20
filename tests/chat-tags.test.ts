import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { applyAutomaticChatTags, createChatTagStore } from "../src/main/lib/chat-tags"
import {
  applyAutomaticAgentChatLabels,
  listAgentChatLabels,
} from "../src/main/lib/chat-agent-labels"

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
  it("includes practical starter tags with semantic default colors", () => {
    const store = createChatTagStore(sqlite)

    expect(store.list()).toEqual([
      expect.objectContaining({ name: "Blocked", color: "violet", icon: "ban" }),
      expect.objectContaining({ name: "Follow-up", color: "amber", icon: "reply" }),
      expect.objectContaining({ name: "Important", color: "rose", icon: "alert" }),
      expect.objectContaining({ name: "Review", color: "blue", icon: "eye" }),
      expect.objectContaining({ name: "Waiting", color: "slate", icon: "clock" }),
    ])
  })

  it("writes tag timestamps in the Unix seconds the timestamp columns declare", () => {
    const store = createChatTagStore(sqlite)
    const before = Math.floor(Date.now() / 1_000)
    const tag = store.create({ name: "Seconds", color: "blue", icon: "eye" })
    store.update({ id: tag.id, name: "Seconds renamed", color: "green" })
    store.assign({ chatId: "chat-a", tagId: tag.id })
    const after = Math.ceil(Date.now() / 1_000)

    const raw = sqlite
      .prepare("SELECT created_at, updated_at FROM chat_tags WHERE id = ?")
      .get(tag.id) as { created_at: number; updated_at: number }
    const assignment = sqlite
      .prepare("SELECT created_at FROM chat_tag_assignments WHERE tag_id = ?")
      .get(tag.id) as { created_at: number }

    for (const value of [raw.created_at, raw.updated_at, assignment.created_at]) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(before)
      expect(value).toBeLessThanOrEqual(after)
    }

    // Drizzle reads the same columns as timestamp-mode seconds; a millisecond
    // write would decode as a date tens of thousands of years in the future.
    const database = drizzle(sqlite, { schema })
    const decoded = database.select().from(schema.chatTags).all()
    const decodedTag = decoded.find((row) => row.id === tag.id)
    expect(decodedTag?.createdAt?.getTime()).toBe(raw.created_at * 1_000)
    expect(Math.abs((decodedTag?.updatedAt?.getTime() ?? 0) - Date.now())).toBeLessThan(5_000)

    const decodedAssignment = database.select().from(schema.chatTagAssignments).all()
    expect(Math.abs((decodedAssignment[0]?.createdAt?.getTime() ?? 0) - Date.now())).toBeLessThan(
      5_000,
    )
  })

  it("creates reusable labels and persists assignments", () => {
    const store = createChatTagStore(sqlite)
    const tag = store.create({ name: "Needs review", color: "violet", icon: "eye" })
    store.assign({ chatId: "chat-a", tagId: tag.id })

    expect(store.list()).toContainEqual(
      expect.objectContaining({ name: "Needs review", color: "violet", icon: "eye" }),
    )
    expect(store.listForChats(["chat-a"]).get("chat-a")).toEqual([
      expect.objectContaining({ id: tag.id, name: "Needs review" }),
    ])

    expect(store.update({ id: tag.id, name: "Review later", color: "blue" })).toEqual(
      expect.objectContaining({ name: "Review later", color: "blue", icon: "eye" }),
    )

    store.unassign({ chatId: "chat-a", tagId: tag.id })
    expect(store.listForChats(["chat-a"]).get("chat-a")).toEqual([])
  })

  it("normalizes names and rejects duplicate labels case-insensitively", () => {
    const store = createChatTagStore(sqlite)
    store.create({ name: "  Needs input  ", color: "amber" })
    expect(() => store.create({ name: "needs input", color: "blue" })).toThrow(/already exists/i)
  })

  it("creates and assigns only automatic tags above the confidence threshold", () => {
    const applied = applyAutomaticChatTags(sqlite, {
      chatId: "chat-a",
      candidates: [
        { key: "bug-fix", confidence: 0.96 },
        { key: "coordinator", confidence: 0.94 },
        { key: "manual-testing", confidence: 0.99 },
      ],
      minimumConfidence: 0.95,
    })

    expect(applied).toEqual([
      expect.objectContaining({ name: "Bug", color: "rose", icon: "bug" }),
      expect.objectContaining({ name: "Manual", color: "amber", icon: "hand" }),
    ])
    expect(createChatTagStore(sqlite).listForChats(["chat-a"]).get("chat-a")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Bug" }),
        expect.objectContaining({ name: "Manual" }),
      ]),
    )
  })

  it("stores inferred agent roles outside the user-owned tag vocabulary", () => {
    const candidates = [
      { key: "coordinator", confidence: 0.99 },
      { key: "reviewer", confidence: 0.99 },
      { key: "worker", confidence: 0.99 },
      { key: "researcher", confidence: 0.99 },
      { key: "planner", confidence: 0.99 },
      { key: "verifier", confidence: 0.99 },
    ] as const
    expect(
      applyAutomaticChatTags(sqlite, {
        chatId: "chat-a",
        candidates: [...candidates],
        minimumConfidence: 0.95,
      }),
    ).toEqual([])

    const applied = applyAutomaticAgentChatLabels(sqlite, {
      chatId: "chat-a",
      candidates: [...candidates],
      minimumConfidence: 0.95,
    })

    expect(applied.map(({ key }) => key)).toEqual([
      "coordinator",
      "planner",
      "researcher",
      "reviewer",
      "verifier",
      "worker",
    ])
    expect(listAgentChatLabels(sqlite, "chat-a")).toEqual(applied)
    expect(
      createChatTagStore(sqlite)
        .list()
        .map(({ name }) => name),
    ).not.toContain("Coordinator")
  })
})
