import { describe, expect, it } from "vitest"
import {
  appendUniqueReasoningOutputParts,
  codexReasoningEventsToParts,
  extractLatestCodexReasoningEvents,
} from "../src/main/lib/codex/reasoning"

describe("Codex saved-session reasoning bridge (T4)", () => {
  it("recovers the latest visible summary and keeps encrypted content out of UI parts", () => {
    const raw = [
      JSON.stringify({
        timestamp: "2026-07-10T10:00:00.000Z",
        type: "response_item",
        payload: { type: "reasoning", summary: [{ text: "Old summary." }] },
      }),
      JSON.stringify({
        timestamp: "2026-07-10T10:01:00.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          id: "reasoning-2",
          summary: [{ type: "summary_text", text: "Checked files, then ran tests." }],
          encrypted_content: "opaque-provider-blob",
        },
      }),
    ].join("\n")

    const events = extractLatestCodexReasoningEvents(raw, {
      notBeforeTimestampMs: new Date("2026-07-10T10:00:30.000Z").getTime(),
    })
    expect(events.map((event) => event.kind)).toEqual(["reasoning-summary", "opaque"])

    const parts = codexReasoningEventsToParts(events)
    expect(parts).toEqual([
      expect.objectContaining({
        type: "tool-ReasoningOutput",
        label: "Reasoning summary",
        input: { text: "Checked files, then ran tests." },
      }),
    ])
    expect(JSON.stringify(parts)).not.toContain("opaque-provider-blob")
  })

  it("ignores pre-run reasoning and avoids duplicate ACP thought text", () => {
    const raw = JSON.stringify({
      timestamp: "2026-07-10T09:00:00.000Z",
      type: "response_item",
      payload: { type: "reasoning", summary: [{ text: "Too old." }] },
    })
    expect(
      extractLatestCodexReasoningEvents(raw, {
        notBeforeTimestampMs: new Date("2026-07-10T10:00:00.000Z").getTime(),
      }),
    ).toEqual([])

    const part = codexReasoningEventsToParts([
      {
        provider: "codex",
        kind: "reasoning-summary",
        phase: "final",
        id: "summary",
        text: "Already visible.",
      },
    ])[0]
    const message = { parts: [{ type: "reasoning", text: "Already visible." }] }
    expect(appendUniqueReasoningOutputParts(message, [part])).toBe(message)
  })

  it("finds an earlier visible summary when the newest reasoning item is encrypted-only", () => {
    const raw = [
      JSON.stringify({
        timestamp: "2026-07-10T10:00:00.000Z",
        type: "response_item",
        payload: { type: "reasoning", summary: [{ text: "Visible summary." }] },
      }),
      JSON.stringify({
        timestamp: "2026-07-10T10:00:01.000Z",
        type: "response_item",
        payload: { type: "reasoning", summary: [], encrypted_content: "newest-opaque" },
      }),
    ].join("\n")

    expect(extractLatestCodexReasoningEvents(raw)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "reasoning-summary", text: "Visible summary." }),
      ]),
    )
  })
})
