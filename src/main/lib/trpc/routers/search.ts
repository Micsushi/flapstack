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

type SearchResult = {
  type: "project" | "task" | "chat" | "message" | "attachment"
  title: string
  snippet: string
  projectId?: string | null
  taskId?: string | null
  chatId?: string | null
  subChatId?: string | null
}

function snippet(value: string | null | undefined, query: string): string {
  const text = value ?? ""
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return text.slice(0, 160)
  return text.slice(Math.max(0, index - 60), index + query.length + 100)
}

function extractMessageText(messagesJson: string): string {
  try {
    const messages = JSON.parse(messagesJson) as unknown
    if (!Array.isArray(messages)) return messagesJson

    return messages
      .flatMap((message) => {
        if (!message || typeof message !== "object") return []
        const record = message as Record<string, unknown>
        const parts = record.parts
        if (Array.isArray(parts)) {
          return parts.flatMap((part) => {
            if (!part || typeof part !== "object") return []
            const partRecord = part as Record<string, unknown>
            if (
              (partRecord.type === "text" || partRecord.type === "file-content") &&
              typeof partRecord.text === "string"
            ) {
              return [partRecord.text]
            }
            if (partRecord.type === "file-content" && typeof partRecord.content === "string") {
              return [partRecord.content]
            }
            return []
          })
        }
        return typeof record.content === "string" ? [record.content] : []
      })
      .join("\n")
  } catch {
    return messagesJson
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
        const messageText = extractMessageText(subChat.messages)
        if (!messageText.toLowerCase().includes(input.query.toLowerCase())) continue
        const parent = db.select().from(chats).where(eq(chats.id, subChat.chatId)).get()
        if (!parent) continue
        if (!isChatSearchVisible(db, parent, input.includeArchived)) continue
        if (input.scope === "project" && input.scopeId && parent.projectId !== input.scopeId)
          continue
        if (input.scope === "task" && input.scopeId && parent.taskId !== input.scopeId) continue
        results.push({
          type: "message",
          title: parent.name || subChat.name || "Message",
          projectId: parent.projectId,
          taskId: parent.taskId,
          chatId: parent.id,
          subChatId: subChat.id,
          snippet: snippet(messageText, input.query),
        })
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
