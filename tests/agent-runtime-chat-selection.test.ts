import { afterEach, beforeEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import {
  RuntimeChatLifecycleError,
  createRuntimeChatLifecycleService,
} from "../src/main/lib/agent-runtime/chat-lifecycle"
import {
  createRuntimeChatLifecycleDatabase,
  seedRuntimeChat,
} from "./agent-runtime-chat-lifecycle-test-db"

describe("Agent Runtime chat selection", () => {
  let database: Database.Database

  beforeEach(() => {
    database = createRuntimeChatLifecycleDatabase()
  })
  afterEach(() => database.close())

  it("rejects another chat's conversation and incompatible persisted Runtime before provider mutation", () => {
    const source = seedRuntimeChat(database)
    const other = seedRuntimeChat(database, { chatId: "other" })
    const service = createRuntimeChatLifecycleService(database)
    expect(() =>
      service.setEmptyChatProvider({
        chatId: source.chatId,
        subChatId: other.subChatId,
        harness: "local",
      }),
    ).toThrow("Conversation is missing")
    service.setEmptyChatPreference({ chatId: source.chatId, preference: "codex" })
    expect(() => service.setEmptyChatProvider({ ...source, harness: "local" })).toThrow()
    expect(database.prepare("SELECT harness FROM chats WHERE id = ?").get(source.chatId)).toEqual({
      harness: "codex",
    })
  })

  it("blocks active and started chats and rejects incompatible choices", () => {
    const active = seedRuntimeChat(database, { chatId: "active" })
    database
      .prepare(
        "INSERT INTO agent_runs (id, chat_id, status, started_at) VALUES ('run', ?, 'running', 1)",
      )
      .run(active.chatId)
    const service = createRuntimeChatLifecycleService(database)
    expect(() =>
      service.setEmptyChatPreference({ chatId: active.chatId, preference: "flapstack-native" }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeChatLifecycleError>>({ code: "active-run" }),
    )

    const started = seedRuntimeChat(database, {
      chatId: "started",
      messages: [{ id: "answer", role: "assistant", parts: [{ type: "text", text: "Done" }] }],
    })
    expect(() =>
      service.setEmptyChatPreference({ chatId: started.chatId, preference: "flapstack-native" }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeChatLifecycleError>>({ code: "chat-started" }),
    )

    const generic = seedRuntimeChat(database, { chatId: "generic", harness: "openrouter" })
    expect(() =>
      service.setEmptyChatPreference({ chatId: generic.chatId, preference: "codex" }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeChatLifecycleError>>({
        code: "runtime-incompatible",
      }),
    )
  })
})
