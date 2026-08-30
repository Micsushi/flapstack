import { sanitizeHarnessEnvelopeEcho } from "../../../../shared/harness-envelope-sanitizer"

type HydratableChat = {
  status: string
  messages: unknown[]
}

export function sanitizePersistedHarnessMessages(messages: readonly unknown[]): unknown[] {
  return messages.map((message) => {
    if (!message || typeof message !== "object") return message
    const record = message as { role?: unknown; parts?: unknown }
    if (record.role !== "assistant" || !Array.isArray(record.parts)) return message

    let changed = false
    const parts = record.parts.map((part) => {
      if (!part || typeof part !== "object") return part
      const partRecord = part as { type?: unknown; text?: unknown }
      if (
        (partRecord.type !== "text" && partRecord.type !== "reasoning") ||
        typeof partRecord.text !== "string"
      ) {
        return part
      }

      const text = sanitizeHarnessEnvelopeEcho(partRecord.text)
      if (text === partRecord.text) return part
      changed = true
      return { ...partRecord, text }
    })

    return changed ? { ...record, parts } : message
  })
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
