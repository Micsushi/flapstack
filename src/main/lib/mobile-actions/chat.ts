import { formatMessageReply, type MessageReply } from "../../../shared/message-replies"
import { readMobileConversation } from "./conversation"
import type Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { queueChatRun } from "../run-launch-service"
import { getPermissionPreferences } from "../permissions"
import { nowEpochSeconds } from "../db/timestamps"

/** A project grant permits creation only inside that exact project. */
export function createMobileChat(
  database: Database.Database,
  input: {
    projectId: string
    commandId: string
    message: string
    harness: "codex" | "claude-code"
  },
): string {
  return database
    .transaction(() => {
      const project = database
        .prepare(
          "SELECT default_permission_mode, default_custom_permissions FROM projects WHERE id = ?",
        )
        .get(input.projectId) as
        | { default_permission_mode: string | null; default_custom_permissions: string | null }
        | undefined
      if (!project) throw new Error("Project is unavailable.")
      const chatId = `mobile-${input.commandId}`
      if (database.prepare("SELECT id FROM chats WHERE id = ?").get(chatId)) {
        throw new Error("This conversation already exists.")
      }
      const preferences = getPermissionPreferences()
      const permission = project.default_permission_mode ?? preferences.globalDefault
      const custom =
        permission === "custom"
          ? (project.default_custom_permissions ??
            JSON.stringify(preferences.globalCustomPermissions))
          : null
      const now = nowEpochSeconds()
      const subChatId = randomUUID()
      database
        .prepare(
          "INSERT INTO chats (id, name, scope, project_id, permission_mode, custom_permissions, harness, created_at, updated_at) VALUES (?, ?, 'project', ?, ?, ?, ?, ?, ?)",
        )
        .run(
          chatId,
          input.message.slice(0, 80),
          input.projectId,
          permission,
          custom,
          input.harness,
          now,
          now,
        )
      database
        .prepare(
          "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, messages, created_at, updated_at) VALUES (?, ?, ?, ?, '[]', ?, ?)",
        )
        .run(subChatId, chatId, input.harness, permission, now, now)
      const queued = queueChatRun(database, {
        chatId,
        subChatId,
        initialPrompt: input.message,
        idempotencyKey: `mobile-${input.commandId}`,
      })
      if (!queued.ok) throw new Error(queued.message)
      return chatId
    })
    .immediate()
}

export function sendMobileChat(
  database: Database.Database,
  input: {
    chatId: string
    subChatId: string
    commandId: string
    message: string
    reply?: MessageReply
  },
): boolean {
  if (input.reply) {
    const source = readMobileConversation(
      database,
      input.chatId,
      input.subChatId,
      undefined,
      input.reply.messageId,
    ).messages[0]
    const liveRunId = /^live-(.+):\d+$/.exec(input.reply.messageId)?.[1]
    const liveSource =
      input.reply.role === "assistant" &&
      liveRunId &&
      database
        .prepare("SELECT id FROM agent_runs WHERE id = ? AND chat_id = ? AND sub_chat_id = ?")
        .get(liveRunId, input.chatId, input.subChatId)
    if ((!source || source.role !== input.reply.role) && !liveSource)
      throw new Error("The referenced message is unavailable in this conversation.")
  }
  const queued = queueChatRun(database, {
    chatId: input.chatId,
    subChatId: input.subChatId,
    initialPrompt: input.reply
      ? formatMessageReply(input.reply) + "\n\n" + input.message
      : input.message,
    idempotencyKey: `mobile-${input.commandId}`,
  })
  if (!queued.ok) throw new Error(queued.message)
  return true
}
