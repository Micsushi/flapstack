import { and, eq, isNull, like, or } from "drizzle-orm"
import { z } from "zod"
import {
  attachments,
  chats,
  getDatabase,
  projects,
  subChats,
  tasks,
  type Chat,
  type Task,
} from "../../db"
import { publicProcedure, router } from "../index"
import { extractVisibleMessageParts } from "../../../../shared/chat-visible-content"

type SearchResult = {
  type: "project" | "task" | "chat" | "message" | "attachment"
  title: string
  snippet: string
  projectId?: string | null
  taskId?: string | null
  chatId?: string | null
  subChatId?: string | null
  messageId?: string | null
}

function snippet(value: string | null | undefined, query: string): string {
  const text = value ?? ""
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return text.slice(0, 160)
  return text.slice(Math.max(0, index - 60), index + query.length + 100)
}

type IndexedMessageText = { messageId?: string; text: string }

export function extractMessageTexts(messagesJson: string): IndexedMessageText[] {
  try {
    const messages = JSON.parse(messagesJson) as unknown
    if (typeof messages === "string") return [{ text: messages }]
    if (!Array.isArray(messages)) return []

    return messages
      .map((message): IndexedMessageText | null => {
        if (!message || typeof message !== "object") return null
        const record = message as Record<string, unknown>
        const parts = record.parts
        const messageId = typeof record.id === "string" ? record.id : undefined
        if (Array.isArray(parts) || Array.isArray(record.content)) {
          const text = extractVisibleMessageParts({
            parts: Array.isArray(parts) ? parts : record.content,
          })
            .map((part) => part.text)
            .join("\n")
          return text ? { messageId, text } : null
        }
        return typeof record.content === "string" ? { messageId, text: record.content } : null
      })
      .filter((entry): entry is IndexedMessageText => entry !== null)
  } catch {
    // Older rows can contain plain text instead of JSON. Keep those searchable,
    // but never index malformed JSON because metadata and hidden tool inputs are
    // outside the user-visible search contract.
    return /^[\[{]/.test(messagesJson.trim()) ? [] : [{ text: messagesJson }]
  }
}

function isTaskSearchVisible(
  db: ReturnType<typeof getDatabase>,
  task: Task,
  includeArchived: boolean,
) {
  if (includeArchived) return true
  if (task.archivedAt) return false

  const project = db.select().from(projects).where(eq(projects.id, task.projectId)).get()
  return !project?.archivedAt
}

function isChatSearchVisible(
  db: ReturnType<typeof getDatabase>,
  chat: Chat,
  includeArchived: boolean,
) {
  if (includeArchived) return true
  if (chat.archivedAt) return false

  if (chat.projectId) {
    const project = db.select().from(projects).where(eq(projects.id, chat.projectId)).get()
    if (project?.archivedAt) return false
  }

  if (chat.taskId) {
    const task = db.select().from(tasks).where(eq(tasks.id, chat.taskId)).get()
    if (task && !isTaskSearchVisible(db, task, includeArchived)) return false
  }

  return true
}

export const searchRouter = router({
  query: publicProcedure
    .input(
      z.object({
        query: z.string().min(1),
        scope: z.enum(["all", "project", "task", "chat"]).default("all"),
        scopeId: z.string().optional(),
        includeArchived: z.boolean().default(false),
      }),
    )
    .query(({ input }) => {
      const db = getDatabase()
      const pattern = `%${input.query}%`
      const results: SearchResult[] = []

      if (input.scope === "all") {
        const projectConditions = [like(projects.name, pattern)]
        if (!input.includeArchived) projectConditions.push(isNull(projects.archivedAt))
        for (const project of db
          .select()
          .from(projects)
          .where(and(...projectConditions))
          .all()) {
          results.push({
            type: "project",
            title: project.name,
            snippet: snippet(project.name, input.query),
            projectId: project.id,
          })
        }
      }

      if (input.scope === "all" || input.scope === "project") {
        const taskConditions = [or(like(tasks.name, pattern), like(tasks.description, pattern))]
        if (input.scope === "project" && input.scopeId) {
          taskConditions.push(eq(tasks.projectId, input.scopeId))
        }
        if (!input.includeArchived) taskConditions.push(isNull(tasks.archivedAt))
        for (const task of db
          .select()
          .from(tasks)
          .where(and(...taskConditions))
          .all()) {
          if (!isTaskSearchVisible(db, task, input.includeArchived)) continue
          results.push({
            type: "task",
            title: task.name,
            snippet: snippet(task.description || task.name, input.query),
            projectId: task.projectId,
            taskId: task.id,
          })
        }
      }

      const chatConditions = [like(chats.name, pattern)]
      if (input.scope === "project" && input.scopeId)
        chatConditions.push(eq(chats.projectId, input.scopeId))
      if (input.scope === "task" && input.scopeId)
        chatConditions.push(eq(chats.taskId, input.scopeId))
      if (input.scope === "chat" && input.scopeId) chatConditions.push(eq(chats.id, input.scopeId))
      if (!input.includeArchived) chatConditions.push(isNull(chats.archivedAt))
      for (const chat of db
        .select()
        .from(chats)
        .where(and(...chatConditions))
        .all()) {
        if (!isChatSearchVisible(db, chat, input.includeArchived)) continue
        results.push({
          type: "chat",
          title: chat.name || "Untitled chat",
          snippet: snippet(chat.name, input.query),
          projectId: chat.projectId,
          taskId: chat.taskId,
          chatId: chat.id,
        })
      }

      const messageConditions = [like(subChats.messages, pattern)]
      if (input.scope === "chat" && input.scopeId)
        messageConditions.push(eq(subChats.chatId, input.scopeId))
      for (const subChat of db
        .select()
        .from(subChats)
        .where(and(...messageConditions))
        .all()) {
        const matchingMessages = extractMessageTexts(subChat.messages).filter((entry) =>
          entry.text.toLowerCase().includes(input.query.toLowerCase()),
        )
        if (matchingMessages.length === 0) continue
        const parent = db.select().from(chats).where(eq(chats.id, subChat.chatId)).get()
        if (!parent) continue
        if (!isChatSearchVisible(db, parent, input.includeArchived)) continue
        if (input.scope === "project" && input.scopeId && parent.projectId !== input.scopeId)
          continue
        if (input.scope === "task" && input.scopeId && parent.taskId !== input.scopeId) continue
        for (const match of matchingMessages) {
          results.push({
            type: "message",
            title: parent.name || subChat.name || "Message",
            projectId: parent.projectId,
            taskId: parent.taskId,
            chatId: parent.id,
            subChatId: subChat.id,
            messageId: match.messageId,
            snippet: snippet(match.text, input.query),
          })
        }
      }

      const attachmentConditions = [
        or(like(attachments.name, pattern), like(attachments.contentText, pattern)),
      ]
      if (input.scope === "task" && input.scopeId)
        attachmentConditions.push(eq(attachments.taskId, input.scopeId))
      if (input.scope === "chat" && input.scopeId)
        attachmentConditions.push(eq(attachments.chatId, input.scopeId))
      for (const attachment of db
        .select()
        .from(attachments)
        .where(and(...attachmentConditions))
        .all()) {
        const parent = db.select().from(chats).where(eq(chats.id, attachment.chatId)).get()
        if (!parent) continue
        if (!isChatSearchVisible(db, parent, input.includeArchived)) continue
        if (input.scope === "project" && input.scopeId && parent.projectId !== input.scopeId)
          continue
        results.push({
          type: "attachment",
          title: attachment.name,
          snippet: snippet(attachment.contentText || attachment.name, input.query),
          projectId: parent.projectId,
          taskId: attachment.taskId ?? parent.taskId,
          chatId: attachment.chatId,
        })
      }

      return results
    }),
})
