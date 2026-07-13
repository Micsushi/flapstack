import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  SETTINGS_CONTROL_REGISTRY,
  SETTINGS_TAB_REGISTRY,
} from "../src/renderer/features/settings/settings-visibility"
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

  it("keeps credential and provider-extension search targets focusable", () => {
    const credentialSource = readSource(
      "src/renderer/components/dialogs/settings-tabs/credential-management.tsx",
    )
    const providerSource = readSource(
      "src/renderer/components/dialogs/settings-tabs/agents-api-providers-tab.tsx",
    )
    const extensionsSource = readSource(
      "src/renderer/components/dialogs/settings-tabs/agents-provider-extensions-tab.tsx",
    )

    expect(credentialSource).toContain("data-settings-id={targetId(definition.id)}")
    expect(providerSource).toContain("data-settings-id={`${providerId}-provider-card`}")
    expect(extensionsSource).toContain('data-settings-id="provider-extensions"')
    expect(SETTINGS_CONTROL_REGISTRY.every((entry) => Boolean(entry.targetId))).toBe(true)
  })

  it("names the third-party MCP surface without merging product or dev control", () => {
    const visibility = readSource("src/renderer/features/settings/settings-visibility.ts")
    const mcp = readSource("src/renderer/components/dialogs/settings-tabs/agents-mcp-tab.tsx")
    expect(visibility).toContain("Configure third-party MCP servers for Claude Code and Codex")
    expect(mcp).toContain("Product app-control and development")
    expect(mcp).toContain("test-control stay separate")
  })

  it("keeps shared Preferences copy provider-neutral", () => {
    const preferences = readSource(
      "src/renderer/components/dialogs/settings-tabs/agents-preferences-tab.tsx",
    )
    expect(preferences).toContain("Configure shared agent behavior and app preferences")
    expect(preferences).not.toContain("Configure Claude's behavior and features")
  })
})
