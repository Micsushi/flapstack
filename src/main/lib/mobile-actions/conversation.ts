import { parseMessageReply, type MessageReply } from "../../../shared/message-replies"
import type Database from "better-sqlite3"
import { redactMobileText } from "../../../shared/mobile-control"
import { createAgentActivityStore } from "../agent-runtime/activity-store"

export function readMobileConversation(
  database: Database.Database,
  chatId: string,
  subChatId?: string,
  before?: number,
  messageId?: string,
) {
  const conversations = database
    .prepare("SELECT id, name FROM sub_chats WHERE chat_id = ? ORDER BY created_at, id")
    .all(chatId) as Array<{ id: string; name: string | null }>
  const selected = subChatId ?? conversations[0]?.id
  const row = database
    .prepare("SELECT messages FROM sub_chats WHERE chat_id = ? AND id = ?")
    .get(chatId, selected ?? "") as { messages: string } | undefined
  if (!row) throw new Error("Conversation unavailable.")
  const messages: Array<{
    id: string
    role: "user" | "assistant"
    text: string
    reply?: MessageReply
  }> = []
  const append = (id: string, role: "user" | "assistant", text: string) => {
    const separator = text.indexOf("\n\n")
    let reference = separator >= 0 ? parseMessageReply(text.slice(0, separator)) : null
    if (reference) text = text.slice(separator + 2)
    // Desktop selection quotes and reply references can appear together, in
    // either order. Decode every quote before applying phone redaction.
    text = text.replace(/@\[quote:[^:\]]*:([A-Za-z0-9+/=]+)\]\s*/g, (_token, encoded: string) => {
      const decoded = Buffer.from(encoded, "base64").toString("utf8")
      const reply = parseMessageReply(decoded)
      if (reply && !reference) {
        reference = reply
        return ""
      }
      return "Quoted context:\n" + (reply?.text ?? decoded) + "\n\n"
    })
    const reply = reference
      ? {
          ...reference,
          messageId: redactMobileText(reference.messageId, reference.messageId.length),
          text: redactMobileText(reference.text, reference.text.length),
        }
      : undefined
    const safe = redactMobileText(text, text.length)
    // Keep reference metadata outside text chunks so a long quote cannot split
    // its JSON framing or turn redacted credentials into malformed metadata.
    for (let offset = 0; offset < Math.max(1, safe.length); offset += 8_000)
      messages.push({
        id: `${id}:${offset}`,
        role,
        text: safe.slice(offset, offset + 8_000),
        ...(offset === 0 && reply ? { reply } : {}),
      })
  }
  const parsed: unknown = JSON.parse(row.messages)
  if (Array.isArray(parsed))
    for (const message of parsed) {
      if (!message || (message.role !== "user" && message.role !== "assistant")) continue
      const text = Array.isArray(message.parts)
        ? message.parts
            .filter(
              (part: { type?: string; text?: unknown }) =>
                part?.type === "text" && typeof part.text === "string",
            )
            .map((part: { text: string }) => part.text)
            .join("\n")
        : typeof message.content === "string"
          ? message.content
          : ""
      append(String(message.id ?? messages.length), message.role, text)
    }
  const runs = database
    .prepare(
      "SELECT id, initial_prompt, prompt_message_id, status FROM agent_runs WHERE sub_chat_id = ? AND (status IN ('pending', 'running') OR prompt_message_id LIKE 'mcp-mobile-%') ORDER BY started_at, rowid",
    )
    .all(selected) as Array<{
    id: string
    initial_prompt: string
    prompt_message_id: string
    status: string
  }>
  for (const run of runs) {
    if (!Array.isArray(parsed) || !parsed.some((message) => message?.id === run.prompt_message_id))
      append(run.prompt_message_id, "user", run.initial_prompt)
    if (run.status === "running")
      append(`live-${run.id}`, "assistant", liveAssistantText(database, run.id))
  }
  const end = Math.min(before ?? messages.length, messages.length)
  const start = Math.max(0, end - 10)
  const acceptedCommands = database
    .prepare(
      "SELECT prompt_message_id FROM agent_runs WHERE sub_chat_id = ? AND prompt_message_id LIKE 'mcp-mobile-%' ORDER BY started_at DESC LIMIT 100",
    )
    .all(selected) as Array<{ prompt_message_id: string }>
  return {
    chatId,
    subChatId: selected,
    conversations: conversations.map((item) => ({
      ...item,
      name: item.name ? redactMobileText(item.name) : null,
    })),
    messages: messageId
      ? messages.filter((message) => message.id === messageId)
      : messages.slice(start, end),
    acceptedCommands: acceptedCommands.map((row) =>
      row.prompt_message_id.slice("mcp-mobile-".length),
    ),
    pageBefore: before ?? null,
    before: start || null,
    status: runs.some((run) => run.status === "running")
      ? "running"
      : runs.some((run) => run.status === "pending")
        ? "pending"
        : runs.at(-1)?.status === "failure"
          ? "failed"
          : "idle",
  }
}

function liveAssistantText(database: Database.Database, runId: string): string {
  const store = createAgentActivityStore(database)
  const parts = new Map<string, string>()
  let cursor: number | undefined
  do {
    const page = store.query({
      runId,
      kinds: ["agent-text"],
      afterStorageId: cursor,
      direction: "forward",
      limit: 500,
      corruptionMode: "redacted-placeholder",
    })
    for (const event of page.events) {
      if (
        event.kind !== "agent-text" ||
        event.privacyClass === "private" ||
        event.privacyClass === "encrypted"
      )
        continue
      const key = `${event.providerMessageId ?? ""}:${event.providerItemId ?? ""}:${event.contentIndex ?? 0}`
      if (event.phase === "delta") parts.set(key, (parts.get(key) ?? "") + event.payload.text)
      else if (event.phase === "started" || event.phase === "completed")
        parts.set(key, event.payload.text)
    }
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return [...parts.values()].join("\n\n")
}
