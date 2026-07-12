import { eq } from "drizzle-orm"
import { chats, getDatabase } from "../db"

export type McpExposureConnection = "disabled" | "next-run" | "unsupported"

export type McpExposureStatus = {
  enabled: boolean
  supported: boolean
  harness: "codex" | "claude" | null
  connection: McpExposureConnection
  callerLabel: string | null
  error: string | null
}

export function getChatMcpExposure(chatId: string): boolean {
  const chat = getDatabase().select().from(chats).where(eq(chats.id, chatId)).get()
  return chat?.mcpExposureEnabled ?? false
}

export function getChatMcpExposureStatus(chatId: string): McpExposureStatus {
  const chat = getDatabase().select().from(chats).where(eq(chats.id, chatId)).get()
  if (!chat) throw new Error("Chat not found")

  const harness = chat.harness === "codex" || chat.harness === "claude" ? chat.harness : null
  const supported = harness !== null
  const enabled = chat.mcpExposureEnabled && supported

  return {
    enabled,
    supported,
    harness,
    connection: !supported ? "unsupported" : enabled ? "next-run" : "disabled",
    callerLabel: harness ? `${harness === "codex" ? "Codex" : "Claude"} / ${chat.id}` : null,
    error:
      chat.mcpExposureEnabled && !supported
        ? "Choose Codex or Claude before enabling Flapstack MCP."
        : null,
  }
}

export function setChatMcpExposure(chatId: string, enabled: boolean): boolean {
  if (enabled && !getChatMcpExposureStatus(chatId).supported) {
    throw new Error("Flapstack MCP is supported only for Codex and Claude chats")
  }
  const updated = getDatabase()
    .update(chats)
    .set({ mcpExposureEnabled: enabled, updatedAt: new Date() })
    .where(eq(chats.id, chatId))
    .returning({ enabled: chats.mcpExposureEnabled })
    .get()
  if (!updated) throw new Error("Chat not found")
  return updated.enabled
}
