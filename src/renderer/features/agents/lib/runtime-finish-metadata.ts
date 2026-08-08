import type { AgentActivityPayloadByKind } from "../../../../shared/agent-activity"

type DirectRuntimeHarness = "codex" | "claude-code"
export type DirectRuntimeUsage = AgentActivityPayloadByKind["usage"]

export function directRuntimeFinishMetadata(input: {
  runId: string
  harness: DirectRuntimeHarness
  startedAtMs: number
  durationMs: number
  stoppedByUser?: boolean
  usage?: DirectRuntimeUsage
}) {
  const inputTokens = input.usage?.inputTokens
  const outputTokens = input.usage?.outputTokens
  const cachedTokens = input.usage?.cachedTokens
  return {
    runId: input.runId,
    transport: `${input.harness}-runtime`,
    startedAt: input.startedAtMs,
    durationMs: input.durationMs,
    ...(inputTokens != null ? { inputTokens } : {}),
    ...(outputTokens != null ? { outputTokens } : {}),
    ...(inputTokens != null || outputTokens != null
      ? {
          totalTokens:
            (inputTokens ?? 0) +
            (outputTokens ?? 0) +
            (input.harness === "claude-code" ? (cachedTokens ?? 0) : 0),
        }
      : {}),
    ...(cachedTokens != null ? { cacheReadInputTokens: cachedTokens } : {}),
    ...(input.usage?.reasoningTokens != null
      ? { reasoningTokens: input.usage.reasoningTokens }
      : {}),
    ...(input.usage?.contextWindow != null
      ? { modelContextWindow: input.usage.contextWindow }
      : {}),
    ...(input.stoppedByUser ? { stoppedByUser: true } : {}),
  }
}
