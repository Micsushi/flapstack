import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { ADVANCED_USAGE_A11Y } from "../src/renderer/features/usage/advanced-usage-model"

describe("advanced usage accessibility contract", () => {
  it("names every major explorer region uniquely for screen readers", () => {
    expect(Object.values(ADVANCED_USAGE_A11Y)).toEqual([
      "Advanced usage explorer",
      "Advanced usage filters",
      "Usage aggregates chart",
      "Usage aggregates table",
      "Supporting usage facts and provenance",
      "Usage insight quality and provenance",
      "Scoped usage budget editor",
      "Redacted usage export",
    ])
    expect(new Set(Object.values(ADVANCED_USAGE_A11Y)).size).toBe(
      Object.keys(ADVANCED_USAGE_A11Y).length,
    )
  })

  it("uses native keyboard controls, table semantics, captions, and live status", () => {
    const source = readFileSync("src/renderer/features/usage/advanced-usage-explorer.tsx", "utf8")
    expect(source).toContain('type="button"')
    expect(source).toContain('type="submit"')
    expect(source).toContain("aria-pressed={state.selectedAggregateKey")
    expect(source).toContain("aria-label={ADVANCED_USAGE_A11Y.chart}")
    expect(source).toContain("aria-label={ADVANCED_USAGE_A11Y.table}")
    expect(source).toContain('<caption className="sr-only">')
    expect(source).toContain('scope="col"')
    expect(source).toContain('scope="row"')
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain("Every aggregate includes a supporting-facts action.")
    expect(source).toContain("Credentials are never exported.")
  })
})
