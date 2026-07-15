import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(path, "utf8")

describe("Plan and Kanban production surface", () => {
  it("routes the durable task board from the main sidebar and exits it on card navigation", () => {
    const atoms = source("src/renderer/features/agents/atoms/index.ts")
    const content = source("src/renderer/features/agents/ui/agents-content.tsx")
    const sidebar = source("src/renderer/features/sidebar/agents-sidebar.tsx")
    const kanban = source("src/renderer/features/kanban/kanban-view.tsx")

    expect(atoms).toContain('| "tasks"')
    expect(content).toContain('import { KanbanView } from "../../kanban"')
    expect(content.match(/desktopView === "tasks"/g)).toHaveLength(2)
    expect(sidebar).toContain('setDesktopView("tasks")')
    expect(sidebar).toContain("<span>Tasks</span>")
    expect(kanban).toContain("setDesktopView(null)")
  })
})
