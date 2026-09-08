import type Database from "better-sqlite3"
import { hostname } from "node:os"
import { discussionHostId } from "./discussions/service"
import {
  chatAssignmentSchema,
  updateChatAssignmentSchema,
  type ChatAssignment,
} from "../../shared/chat-assignment"

type ChatRow = ChatAssignment & { id: string; name: string | null; projectId: string | null }
const columns = `id, name, project_id AS projectId, assigned_role AS assignedRole,
  lead_chat_id AS leadChatId, discussion_chat_id AS discussionChatId`
const assignmentOf = (row: ChatRow) =>
  chatAssignmentSchema.parse({
    assignedRole: row.assignedRole,
    leadChatId: row.leadChatId,
    discussionChatId: row.discussionChatId,
  })
function paneChat(db: Database.Database, subChatId: string): ChatRow {
  const pane = db.prepare("SELECT chat_id AS chatId FROM sub_chats WHERE id = ?").get(subChatId) as
    { chatId: string } | undefined
  const chat =
    pane &&
    (db.prepare(`SELECT ${columns} FROM chats WHERE id = ?`).get(pane.chatId) as
      ChatRow | undefined)
  if (!chat) throw new Error("Chat pane not found")
  return chat
}

export function getChatAssignment(db: Database.Database, subChatId: string) {
  const chat = paneChat(db, subChatId)
  const choices = chat.projectId
    ? (db
        .prepare(`SELECT ${columns} FROM chats WHERE project_id = ? AND id != ? ORDER BY name, id`)
        .all(chat.projectId, chat.id) as ChatRow[])
    : []
  return {
    chatId: chat.id,
    projectId: chat.projectId,
    assignment: assignmentOf(chat),
    choices,
    localHost: { id: discussionHostId(), label: hostname() },
  }
}

export function updateChatAssignment(db: Database.Database, raw: unknown) {
  const input = updateChatAssignmentSchema.parse(raw)
  return db.transaction(() => {
    const chat = paneChat(db, input.subChatId)
    const current = assignmentOf(chat)
    if (JSON.stringify(current) !== JSON.stringify(input.expected)) {
      throw new Error("Chat assignment changed elsewhere. Reopen the control before editing.")
    }
    const next = input.assignment
    if (next.leadChatId && next.assignedRole !== "worker")
      throw new Error("Only a worker can link to a lead")
    if (next.discussionChatId && next.assignedRole !== "worker" && next.assignedRole !== "lead") {
      throw new Error("Only a lead or worker can link to a discussion")
    }
    for (const [targetId, role] of [
      [next.leadChatId, "lead"],
      [next.discussionChatId, "discussion"],
    ] as const) {
      if (!targetId) continue
      if (targetId === chat.id) throw new Error("A chat cannot link to itself")
      const target = db.prepare(`SELECT ${columns} FROM chats WHERE id = ?`).get(targetId) as
        ChatRow | undefined
      if (!chat.projectId || !target || target.projectId !== chat.projectId)
        throw new Error("Linked chats must belong to the same project")
      if (target.assignedRole !== role)
        throw new Error(`Linked chat must have the owner-assigned ${role} role`)
    }
    // Existing links must remain true when a role is removed or changed.
    if (next.assignedRole !== current.assignedRole) {
      const dependent = db
        .prepare("SELECT id FROM chats WHERE lead_chat_id = ? OR discussion_chat_id = ? LIMIT 1")
        .get(chat.id, chat.id)
      if (dependent) throw new Error("Remove incoming chat links before changing this role")
    }
    db.prepare(
      "UPDATE chats SET assigned_role = ?, lead_chat_id = ?, discussion_chat_id = ? WHERE id = ?",
    ).run(next.assignedRole, next.leadChatId, next.discussionChatId, chat.id)
    return getChatAssignment(db, input.subChatId)
  })()
}

export function assertChatAssignmentProjectMove(
  db: Database.Database,
  chatId: string,
  projectId: string | null,
) {
  const chat = db.prepare(`SELECT ${columns} FROM chats WHERE id = ?`).get(chatId) as
    ChatRow | undefined
  if (!chat || chat.projectId === projectId) return
  const incoming = db
    .prepare("SELECT id FROM chats WHERE lead_chat_id = ? OR discussion_chat_id = ? LIMIT 1")
    .get(chatId, chatId)
  if (chat.leadChatId || chat.discussionChatId || incoming) {
    throw new Error("Remove chat assignment links before moving to another project")
  }
}
