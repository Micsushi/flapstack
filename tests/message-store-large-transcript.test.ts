import { afterEach, describe, expect, it } from "vitest"
import { appStore } from "../src/renderer/lib/jotai-store"
import {
  clearSubChatCaches,
  getPerChatMessageKey,
  messageAtomFamily,
  messagesByChatAtom,
  syncMessagesWithStatusAtom,
  userMessageIdsPerChatAtom,
  type Message,
} from "../src/renderer/features/agents/stores/message-store"

const subChatId = "large-transcript"

describe("message store large transcript hydration", () => {
  afterEach(() => clearSubChatCaches(subChatId))

  it("commits 100k messages through one per-chat map while preserving message selectors", () => {
    const messages = Array.from<Message>({ length: 100_000 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      parts: [{ type: "text", text: `message ${index}` }],
    }))

    appStore.set(syncMessagesWithStatusAtom, {
      messages,
      status: "ready",
      subChatId,
      updateGlobal: false,
    })

    expect(appStore.get(messagesByChatAtom(subChatId)).size).toBe(100_000)
    expect(appStore.get(userMessageIdsPerChatAtom(subChatId))).toHaveLength(50_000)
    expect(
      appStore.get(messageAtomFamily(getPerChatMessageKey(subChatId, "message-99999"))),
    ).toMatchObject({
      id: "message-99999",
      role: "assistant",
    })
  })
})
