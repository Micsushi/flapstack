export type StoredMessage = {
  id?: string
  role?: string
  content?: string
  parts?: Array<{ type?: string; text?: string; [key: string]: unknown }>
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type RuntimeActivityMessageRow = {
  eventId: string
  sequence: number
  kind: string
  phase: string
  providerMessageId?: string | null
  payloadJson: string
}

export type ActivityAssistant = {
  id: string
  text: string
  metadata: { usage?: Record<string, number> }
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

export function buildActivityAssistant(
  rows: RuntimeActivityMessageRow[],
): ActivityAssistant | null {
  const ordered = [...rows].sort((left, right) => left.sequence - right.sequence)
  const completedText: Array<{ id: string; text: string }> = []
  let usage: Record<string, number> | undefined

  for (const row of ordered) {
    const payload = parseActivityPayload(row.payloadJson)
    if (!payload) continue

    if (row.kind === "agent-text" && row.phase === "completed") {
      const text = typeof payload.text === "string" ? payload.text : ""
      if (text) completedText.push({ id: row.providerMessageId || row.eventId, text })
      continue
    }

    if (row.kind === "usage" && row.phase === "snapshot") {
      const nextUsage = finiteUsage(payload)
      if (Object.keys(nextUsage).length > 0) usage = nextUsage
    }
  }

  if (completedText.length === 0) return null
  const text = completedText
    .map((entry) => entry.text)
    .join("")
    .slice(0, 8_000)
  return {
    id: completedText.at(-1)!.id,
    text,
    metadata: usage ? { usage } : {},
  }
}

function parseActivityPayload(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function finiteUsage(payload: Record<string, unknown>): Record<string, number> {
  const usage: Record<string, number> = {}
  for (const key of ["inputTokens", "outputTokens", "cachedTokens", "reasoningTokens", "costUsd"]) {
    const value = payload[key]
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) usage[key] = value
  }
  const tokenValues = ["inputTokens", "outputTokens", "cachedTokens", "reasoningTokens"]
    .map((key) => usage[key])
    .filter((value): value is number => typeof value === "number")
  if (tokenValues.length > 0) usage.totalTokens = tokenValues.reduce((sum, value) => sum + value, 0)
  return usage
}
