import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync("src/renderer/features/sidebar/agents-sidebar.tsx", "utf8")

describe("agents sidebar polish", () => {
  it("uses one trailing disclosure component across sidebar sections", () => {
    expect(source).toContain("function SidebarDisclosure")
    expect(source.match(/<SidebarDisclosure/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(source.match(/group\/disclosure/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
    expect(source).toContain("group-hover/disclosure:opacity-100")
    expect(source).toContain("group-focus-within/disclosure:opacity-100")
    expect(source).not.toContain('!isCollapsed && "opacity-100"')
    expect(source).toContain("ml-auto mr-10 flex h-5 w-5")
    expect(source).not.toContain("group-hover/section:pr-10")
  })

  it("tightens the vertical margins around project headers", () => {
    expect(source).toContain("h-7 mt-0.5 mb-0 rounded-md pl-2 pr-1")
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
