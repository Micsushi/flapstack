type Message = Record<string, unknown> & {
  id?: unknown
  role?: unknown
  metadata?: unknown
}

export function mergeRuntimeMessages(currentJson: string, incomingJson: string): string {
  const current = parseMessages(currentJson)
  const incoming = parseMessages(incomingJson)
  const incomingById = new Map<string, Message>()
  const incomingByRunId = new Map<string, Message>()
  for (const message of incoming) {
    const id = messageId(message)
    if (id) incomingById.set(id, message)
    const runId = assistantRunId(message)
    if (runId) incomingByRunId.set(runId, message)
  }

  const consumed = new Set<Message>()
  const merged = current.map((message) => {
    const byId = messageId(message) ? incomingById.get(messageId(message)!) : undefined
    const replacement =
      byId ?? (assistantRunId(message) ? incomingByRunId.get(assistantRunId(message)!) : undefined)
    if (!replacement) return message
    consumed.add(replacement)
    return replacement
  })
  for (const message of incoming) {
    if (!consumed.has(message)) merged.push(message)
  }
  return JSON.stringify(merged)
}

function parseMessages(value: string): Message[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as Message[]) : []
  } catch {
    return []
  }
}

function messageId(message: Message): string | null {
  return typeof message.id === "string" && message.id ? message.id : null
}

function assistantRunId(message: Message): string | null {
  if (message.role !== "assistant" || !message.metadata || typeof message.metadata !== "object") {
    return null
  }
  const runId = (message.metadata as { runId?: unknown }).runId
  return typeof runId === "string" && runId ? runId : null
}
