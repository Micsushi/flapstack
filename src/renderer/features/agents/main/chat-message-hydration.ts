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
    persistedMessages.length < chat.messages.length
  ) {
    return false
  }

  if (persistedMessages.length === chat.messages.length) {
    let recovered = false
    const messages = chat.messages.map((message, index) => {
      const persisted = persistedMessages[index]
      if (!message || typeof message !== "object" || !persisted || typeof persisted !== "object")
        return message
      const current = message as { id?: unknown; role?: unknown; parts?: unknown }
      const saved = persisted as { id?: unknown; role?: unknown; parts?: unknown }
      // Recover only empty assistant placeholders with the same durable identity.
      // Without a revision, nonempty local output may be newer than persistence.
      if (
        current.role !== "assistant" ||
        saved.role !== "assistant" ||
        typeof current.id !== "string" ||
        current.id !== saved.id ||
        !Array.isArray(current.parts) ||
        !Array.isArray(saved.parts) ||
        !current.parts.every(isEmptyTextPart) ||
        saved.parts.every(isEmptyTextPart)
      )
        return message
      recovered = true
      return persisted
    })
    if (!recovered) return false
    chat.messages = messages
  } else {
    chat.messages = [...persistedMessages]
  }
  return true
}

function isEmptyTextPart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false
  const value = part as { type?: unknown; text?: unknown }
  return (value.type === "text" || value.type === "reasoning") && value.text === ""
}
