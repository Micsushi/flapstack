import { describe, expect, it } from "vitest"
import type { AgentActivityEvent } from "../src/shared/agent-activity"
import { resolveContextUsage } from "../src/renderer/features/agents/ui/agent-context-usage"

function usageEvent(
  storageId: number,
  subChatId: string,
  payload: Extract<AgentActivityEvent, { kind: "usage" }>["payload"],
  phase: AgentActivityEvent["phase"] = "snapshot",
  harness: AgentActivityEvent["harness"] = "codex",
): AgentActivityEvent {
  return {
    storageId,
    eventId: `event-${storageId}`,
    runId: "run-1",
    chatId: "chat-1",
    subChatId,
    runtime: "codex",
    harness,
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
  it("shows a provider-reported threshold and never borrows a different provider's limit", () => {
    const events = [
      usageEvent(
        1,
        "sub-1",
        { contextUsed: 912, contextWindow: 32_768 },
        "snapshot",
        "antigravity",
      ),
      usageEvent(2, "sub-1", {
        contextUsed: 5_000,
        autoCompactThreshold: 117_000,
        autoCompactEnabled: true,
      }),
    ]
    expect(resolveContextUsage(events, "sub-1", "codex")).toMatchObject({
      contextTokens: 5_000,
      autoCompactThreshold: 117_000,
      autoCompactEnabled: true,
    })
    expect(resolveContextUsage(events, "sub-1", "antigravity")).not.toHaveProperty(
      "autoCompactThreshold",
    )
  })
})
