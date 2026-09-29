import { afterEach, beforeEach, describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import {
  RuntimeChatLifecycleError,
  createRuntimeChatLifecycleService,
} from "../src/main/lib/agent-runtime/chat-lifecycle"
import type { RuntimeAdapterProbe } from "../src/shared/agent-runtime"
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

  it("configures user-only idle context in place without changing history or starting a run", () => {
    const context = [
      { id: "context", role: "user", parts: [{ type: "text", text: "Quoted task context" }] },
    ]
    const { chatId, subChatId } = seedRuntimeChat(database, { harness: "local", messages: context })
    const service = createRuntimeChatLifecycleService(database)
    expect(service.hasProviderIntent(chatId)).toBe(false)
    service.setEmptyChatProvider({ chatId, subChatId, harness: "codex" })
    service.setEmptyChatPreference({ chatId, preference: "codex" })
    expect(
      database
        .prepare("SELECT harness, model, messages, session_id FROM sub_chats WHERE id = ?")
        .get(subChatId),
    ).toEqual({
      harness: "codex",
      model: null,
      messages: JSON.stringify(context),
      session_id: null,
    })
    expect(database.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
    expect(database.prepare("SELECT count(*) count FROM chats").get()).toEqual({ count: 1 })
  })

  it.each(["assistant", "session", "stream", "run"])(
    "keeps %s provider intent immutable during provider selection",
    (kind) => {
      const { chatId, subChatId } = seedRuntimeChat(database)
      if (kind === "assistant")
        database
          .prepare("UPDATE sub_chats SET messages = ? WHERE id = ?")
          .run(JSON.stringify([{ role: "assistant", parts: [] }]), subChatId)
      if (kind === "session")
        database.prepare("UPDATE sub_chats SET session_id = 'existing' WHERE id = ?").run(subChatId)
      if (kind === "stream")
        database.prepare("UPDATE sub_chats SET stream_id = 'existing' WHERE id = ?").run(subChatId)
      if (kind === "run")
        database
          .prepare(
            "INSERT INTO agent_runs (id,chat_id,status,started_at) VALUES ('prior',?,'completed',1)",
          )
          .run(chatId)
      const service = createRuntimeChatLifecycleService(database)
      expect(service.hasProviderIntent(chatId)).toBe(true)
      expect(() => service.setEmptyChatProvider({ chatId, subChatId, harness: "local" })).toThrow(
        "Started chats",
      )
      expect(database.prepare("SELECT harness, model FROM chats WHERE id = ?").get(chatId)).toEqual(
        { harness: "codex", model: "model" },
      )
    },
  )

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

  it.each(["not-json", "null", '{"role":"assistant"}', '["assistant",null,3,{"role":"user"}]'])(
    "preserves malformed/non-message history handling for %s",
    (messages) => {
      const { chatId, subChatId } = seedRuntimeChat(database)
      database.prepare("UPDATE sub_chats SET messages = ? WHERE id = ?").run(messages, subChatId)
      const service = createRuntimeChatLifecycleService(database)
      expect(service.hasProviderIntent(chatId)).toBe(false)
      database.prepare("UPDATE sub_chats SET session_id = 'existing' WHERE id = ?").run(subChatId)
      expect(service.hasProviderIntent(chatId)).toBe(true)
    },
  )

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

  it("accepts an empty-chat Runtime when an enabled translated pack probe authorizes it", () => {
    const chat = seedRuntimeChat(database, { chatId: "translated", harness: "claude-code" })
    const probe = translatedChatProbe()
    const service = createRuntimeChatLifecycleService(database, () => probe)

    expect(service.setEmptyChatPreference({ chatId: chat.chatId, preference: "codex" })).toEqual({
      chatId: chat.chatId,
      runtimePreference: "codex",
    })
  })

  it("rejects an empty-chat translated Runtime when its exact pack probe is unavailable", () => {
    const chat = seedRuntimeChat(database, {
      chatId: "translated-disabled",
      harness: "claude-code",
    })
    const probe = translatedChatProbe(false)
    expect(() =>
      createRuntimeChatLifecycleService(database, () => probe).setEmptyChatPreference({
        chatId: chat.chatId,
        preference: "codex",
      }),
    ).toThrow(probe.reason!.message)
    expect(
      database.prepare("SELECT runtime_preference FROM chats WHERE id = ?").get(chat.chatId),
    ).toEqual({ runtime_preference: "auto" })
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

function translatedChatProbe(available = true): RuntimeAdapterProbe {
  const reason = available
    ? null
    : {
        code: "adapter-disabled" as const,
        harness: "claude-code",
        runtime: "codex" as const,
        message: "Claude provider adapter pack is disabled.",
        repair: "Enable the reviewed translated adapter pack.",
      }
  const supported = { supported: available, reason: reason?.message ?? null }
  return {
    runtime: "codex",
    harness: "claude-code",
    available,
    versions: { adapterVersion: "translated/1", protocolVersion: "claude" },
    capabilities: {
      schemaVersion: 1,
      status: available ? "available" : "unavailable",
      capturedAt: "2026-08-05T00:00:00.000Z",
      controls: {
        modelThinking: supported,
        reasoningDisplay: supported,
        subagentActivity: supported,
        hookDiagnostics: supported,
      },
      execution: {
        continuation: supported,
        delegation: supported,
        structuredOutput: supported,
        cancellation: supported,
      },
      composition: {
        runtimeMode: "translated",
        providerRuntime: "claude-code",
        providerVersions: { adapterVersion: "claude", protocolVersion: "sdk" },
        adapterChain: [{ id: "claude-provider-to-codex-contract", version: "1" }],
        capabilities: {
          promptSystem: "lossy",
          instructionFiles: "lossy",
          toolLoop: available ? "available" : "unavailable",
          tools: "lossy",
          permissions: available ? "available" : "unavailable",
          mcp: "lossy",
          skills: "lossy",
          hooks: "lossy",
          sessionResume: "lossy",
          sessionFork: "unavailable",
          attachments: "unknown",
          reasoning: "lossy",
          events: "lossy",
          structuredOutput: available ? "available" : "unavailable",
          usage: available ? "available" : "unavailable",
          cancellation: available ? "available" : "unavailable",
          recovery: available ? "available" : "unavailable",
        },
        losses: [],
      },
      limitations: reason ? [reason.message] : [],
      unavailableReason: reason,
    },
    reason,
  }
}
