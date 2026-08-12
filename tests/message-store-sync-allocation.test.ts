import { afterEach, describe, expect, it } from "vitest"
import { appStore } from "../src/renderer/lib/jotai-store"
import {
  clearSubChatCaches,
  getPerChatMessageKey,
  messageAtomFamily,
  messageIdsPerChatAtom,
  messageRolesPerChatAtom,
  messagesByChatAtom,
  syncMessagesWithStatusAtom,
  type Message,
} from "../src/renderer/features/agents/stores/message-store"

const subChatId = "sync-allocation"

function sync(messages: Message[], status = "streaming") {
  appStore.set(syncMessagesWithStatusAtom, {
    messages,
    status,
    subChatId,
    updateGlobal: false,
  })
}

function makeTranscript(length: number): Message[] {
  return Array.from<Message>({ length }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `message ${index}` }],
    metadata: { createdAt: new Date(1_700_000_000_000 + index).toISOString() },
  }))
}

describe("message store streaming sync", () => {
  afterEach(() => clearSubChatCaches(subChatId))

  it("reuses the stored id array and role map when nothing structural changed", () => {
    const messages = makeTranscript(20)
    sync(messages)

    const ids = appStore.get(messageIdsPerChatAtom(subChatId))
    const roles = appStore.get(messageRolesPerChatAtom(subChatId))

    // A stream frame only mutates the trailing assistant message's text.
    const last = messages[messages.length - 1]
    last.parts = [{ type: "text", text: "more tokens" }]
    sync(messages)

    expect(appStore.get(messageIdsPerChatAtom(subChatId))).toBe(ids)
    expect(appStore.get(messageRolesPerChatAtom(subChatId))).toBe(roles)
  })

  it("still publishes new ids and roles when a message is appended", () => {
    const messages = makeTranscript(5)
    sync(messages)

    const ids = appStore.get(messageIdsPerChatAtom(subChatId))
    const next = [
      ...messages,
      { id: "message-5", role: "assistant", parts: [{ type: "text", text: "hi" }] } as Message,
    ]
    sync(next)

    const updatedIds = appStore.get(messageIdsPerChatAtom(subChatId))
    expect(updatedIds).not.toBe(ids)
    expect(updatedIds).toHaveLength(6)
    expect(appStore.get(messageRolesPerChatAtom(subChatId)).get("message-5")).toBe("assistant")
  })

  it("republishes roles when a role changes under an unchanged id list", () => {
    const messages = makeTranscript(3)
    sync(messages)

    const roles = appStore.get(messageRolesPerChatAtom(subChatId))
    messages[1] = { ...messages[1], role: "system" }
    sync(messages)

    const updatedRoles = appStore.get(messageRolesPerChatAtom(subChatId))
    expect(updatedRoles).not.toBe(roles)
    expect(updatedRoles.get("message-1")).toBe("system")
  })

  it("propagates a mid-transcript tool part state transition", () => {
    const messages: Message[] = [
      { id: "a", role: "user", parts: [{ type: "text", text: "run it" }] },
      {
        id: "b",
        role: "assistant",
        parts: [{ type: "tool-Bash", toolCallId: "t1", state: "call", input: { command: "ls" } }],
      },
      { id: "c", role: "assistant", parts: [{ type: "text", text: "tail" }] },
    ]
    sync(messages)

    // The SDK replaces the part object when the tool resolves.
    messages[1] = {
      ...messages[1],
      parts: [
        {
          type: "tool-Bash",
          toolCallId: "t1",
          state: "output-available",
          input: { command: "ls" },
          output: "README.md",
        },
      ],
    }
    sync(messages)

    const stored = appStore.get(messageAtomFamily(getPerChatMessageKey(subChatId, "b")))
    expect(stored?.parts?.[0].state).toBe("output-available")
    expect(stored?.parts?.[0].output).toBe("README.md")
  })

  it("keeps the trailing message refreshed even when its last part is unchanged", () => {
    const messages: Message[] = [
      { id: "a", role: "user", parts: [{ type: "text", text: "go" }] },
      {
        id: "b",
        role: "assistant",
        parts: [
          { type: "tool-Bash", toolCallId: "t1", state: "call", input: { command: "ls" } },
          { type: "text", text: "done" },
        ],
      },
    ]
    sync(messages)

    // The SDK mutates a non-last part of the streaming message in place.
    messages[1].parts![0].state = "output-available"
    sync(messages)

    const stored = appStore.get(messageAtomFamily(getPerChatMessageKey(subChatId, "b")))
    expect(stored?.parts?.[0].state).toBe("output-available")
  })

  it("drops per-message state when a message is removed", () => {
    const messages = makeTranscript(4)
    sync(messages)
    expect(appStore.get(messagesByChatAtom(subChatId)).size).toBe(4)

    sync(messages.slice(0, 2))

    const remaining = appStore.get(messagesByChatAtom(subChatId))
    expect(remaining.size).toBe(2)
    expect(remaining.has("message-3")).toBe(false)
    expect(appStore.get(messageIdsPerChatAtom(subChatId))).toEqual(["message-0", "message-1"])
  })
})
