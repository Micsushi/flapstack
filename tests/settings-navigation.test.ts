import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

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
})
