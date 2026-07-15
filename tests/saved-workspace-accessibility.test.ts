import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { SAVED_WORKSPACE_A11Y } from "../src/renderer/features/saved-workspaces/workspace-layout-shell"

describe("saved workspace accessibility contract", () => {
  it("uses unique names for the layout, tabs, toolbar, and resize controls", () => {
    expect(new Set(Object.values(SAVED_WORKSPACE_A11Y)).size).toBe(
      Object.keys(SAVED_WORKSPACE_A11Y).length,
    )
  })

  it("keeps every pane action and stale state reachable without pointer input", () => {
    const source = [
      "src/renderer/features/saved-workspaces/workspace-layout-shell.tsx",
      "src/renderer/features/saved-workspaces/saved-workspaces-view.tsx",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n")
    expect(source).toContain('role="tablist"')
    expect(source).toContain('role="tab"')
    expect(source).toContain('role="tabpanel"')
    expect(source).toContain('role="separator"')
    expect(source).toContain("onKeyDown={handleKeyDown}")
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain("Pane target is stale")
    expect(source).toContain("Other panes remain available.")
  })
})
