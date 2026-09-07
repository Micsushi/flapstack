import { expect, it } from "vitest"
import { resizeSplitPair } from "../src/renderer/lib/split-ratios"

it("keeps narrow four-pane layouts positive when minimum widths cannot fit", () => {
  expect(resizeSplitPair([0.25, 0.25, 0.25, 0.25], 1, 0.1, 350 / 600, 350 / 600)).toEqual([
    0.25, 0.25, 0.25, 0.25,
  ])
})

it("preserves neighboring panes and the pair budget across resize extremes", () => {
  for (const extent of [1, 320, 600, 1400, 4000]) {
    for (const delta of [-100, -0.1, 0, 0.1, 100]) {
      const original = [0.2, 0.3, 0.1, 0.4]
      const next = resizeSplitPair(original, 1, delta, 350 / extent, 700 / extent)!
      expect(next.every((value) => Number.isFinite(value) && value > 0)).toBe(true)
      expect(next[0]).toBe(original[0])
      expect(next[3]).toBe(original[3])
      expect(next[1] + next[2]).toBeCloseTo(original[1] + original[2])
      expect(next.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1)
      expect(original).toEqual([0.2, 0.3, 0.1, 0.4])
    }
  }
})

it("keeps the usual minimum-width clamp when sufficient space is available", () => {
  expect(resizeSplitPair([0.5, 0.5], 0, 0.1, 0.2, 0.2)).toEqual([0.6, 0.4])
  expect(resizeSplitPair([0.5, 0.5], 0, 10, 0.2, 0.2)?.[0]).toBeCloseTo(0.8)
})

it("rejects invalid geometry without persisting non-finite or non-positive widths", () => {
  expect(resizeSplitPair([], 0, 0, 1, 1)).toBeNull()
  expect(resizeSplitPair([0.5, 0.5], 0, NaN, 1, 1)).toBeNull()
  expect(resizeSplitPair([0.5, 0.5], 0, 1, Infinity, 1)).toBeNull()
  expect(resizeSplitPair([0, 1], 0, 1, 1, 1)).toBeNull()
  expect(resizeSplitPair([0.5, 0.5], -1, 1, 1, 1)).toBeNull()
})
