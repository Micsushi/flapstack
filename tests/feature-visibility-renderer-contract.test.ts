import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("Stage 6 feature visibility renderer contract", () => {
  it("uses visibility only for optional navigation while keeping direct routes operational", () => {
    const sidebar = source("src/renderer/features/sidebar/agents-sidebar.tsx")
    const content = source("src/renderer/features/agents/ui/agents-content.tsx")

    for (const feature of [
      "automations",
      "orchestration",
      "plan",
      "knowledge-graph",
      "saved-workspaces",
      "usage",
    ]) {
      expect(sidebar).toContain(`featureVisibility.isVisible("${feature}")`)
    }
    expect(content).not.toContain("useFeatureVisibility")
    expect(content).toContain('effectiveDesktopView === "automations"')
    expect(content).toContain('effectiveDesktopView === "plan"')
    expect(content).toContain('effectiveDesktopView === "saved-workspaces"')
  })

  it("refreshes every window and keeps hidden controls searchable in Settings", () => {
    const preload = source("src/preload/index.ts")
    const settings = source("src/renderer/features/settings/settings-visibility.ts")
    const hook = source("src/renderer/features/settings/use-feature-visibility.ts")

    expect(preload).toContain('ipcRenderer.on("feature-visibility:changed"')
    expect(hook).toContain("utils.featureVisibility.get.invalidate()")
    expect(settings).toContain('"feature-visibility-controls"')
    expect(settings).toContain("FEATURE_VISIBILITY_SEARCH_KEYWORDS")
  })
})

function source(path: string) {
  return readFileSync(resolve(path), "utf8")
}
