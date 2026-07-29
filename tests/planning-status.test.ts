import { describe, expect, it } from "vitest"
import {
  PLANNING_STATUS_INTERVAL_MS,
  PLANNING_STATUS_MESSAGES,
  getPlanningStatus,
} from "../src/renderer/features/agents/ui/planning-status"

describe("planning status", () => {
  it("uses a substantial professional phrase set", () => {
    expect(PLANNING_STATUS_MESSAGES.length).toBeGreaterThanOrEqual(16)
    expect(PLANNING_STATUS_MESSAGES).toContain("Analyzing context")
    expect(PLANNING_STATUS_MESSAGES).toContain("Checking constraints")
  })

  it("does not change within the four-second interval", () => {
    expect(PLANNING_STATUS_INTERVAL_MS).toBe(4_000)
    expect(getPlanningStatus(0)).toBe(getPlanningStatus(3_999))
    expect(getPlanningStatus(4_000)).not.toBe(getPlanningStatus(3_999))
  })

  it("stays static for reduced motion", () => {
    expect(getPlanningStatus(0, true)).toBe(getPlanningStatus(80_000, true))
  })
})
