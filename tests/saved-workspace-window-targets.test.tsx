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
    }
  >,
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
        useQuery: (
          { workspaceId }: { workspaceId: string },
          { enabled }: { enabled: boolean },
        ) => ({
          data: enabled ? mocks.records[workspaceId] : undefined,
          error:
            enabled && !mocks.records[workspaceId]
              ? new Error(`Workspace ${workspaceId} was not found.`)
              : null,
          isLoading: false,
        }),
      },
      create: { useMutation: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }) },
      saveLayout: { useMutation: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }) },
    },
  },
}))

vi.mock("../src/renderer/features/saved-workspaces/pane-adapters", async () => {
  const react = await vi.importActual<typeof import("react")>("react")
  return {
    WorkspacePaneAdapter: ({ pane }: { pane: { id: string; title?: string } }) =>
      react.createElement("div", { "data-rendered-pane": pane.id }, pane.title ?? pane.id),
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
  return { id, name, version: 1, layout, layoutIssue: null }
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
