import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyAutomaticChatTitle } from "../src/main/lib/automatic-chat-title"
import { initialChatName, isUntitledChatName } from "../src/shared/chat-title"
import { autoRenameAgentChat } from "../src/renderer/features/agents/utils/auto-rename"

let db: Database.Database
const input = { subChatId: "first", parentChatId: "parent", name: "Generated title" }
beforeEach(() => {
  db = new Database(":memory:")
  db.exec(`
    CREATE TABLE chats (id TEXT PRIMARY KEY, name TEXT, updated_at INTEGER);
    CREATE TABLE sub_chats (id TEXT PRIMARY KEY, chat_id TEXT, name TEXT, created_at INTEGER, updated_at INTEGER);
    INSERT INTO chats VALUES ('parent', NULL, 1);
    INSERT INTO sub_chats VALUES ('first', 'parent', 'New Chat', 1, 1);
    INSERT INTO sub_chats VALUES ('second', 'parent', 'New Chat', 2, 1);
  `)
})
afterEach(() => db.close())
const names = () => ({
  parent: db.prepare("SELECT name FROM chats WHERE id = 'parent'").pluck().get(),
  first: db.prepare("SELECT name FROM sub_chats WHERE id = 'first'").pluck().get(),
  second: db.prepare("SELECT name FROM sub_chats WHERE id = 'second'").pluck().get(),
})

describe("atomic automatic title application", () => {
  it("leaves generated-title chats eligible and preserves the disabled setting", () => {
    expect(initialChatName("Please repair the navigation", true)).toBe("New Chat")
    expect(initialChatName("  Please repair the navigation  ", false)).toBe(
      "Please repair the navigation",
    )
    expect(initialChatName("a".repeat(60), false)).toHaveLength(50)
  })
  it("preserves a manual rename across an in-flight generation and cache update", async () => {
    let finishGeneration!: (value: { name: string }) => void
    const updateSubChatName = vi.fn()
    const updateChatName = vi.fn()
    const pending = autoRenameAgentChat({
      subChatId: input.subChatId,
      parentChatId: input.parentChatId,
      userMessage: "Name this task",
      generateName: () =>
        new Promise((resolve) => {
          finishGeneration = resolve
        }),
      applyName: async (value) => applyAutomaticChatTitle(db, value)!,
      updateSubChatName,
      updateChatName,
    })
    db.prepare("UPDATE sub_chats SET name = 'Manual choice' WHERE id = 'first'").run()
    finishGeneration({ name: input.name })
    await pending
    expect(names().first).toBe("Manual choice")
    expect(updateSubChatName).not.toHaveBeenCalled()
    expect(updateChatName).not.toHaveBeenCalled()
  })
  it("shares placeholder eligibility with renderer cache guards", () => {
    for (const name of [null, undefined, "", "  ", "New Chat", " new chat "]) {
      expect(isUntitledChatName(name)).toBe(true)
    }
    for (const name of ["My title", "New chat project", "新聊天"]) {
      expect(isUntitledChatName(name)).toBe(false)
    }
  })
  it("names the first child and parent together", () => {
    expect(applyAutomaticChatTitle(db, input)).toEqual({
      subChatApplied: true,
      parentChatApplied: true,
    })
    expect(names()).toEqual({ parent: input.name, first: input.name, second: "New Chat" })
  })

  it("preserves a name chosen while metadata was being generated", () => {
    db.prepare("UPDATE sub_chats SET name = 'My chosen name' WHERE id = 'first'").run()
    expect(applyAutomaticChatTitle(db, input)).toEqual({
      subChatApplied: false,
      parentChatApplied: false,
    })
    expect(names().first).toBe("My chosen name")
    expect(names().parent).toBeNull()
  })

  it("does not rename an already named parent", () => {
    db.prepare("UPDATE chats SET name = 'Keep parent'").run()
    expect(applyAutomaticChatTitle(db, input)).toEqual({
      subChatApplied: true,
      parentChatApplied: false,
    })
    expect(names().parent).toBe("Keep parent")
  })

  it("never lets later sub-chats overwrite the parent", () => {
    expect(applyAutomaticChatTitle(db, { ...input, subChatId: "second" })).toEqual({
      subChatApplied: true,
      parentChatApplied: false,
    })
    expect(names()).toEqual({ parent: null, first: "New Chat", second: input.name })
  })

  it("rejects missing and cross-parent targets", () => {
    expect(applyAutomaticChatTitle(db, { ...input, subChatId: "missing" })).toBeNull()
    expect(applyAutomaticChatTitle(db, { ...input, parentChatId: "other" })).toBeNull()
    expect(names().first).toBe("New Chat")
  })

  it("leaves the first accepted title unchanged when a second result arrives", () => {
    applyAutomaticChatTitle(db, input)
    expect(applyAutomaticChatTitle(db, { ...input, name: "Late result" })).toEqual({
      subChatApplied: false,
      parentChatApplied: false,
    })
    expect(names().first).toBe(input.name)
  })

  it("rolls back the child if the parent write fails", () => {
    db.exec(
      "CREATE TRIGGER reject_title BEFORE UPDATE ON chats BEGIN SELECT RAISE(ABORT, 'write failed'); END",
    )
    expect(() => applyAutomaticChatTitle(db, input)).toThrow("write failed")
    expect(names()).toEqual({ parent: null, first: "New Chat", second: "New Chat" })
  })
})
