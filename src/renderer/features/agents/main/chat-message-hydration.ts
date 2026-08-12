type HydratableChat = {
  status: string
  messages: unknown[]
}

type InitialResponseState = {
  messages: readonly { role?: unknown }[]
  status: string
  streamId?: string | null
  pendingInitialGeneration: boolean
}

export function shouldAutoGenerateInitialResponse({
  messages,
  status,
  streamId,
  pendingInitialGeneration,
}: InitialResponseState): boolean {
  return (
    pendingInitialGeneration &&
    messages.length === 1 &&
    messages[0]?.role === "user" &&
    status === "ready" &&
    !streamId
  )
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
