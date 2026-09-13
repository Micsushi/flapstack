import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(path, "utf8")

describe("Plan and Kanban production surface", () => {
  it("routes the canonical task board from the main sidebar", () => {
    const atoms = source("src/renderer/features/agents/atoms/index.ts")
    const content = source("src/renderer/features/agents/ui/agents-content.tsx")
    const sidebar = source("src/renderer/features/sidebar/agents-sidebar.tsx")
    const kanban = source("src/renderer/features/kanban/kanban-view.tsx")

    expect(atoms).toContain('| "tasks"')
    expect(content).toContain('import("../../kanban/kanban-view")')
    expect(content.match(/effectiveDesktopView === "tasks"/g)).toHaveLength(2)
    expect(content).toMatch(/desktopView === "tasks"\s*\|\|\s*desktopView === "plan"/)
    expect(content).toContain("!betaFeatures.planning")
    expect(sidebar).toContain('setDesktopView("tasks")')
    expect(sidebar).toContain('label: "Tasks"')
    expect(sidebar).toContain("<span>{label}</span>")
    expect(kanban).toContain("SharedRecordsBoard as KanbanView")
  })
})
