import { formatVisiblePartForHandoff } from "../../shared/chat-visible-content"

export type HandoffMessage = {
  id?: string
  role: string
  createdAt?: Date | string
  metadata?: Record<string, unknown>
  content?: string | Array<Record<string, unknown>>
  parts?: Array<Record<string, unknown> & { type?: string; text?: string; toolName?: string }>
}

export type HandoffConversation = {
  subChatId: string
  subChatName: string | null
  createdAt?: Date | string
  messages: HandoffMessage[]
}

export type ChatHandoffInput = {
  chat: { id: string; name: string | null; branch?: string | null; createdAt?: Date | string }
  project?: { name: string } | null
  conversations: HandoffConversation[]
}

function timestampOf(message: HandoffMessage): number | null {
  const candidates = [message.createdAt, message.metadata?.createdAt, message.metadata?.timestamp]
  for (const candidate of candidates) {
    if (!(candidate instanceof Date) && typeof candidate !== "string") continue
    const value = candidate instanceof Date ? candidate : new Date(candidate)
    if (!Number.isNaN(value.getTime())) return value.getTime()
  }
  const fromId = message.id?.match(/^msg-(\d{13})(?:\D|$)/)?.[1]
  return fromId ? Number(fromId) : null
}

export function formatChatHandoff(input: ChatHandoffInput, exportedAt = new Date()): string {
  const lines = [
    "# Flapstack Chat Handoff",
    "",
    `- Chat: ${input.chat.name || "Untitled Chat"}`,
    `- Chat ID: ${input.chat.id}`,
    ...(input.project ? [`- Project: ${input.project.name}`] : []),
    ...(input.chat.branch ? [`- Branch: ${input.chat.branch}`] : []),
    `- Exported: ${exportedAt.toISOString()}`,
    "",
  ]

  const flattened = input.conversations.flatMap((conversation, conversationIndex) => {
    return conversation.messages.map((message, messageIndex) => ({
      conversation,
      conversationIndex,
      message,
      messageIndex,
      timestamp: timestampOf(message),
    }))
  })

  if (flattened.every((item) => item.timestamp !== null)) {
    flattened.sort(
      (left, right) =>
        left.timestamp! - right.timestamp! ||
        left.conversationIndex - right.conversationIndex ||
        left.messageIndex - right.messageIndex,
    )
  }

  for (const item of flattened) {
    const role =
      item.message.role === "user"
        ? "User"
        : item.message.role === "assistant"
          ? "Assistant"
          : item.message.role
    const conversationLabel =
      item.conversationIndex === 0
        ? item.conversation.subChatName || "Visible conversation"
        : `Legacy recovery: ${item.conversation.subChatName || item.conversation.subChatId}`
    const time = item.timestamp ? new Date(item.timestamp).toISOString() : "Time unavailable"
    lines.push(`## ${role} · ${conversationLabel} · ${time}`, "")
    const content =
      typeof item.message.content === "string"
        ? [item.message.content]
        : (item.message.parts ?? item.message.content ?? []).flatMap(formatVisiblePartForHandoff)
    lines.push(content.join("\n\n") || "_(No text content)_", "")
  }

  return lines.join("\n").trimEnd() + "\n"
}

export type HandoffBudget = { maxTokens?: number; maxBytes?: number }

export const DEFAULT_HANDOFF_TOKEN_CAP = 16_000
export const HARD_HANDOFF_BYTE_CAP = 64 * 1024

function configuredPositiveInteger(value: number, fallback: number) {
  return Number.isSafeInteger(value) && value >= 256 ? value : fallback
}

export function handoffByteBudget(budget: HandoffBudget = {}): number {
  const tokens = configuredPositiveInteger(
    budget.maxTokens ?? Number(process.env.FLAPSTACK_HANDOFF_TOKEN_CAP),
    DEFAULT_HANDOFF_TOKEN_CAP,
  )
  const bytes = configuredPositiveInteger(
    budget.maxBytes ?? Number(process.env.FLAPSTACK_HANDOFF_BYTE_CAP),
    HARD_HANDOFF_BYTE_CAP,
  )
  // Provider-independent token estimate. The separate UTF-8 wire cap is exact.
  return Math.min(HARD_HANDOFF_BYTE_CAP, bytes, tokens * 4)
}

export function utf8Prefix(text: string, maxBytes: number): string {
  let end = 0
  let bytes = 0
  for (const character of text) {
    bytes += Buffer.byteLength(character)
    if (bytes > maxBytes) break
    end += character.length
  }
  return text.slice(0, end)
}
