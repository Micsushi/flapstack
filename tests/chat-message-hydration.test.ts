import { describe, expect, it } from "vitest"
import {
  hydrateChatFromPersistedMessages,
  shouldAutoGenerateInitialResponse,
} from "../src/renderer/features/agents/main/chat-message-hydration"

describe("chat message hydration", () => {
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
