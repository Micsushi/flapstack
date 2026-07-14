import { and, eq } from "drizzle-orm"
import { subChats, type getDatabase } from "../db"
import { mergeMessagesPreservingSpokenText } from "../speech/history"

type Database = ReturnType<typeof getDatabase>

function parseMessages(value: string | null | undefined): any[] {
  try {
    const parsed = JSON.parse(value || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function persistClaudeMessagesForStream(
  db: Database,
  input: {
    subChatId: string
    streamId: string
    incomingMessages: any[]
    sessionId?: string | null
  },
): boolean {
  const latest = db
    .select({ messages: subChats.messages })
    .from(subChats)
    .where(eq(subChats.id, input.subChatId))
    .get()
  const finalMessages = mergeMessagesPreservingSpokenText(
    parseMessages(latest?.messages),
    input.incomingMessages,
  )
  const result = db
    .update(subChats)
    .set({
      messages: JSON.stringify(finalMessages),
      sessionId: input.sessionId ?? null,
      streamId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(subChats.id, input.subChatId), eq(subChats.streamId, input.streamId)))
    .run()
  return result.changes === 1
}

export function clearClaudeStreamIfOwned(
  db: Database,
  input: { subChatId: string; streamId: string; sessionId?: string | null },
): boolean {
  const values =
    input.sessionId === undefined
      ? { streamId: null, updatedAt: new Date() }
      : { sessionId: input.sessionId, streamId: null, updatedAt: new Date() }
  const result = db
    .update(subChats)
    .set(values)
    .where(and(eq(subChats.id, input.subChatId), eq(subChats.streamId, input.streamId)))
    .run()
  return result.changes === 1
}
