import type Database from "better-sqlite3"
import { createId } from "./db/utils"

export const CHAT_TAG_COLORS = [
  "slate",
  "blue",
  "cyan",
  "green",
  "amber",
  "orange",
  "rose",
  "violet",
] as const

export const CHAT_TAG_ICONS = [
  "alert",
  "ban",
  "reply",
  "eye",
  "clock",
  "star",
  "flag",
  "bookmark",
] as const

export type ChatTagColor = (typeof CHAT_TAG_COLORS)[number]
export type ChatTagIcon = (typeof CHAT_TAG_ICONS)[number]
export type ChatTag = {
  id: string
  name: string
  normalizedName: string
  color: ChatTagColor
  icon: ChatTagIcon | null
  createdAt: number | null
  updatedAt: number | null
}

function normalizeName(name: string): { name: string; normalizedName: string } {
  const clean = name.trim().replace(/\s+/g, " ")
  if (!clean) throw new Error("Tag name is required")
  if (clean.length > 32) throw new Error("Tag names can be at most 32 characters")
  return { name: clean, normalizedName: clean.toLocaleLowerCase() }
}

export function createChatTagStore(sqlite: Database.Database) {
  const rowToTag = (row: Record<string, unknown>): ChatTag => ({
    id: String(row.id),
    name: String(row.name),
    normalizedName: String(row.normalized_name),
    color: row.color as ChatTagColor,
    icon: row.icon == null ? null : (String(row.icon) as ChatTagIcon),
    createdAt: row.created_at == null ? null : Number(row.created_at),
    updatedAt: row.updated_at == null ? null : Number(row.updated_at),
  })

  return {
    list(): ChatTag[] {
      return sqlite
        .prepare("SELECT * FROM chat_tags ORDER BY normalized_name, id")
        .all()
        .map((row) => rowToTag(row as Record<string, unknown>))
    },
    create(input: { name: string; color: ChatTagColor; icon?: ChatTagIcon | null }): ChatTag {
      const names = normalizeName(input.name)
      const now = Date.now()
      const id = createId()
      try {
        sqlite
          .prepare(
            "INSERT INTO chat_tags (id, name, normalized_name, color, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(id, names.name, names.normalizedName, input.color, input.icon ?? null, now, now)
      } catch (error) {
        if (error instanceof Error && /unique/i.test(error.message)) {
          throw new Error(`A tag named '${names.name}' already exists`)
        }
        throw error
      }
      return rowToTag(
        sqlite.prepare("SELECT * FROM chat_tags WHERE id = ?").get(id) as Record<string, unknown>,
      )
    },
    update(input: {
      id: string
      name: string
      color: ChatTagColor
      icon?: ChatTagIcon | null
    }): ChatTag {
      const names = normalizeName(input.name)
      try {
        const result =
          input.icon === undefined
            ? sqlite
                .prepare(
                  "UPDATE chat_tags SET name = ?, normalized_name = ?, color = ?, updated_at = ? WHERE id = ?",
                )
                .run(names.name, names.normalizedName, input.color, Date.now(), input.id)
            : sqlite
                .prepare(
                  "UPDATE chat_tags SET name = ?, normalized_name = ?, color = ?, icon = ?, updated_at = ? WHERE id = ?",
                )
                .run(
                  names.name,
                  names.normalizedName,
                  input.color,
                  input.icon,
                  Date.now(),
                  input.id,
                )
        if (result.changes === 0) throw new Error("Tag not found")
      } catch (error) {
        if (error instanceof Error && /unique/i.test(error.message)) {
          throw new Error(`A tag named '${names.name}' already exists`)
        }
        throw error
      }
      return rowToTag(
        sqlite.prepare("SELECT * FROM chat_tags WHERE id = ?").get(input.id) as Record<
          string,
          unknown
        >,
      )
    },
    delete(id: string): void {
      sqlite.prepare("DELETE FROM chat_tags WHERE id = ?").run(id)
    },
    assign(input: { chatId: string; tagId: string }): void {
      sqlite
        .prepare(
          "INSERT OR IGNORE INTO chat_tag_assignments (chat_id, tag_id, created_at) VALUES (?, ?, ?)",
        )
        .run(input.chatId, input.tagId, Date.now())
    },
    unassign(input: { chatId: string; tagId: string }): void {
      sqlite
        .prepare("DELETE FROM chat_tag_assignments WHERE chat_id = ? AND tag_id = ?")
        .run(input.chatId, input.tagId)
    },
    listForChats(chatIds: string[]): Map<string, ChatTag[]> {
      const result = new Map(chatIds.map((id) => [id, [] as ChatTag[]]))
      if (chatIds.length === 0) return result
      const placeholders = chatIds.map(() => "?").join(",")
      const rows = sqlite
        .prepare(
          `SELECT a.chat_id, t.* FROM chat_tag_assignments a JOIN chat_tags t ON t.id = a.tag_id WHERE a.chat_id IN (${placeholders}) ORDER BY t.normalized_name, t.id`,
        )
        .all(...chatIds) as Array<Record<string, unknown>>
      for (const row of rows) result.get(String(row.chat_id))?.push(rowToTag(row))
      return result
    },
  }
}
