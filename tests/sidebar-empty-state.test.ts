import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const sidebarSource = readFileSync(
  "src/renderer/features/sidebar/agents-sidebar.tsx",
  "utf8",
).replace(/\r\n/g, "\n")

describe("sidebar empty chat states", () => {
  it("shows empty states only for persistent chat containers", () => {
    expect(sidebarSource).toContain('data-sidebar-empty-state="chats"')
    expect(sidebarSource).not.toContain('data-sidebar-empty-state="quick-access"')
    expect(sidebarSource).toContain('data-sidebar-empty-state="projects"')
    expect(sidebarSource).toContain("<SidebarCollapsibleContent isOpen={!isCollapsed}>")
    expect(sidebarSource).toContain("No chats")
    expect(sidebarSource).toContain("showEmptyState: !searchQuery.trim() && global.length === 0")
    expect(sidebarSource).toContain(
      "section.chats.length > 0 || section.tasks.some((task) => task.chats.length > 0)",
    )
    expect(sidebarSource).toContain("drafts.length > 0")
    expect(sidebarSource).toContain("section.tasks.every((task) => task.chats.length === 0)")
    expect(sidebarSource).toMatch(
      /showEmptyState:\s*!searchQuery\.trim\(\)\s*&&\s*projectGroup\.chats\.length === 0\s*&&\s*projectGroup\.taskGroups\.length === 0/,
    )
    expect(sidebarSource).toContain(
      "showEmptyState: !searchQuery.trim() && taskGroup.chats.length === 0",
    )
  })
})
