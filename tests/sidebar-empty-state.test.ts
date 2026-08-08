import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const sidebarSource = readFileSync(
  "src/renderer/features/sidebar/agents-sidebar.tsx",
  "utf8",
).replace(/\r\n/g, "\n")

describe("sidebar empty chat states", () => {
  it("shows No chats for every expanded empty chat container", () => {
    expect(sidebarSource).toContain('data-sidebar-empty-state="chats"')
    expect(sidebarSource).toContain('data-sidebar-empty-state="quick-access"')
    expect(sidebarSource).toContain('data-sidebar-empty-state="projects"')
    expect(sidebarSource).toContain("!isCollapsed && showEmptyState")
    expect(sidebarSource).toContain("No chats")
    expect(sidebarSource).toContain("section.tasks.every((task) => task.chats.length === 0)")
    expect(sidebarSource).toContain(
      "!searchQuery.trim() &&\n            projectGroup.chats.length === 0 &&\n            projectGroup.taskGroups.length === 0",
    )
    expect(sidebarSource).toContain(
      "showEmptyState: !searchQuery.trim() && taskGroup.chats.length === 0",
    )
  })
})
