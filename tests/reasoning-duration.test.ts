import { describe, expect, it } from "vitest"
import {
  formatReasoningDuration,
  formatReasoningStatus,
} from "../src/renderer/features/agents/lib/reasoning-duration"
import { dedupeVisibleReasoningParts } from "../src/renderer/features/agents/lib/reasoning-parts"

describe("reasoning duration labels", () => {
  it("formats live seconds", () => {
    expect(formatReasoningStatus(true, 42_900)).toBe("Working for 42s")
  })

  it("formats completed minutes and seconds", () => {
    expect(formatReasoningStatus(false, 665_900)).toBe("Worked for 11m 5s")
  })

  it("does not invent a duration for historical output without timing metadata", () => {
    expect(formatReasoningStatus(false)).toBe("Worked")
  })

  it("clamps sub-second display to zero", () => {
    expect(formatReasoningDuration(400)).toBe("0s")
  })
})

describe("visible reasoning parts", () => {
  const isReasoningPart = (part: any) => part.type === "reasoning"

  it("keeps only the first exact visible reasoning copy", () => {
    const first = { type: "reasoning", text: "Checked the response approach." }
    const duplicateSummary = {
      type: "reasoning",
      input: { text: "  Checked the response   approach. " },
      label: "Reasoning summary",
    }

    expect(
      dedupeVisibleReasoningParts([first, { type: "text" }, duplicateSummary], isReasoningPart),
    ).toEqual([first, { type: "text" }])
  })

  it("preserves distinct and empty streaming reasoning parts", () => {
    const parts = [
      { type: "reasoning", text: "First step." },
      { type: "reasoning", text: "Second step." },
      { type: "reasoning", text: "" },
    ]

    expect(dedupeVisibleReasoningParts(parts, isReasoningPart)).toEqual(parts)
  })
})
