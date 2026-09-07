import { describe, expect, it } from "vitest"
import {
  hydrateChatFromPersistedMessages,
  sanitizePersistedHarnessMessages,
  shouldAutoGenerateInitialResponse,
} from "../src/renderer/features/agents/main/chat-message-hydration"

describe("chat message hydration", () => {
  it("recovers an empty assistant placeholder without requiring another message", () => {
    const user = { id: "user", role: "user", parts: [{ type: "text", text: "Explain this" }] }
    const chat = {
      status: "ready",
      messages: [user, { id: "answer", role: "assistant", parts: [] }],
    }
    const answer = {
      id: "answer",
      role: "assistant",
      parts: [{ type: "text", text: "Completed answer" }],
    }
    expect(hydrateChatFromPersistedMessages(chat, [user, answer])).toBe(true)
    expect(chat.messages[0]).toBe(user)
    expect(chat.messages[1]).toBe(answer)
    expect(hydrateChatFromPersistedMessages(chat, [user, answer])).toBe(false)
  })

  it("preserves nonempty, tool, and differently identified local messages", () => {
    const saved = [
      { id: "answer", role: "assistant", parts: [{ type: "text", text: "Saved answer" }] },
    ]
    for (const message of [
      { id: "answer", role: "assistant", parts: [{ type: "text", text: "Newer local answer" }] },
      { id: "answer", role: "assistant", parts: [{ type: "tool-read", state: "input-available" }] },
      { id: "optimistic", role: "assistant", parts: [] },
    ]) {
      const chat = { status: "ready", messages: [message] }
      expect(hydrateChatFromPersistedMessages(chat, saved)).toBe(false)
      expect(chat.messages[0]).toBe(message)
    }
  })

  it("defers restoration while submitted and allows the same persisted data after idle", () => {
    const chat = {
      status: "submitted",
      messages: [{ id: "answer", role: "assistant", parts: [] }] as unknown[],
    }
    const saved = [
      { id: "answer", role: "assistant", parts: [{ type: "text", text: "Saved answer" }] },
    ]
    expect(hydrateChatFromPersistedMessages(chat, saved)).toBe(false)
    chat.status = "ready"
    expect(hydrateChatFromPersistedMessages(chat, saved)).toBe(true)
  })
  it("hydrates a cached empty chat when persisted messages arrive", () => {
    const chat = { status: "ready", messages: [] as unknown[] }
    const persisted = [{ id: "user-1", role: "user" }]

    expect(hydrateChatFromPersistedMessages(chat, persisted)).toBe(true)
    expect(chat.messages).toEqual(persisted)
  })

  it("does not overwrite optimistic or streaming messages", () => {
    const streaming = { status: "streaming", messages: [] as unknown[] }
    const optimistic = { status: "ready", messages: [{ id: "optimistic" }] as unknown[] }

    expect(hydrateChatFromPersistedMessages(streaming, [{ id: "persisted" }])).toBe(false)
    expect(hydrateChatFromPersistedMessages(optimistic, [{ id: "persisted" }])).toBe(false)
  })

  it("does not clear a cached chat when persistence is empty", () => {
    const chat = { status: "ready", messages: [{ id: "existing" }] as unknown[] }

    expect(hydrateChatFromPersistedMessages(chat, [])).toBe(false)
    expect(chat.messages).toEqual([{ id: "existing" }])
  })

  it("hides historical harness envelopes without changing user or tool parts", () => {
    const user = {
      role: "user",
      parts: [{ type: "text", text: "Explain [FLAPSTACK PRODUCT MCP] literally." }],
    }
    const tool = { type: "tool-read", text: "[FLAPSTACK PRODUCT MCP] tool output" }

    expect(
      sanitizePersistedHarnessMessages([
        user,
        {
          role: "assistant",
          parts: [
            {
              type: "reasoning",
              text: "[FLAPSTACK PRODUCT MCP]\nhidden\n[/FLAPSTACK PRODUCT MCP]\nVisible reason",
            },
            {
              type: "text",
              text: "[FLAPSTACK PRODUCT MCP]\nhidden\n[/FLAPSTACK PRODUCT MCP]NANOGPT_OK",
            },
            tool,
          ],
        },
      ]),
    ).toEqual([
      user,
      {
        role: "assistant",
        parts: [
          { type: "reasoning", text: "Visible reason" },
          { type: "text", text: "NANOGPT_OK" },
          tool,
        ],
      },
    ])
  })

  it("never regenerates a stale one-message transcript for an existing Chat", () => {
    expect(
      shouldAutoGenerateInitialResponse({
        messages: [{ id: "stale-seed", role: "user" }],
        status: "ready",
        streamId: null,
        pendingInitialGeneration: false,
      }),
    ).toBe(false)
  })

  it("auto-generates exactly for an explicitly pending new-Chat launch", () => {
    expect(
      shouldAutoGenerateInitialResponse({
        messages: [{ id: "new-seed", role: "user" }],
        status: "ready",
        streamId: null,
        pendingInitialGeneration: true,
      }),
    ).toBe(true)

    expect(
      shouldAutoGenerateInitialResponse({
        messages: [{ id: "new-seed", role: "user" }],
        status: "streaming",
        streamId: null,
        pendingInitialGeneration: true,
      }),
    ).toBe(false)
  })
})
