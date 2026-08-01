import { describe, expect, it } from "vitest"
import type { AgentActivityEvent } from "../src/shared/agent-activity"
import {
  buildTranscriptMarkers,
  summarizeChatProgress,
} from "../src/renderer/features/agents/main/chat-transcript-overview-model"

describe("active Chat transcript overview", () => {
  it("shows only known progress values and omits unavailable totals", () => {
    expect(
      summarizeChatProgress({
        events: [],
        isStreaming: false,
        isCompacting: false,
        messageCount: 0,
        changeCount: 0,
      }),
    ).toEqual({
      state: "Ready",
      currentStep: null,
      messageCount: null,
      changeCount: null,
      plan: null,
    })
  })

  it("uses safe Runtime activity while excluding private reasoning from the capsule", () => {
    const events = [
      event(1, "plan", "public", {
        items: [
          { text: "First", status: "built" },
          { text: "Second", status: "active" },
        ],
      }),
      event(2, "reasoning-summary", "private", { text: "PRIVATE_CHAIN_OF_THOUGHT" }),
      event(3, "command", "public", { state: "completed", command: "npm test" }),
    ]
    const summary = summarizeChatProgress({
      events,
      isStreaming: true,
      isCompacting: false,
      messageCount: 4,
      changeCount: 2,
    })
    expect(summary).toMatchObject({
      state: "Working",
      currentStep: "Command completed",
      messageCount: 4,
      changeCount: 2,
      plan: { completed: 1, total: 2 },
    })
    expect(JSON.stringify(summary)).not.toContain("PRIVATE_CHAIN_OF_THOUGHT")
  })

  it("bounds timeline markers while keeping the first and last visible message", () => {
    const messages = Array.from({ length: 40 }, (_, index) => ({
      id: `message-${index + 1}`,
      role: index % 2 ? "assistant" : "user",
      privateReasoning: "never summarize this",
    }))
    const markers = buildTranscriptMarkers(messages, 8)
    expect(markers).toHaveLength(8)
    expect(markers[0]).toMatchObject({ id: "message-1", ordinal: 1, total: 40 })
    expect(markers.at(-1)).toMatchObject({ id: "message-40", ordinal: 40, total: 40 })
    expect(JSON.stringify(markers)).not.toContain("never summarize this")
  })
})

function event(
  storageId: number,
  kind: AgentActivityEvent["kind"],
  privacyClass: AgentActivityEvent["privacyClass"],
  payload: unknown,
): AgentActivityEvent {
  return {
    storageId,
    eventId: `event-${storageId}`,
    runId: "run",
    chatId: "chat",
    subChatId: "subchat",
    runtime: "codex",
    harness: "codex",
    sequence: storageId,
    provider: "test",
    phase: "completed",
    displayClass: "status",
    privacyClass,
    receivedAt: storageId,
    redactionState: "none",
    redactionReason: null,
    createdAt: storageId,
    kind,
    payload,
  } as AgentActivityEvent
}
