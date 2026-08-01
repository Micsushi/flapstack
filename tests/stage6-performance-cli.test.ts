import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import {
  parsePerformanceCliArguments,
  performanceAcceptanceFailureReasons,
} from "../src/main/lib/performance/cli"

describe("Stage 6 performance acceptance CLI", () => {
  it("keeps bounded CI and acceptance summaries in distinct evidence files", () => {
    const entry = readFileSync("src/main/lib/performance/cli-entry.ts", "utf8")
    expect(entry).toContain('"stage6-performance-core-ci-summary.json"')
    expect(entry).toContain('"stage6-performance-core-summary.json"')
    expect(entry).toMatch(/input\.boundedCi[\s\S]*core-ci-summary[\s\S]*core-summary/)
  })

  it("separates full acceptance from the bounded CI lane", () => {
    expect(parsePerformanceCliArguments(["--core", "--acceptance"])).toMatchObject({
      lane: "core",
      boundedCi: false,
      acceptance: true,
    })
    expect(() => parsePerformanceCliArguments(["--core", "--ci", "--acceptance"])).toThrow(
      /acceptance.*bounded|bounded.*acceptance/i,
    )
  })

  it("fails full acceptance for failed, omitted, dirty, untrusted, or incomplete evidence", () => {
    expect(
      performanceAcceptanceFailureReasons({
        evidenceStatus: "incomplete",
        candidate: { dirty: true },
        results: [{ budgetId: "failed", evaluation: { status: "fail" } }],
        omissions: [{ budgetId: "omitted" }],
        coverage: { complete: false, missingBudgetIds: ["missing"] },
      }),
    ).toEqual([
      "failed performance budgets: failed",
      "omitted requested performance budgets: omitted",
      "performance candidate is dirty",
      "performance coverage is incomplete: missing",
      "performance evidence status is incomplete",
    ])
    expect(
      performanceAcceptanceFailureReasons({
        evidenceStatus: "pass",
        candidate: { dirty: false },
        results: [{ budgetId: "passing", evaluation: { status: "pass" } }],
        omissions: [],
        coverage: { complete: true, missingBudgetIds: [] },
      }),
    ).toEqual([])
  })

  it("forces termination after output flush for every dedicated CLI host", () => {
    const entry = readFileSync("src/main/lib/performance/cli-entry.ts", "utf8")
    expect(entry).not.toContain("shouldForcePerformanceCliExit")
    expect(entry).toMatch(/process\.exit\(exitCode\)/)
  })
})
