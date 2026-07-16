import { describe, expect, it } from "vitest"
import { mergeRuntimeMessages } from "../src/main/lib/agent-runtime/message-merge"

describe("Runtime message merge", () => {
  it("preserves concurrent messages and replaces the fallback for the same run", () => {
    const current = JSON.stringify([
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Review" }] },
      {
        id: "fallback",
        role: "assistant",
        parts: [{ type: "text", text: "Fallback" }],
        metadata: { runId: "run-1" },
      },
      { id: "concurrent", role: "user", parts: [{ type: "text", text: "Next" }] },
    ])
    const incoming = JSON.stringify([
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Review" }] },
      {
        id: "renderer",
        role: "assistant",
        parts: [{ type: "text", text: "Complete" }],
        metadata: { runId: "run-1", durationMs: 22_000 },
      },
    ])

    expect(JSON.parse(mergeRuntimeMessages(current, incoming))).toEqual([
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Review" }] },
      {
        id: "renderer",
        role: "assistant",
        parts: [{ type: "text", text: "Complete" }],
        metadata: { runId: "run-1", durationMs: 22_000 },
      },
      { id: "concurrent", role: "user", parts: [{ type: "text", text: "Next" }] },
    ])
  })
})
