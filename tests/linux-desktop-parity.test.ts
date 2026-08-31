import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { getFileManagerName } from "../src/renderer/lib/utils/platform"

describe("Linux desktop parity", () => {
  it("names the native file manager for each desktop platform", () => {
    expect(getFileManagerName("darwin")).toBe("Finder")
    expect(getFileManagerName("win32")).toBe("File Explorer")
    expect(getFileManagerName("linux")).toBe("File Manager")
    expect(getFileManagerName("unknown")).toBe("File Manager")
  })

  it.each([
    "src/renderer/components/dialogs/settings-tabs/agents-project-worktree-tab.tsx",
    "src/renderer/features/agents/ui/agent-diff-view.tsx",
    "src/renderer/features/changes/changes-view.tsx",
    "src/renderer/features/changes/components/file-item/file-item.tsx",
    "src/renderer/features/changes/components/file-list-item.tsx",
    "src/renderer/features/details-sidebar/sections/files-tab.tsx",
    "src/renderer/features/details-sidebar/sections/info-section.tsx",
  ])("uses the platform file-manager name in %s", (path) => {
    expect(readFileSync(path, "utf8")).toContain("getFileManagerName")
  })
})
