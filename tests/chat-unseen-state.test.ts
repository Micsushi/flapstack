import { describe, expect, it } from "vitest"
import { markChatSeen, markChatUnseen } from "../src/renderer/features/agents/lib/chat-unseen-state"

describe("Chat unseen completion state", () => {
  it("persists completion until the Chat is explicitly seen", () => {
    const empty = new Set<string>()
    const unseen = markChatUnseen(empty, "chat-a")

    expect(unseen).not.toBe(empty)
    expect(unseen.has("chat-a")).toBe(true)
    expect(markChatUnseen(unseen, "chat-a")).toBe(unseen)

    const seen = markChatSeen(unseen, "chat-a")
    expect(seen).not.toBe(unseen)
    expect(seen.has("chat-a")).toBe(false)
    expect(markChatSeen(seen, "chat-a")).toBe(seen)
  })
})
