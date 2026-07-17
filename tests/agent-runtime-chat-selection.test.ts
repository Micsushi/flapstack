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

  it("mutates an empty chat in place without creating run or provider identity", () => {
    const { chatId, subChatId } = seedRuntimeChat(database, {
      messages: [{ id: "draft", role: "user", parts: [{ type: "text", text: "Draft" }] }],
    })
    const service = createRuntimeChatLifecycleService(database)
    expect(service.setEmptyChatPreference({ chatId, preference: "flapstack-native" })).toEqual({
      chatId,
      runtimePreference: "flapstack-native",
    })
    expect(
      database.prepare("SELECT runtime_preference FROM chats WHERE id = ?").get(chatId),
    ).toEqual({
      runtime_preference: "flapstack-native",
    })
    expect(
      database.prepare("SELECT session_id FROM sub_chats WHERE id = ?").get(subChatId),
    ).toEqual({
      session_id: null,
    })
    expect(database.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
  })

  it("accepts the matching enhanced preference and rejects it for another harness", () => {
    const codex = seedRuntimeChat(database, { chatId: "codex-enhanced" })
    const service = createRuntimeChatLifecycleService(database)
    expect(
      service.setEmptyChatPreference({
        chatId: codex.chatId,
        preference: "codex-enhanced",
      }),
    ).toMatchObject({ runtimePreference: "codex-enhanced" })

    const claude = seedRuntimeChat(database, {
      chatId: "claude-enhanced",
      harness: "claude-code",
    })
    expect(() =>
      service.setEmptyChatPreference({
        chatId: claude.chatId,
        preference: "codex-enhanced",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeChatLifecycleError>>({
        code: "runtime-incompatible",
      }),
    )
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
