import { describe, expect, it } from "vitest"
import type { AgentActivityEvent } from "../src/shared/agent-activity"
import { resolveContextUsage } from "../src/renderer/features/agents/ui/agent-context-usage"

function usageEvent(
  storageId: number,
  subChatId: string,
  payload: Extract<AgentActivityEvent, { kind: "usage" }>["payload"],
  phase: AgentActivityEvent["phase"] = "snapshot",
): AgentActivityEvent {
  return {
    storageId,
    eventId: `event-${storageId}`,
    runId: "run-1",
    chatId: "chat-1",
    subChatId,
    runtime: "codex",
    harness: "codex",
    provider: "codex-app-server",
    sequence: storageId,
    kind: "usage",
    phase,
    displayClass: "metadata",
    privacyClass: "sensitive",
    receivedAt: storageId,
    redactionState: "none",
    redactionReason: null,
    createdAt: storageId,
    payload,
  }
}

describe("context usage", () => {
  it("uses latest native snapshot and Codex-reported window", () => {
    const result = resolveContextUsage(
      [
        usageEvent(1, "sub-1", { inputTokens: 10_000, contextWindow: 258_400 }),
        usageEvent(2, "other", { inputTokens: 99_000, contextWindow: 1_000_000 }),
        usageEvent(3, "sub-1", { reasoningTokens: 50 }, "updated"),
        usageEvent(4, "sub-1", { inputTokens: 42_057, contextWindow: 258_400 }),
      ],
      "sub-1",
      "codex",
    )

    expect(result).toEqual({
      runId: "run-1",
      inputTokens: 42_057,
      outputTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      contextTokens: 42_057,
      contextWindow: 258_400,
    })
  })

  it("includes Claude cached input in current context", () => {
    const result = resolveContextUsage(
      [usageEvent(1, "sub-1", { inputTokens: 2, cachedTokens: 22_077 })],
      "sub-1",
      "claude-code",
    )

    expect(result).toEqual({
      runId: "run-1",
      inputTokens: 2,
      outputTokens: 0,
      cachedTokens: 22_077,
      reasoningTokens: 0,
      contextTokens: 22_079,
      contextWindow: undefined,
    })
  })
})
