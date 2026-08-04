import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readSource = (path: string) => readFileSync(path, "utf8")

describe("Settings plugin hub", () => {
  it("combines plugins, apps, MCP servers, and skills under one Settings destination", () => {
    const content = readSource("src/renderer/features/settings/settings-content.tsx")
    const sidebar = readSource("src/renderer/features/settings/settings-sidebar.tsx")
    const hub = readSource(
      "src/renderer/components/dialogs/settings-tabs/agents-plugins-hub-tab.tsx",
    )

    expect(content).toContain('<AgentsPluginsHubTab initialView="plugins" />')
    expect(content).toContain('<AgentsPluginsHubTab initialView="mcp" />')
    expect(content).toContain('<AgentsPluginsHubTab initialView="skills" />')
    expect(sidebar).toContain('tab.id !== "skills" && tab.id !== "mcp"')
    expect(sidebar).toContain('["plugins", "skills", "mcp"].includes(activeTab)')
    expect(hub).toContain('role="tablist"')
    expect(hub).toContain('label: "Plugins"')
    expect(hub).toContain('label: "Apps"')
    expect(hub).toContain('label: "MCP servers"')
    expect(hub).toContain('label: "Skills"')
  })

  it("keeps the Apps surface honest about current MCP Apps support", () => {
    const hub = readSource(
      "src/renderer/components/dialogs/settings-tabs/agents-plugins-hub-tab.tsx",
    )

    expect(hub).toContain("Available through MCP")
    expect(hub).toContain("Host support needed")
    expect(hub).toContain("Flapstack does not yet host MCP Apps UI resources")
    expect(hub).toContain("ChatGPT installs and Flapstack connections are separate")
    expect(hub).toContain("Manage MCP servers")
  })
})
