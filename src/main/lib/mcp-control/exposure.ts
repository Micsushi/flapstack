import { and, eq, inArray, isNull } from "drizzle-orm"
import { agentRuns, chats, getDatabase, mcpApprovalRequests, subChats } from "../db"
import type { AgentHarness } from "../../../shared/harness-types"

type ActiveProductMcpSession = {
  chatId: string
  runId: string
  revoke: () => void
}

const activeProductMcpSessions = new Map<string, ActiveProductMcpSession>()

export type McpExposureConnection = "disabled" | "next-run" | "connected" | "unsupported"

export type McpExposureStatus = {
  enabled: boolean
  supported: boolean
  harness: AgentHarness | null
  connection: McpExposureConnection
  callerLabel: string | null
  activeRunIds: string[]
  error: string | null
}

export function getChatMcpExposure(chatId: string): boolean {
  const chat = getDatabase().select().from(chats).where(eq(chats.id, chatId)).get()
  return chat?.mcpExposureEnabled ?? false
}

export function getChatMcpExposureStatus(chatId: string): McpExposureStatus {
  const chat = getDatabase().select().from(chats).where(eq(chats.id, chatId)).get()
  if (!chat) throw new Error("Chat not found")

  const harness: AgentHarness | null =
    chat.harness === "claude"
      ? "claude-code"
      : ["codex", "claude-code", "cursor-agent", "openrouter", "nanogpt"].includes(
            chat.harness ?? "",
          )
        ? (chat.harness as AgentHarness)
        : null
  const supported = harness !== null
  const enabled = chat.mcpExposureEnabled && supported
  const activeRunIds = activeSessionsForChat(chatId).map(([, session]) => session.runId)
  const harnessLabel = harness
    ? {
        codex: "Codex",
        "claude-code": "Claude",
        "cursor-agent": "Cursor",
        openrouter: "OpenRouter",
        nanogpt: "NanoGPT",
      }[harness]
    : null

  return {
    enabled,
    supported,
    harness,
    connection: !supported
      ? "unsupported"
      : !enabled
        ? "disabled"
        : activeRunIds.length > 0
          ? "connected"
          : "next-run",
    callerLabel: !harnessLabel
      ? null
      : activeRunIds.length === 1
        ? `${harnessLabel} / ${chat.id} / ${activeRunIds[0]}`
        : activeRunIds.length > 1
          ? `${harnessLabel} / ${chat.id} / ${activeRunIds.length} active runs`
          : `${harnessLabel} / ${chat.id}`,
    activeRunIds,
    error:
      chat.mcpExposureEnabled && !supported
        ? "Choose a supported agent provider before enabling Flapstack MCP."
        : null,
  }
}

export function setChatMcpExposure(chatId: string, enabled: boolean): boolean {
  if (enabled && !getChatMcpExposureStatus(chatId).supported) {
    throw new Error("Flapstack MCP requires a supported agent provider")
  }
  const productSessions = enabled ? [] : activeSessionsForChat(chatId)
  const productRunIds = [...new Set(productSessions.map(([, session]) => session.runId))]
  const updated = getDatabase().transaction((tx) => {
    const result = tx
      .update(chats)
      .set({ mcpExposureEnabled: enabled, updatedAt: new Date() })
      .where(eq(chats.id, chatId))
      .returning({ enabled: chats.mcpExposureEnabled })
      .get()
    if (!result) return result
    if (!result.enabled) {
      tx.update(mcpApprovalRequests)
        .set({ decision: "deny", grantSession: false })
        .where(
          and(eq(mcpApprovalRequests.callerChatId, chatId), isNull(mcpApprovalRequests.decision)),
        )
        .run()
      // Invalidate launcher-owned child identities in the same durable commit as
      // exposure. A quick disable/re-enable must not revive an old stdio child.
      const running =
        productRunIds.length === 0
          ? []
          : tx
              .select({ subChatId: agentRuns.subChatId })
              .from(agentRuns)
              .where(
                and(
                  eq(agentRuns.chatId, chatId),
                  eq(agentRuns.status, "running"),
                  inArray(agentRuns.id, productRunIds),
                ),
              )
              .all()
      if (productRunIds.length > 0) {
        tx.update(agentRuns)
          .set({ status: "cancelled", completedAt: new Date() })
          .where(
            and(
              eq(agentRuns.chatId, chatId),
              eq(agentRuns.status, "running"),
              inArray(agentRuns.id, productRunIds),
            ),
          )
          .run()
      }
      for (const subChatId of new Set(running.map((run) => run.subChatId).filter(Boolean))) {
        const stillRunning = tx
          .select({ id: agentRuns.id })
          .from(agentRuns)
          .where(and(eq(agentRuns.subChatId, subChatId!), eq(agentRuns.status, "running")))
          .get()
        if (!stillRunning) {
          tx.update(subChats)
            .set({ runStatus: "cancelled" })
            .where(eq(subChats.id, subChatId!))
            .run()
        }
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
  const matches = activeSessionsForChat(chatId)
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

function activeSessionsForChat(chatId: string): Array<[string, ActiveProductMcpSession]> {
  return [...activeProductMcpSessions.entries()].filter(([, session]) => session.chatId === chatId)
}

export function resetActiveProductMcpSessionsForTests(): void {
  activeProductMcpSessions.clear()
}
