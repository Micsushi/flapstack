import type { AgentActivityEvent } from "../../../../shared/agent-activity"

export function resolveContextUsage(
  events: AgentActivityEvent[],
  subChatId: string,
  provider: string,
): {
  runId: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  reasoningTokens: number
  contextTokens: number
  contextWindow: number | undefined
} | null {
  const event = events.findLast(
    (candidate) =>
      candidate.subChatId === subChatId &&
      candidate.kind === "usage" &&
      candidate.phase === "snapshot" &&
      candidate.payload.inputTokens != null,
  )
  if (!event || event.kind !== "usage" || event.payload.inputTokens == null) return null

  return {
    runId: event.runId,
    inputTokens: event.payload.inputTokens,
    outputTokens: event.payload.outputTokens ?? 0,
    cachedTokens: event.payload.cachedTokens ?? 0,
    reasoningTokens: event.payload.reasoningTokens ?? 0,
    contextTokens:
      event.payload.inputTokens +
      (provider === "claude-code" ? (event.payload.cachedTokens ?? 0) : 0),
    contextWindow: event.payload.contextWindow ?? undefined,
  }
}
