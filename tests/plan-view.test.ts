import { describe, expect, it } from "vitest"
import type {
  PlanCandidate,
  PlanSourceSnapshot,
  ProjectPlanSnapshot,
} from "../src/shared/plan-sources"
import {
  buildPlanOpenTarget,
  buildPlanViewModel,
  describePlanSourceStatus,
  planViewReducer,
  resolvePlanWorkStatus,
  selectPlanSource,
  type PlanViewState,
} from "../src/shared/plan-view"

const baseState: PlanViewState = { selectedSourceId: null, query: "", status: "all" }

describe("plan view selectors", () => {
  it("maps proposal, active, and completed work without inventing task mutation", () => {
    expect(resolvePlanWorkStatus(candidate("proposal", "Plan"))).toBe("proposed")
    expect(resolvePlanWorkStatus(candidate("task", "Build", false))).toBe("active")
    expect(resolvePlanWorkStatus(candidate("task", "Ship", true))).toBe("built")
  })

  it("preserves hierarchy ancestors while filtering requirements and checklist work", () => {
    const root = candidate("proposal", "Stage 4", null, { id: "root" })
    const requirement = candidate("requirement", "Safe plans", null, {
      id: "requirement",
      parentId: root.id,
    })
    const task = candidate("task", "Render stale state", false, {
      id: "task",
      parentId: requirement.id,
    })
    const snapshot = project(source([root, requirement, task]))
    const model = buildPlanViewModel(snapshot, { ...baseState, query: "stale" })

    expect(model.resultCount).toBe(1)
    expect(model.nodes[0]?.candidate.id).toBe("root")
    expect(model.nodes[0]?.children[0]?.candidate.id).toBe("requirement")
    expect(model.nodes[0]?.children[0]?.children[0]?.candidate.id).toBe("task")
  })

  it("reports checklist progress and filters status without changing source order", () => {
    const snapshot = project(
      source([
        candidate("task", "Ready", true, { id: "ready" }),
        candidate("task", "Pending", false, { id: "pending" }),
      ]),
    )
    const all = buildPlanViewModel(snapshot, baseState)
    const built = buildPlanViewModel(snapshot, { ...baseState, status: "built" })

    expect(all.progress).toEqual({ completed: 1, total: 2, percent: 50 })
    expect(built.nodes.map((node) => node.candidate.id)).toEqual(["ready"])
  })

  it("falls back to a current source when a selected source disappears", () => {
    const malformed = source([], { id: "broken", status: "malformed" })
    const current = source([], { id: "current", status: "current" })
    expect(selectPlanSource([malformed, current], "removed")?.id).toBe("current")
    expect(describePlanSourceStatus("stale")).toContain("refresh required")
  })
})

describe("plan view navigation state", () => {
  it("changes source, query, filter, then resets at the project boundary", () => {
    let state = planViewReducer(baseState, { type: "select-source", sourceId: "source-2" })
    state = planViewReducer(state, { type: "set-query", query: "migration" })
    state = planViewReducer(state, { type: "set-status", status: "active" })
    expect(state).toEqual({ selectedSourceId: "source-2", query: "migration", status: "active" })
    expect(planViewReducer(state, { type: "reset-project" })).toEqual(baseState)
  })

  it("builds bounded editor targets and rejects escaped or absolute paths", () => {
    expect(buildPlanOpenTarget("/repo", "openspec/changes/add-plan/tasks.md", 12)).toEqual({
      path: "/repo/openspec/changes/add-plan/tasks.md",
      cwd: "/repo",
      line: 12,
    })
    expect(buildPlanOpenTarget("C:\\repo", "docs\\plan.md")).toEqual({
      path: "C:\\repo\\docs\\plan.md",
      cwd: "C:\\repo",
    })
    expect(buildPlanOpenTarget("/repo", "../secret.md")).toBeNull()
    expect(buildPlanOpenTarget("/repo", "/tmp/secret.md")).toBeNull()
    expect(buildPlanOpenTarget("/repo", "docs//plan.md")).toBeNull()
    expect(buildPlanOpenTarget("repo", "docs/plan.md")).toBeNull()
    expect(buildPlanOpenTarget("/", "docs/plan.md")).toEqual({
      path: "/docs/plan.md",
      cwd: "/",
    })
  })
})

function candidate(
  kind: PlanCandidate["kind"],
  title: string,
  completed: boolean | null = null,
  overrides: Partial<PlanCandidate> = {},
): PlanCandidate {
  return {
    id: `${kind}-${title}`,
    fingerprint: `fingerprint-${kind}-${title}`,
    kind,
    title,
    body: null,
    path: "docs/plan.md",
    line: 1,
    depth: 1,
    parentId: null,
    completed,
    ...overrides,
  }
}

function source(
  candidates: PlanCandidate[],
  overrides: Partial<PlanSourceSnapshot> = {},
): PlanSourceSnapshot {
  return {
    id: "source-1",
    type: "markdown",
    path: "docs/plan.md",
    fingerprint: "source-fingerprint",
    status: "current",
    stale: false,
    candidates,
    limitations: [],
    errors: [],
    ...overrides,
  }
}

function project(planSource: PlanSourceSnapshot): ProjectPlanSnapshot {
  return {
    projectId: "project-1",
    rootPath: "/repo",
    fingerprint: "project-fingerprint",
    sources: [planSource],
    limitations: [],
  }
}
