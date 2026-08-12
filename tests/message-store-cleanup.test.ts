import { afterEach, describe, expect, it } from "vitest"
import { appStore } from "../src/renderer/lib/jotai-store"
import {
  assistantIdsForUserMsgAtomFamily,
  clearSubChatCaches,
  isFirstUserMessageAtomFamily,
  isLastMessageAtomFamily,
  isLastUserMessageAtomFamily,
  isMessageStreamingAtomFamily,
  messageGroupsPerChatAtom,
  messageIdsPerChatAtom,
  messageRolesPerChatAtom,
  messagesByChatAtom,
  rollbackTargetSdkUuidForUserMsgAtomFamily,
  syncMessagesWithStatusAtom,
  userMessageIdsPerChatAtom,
  type Message,
} from "../src/renderer/features/agents/stores/message-store"

function transcript(prefix: string, length: number): Message[] {
  return Array.from<Message>({ length }, (_, index) => ({
    id: `${prefix}-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `${prefix} ${index}` }],
  }))
}

function sync(subChatId: string, messages: Message[]) {
  appStore.set(syncMessagesWithStatusAtom, {
    messages,
    status: "ready",
    subChatId,
    updateGlobal: false,
  })
}

describe("clearSubChatCaches", () => {
  afterEach(() => {
    clearSubChatCaches("chat-a")
    clearSubChatCaches("chat-b")
  })

  it("removes every subChat-keyed atom family entry", () => {
    const messages = transcript("a", 4)
    sync("chat-a", messages)

    const before = {
      ids: messageIdsPerChatAtom("chat-a"),
      roles: messageRolesPerChatAtom("chat-a"),
      userIds: userMessageIdsPerChatAtom("chat-a"),
      groups: messageGroupsPerChatAtom("chat-a"),
      messages: messagesByChatAtom("chat-a"),
    }
    // Touch the derived families so they are materialized before cleanup.
    appStore.get(before.userIds)
    appStore.get(before.groups)

    clearSubChatCaches("chat-a")

    // A removed family key yields a fresh atom identity on next access.
    expect(messageIdsPerChatAtom("chat-a")).not.toBe(before.ids)
    expect(messageRolesPerChatAtom("chat-a")).not.toBe(before.roles)
    expect(userMessageIdsPerChatAtom("chat-a")).not.toBe(before.userIds)
    expect(messageGroupsPerChatAtom("chat-a")).not.toBe(before.groups)
    expect(messagesByChatAtom("chat-a")).not.toBe(before.messages)

    // And the replacements are empty rather than carrying the old transcript.
    expect(appStore.get(messageIdsPerChatAtom("chat-a"))).toEqual([])
    expect(appStore.get(messagesByChatAtom("chat-a")).size).toBe(0)
  })

  it("removes message-id keyed families owned by the cleaned chat", () => {
    sync("chat-a", transcript("a", 4))

    const owned = {
      last: isLastMessageAtomFamily("a-3"),
      streaming: isMessageStreamingAtomFamily("a-3"),
      assistants: assistantIdsForUserMsgAtomFamily("a-0"),
      lastUser: isLastUserMessageAtomFamily("a-0"),
      firstUser: isFirstUserMessageAtomFamily("a-0"),
      rollback: rollbackTargetSdkUuidForUserMsgAtomFamily("a-0"),
    }

    clearSubChatCaches("chat-a")

    expect(isLastMessageAtomFamily("a-3")).not.toBe(owned.last)
    expect(isMessageStreamingAtomFamily("a-3")).not.toBe(owned.streaming)
    expect(assistantIdsForUserMsgAtomFamily("a-0")).not.toBe(owned.assistants)
    expect(isLastUserMessageAtomFamily("a-0")).not.toBe(owned.lastUser)
    expect(isFirstUserMessageAtomFamily("a-0")).not.toBe(owned.firstUser)
    expect(rollbackTargetSdkUuidForUserMsgAtomFamily("a-0")).not.toBe(owned.rollback)
  })

  it("keeps message-id keyed families that another live chat still uses", () => {
    // Message ids are only unique per chat, so a shared id must survive.
    const shared = transcript("shared", 2)
    sync("chat-a", shared)
    sync("chat-b", shared)

    const sharedLast = isLastMessageAtomFamily("shared-1")
    const sharedFirstUser = isFirstUserMessageAtomFamily("shared-0")

    clearSubChatCaches("chat-a")

    expect(isLastMessageAtomFamily("shared-1")).toBe(sharedLast)
    expect(isFirstUserMessageAtomFamily("shared-0")).toBe(sharedFirstUser)

    clearSubChatCaches("chat-b")

    // Once the last owner is gone the key is released.
    expect(isLastMessageAtomFamily("shared-1")).not.toBe(sharedLast)
  })
})
