import { describe, expect, it } from "vitest"
import { resolveCanonicalConversationId } from "../src/renderer/features/agents/lib/canonical-conversation"

describe("single conversation per sidebar chat", () => {
  const conversations = [
    { id: "later", created_at: "2026-07-11T12:00:00Z" },
    { id: "earliest", created_at: "2026-07-10T12:00:00Z" },
  ]

  it("ignores a persisted legacy selection", () => {
    expect(resolveCanonicalConversationId(conversations, "later")).toBe("earliest")
  })

  it("falls back deterministically without deleting legacy rows", () => {
    expect(resolveCanonicalConversationId(conversations, "missing")).toBe("earliest")
    expect(conversations).toHaveLength(2)
  })

  it("returns null when the chat has no conversation record", () => {
    expect(resolveCanonicalConversationId([], null)).toBeNull()
  })
})
