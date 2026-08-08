import { describe, expect, it } from "vitest"
import { assignStableProjectColors } from "../src/renderer/features/sidebar/project-colors"

describe("stable project colors", () => {
  it("never changes existing project colors when a new project is inserted", () => {
    const current = {
      flapstack: "#38bdf8",
      existing: "#22c55e",
    }

    const assigned = assignStableProjectColors(
      [{ id: "new-project" }, { id: "existing" }, { id: "flapstack" }],
      current,
    )

    expect(assigned.flapstack).toBe("#38bdf8")
    expect(assigned.existing).toBe("#22c55e")
    expect(assigned["new-project"]).toBe("#f97316")
  })

  it("preserves a valid duplicate instead of recoloring an existing project", () => {
    const assigned = assignStableProjectColors(
      [{ id: "one" }, { id: "two" }, { id: "new-project" }],
      { one: "#38bdf8", two: "#38bdf8" },
    )

    expect(assigned.one).toBe("#38bdf8")
    expect(assigned.two).toBe("#38bdf8")
    expect(assigned["new-project"]).not.toBe("#38bdf8")
  })
})
