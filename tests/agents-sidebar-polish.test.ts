import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync("src/renderer/features/sidebar/agents-sidebar.tsx", "utf8")

describe("agents sidebar polish", () => {
  it("keeps disclosure arrows directly after truncating sidebar titles", () => {
    expect(source).toContain("function SidebarDisclosure")
    expect(source.match(/<SidebarDisclosure/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(source.match(/group\/disclosure/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(source).toContain("group-hover/disclosure:opacity-100")
    expect(source).not.toContain("group-focus-within/disclosure:opacity-100")
    expect(source).not.toContain('!isCollapsed && "opacity-100"')
    expect(source).toContain("flex h-5 w-5 flex-shrink-0")
    expect(source).not.toContain("ml-auto mr-10 flex h-5 w-5")
    expect(source).toContain('actions && "pr-12"')
    expect(source).toContain(
      '(lifecycleTarget || isGlobalSection) && !isMultiSelectMode && "pr-12"',
    )
    expect(source).toContain('"min-w-0 truncate whitespace-nowrap"')
  })

  it("aligns project card edges with the Projects divider and keeps internal padding", () => {
    expect(source).toContain("h-7 mt-0.5 mb-0 rounded-md pl-2 pr-1")
    expect(source).not.toContain("h-7 -ml-1.5 mt-0.5")
    expect(source).not.toContain("h-7 mt-0.5 mb-0 rounded-md pl-0.5")
  })

  it("shows user-tagged chats and keeps an empty Global section", () => {
    expect(source).toContain("activeFiltered.filter((chat) => chat.tags.length > 0)")
    expect(source).toContain('title: "Tagged"')
    expect(source).toContain('kind: "tagged" as const')
    expect(source).toContain("!section.hideWhenEmpty || section.chats.length > 0")
    expect(source).toContain('title: "Global"')
    expect(source).toContain("showWhenEmpty: true")
    expect(source).toContain("showEmptyState: !searchQuery.trim() && global.length === 0")
    expect(source).toContain('kind === "tagged"')
  })

  it("uses halved asymmetric vertical padding for chat rows", () => {
    expect(source).toContain("text-left pt-px pb-[3px] cursor-pointer group relative")
    expect(source).not.toContain("text-left py-1 cursor-pointer group relative")
  })

  it("marks Chats that belong to a saved group", () => {
    expect(source).toContain("isInWorkbenchGroup")
    expect(source).toContain('aria-label="In Chat group"')
    expect(source).toContain("<PanelsTopLeft")
  })

  it("gives the icon-only Settings action an accessible name", () => {
    const settingsButton = source.slice(
      source.indexOf('data-tour="settings"'),
      source.indexOf("<SettingsIcon", source.indexOf('data-tour="settings"')),
    )
    expect(settingsButton).toContain('aria-label="Settings"')
  })
})
