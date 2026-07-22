import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const sidebarSource = readFileSync(
  "src/renderer/features/sidebar/agents-sidebar.tsx",
  "utf8",
).replace(/\r\n/g, "\n")

describe("sidebar empty project state", () => {
  it("shows an expanded empty-project gap using Flapstack chat terminology", () => {
    expect(sidebarSource).toContain('data-sidebar-empty-state="project"')
    expect(sidebarSource).toContain("!isCollapsed && showEmptyState")
    expect(sidebarSource).toContain("No chats")
    expect(sidebarSource).toContain(
      "!searchQuery.trim() &&\n            projectGroup.chats.length === 0 &&\n            projectGroup.taskGroups.length === 0",
    )
  })
})
