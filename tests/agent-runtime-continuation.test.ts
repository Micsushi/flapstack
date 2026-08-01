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
      .prepare(
        "SELECT parent_chat_id, runtime_preference, mcp_exposure_enabled FROM chats WHERE id = ?",
      )
      .get(first.chatId)
    expect(target).toEqual({
      parent_chat_id: chatId,
      runtime_preference: "flapstack-native",
      mcp_exposure_enabled: 1,
    })
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

  it("keeps product MCP disabled for unsupported continuation harnesses", () => {
    const { chatId } = seedRuntimeChat(database, {
      harness: "local",
      sessionId: "local-source-session",
    })
    const continued = createRuntimeChatLifecycleService(database).continueWithRuntime({
      sourceChatId: chatId,
      preference: "flapstack-native",
      requestId: "local-continuation",
    })

    expect(
      database.prepare("SELECT mcp_exposure_enabled FROM chats WHERE id = ?").get(continued.chatId),
    ).toEqual({ mcp_exposure_enabled: 0 })
  })

  it.each([
    {
      sourceHarness: "codex",
      targetHarness: "claude-code",
      preference: "claude-code" as const,
    },
    {
      sourceHarness: "claude-code",
      targetHarness: "codex",
      preference: "codex" as const,
    },
  ])(
    "creates a distinct $targetHarness Chat when continuing from $sourceHarness",
    ({ sourceHarness, targetHarness, preference }) => {
      const { chatId } = seedRuntimeChat(database, {
        harness: sourceHarness,
        sessionId: `${sourceHarness}-session`,
      })

      const service = createRuntimeChatLifecycleService(database)
      const request = {
        sourceChatId: chatId,
        targetHarness,
        targetModel: `${targetHarness}-review-model`,
        preference,
        requestId: `${sourceHarness}-to-${targetHarness}`,
      }
      const preview = service.previewContinuation(request)
      const continued = service.continueWithRuntime({
        ...request,
        confirmedPreviewDigest: preview.digest,
      })

      expect(
        database
          .prepare(
            "SELECT harness, model, runtime_preference, parent_chat_id FROM chats WHERE id = ?",
          )
          .get(continued.chatId),
      ).toEqual({
        harness: targetHarness,
        model: `${targetHarness}-review-model`,
        runtime_preference: preference,
        parent_chat_id: chatId,
      })
      expect(
        database
          .prepare("SELECT harness, model, session_id FROM sub_chats WHERE id = ?")
          .get(continued.subChatId),
      ).toEqual({
        harness: targetHarness,
        model: `${targetHarness}-review-model`,
        session_id: null,
      })
      expect(continued.diagnostic).toMatchObject({ targetHarness })
    },
  )

  it("previews deterministic selected context and omits reasoning, credentials, and hidden state", () => {
    const { chatId } = seedRuntimeChat(database, {
      harness: "codex",
      sessionId: "codex-private-session",
      messages: [
        {
          id: "selected-user",
          role: "user",
          parts: [{ type: "text", text: "Review the public API." }],
        },
        {
          id: "selected-assistant",
          role: "assistant",
          parts: [
            { type: "text", text: "Visible result" },
            { type: "reasoning", text: "PRIVATE_REASONING" },
            { type: "tool-ReasoningOutput", input: { text: "PRIVATE_TOOL_REASONING" } },
            {
              type: "tool-call",
              toolName: "ghp_toolnameabcdefghijklmnopqrstuvwxyz123456",
              input: { authorization: "Bearer SECRET_CREDENTIAL" },
              hiddenState: "HIDDEN_TOOL_STATE",
            },
          ],
        },
        {
          id: "unselected",
          role: "user",
          parts: [{ type: "text", text: "UNSELECTED_MESSAGE" }],
        },
        {
          id: "secret-visible-text",
          role: "user",
          parts: [{ type: "text", text: "Use api_key=sk-super-secret-value" }],
        },
        {
          id: "github-token-visible-text",
          role: "user",
          parts: [{ type: "text", text: "Use ghp_abcdefghijklmnopqrstuvwxyz123456" }],
        },
        {
          id: "slack-token-visible-text",
          role: "user",
          parts: [{ type: "text", text: "Use xoxb-abcdefghijklmnopqrstuvwxyz123456" }],
        },
      ],
    })
    database
      .prepare("UPDATE sub_chats SET name = ? WHERE id = ?")
      .run("xoxb-subchatnameabcdefghijklmnopqrstuvwxyz123456", `${chatId}-conversation`)
    const service = createRuntimeChatLifecycleService(database)
    const request = {
      sourceChatId: chatId,
      targetHarness: "claude-code",
      targetModel: "claude-review",
      preference: "claude-code" as const,
      requestId: "selected-private-context",
      selectedMessageIds: ["selected-user", "selected-assistant"],
      selectedFileRefs: ["public-file", "ghp_filerefabcdefghijklmnopqrstuvwxyz123456"],
      selectedArtifactRefs: ["public-artifact", "xoxb-artifactabcdefghijklmnopqrstuvwxyz123456"],
    }

    const firstPreview = service.previewContinuation(request)
    const secondPreview = service.previewContinuation(request)
    expect(secondPreview).toEqual(firstPreview)
    expect(firstPreview.visibleContextManifest.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ class: "private-reasoning" }),
        expect.objectContaining({ class: "hidden-tool-state" }),
        expect.objectContaining({ class: "unselected-message" }),
      ]),
    )

    const continued = service.continueWithRuntime({
      ...request,
      confirmedPreviewDigest: firstPreview.digest,
    })
    const messages = String(
      (
        database
          .prepare("SELECT messages FROM sub_chats WHERE id = ?")
          .get(continued.subChatId) as { messages: string }
      ).messages,
    )
    expect(messages).toContain("Visible result")
    expect(messages).not.toContain("PRIVATE_REASONING")
    expect(messages).not.toContain("PRIVATE_TOOL_REASONING")
    expect(messages).not.toContain("SECRET_CREDENTIAL")
    expect(messages).not.toContain("HIDDEN_TOOL_STATE")
    expect(messages).not.toContain("UNSELECTED_MESSAGE")
    expect(messages).not.toContain("sk-super-secret-value")
    expect(messages).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456")
    expect(messages).not.toContain("xoxb-abcdefghijklmnopqrstuvwxyz123456")
    expect(messages).not.toContain("ghp_toolnameabcdefghijklmnopqrstuvwxyz123456")
    expect(messages).not.toContain("xoxb-subchatnameabcdefghijklmnopqrstuvwxyz123456")
    expect(firstPreview.visibleContextManifest.selectedFileRefs).toEqual(["public-file"])
    expect(firstPreview.visibleContextManifest.selectedArtifactRefs).toEqual(["public-artifact"])
    expect(continued.diagnostic.contextManifestDigest).toBe(
      firstPreview.visibleContextManifest.digest,
    )
    expect(continued.diagnostic.previewDigest).toBe(firstPreview.digest)
  })
})
