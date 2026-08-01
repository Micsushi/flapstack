import { describe, expect, it } from "vitest"
import { STAGE6_PERFORMANCE_BUDGETS } from "../src/main/lib/performance/budgets"
import { verifyReviewedPerformanceBudgetAuthority } from "../src/main/lib/performance/budget-review"

describe("Stage 6 reviewed performance authority", () => {
  it("binds s6-v7 budgets to reviewed evidence and isolates development-only thresholds", () => {
    expect(STAGE6_PERFORMANCE_BUDGETS.authority).toMatchObject({
      status: "reviewed",
      reviewedEvidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(() => verifyReviewedPerformanceBudgetAuthority()).not.toThrow()
    const searchBudgets = STAGE6_PERFORMANCE_BUDGETS.budgets.filter(
      (budget) => budget.scenario === "renderer" && budget.metric === "search-response",
    )
    expect(searchBudgets.find((budget) => budget.buildType === "dev")?.threshold).toBe(600)
    expect(searchBudgets.find((budget) => budget.buildType === "package")?.threshold).toBe(250)
    const startupBudgets = STAGE6_PERFORMANCE_BUDGETS.budgets.filter(
      (budget) => budget.scenario === "startup",
    )
    expect(
      startupBudgets.find(
        (budget) =>
          budget.metric === "shell-ready" &&
          budget.temperature === "cold" &&
          budget.buildType === "dev",
      )?.threshold,
    ).toBe(30_000)
    expect(
      startupBudgets.find(
        (budget) =>
          budget.metric === "shell-ready" &&
          budget.temperature === "warm" &&
          budget.buildType === "dev",
      )?.threshold,
    ).toBe(30_000)
    expect(
      startupBudgets.find(
        (budget) => budget.metric === "first-use-ready" && budget.buildType === "dev",
      )?.threshold,
    ).toBe(35_000)
    expect(
      startupBudgets.find(
        (budget) =>
          budget.metric === "shell-ready" &&
          budget.temperature === "cold" &&
          budget.buildType === "package",
      )?.threshold,
    ).toBe(4_000)
    expect(
      startupBudgets.find(
        (budget) =>
          budget.metric === "shell-ready" &&
          budget.temperature === "warm" &&
          budget.buildType === "package",
      )?.threshold,
    ).toBe(2_500)
    expect(
      startupBudgets.find(
        (budget) => budget.metric === "first-use-ready" && budget.buildType === "package",
      )?.threshold,
    ).toBe(6_000)
    expect(
      STAGE6_PERFORMANCE_BUDGETS.datasets.find((dataset) => dataset.id === "large"),
    ).toMatchObject({
      cardinality: { chats: 100, messages: 200 },
    })
    expect(
      Math.max(
        ...STAGE6_PERFORMANCE_BUDGETS.datasets.map((dataset) => dataset.cardinality.messages ?? 0),
      ),
    ).toBe(200)
  })
})
