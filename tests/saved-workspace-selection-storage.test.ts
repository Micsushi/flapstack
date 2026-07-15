// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"
import {
  readPendingWorkspaceLayout,
  readSavedWorkspaceSelection,
  writePendingWorkspaceLayout,
  writeSavedWorkspaceSelection,
} from "../src/renderer/features/saved-workspaces/selection-storage"

describe("saved workspace restart selection", () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it("restores selection independently for each project after restart", () => {
    writeSavedWorkspaceSelection("project-a", "workspace-a")
    writeSavedWorkspaceSelection("project-b", "workspace-b")
    expect(readSavedWorkspaceSelection("project-a")).toBe("workspace-a")
    expect(readSavedWorkspaceSelection("project-b")).toBe("workspace-b")
    writeSavedWorkspaceSelection("project-a", null)
    expect(readSavedWorkspaceSelection("project-a")).toBeNull()
    expect(readSavedWorkspaceSelection("project-b")).toBe("workspace-b")
  })

  it("keeps a bounded pending layout available across a renderer remount", () => {
    const layout = {
      version: 1 as const,
      root: {
        type: "tabs" as const,
        id: "group-1",
        activePaneId: "pane-1",
        panes: [{ id: "pane-1", binding: { type: "chat" as const, chatId: "chat-1" } }],
      },
    }
    writePendingWorkspaceLayout("workspace-1", { layout, expectedVersion: 3 })
    expect(readPendingWorkspaceLayout("workspace-1")).toEqual({ layout, expectedVersion: 3 })
    writePendingWorkspaceLayout("workspace-1", null)
    expect(readPendingWorkspaceLayout("workspace-1")).toBeNull()
  })
})
