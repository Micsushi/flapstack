import { describe, expect, it } from "vitest"
import {
  buildReasoningTimerState,
  formatReasoningDuration,
  formatReasoningStatus,
  getReasoningStartedAt,
} from "../src/renderer/features/agents/lib/reasoning-duration"
import {
  dedupeVisibleReasoningParts,
  getVisibleReasoningText,
} from "../src/renderer/features/agents/lib/reasoning-parts"

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

  it("keeps a live start time stable across message remounts", () => {
    expect(getReasoningStartedAt("chat:message", 1_000)).toBe(1_000)
    expect(getReasoningStartedAt("chat:message", 9_000)).toBe(1_000)
  })

  it("derives a stable live timer from the persisted run start", () => {
    const first = buildReasoningTimerState({
      status: "running",
      startedAtMs: 1_000,
      nowMs: 6_900,
    })
    const afterRemount = buildReasoningTimerState({
      status: "running",
      startedAtMs: 1_000,
      nowMs: 9_100,
    })

    expect(first).toMatchObject({ startedAtMs: 1_000, durationMs: 5_900, label: "Working for 5s" })
    expect(afterRemount).toMatchObject({
      startedAtMs: 1_000,
      durationMs: 8_100,
      label: "Working for 8s",
    })
  })

  it("uses the persisted final duration after completion", () => {
    expect(
      buildReasoningTimerState({
        status: "success",
        startedAtMs: 1_000,
        completedAtMs: 7_000,
        durationMs: 5_500,
        nowMs: 50_000,
      }),
    ).toMatchObject({ durationMs: 5_500, label: "Worked for 5s" })
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

  it("drops a provider summary that only concatenates earlier visible steps", () => {
    const parts = [
      { type: "reasoning", text: "Calculating stage2 line counts" },
      { type: "reasoning", text: "Assessing stage completion percentages" },
      {
        type: "reasoning",
        input: { text: "Calculating stage2 line counts****Assessing stage completion percentages" },
        label: "Reasoning summary",
      },
    ]

    expect(dedupeVisibleReasoningParts(parts, isReasoningPart)).toEqual(parts.slice(0, 2))
  })

  it("hides echoed harness context while preserving actual visible reasoning", () => {
    expect(
      getVisibleReasoningText({
        type: "reasoning",
        text: `[FLAPSTACK THREAD DEFAULTS]
hotline off
[/FLAPSTACK THREAD DEFAULTS]
Inspecting the repository.`,
      }),
    ).toBe("Inspecting the repository.")
  })
})
