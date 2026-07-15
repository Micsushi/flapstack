// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import { openOperationWorkspace } from "../src/renderer/features/saved-workspaces/operation-navigation"

describe("operation workspace navigation", () => {
  beforeEach(() => localStorage.clear())

  it("opens the exact durable operation workspace selected for its project", async () => {
    const showSavedWorkspaces = vi.fn()
    const fetchWorkspace = vi.fn(async () => ({ workspaceId: "workspace-1" }))

    await expect(
      openOperationWorkspace({
        projectId: "project-1",
        taskId: "task-1",
        fetchWorkspace,
        showSavedWorkspaces,
      }),
    ).resolves.toBe(true)

    expect(fetchWorkspace).toHaveBeenCalledWith({ taskId: "task-1" })
    expect(localStorage.getItem("flapstack:saved-workspace-selection:v1:project-1")).toBe(
      "workspace-1",
    )
    expect(showSavedWorkspaces).toHaveBeenCalledOnce()
  })

  it("fails closed when operation workspace metadata is unavailable", async () => {
    const showSavedWorkspaces = vi.fn()

    await expect(
      openOperationWorkspace({
        projectId: "project-1",
        taskId: "task-1",
        fetchWorkspace: async () => null,
        showSavedWorkspaces,
      }),
    ).resolves.toBe(false)

    expect(localStorage.length).toBe(0)
    expect(showSavedWorkspaces).not.toHaveBeenCalled()
  })
})
