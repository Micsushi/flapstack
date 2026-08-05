type HydratableChat = {
  status: string
  messages: unknown[]
}

export function hydrateChatFromPersistedMessages(
  chat: HydratableChat,
  persistedMessages: readonly unknown[],
): boolean {
  if (
    persistedMessages.length === 0 ||
    chat.status === "streaming" ||
    chat.status === "submitted" ||
    persistedMessages.length <= chat.messages.length
  ) {
    return false
  }

  chat.messages = [...persistedMessages]
  return true
}
