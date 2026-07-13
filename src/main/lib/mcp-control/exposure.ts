import { and, eq } from "drizzle-orm"
import { agentRuns, chats, getDatabase, subChats } from "../db"

type ActiveProductMcpSession = {
  chatId: string
  runId: string
  revoke: () => void
}

const activeProductMcpSessions = new Map<string, ActiveProductMcpSession>()

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
  const updated = getDatabase().transaction((tx) => {
    const result = tx
      .update(chats)
      .set({ mcpExposureEnabled: enabled, updatedAt: new Date() })
      .where(eq(chats.id, chatId))
      .returning({ enabled: chats.mcpExposureEnabled })
      .get()
    if (!result) return result
    if (!result.enabled) {
      // Invalidate launcher-owned child identities in the same durable commit as
      // exposure. A quick disable/re-enable must not revive an old stdio child.
      const running = tx
        .select({ subChatId: agentRuns.subChatId })
        .from(agentRuns)
        .where(and(eq(agentRuns.chatId, chatId), eq(agentRuns.status, "running")))
        .all()
      tx.update(agentRuns)
        .set({ status: "cancelled", completedAt: new Date() })
        .where(and(eq(agentRuns.chatId, chatId), eq(agentRuns.status, "running")))
        .run()
      for (const subChatId of new Set(running.map((run) => run.subChatId).filter(Boolean))) {
        tx.update(subChats).set({ runStatus: "cancelled" }).where(eq(subChats.id, subChatId!)).run()
      }
    }
    return result
  })
  if (!updated) throw new Error("Chat not found")
  if (!updated.enabled) revokeActiveProductMcpSessions(chatId)
  return updated.enabled
}

export function registerActiveProductMcpSession(session: ActiveProductMcpSession): () => void {
  const key = `${session.chatId}\u0000${session.runId}`
  activeProductMcpSessions.set(key, session)
  return () => {
    if (activeProductMcpSessions.get(key) === session) activeProductMcpSessions.delete(key)
  }
}

export function revokeActiveProductMcpSessions(chatId: string): number {
  const matches = [...activeProductMcpSessions.entries()].filter(
    ([, session]) => session.chatId === chatId,
  )
  for (const [key, session] of matches) {
    activeProductMcpSessions.delete(key)
    try {
      session.revoke()
    } catch {
      // Durable exposure is already disabled. Per-call validation remains the
      // fail-closed boundary even if harness teardown itself reports an error.
    }
  }
  return matches.length
}

export function resetActiveProductMcpSessionsForTests(): void {
  activeProductMcpSessions.clear()
}
