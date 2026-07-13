import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { SETTINGS_TAB_REGISTRY } from "../src/renderer/features/settings/settings-visibility"
import { SETTINGS_SEARCH_ENTRIES } from "../src/renderer/features/settings/settings-search"

const readSource = (path: string) => readFileSync(path, "utf8")

describe("Settings navigation", () => {
  it("opens Usage inside Settings so navigation and Back remain available", () => {
    const source = readSource("src/renderer/features/sidebar/agents-sidebar.tsx")

    expect(source).toContain('setSettingsActiveTab("usage")')
    expect(source).toContain("setSettingsDialogOpen(true)")
    expect(source).not.toContain('setDesktopView("usage")')
  })

  it("keeps the Settings sidebar and Back action available", () => {
    const layout = readSource("src/renderer/features/layout/agents-layout.tsx")
    const sidebar = readSource("src/renderer/features/settings/settings-sidebar.tsx")

    expect(layout).toContain("isOpen={!isMobile && (isSettingsView || sidebarOpen)}")
    expect(sidebar).toContain("<span>Back</span>")
  })

  it("keeps every released tab in registry, search, sidebar, and direct content routing", () => {
    const content = readSource("src/renderer/features/settings/settings-content.tsx")
    const sidebar = readSource("src/renderer/features/settings/settings-sidebar.tsx")
    expect(sidebar).toContain('getVisibleSettingsTabs("main"')
    expect(sidebar).toContain('getVisibleSettingsTabs("advanced"')

    for (const tab of SETTINGS_TAB_REGISTRY.filter(
      (entry) => entry.released && entry.section !== "development",
    )) {
      expect(SETTINGS_SEARCH_ENTRIES).toContainEqual(
        expect.objectContaining({ id: `settings-page-${tab.id}`, tab: tab.id }),
      )
      expect(content).toContain(`case "${tab.id}"`)
    }
  })
})
