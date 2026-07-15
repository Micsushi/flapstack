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

describe("Agent Runtime continuation", () => {
  let database: Database.Database

  beforeEach(() => {
    database = createRuntimeChatLifecycleDatabase()
  })
  afterEach(() => database.close())

  it("creates exactly one new sidebar chat with visible labeled context and no copied session", () => {
    const { chatId } = seedRuntimeChat(database, {
      sessionId: "source-session",
      messages: [
        { id: "user", role: "user", parts: [{ type: "text", text: "Question" }] },
        {
          id: "assistant",
          role: "assistant",
          parts: [
            { type: "text", text: "Visible answer" },
            { type: "file-content", filePath: "/secret", content: "SECRET_VALUE" },
          ],
        },
      ],
    })
    database
      .prepare(
        `INSERT INTO sub_chats (
          id, chat_id, name, session_id, mode, harness, model, permission_mode,
          messages, created_at, updated_at
        ) VALUES ('source-secondary', ?, 'Secondary', NULL, 'agent', 'codex', 'model',
          'read-only', ?, 2, 2)`,
      )
      .run(
        chatId,
        JSON.stringify([
          { id: "secondary-user", role: "user", parts: [{ type: "text", text: "Follow-up" }] },
          {
            id: "secondary-assistant",
            role: "assistant",
            parts: [{ type: "text", text: "Second visible answer" }],
          },
        ]),
      )
    const service = createRuntimeChatLifecycleService(database)
    const first = service.continueWithRuntime({
      sourceChatId: chatId,
      preference: "flapstack-native",
      requestId: "request-double-click",
    })
    const replay = service.continueWithRuntime({
      sourceChatId: chatId,
      preference: "flapstack-native",
      requestId: "request-double-click",
    })

    expect(first).toMatchObject({ created: true, sourceChatId: chatId })
    expect(replay).toMatchObject({
      created: false,
      chatId: first.chatId,
      subChatId: first.subChatId,
    })
    expect(database.prepare("SELECT count(*) count FROM chats").get()).toEqual({ count: 2 })
    expect(database.prepare("SELECT count(*) count FROM sub_chats").get()).toEqual({ count: 3 })
    const target = database
      .prepare("SELECT parent_chat_id, runtime_preference FROM chats WHERE id = ?")
      .get(first.chatId)
    expect(target).toEqual({ parent_chat_id: chatId, runtime_preference: "flapstack-native" })
    const conversation = database
      .prepare("SELECT session_id, messages FROM sub_chats WHERE id = ?")
      .get(first.subChatId) as { session_id: string | null; messages: string }
    expect(conversation.session_id).toBeNull()
    expect(conversation.messages).toContain("Imported visible history context")
    expect(conversation.messages).toContain("Visible answer")
    expect(conversation.messages).toContain("Second visible answer")
    expect(conversation.messages).not.toContain("SECRET_VALUE")
    expect(first.diagnostic.visibleMessageCount).toBe(4)
    expect(replay.diagnostic.visibleMessageCount).toBe(4)
    expect(
      database.prepare("SELECT session_id FROM sub_chats WHERE chat_id = ?").get(chatId),
    ).toEqual({ session_id: "source-session" })
  })

  it("blocks active-run races, supports safe undo, and never creates partial rows", () => {
    const { chatId } = seedRuntimeChat(database, { sessionId: "source-session" })
    database
      .prepare(
        "INSERT INTO agent_runs (id, chat_id, status, started_at) VALUES ('active', ?, 'running', 1)",
      )
      .run(chatId)
    const service = createRuntimeChatLifecycleService(database)
    expect(() =>
      service.continueWithRuntime({
        sourceChatId: chatId,
        preference: "flapstack-native",
        requestId: "blocked-request",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<RuntimeChatLifecycleError>>({ code: "active-run" }),
    )
    expect(database.prepare("SELECT count(*) count FROM chats").get()).toEqual({ count: 1 })

    database.prepare("UPDATE agent_runs SET status = 'success' WHERE id = 'active'").run()
    const created = service.continueWithRuntime({
      sourceChatId: chatId,
      preference: "flapstack-native",
      requestId: "undo-request",
    })
    expect(service.undoContinuation({ sourceChatId: chatId, targetChatId: created.chatId })).toBe(
      true,
    )
    expect(
      database.prepare("SELECT archived_at FROM chats WHERE id = ?").get(created.chatId),
    ).toEqual({
      archived_at: expect.any(Number),
    })
  })
})
