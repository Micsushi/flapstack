// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SavedWorkspaceLayout } from "../src/shared/saved-workspaces"

const mocks = vi.hoisted(() => ({
  list: [] as Array<{ id: string; name: string }>,
  listLoading: false,
  records: {} as Record<
    string,
    {
      id: string
      name: string
      version: number
      layout: SavedWorkspaceLayout | null
      layoutIssue: string | null
      archivedAt: number | null
      owner?: { kind: "manual" } | { kind: "orchestration"; orchestrationId: string }
    }
  >,
  operation: undefined as
    | {
        orchestrationId: string
        agents: Array<{ agentId: string; chatId: string | null; chatState: "ready" | "pending" }>
      }
    | undefined,
  enabledWorkspaceGets: [] as string[],
  enabledOperationGets: [] as string[],
  invalidate: vi.fn(async () => undefined),
  mutateAsync: vi.fn(),
}))

vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      savedWorkspaces: {
        list: { invalidate: mocks.invalidate },
        get: { invalidate: mocks.invalidate },
        resolvePane: { invalidate: mocks.invalidate },
        getOperation: { invalidate: mocks.invalidate },
      },
    }),
    savedWorkspaces: {
      list: {
        useQuery: () => ({
          data: mocks.listLoading ? undefined : mocks.list,
          isLoading: mocks.listLoading,
        }),
      },
      get: {
        useQuery: ({ workspaceId }: { workspaceId: string }, { enabled }: { enabled: boolean }) => {
          if (enabled) mocks.enabledWorkspaceGets.push(workspaceId)
          return {
            data: enabled ? mocks.records[workspaceId] : undefined,
            error:
              enabled && !mocks.records[workspaceId]
                ? new Error(`Workspace ${workspaceId} was not found.`)
                : null,
            isLoading: false,
          }
        },
      },
      create: { useMutation: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }) },
      saveLayout: { useMutation: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }) },
      rename: { useMutation: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }) },
      archive: { useMutation: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }) },
      restore: { useMutation: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }) },
      delete: { useMutation: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }) },
      previewDelete: {
        useQuery: () => ({ data: undefined, error: null, isLoading: false }),
      },
      getOperation: {
        useQuery: ({ workspaceId }: { workspaceId: string }, { enabled }: { enabled: boolean }) => {
          if (enabled) mocks.enabledOperationGets.push(workspaceId)
          return {
            data: enabled ? mocks.operation : undefined,
            error: null,
            isLoading: false,
          }
        },
      },
    },
  },
}))

vi.mock("../src/renderer/features/saved-workspaces/pane-adapters", async () => {
  const react = await vi.importActual<typeof import("react")>("react")
  return {
    WorkspacePaneAdapter: ({
      pane,
      ownershipChatIds = [],
    }: {
      pane: { id: string; title?: string }
      ownershipChatIds?: string[]
    }) =>
      react.createElement(
        "div",
        {
          "data-rendered-pane": pane.id,
          "data-ownership-chat-ids": ownershipChatIds.join(","),
        },
        pane.title ?? pane.id,
      ),
    WorkspacePaneBindingForm: () => null,
  }
})

import { claimInitialWindowParamsApplication } from "../src/renderer/contexts/WindowContext"
import {
  SavedWorkspacesView,
  resolveWorkspaceWindowLayout,
} from "../src/renderer/features/saved-workspaces/saved-workspaces-view"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("saved workspace initial window targets", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mocks.listLoading = false
    mocks.enabledWorkspaceGets = []
    mocks.enabledOperationGets = []
    mocks.operation = undefined
    mocks.list = [
      { id: "workspace-a", name: "Workspace A" },
      { id: "workspace-b", name: "Workspace B" },
    ]
    mocks.records = {
      "workspace-a": workspaceRecord("workspace-a", "Workspace A", workspaceALayout()),
      "workspace-b": workspaceRecord("workspace-b", "Workspace B", singlePaneLayout("prior-b")),
    }
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("selects exact workspace A after the list loads instead of prior local B", async () => {
    localStorage.setItem("flapstack:saved-workspace-selection:v1:project", "workspace-b")
    mocks.listLoading = true
    await renderTarget({ initialWorkspaceId: "workspace-a" })

    mocks.listLoading = false
    await renderTarget({ initialWorkspaceId: "workspace-a" })

    expect(container.querySelector<HTMLSelectElement>("#saved-workspace-picker")?.value).toBe(
      "workspace-a",
    )
    expect(renderedPaneIds()).toEqual(["pane-a", "pane-b"])
    expect(container.textContent).not.toContain("prior-b")
  })

  it("never fetches, renders, or claims a target before project membership is confirmed", async () => {
    mocks.listLoading = true
    mocks.records["foreign-workspace"] = {
      ...workspaceRecord("foreign-workspace", "Foreign workspace", selectedAgentLayout("agent-1")),
      owner: { kind: "orchestration", orchestrationId: "foreign-operation" },
    }
    mocks.operation = {
      orchestrationId: "foreign-operation",
      agents: [{ agentId: "agent-1", chatId: "foreign-chat", chatState: "ready" }],
    }

    await renderTarget({ initialWorkspaceId: "foreign-workspace" })
    expect(mocks.enabledWorkspaceGets).toEqual([])
    expect(mocks.enabledOperationGets).toEqual([])
    expect(renderedPaneIds()).toEqual([])

    mocks.listLoading = false
    mocks.list = [{ id: "workspace-a", name: "Workspace A" }]
    await renderTarget({ initialWorkspaceId: "foreign-workspace" })

    expect(container.textContent).toContain("Workspace target needs repair")
    expect(mocks.enabledWorkspaceGets).toEqual([])
    expect(mocks.enabledOperationGets).toEqual([])
    expect(renderedPaneIds()).toEqual([])
    expect(container.querySelector("[data-ownership-chat-ids]")).toBeNull()
  })

  it("renders only the exact pane in a pane pop-out", async () => {
    await renderTarget({ initialWorkspaceId: "workspace-a", popoutPaneId: "pane-b" })

    expect(renderedPaneIds()).toEqual(["pane-b"])
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1)
    expect(container.textContent).not.toContain("Pane A")
  })

  it("excludes exactly the requested pane from a remainder window", async () => {
    await renderTarget({ initialWorkspaceId: "workspace-a", initialSkipPaneId: "pane-a" })

    expect(renderedPaneIds()).toEqual(["pane-b"])
    expect(container.textContent).not.toContain("Pane A")
    expect(container.querySelector("[data-structural-read-only='true']")).not.toBeNull()
    expect(container.querySelector('[role="separator"]')).toBeNull()
    expect(container.querySelector('[aria-label="Remove active pane"]')).toBeNull()
    expect(container.querySelector<HTMLElement>('[role="tab"]')?.draggable).toBe(false)
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
  })

  it("normalizes surviving sizes at every split after remainder exclusion", () => {
    const result = resolveWorkspaceWindowLayout(nestedLayout(), { skipPaneId: "nested-b" })
    expect(result.kind).toBe("ready")
    if (result.kind !== "ready" || result.layout.root.type !== "split") return
    expect(result.layout.root.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
    const nested = result.layout.root.children[1]
    expect(nested.type).toBe("split")
    if (nested.type !== "split") return
    expect(nested.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
    expect(nested.sizes[0]).toBeCloseTo(33 / 67)
    expect(nested.sizes[1]).toBeCloseTo(34 / 67)
  })

  it("shows repair for stale workspace and pane targets without fallback", async () => {
    await renderTarget({ initialWorkspaceId: "missing-workspace" })
    expect(container.textContent).toContain("Workspace target needs repair")
    expect(renderedPaneIds()).toEqual([])
    expect(container.textContent).not.toContain("prior-b")

    await renderTarget({ initialWorkspaceId: "workspace-a", popoutPaneId: "missing-pane" })
    expect(container.textContent).toContain("Workspace window target needs repair")
    expect(container.textContent).toContain("missing-pane")
    expect(renderedPaneIds()).toEqual([])
  })

  it("shows project repair instead of using a prior project for an exact window target", async () => {
    await act(async () => {
      root.render(
        createElement(SavedWorkspacesView, {
          projectId: null,
          initialProjectId: "missing-project",
          initialChatId: null,
          initialWorkspaceId: "workspace-a",
        }),
      )
    })

    expect(container.textContent).toContain("Workspace project target needs repair")
    expect(container.textContent).toContain("will not fall back")
    expect(renderedPaneIds()).toEqual([])
  })

  it("restores an exact archived target as structurally read-only", async () => {
    mocks.records["workspace-a"] = {
      ...mocks.records["workspace-a"],
      archivedAt: 123,
    }
    await renderTarget({ initialWorkspaceId: "workspace-a" })

    expect(container.textContent).toContain("Restore")
    expect(container.querySelector("[data-structural-read-only='true']")).not.toBeNull()
    expect(container.querySelector('[aria-label="Add pane to this group"]')).toBeNull()
  })

  it("passes a materialized selected-agent chat into exclusive pane ownership", async () => {
    mocks.list = [{ id: "workspace-operation", name: "Operation" }]
    mocks.records = {
      "workspace-operation": {
        ...workspaceRecord("workspace-operation", "Operation", selectedAgentLayout("agent-1")),
        owner: { kind: "orchestration", orchestrationId: "operation-1" },
      },
    }
    mocks.operation = {
      orchestrationId: "operation-1",
      agents: [{ agentId: "agent-1", chatId: "agent-chat-1", chatState: "ready" }],
    }

    await renderTarget({ initialWorkspaceId: "workspace-operation" })

    expect(
      container.querySelector<HTMLElement>('[data-rendered-pane="selected-pane"]')?.dataset
        .ownershipChatIds,
    ).toBe("agent-chat-1")
  })

  it("dedupes one document lifetime but reapplies the same target after reload", () => {
    const params = {
      projectId: "project-guard",
      workspaceId: "workspace-guard",
      paneId: "pane-guard",
    }
    const currentDocument = {}
    expect(claimInitialWindowParamsApplication(params, currentDocument)).toBe(true)
    expect(claimInitialWindowParamsApplication(params, currentDocument)).toBe(false)
    expect(claimInitialWindowParamsApplication(params, {})).toBe(true)
  })

  async function renderTarget(
    target: Pick<
      Parameters<typeof SavedWorkspacesView>[0],
      "initialWorkspaceId" | "popoutPaneId" | "initialSkipPaneId"
    >,
  ) {
    await act(async () => {
      root.render(
        createElement(SavedWorkspacesView, {
          projectId: "project",
          initialProjectId: "project",
          initialChatId: null,
          ...target,
        }),
      )
    })
  }

  function renderedPaneIds() {
    return [...container.querySelectorAll<HTMLElement>("[data-rendered-pane]")].map(
      (element) => element.dataset.renderedPane,
    )
  }
})

function workspaceRecord(id: string, name: string, layout: SavedWorkspaceLayout) {
  return { id, name, version: 1, layout, layoutIssue: null, archivedAt: null }
}

function workspaceALayout(): SavedWorkspaceLayout {
  return {
    version: 1,
    root: {
      type: "split",
      id: "split-a",
      direction: "row",
      sizes: [1, 1],
      children: [
        singlePaneLayout("pane-a", "Pane A").root,
        singlePaneLayout("pane-b", "Pane B").root,
      ],
    },
  }
}

function singlePaneLayout(paneId: string, title = paneId): SavedWorkspaceLayout {
  return {
    version: 1,
    root: {
      type: "tabs",
      id: `group-${paneId}`,
      activePaneId: paneId,
      panes: [{ id: paneId, title, binding: { type: "chat", chatId: `chat-${paneId}` } }],
    },
  }
}

function selectedAgentLayout(agentId: string): SavedWorkspaceLayout {
  return {
    version: 1,
    root: {
      type: "tabs",
      id: "selected-group",
      activePaneId: "selected-pane",
      panes: [
        {
          id: "selected-pane",
          title: "Selected agent",
          binding: {
            type: "selected-agent",
            orchestrationId: "operation-1",
            agentId,
          },
        },
      ],
    },
  }
}

function nestedLayout(): SavedWorkspaceLayout {
  return {
    version: 1,
    root: {
      type: "split",
      id: "root-split",
      direction: "row",
      sizes: [20, 80],
      children: [
        singlePaneLayout("outside").root,
        {
          type: "split",
          id: "nested-split",
          direction: "column",
          sizes: [33, 33, 34],
          children: [
            singlePaneLayout("nested-a").root,
            singlePaneLayout("nested-b").root,
            singlePaneLayout("nested-c").root,
          ],
        },
      ],
    },
  }
}
