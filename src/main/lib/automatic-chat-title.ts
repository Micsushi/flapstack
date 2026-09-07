import type Database from "better-sqlite3"
import { nowEpochSeconds } from "./db/timestamps"
import { isUntitledChatName } from "../../shared/chat-title"

/** Apply late metadata only to untitled rows, with parent/child changes atomic. */
export function applyAutomaticChatTitle(
  database: Database.Database,
  input: { subChatId: string; parentChatId: string; name: string },
): { subChatApplied: boolean; parentChatApplied: boolean } | null {
  return database.transaction(() => {
    const subChat = database
      .prepare("SELECT name FROM sub_chats WHERE id = ? AND chat_id = ?")
      .get(input.subChatId, input.parentChatId) as { name: string | null } | undefined
    if (!subChat) return null
    if (!isUntitledChatName(subChat.name))
      return { subChatApplied: false, parentChatApplied: false }
    const parent = database
      .prepare("SELECT name FROM chats WHERE id = ?")
      .get(input.parentChatId) as { name: string | null } | undefined
    if (!parent) return null
    const first = database
      .prepare("SELECT id FROM sub_chats WHERE chat_id = ? ORDER BY created_at, rowid LIMIT 1")
      .get(input.parentChatId) as { id: string } | undefined
    const parentChatApplied = first?.id === input.subChatId && isUntitledChatName(parent.name)
    const now = nowEpochSeconds()
    database
      .prepare("UPDATE sub_chats SET name = ?, updated_at = ? WHERE id = ?")
      .run(input.name, now, input.subChatId)
    if (parentChatApplied) {
      database
        .prepare("UPDATE chats SET name = ?, updated_at = ? WHERE id = ?")
        .run(input.name, now, input.parentChatId)
    }
    return { subChatApplied: true, parentChatApplied }
  })()
}
