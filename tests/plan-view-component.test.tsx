// @vitest-environment jsdom

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PlanHierarchy } from "../src/renderer/features/plan/plan-view"
import type { PlanViewNode } from "../src/shared/plan-view"

vi.mock("../src/renderer/lib/trpc", () => ({ trpc: {} }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const nodes: PlanViewNode[] = [
  {
    candidate: {
      id: "stage-4",
      fingerprint: "stage-fingerprint",
      kind: "proposal",
      title: "Stage 4",
      body: "Knowledge workspaces and operations",
      path: "openspec/changes/add-plan/proposal.md",
      line: 1,
      depth: 1,
      parentId: null,
      completed: null,
    },
    status: "proposed",
    children: [
      {
        candidate: {
          id: "requirement-safe-plans",
          fingerprint: "requirement-fingerprint",
          kind: "requirement",
          title: "Safe plans",
          body: "Sources remain read-only.",
          path: "openspec/changes/add-plan/specs/plan/spec.md",
          line: 8,
          depth: 2,
          parentId: "stage-4",
          completed: null,
        },
        status: "active",
        children: [
          {
            candidate: {
              id: "task-render",
              fingerprint: "task-fingerprint",
              kind: "task",
              title: "Render hierarchy",
              body: null,
              path: "openspec/changes/add-plan/tasks.md",
              line: 22,
              depth: 3,
              parentId: "requirement-safe-plans",
              completed: false,
            },
            status: "active",
            children: [],
          },
        ],
      },
    ],
  },
]

describe("PlanHierarchy", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderHierarchy(
    options: {
      onOpenSource?: (path: string, line?: number) => void
      onPromote?: (candidateId: string) => void
      onToggle?: (candidateId: string) => void
    } = {},
  ) {
    function Harness() {
      const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
      return (
        <PlanHierarchy
          nodes={nodes}
          sourcePath="openspec/changes/add-plan"
          collapsedIds={collapsedIds}
          onToggleCollapsed={(candidateId) => {
            options.onToggle?.(candidateId)
            setCollapsedIds((current) => {
              const next = new Set(current)
              if (next.has(candidateId)) next.delete(candidateId)
              else next.add(candidateId)
              return next
            })
          }}
          onOpenSource={options.onOpenSource ?? (() => undefined)}
          onPromote={
            options.onPromote ? (candidate) => options.onPromote?.(candidate.id) : undefined
          }
          linksByCandidateId={new Map()}
          onCompare={() => undefined}
        />
      )
    }

    act(() => root.render(<Harness />))
  }

  it("renders a labelled read-only hierarchy with source and promotion affordances", () => {
    const openSource = vi.fn()
    renderHierarchy({ onOpenSource: openSource })

    const tree = container.querySelector('[role="tree"]')
    const items = container.querySelectorAll<HTMLElement>('[role="treeitem"]')
    expect(tree?.getAttribute("aria-label")).toBe("openspec/changes/add-plan plan hierarchy")
    expect(Array.from(items, (item) => item.getAttribute("aria-level"))).toEqual(["1", "2", "3"])
    expect(items[0]?.getAttribute("aria-expanded")).toBe("true")
    expect(items[0]?.getAttribute("tabindex")).toBe("0")
    expect(items[1]?.getAttribute("tabindex")).toBe("-1")
    expect(container.textContent).toContain("Safe plans")
    expect(container.textContent).toContain("Render hierarchy")
    expect(container.textContent).toContain("Proposed")
    expect(container.textContent).toContain("Active")
    expect(
      container.querySelector("textarea, [contenteditable='true'], input[type='checkbox']"),
    ).toBeNull()

    const promotion = container.querySelector<HTMLButtonElement>(
      '[aria-label="Promote Render hierarchy to task"]',
    )
    expect(promotion?.disabled).toBe(true)
    expect(promotion?.title).toBe("Refresh this source first")

    const taskItem = items[2]!
    const open = Array.from(taskItem.querySelectorAll("button")).find(
      (button) => button.textContent === "Open",
    )
    act(() => open?.click())
    expect(openSource).toHaveBeenCalledWith("openspec/changes/add-plan/tasks.md", 22)
  })

  it("uses roving focus and complete tree arrow-key behavior", () => {
    renderHierarchy()
    const item = (id: string) =>
      container.querySelector<HTMLElement>(`[data-plan-candidate-id="${id}"]`)!

    act(() => item("stage-4").focus())
    act(() =>
      item("stage-4").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    )
    expect(document.activeElement).toBe(item("requirement-safe-plans"))
    expect(item("stage-4").getAttribute("tabindex")).toBe("-1")
    expect(item("requirement-safe-plans").getAttribute("tabindex")).toBe("0")

    act(() =>
      item("requirement-safe-plans").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      ),
    )
    expect(item("requirement-safe-plans").getAttribute("aria-expanded")).toBe("false")
    act(() =>
      item("requirement-safe-plans").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      ),
    )
    expect(document.activeElement).toBe(item("stage-4"))

    act(() =>
      item("stage-4").dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    )
    expect(document.activeElement).toBe(item("requirement-safe-plans"))
  })

  it("does not treat keyboard activation of nested actions as a tree collapse", () => {
    const onToggle = vi.fn()
    const promote = vi.fn()
    renderHierarchy({ onToggle, onPromote: promote })
    const rootItem = container.querySelector<HTMLElement>('[data-plan-candidate-id="stage-4"]')!
    const open = Array.from(rootItem.querySelectorAll("button")).find(
      (button) => button.textContent === "Open",
    )!

    act(() => open.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })))
    expect(onToggle).not.toHaveBeenCalled()
    expect(rootItem.getAttribute("aria-expanded")).toBe("true")

    const promotion = container.querySelector<HTMLButtonElement>(
      '[aria-label="Promote Render hierarchy to task"]',
    )!
    act(() => promotion.click())
    expect(promote).toHaveBeenCalledWith("task-render")
  })
})
