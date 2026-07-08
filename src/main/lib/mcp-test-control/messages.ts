export type StoredMessage = {
  id?: string
  role?: string
  content?: string
  parts?: Array<{ type?: string; text?: string; [key: string]: unknown }>
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export function parseStoredMessages(raw: string | null | undefined): StoredMessage[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredMessage[]) : []
  } catch {
    return []
  }
}

export function getMessageText(message: StoredMessage): string {
  if (typeof message.content === "string") return message.content

  const parts = Array.isArray(message.parts) ? message.parts : []
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
}

export function appendUserMessage(
  rawMessages: string | null | undefined,
  text: string,
  metadata?: Record<string, unknown>,
): string {
  const messages = parseStoredMessages(rawMessages)
  messages.push({
    id: `dev-mcp-${Date.now()}`,
    role: "user",
    parts: [{ type: "text", text }],
    ...(metadata ? { metadata } : {}),
  })
  return JSON.stringify(messages)
}

export function findLastAssistantMessage(messages: StoredMessage[]): StoredMessage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === "assistant") return message
  }

  return null
}

export function summarizeMessages(raw: string | null | undefined): {
  total: number
  user: number
  assistant: number
  lastAssistantText: string | null
} {
  const messages = parseStoredMessages(raw)
  const lastAssistant = findLastAssistantMessage(messages)

  return {
    total: messages.length,
    user: messages.filter((message) => message.role === "user").length,
    assistant: messages.filter((message) => message.role === "assistant").length,
    lastAssistantText: lastAssistant ? getMessageText(lastAssistant).slice(0, 500) : null,
  }
}
