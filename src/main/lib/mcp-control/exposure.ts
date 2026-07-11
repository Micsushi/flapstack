import { eq } from "drizzle-orm"
import { chats, getDatabase } from "../db"

export function getChatMcpExposure(chatId: string): boolean {
  const chat = getDatabase().select().from(chats).where(eq(chats.id, chatId)).get()
  return chat?.mcpExposureEnabled ?? false
}

export function setChatMcpExposure(chatId: string, enabled: boolean): boolean {
  const updated = getDatabase()
    .update(chats)
    .set({ mcpExposureEnabled: enabled, updatedAt: new Date() })
    .where(eq(chats.id, chatId))
    .returning({ enabled: chats.mcpExposureEnabled })
    .get()
  if (!updated) throw new Error("Chat not found")
  return updated.enabled
}
