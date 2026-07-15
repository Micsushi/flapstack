// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SavedWorkspaceLayout } from "../src/shared/saved-workspaces"

const fixtureLayout: SavedWorkspaceLayout = {
  version: 1,
  root: {
    type: "tabs",
    id: "group-1",
    activePaneId: "pane-1",
    panes: [{ id: "pane-1", title: "Chat", binding: { type: "chat", chatId: "chat-1" } }],
  },
}

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  create: vi.fn(),
  duplicate: vi.fn(),
  duplicateWorkspace: null as null | {
    id: string
    name: string
    scope: { type: "project"; projectId: string }
    owner: { kind: "manual" }
    layoutVersion: 1
    layout: SavedWorkspaceLayout
    layoutIssue: null
    sortOrder: string
    version: number
    createdAt: number
    updatedAt: number
    archivedAt: null
  },
  invalidateList: vi.fn(async () => undefined),
  invalidateGet: vi.fn(async () => undefined),
  invalidateResolvePane: vi.fn(async () => undefined),
  invalidateGetOperation: vi.fn(async () => undefined),
}))

vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      savedWorkspaces: {
        list: { invalidate: mocks.invalidateList },
        get: { invalidate: mocks.invalidateGet },
        resolvePane: { invalidate: mocks.invalidateResolvePane },
        getOperation: { invalidate: mocks.invalidateGetOperation },
      },
    }),
    savedWorkspaces: {
      list: {
        useQuery: ({ projectId }: { projectId?: string }) => {
          const data =
            projectId === "project-2"
              ? [
                  {
                    id: "workspace-2",
                    name: "Second workspace",
                    scope: { type: "project", projectId: "project-2" },
                    owner: { kind: "manual" },
                    layoutVersion: 1,
                    sortOrder: "b0",
                    version: 7,
                    createdAt: 1,
                    updatedAt: 1,
                    archivedAt: null,
                    layoutState: "ready",
                  },
                ]
              : [
                  {
                    id: "workspace-1",
                    name: "Fixture workspace",
                    scope: { type: "project", projectId: "project-1" },
                    owner: { kind: "manual" },
                    layoutVersion: 1,
                    sortOrder: "a0",
                    version: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    archivedAt: null,
                    layoutState: "ready",
                  },
                  {
                    id: "workspace-2",
                    name: "Second workspace",
                    scope: { type: "project", projectId: "project-1" },
                    owner: { kind: "manual" },
                    layoutVersion: 1,
                    sortOrder: "b0",
                    version: 7,
                    createdAt: 1,
                    updatedAt: 1,
                    archivedAt: null,
                    layoutState: "ready",
                  },
                ]
          if (mocks.duplicateWorkspace?.scope.projectId === projectId) {
            data.push({
              ...mocks.duplicateWorkspace,
              layoutState: "ready" as const,
            })
          }
          return { data, isLoading: false }
        },
      },
      get: {
        useQuery: ({ workspaceId }: { workspaceId: string }) => {
          const duplicate =
            mocks.duplicateWorkspace?.id === workspaceId ? mocks.duplicateWorkspace : undefined
          return {
            data: workspaceId
              ? (duplicate ?? {
                  id: workspaceId,
                  name: workspaceId === "workspace-2" ? "Second workspace" : "Fixture workspace",
                  scope: { type: "project", projectId: "project-1" },
                  owner: { kind: "manual" },
                  layoutVersion: 1,
                  layout: fixtureLayout,
                  layoutIssue: null,
                  sortOrder: "a0",
                  version: workspaceId === "workspace-2" ? 7 : 1,
                  createdAt: 1,
                  updatedAt: 1,
                  archivedAt: null,
                })
              : undefined,
            isLoading: false,
            error: null,
          }
        },
      },
      getOperation: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
      previewDelete: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
      create: { useMutation: () => ({ mutateAsync: mocks.create, isPending: false }) },
      saveLayout: { useMutation: () => ({ mutateAsync: mocks.save, isPending: false }) },
      rename: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      duplicate: { useMutation: () => ({ mutateAsync: mocks.duplicate, isPending: false }) },
      archive: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      restore: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      delete: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}))

vi.mock("../src/renderer/features/saved-workspaces/pane-adapters", () => ({
  WorkspacePaneAdapter: ({ pane }: { pane: { id: string } }) =>
    createElement("div", { "data-pane-adapter": pane.id }),
  WorkspacePaneBindingForm: () => createElement("div", null, "Pane form"),
}))

import { SavedWorkspacesView } from "../src/renderer/features/saved-workspaces/saved-workspaces-view"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("saved workspace persistence view", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    mocks.save.mockImplementation(async (input: { layout: SavedWorkspaceLayout }) =>
      savedResult(input, 2),
    )
    mocks.duplicateWorkspace = null
    mocks.duplicate.mockImplementation(async () => {
      const workspace = {
        ...savedResult({ layout: fixtureLayout }, 1, "workspace-copy").workspace,
        name: "Fixture workspace copy",
      }
      mocks.duplicateWorkspace = workspace
      return {
        workspace,
        invalidation: { queries: [], workspaceIds: [workspace.id], removeWorkspaceIds: [] },
      }
    })
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root.render(
        createElement(SavedWorkspacesView, {
          projectId: "project-1",
          initialChatId: "chat-1",
        }),
      )
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  it("restores the selected workspace and persists a split layout through T2 save", async () => {
    expect(
      container.querySelector<HTMLSelectElement>('[aria-label="Saved workspace"]')?.value,
    ).toBe("workspace-1")
    expect(localStorage.getItem("flapstack:saved-workspace-selection:v1:project-1")).toBe(
      "workspace-1",
    )

    const split = container.querySelector<HTMLButtonElement>(
      '[aria-label="Split panes horizontally"]',
    )!
    await act(async () => split.click())
    const save = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save"),
    )!
    await act(async () => save.click())

    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.save.mock.calls[0]?.[0]).toMatchObject({
      workspaceId: "workspace-1",
      expectedVersion: 1,
      layout: { version: 1, root: { type: "split" } },
    })
    expect(container.textContent).toContain("Workspace saved.")
  })

  it("does not discard an immediate edit when workspace switching is attempted", async () => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Split panes horizontally"]')!.click()
    })

    const picker = container.querySelector<HTMLSelectElement>('[aria-label="Saved workspace"]')!
    expect(picker.disabled).toBe(true)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        picker,
        "workspace-2",
      )
      picker.dispatchEvent(new Event("change", { bubbles: true }))
    })

    expect(localStorage.getItem("flapstack:saved-workspace-selection:v1:project-1")).toBe(
      "workspace-1",
    )
    expect(sessionStorage.getItem("flapstack:saved-workspace-draft:v1:workspace-1")).toContain(
      '"type":"split"',
    )
    expect(container.querySelector("[data-workspace-split]")).not.toBeNull()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it("duplicates the complete selected workspace and selects the returned record", async () => {
    const duplicate = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Duplicate workspace",
    )!
    expect(duplicate).not.toBeUndefined()
    duplicate.focus()
    expect(document.activeElement).toBe(duplicate)

    const createName = container.querySelector<HTMLInputElement>("#saved-workspace-name")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        createName,
        "Unrelated create draft",
      )
      createName.dispatchEvent(new Event("input", { bubbles: true }))
      duplicate.click()
    })

    expect(mocks.duplicate).toHaveBeenCalledTimes(1)
    expect(mocks.duplicate).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      expectedVersion: 1,
    })
    expect(mocks.invalidateList).toHaveBeenCalledWith({
      projectId: "project-1",
      archive: "active",
    })
    expect(mocks.invalidateGet).toHaveBeenCalledWith({ workspaceId: "workspace-copy" })
    expect(
      container.querySelector<HTMLSelectElement>('[aria-label="Saved workspace"]')?.value,
    ).toBe("workspace-copy")
    expect(localStorage.getItem("flapstack:saved-workspace-selection:v1:project-1")).toBe(
      "workspace-copy",
    )
    expect(container.querySelector<HTMLInputElement>("#saved-workspace-name")?.value).toBe(
      "Unrelated create draft",
    )
    expect(container.querySelector("[data-pane-adapter='pane-1']")).not.toBeNull()
    expect(container.textContent).toContain("Workspace duplicated as Fixture workspace copy.")
  })

  it("preserves the selected workspace when duplication fails", async () => {
    mocks.duplicate.mockRejectedValueOnce(new Error("Workspace version conflict."))
    const duplicate = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Duplicate workspace",
    )!

    await act(async () => duplicate.click())

    expect(
      container.querySelector<HTMLSelectElement>('[aria-label="Saved workspace"]')?.value,
    ).toBe("workspace-1")
    expect(localStorage.getItem("flapstack:saved-workspace-selection:v1:project-1")).toBe(
      "workspace-1",
    )
    expect(container.querySelector("[data-pane-adapter='pane-1']")).not.toBeNull()
    expect(container.textContent).toContain("Workspace version conflict.")
  })

  it("prevents double submission while workspace duplication is pending", async () => {
    const pending = deferred<ReturnType<typeof duplicateResult>>()
    mocks.duplicate.mockReset().mockReturnValueOnce(pending.promise)
    const duplicate = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Duplicate workspace",
    )!

    await act(async () => duplicate.click())
    expect(duplicate.disabled).toBe(true)
    await act(async () => duplicate.click())
    expect(mocks.duplicate).toHaveBeenCalledTimes(1)

    const result = duplicateResult()
    mocks.duplicateWorkspace = result.workspace
    await act(async () => pending.resolve(result))
    expect(container.textContent).toContain("Workspace duplicated as Fixture workspace copy.")
  })

  it("disables workspace duplication while a draft is dirty and preserves that draft", async () => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Split panes horizontally"]')!.click()
    })
    const duplicate = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Duplicate workspace",
    )!

    expect(duplicate.disabled).toBe(true)
    expect(sessionStorage.getItem("flapstack:saved-workspace-draft:v1:workspace-1")).toContain(
      '"type":"split"',
    )
    await act(async () => duplicate.click())
    expect(mocks.duplicate).not.toHaveBeenCalled()
  })

  it("queues an edit made during an older save and persists it against the returned version", async () => {
    const firstSave = deferred<ReturnType<typeof savedResult>>()
    mocks.save.mockReset()
    mocks.save
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(async (input: { layout: SavedWorkspaceLayout }) =>
        savedResult(input, 3),
      )

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Split panes horizontally"]')!.click()
    })
    const save = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save"),
    )!
    await act(async () => save.click())
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Duplicate workspace",
      )?.disabled,
    ).toBe(true)
    const layoutA = mocks.save.mock.calls[0]?.[0].layout as SavedWorkspaceLayout

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Duplicate active pane as tab"]')!
        .click()
    })

    await act(async () => {
      firstSave.resolve(savedResult({ layout: layoutA }, 2))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })

    expect(mocks.save).toHaveBeenCalledTimes(2)
    const queued = mocks.save.mock.calls[1]?.[0] as {
      expectedVersion: number
      layout: SavedWorkspaceLayout
    }
    expect(queued.expectedVersion).toBe(2)
    expect(countPanes(queued.layout)).toBe(countPanes(layoutA) + 1)
    expect(container.textContent).toContain("Workspace saved.")
  })

  it("wakes a queued autosave after an older workspace save finishes", async () => {
    vi.useFakeTimers()
    const firstSave = deferred<ReturnType<typeof savedResult>>()
    mocks.save.mockReset()
    mocks.save
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(async (input: { layout: SavedWorkspaceLayout }) =>
        savedResult(input, 8, "workspace-2"),
      )

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Split panes horizontally"]')!.click()
    })
    const save = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Save"),
    )!
    await act(async () => save.click())
    const layoutA = mocks.save.mock.calls[0]?.[0].layout as SavedWorkspaceLayout

    await act(async () => {
      root.render(
        createElement(SavedWorkspacesView, {
          projectId: "project-2",
          initialChatId: "chat-2",
        }),
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(
      container.querySelector<HTMLSelectElement>('[aria-label="Saved workspace"]')?.value,
    ).toBe("workspace-2")

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Duplicate active pane as tab"]')!
        .click()
      await vi.advanceTimersByTimeAsync(400)
    })
    expect(mocks.save).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstSave.resolve(savedResult({ layout: layoutA }, 2))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.save).toHaveBeenCalledTimes(2)
    expect(mocks.save.mock.calls[1]?.[0]).toMatchObject({
      workspaceId: "workspace-2",
      expectedVersion: 7,
    })
    expect(countPanes(mocks.save.mock.calls[1]?.[0].layout as SavedWorkspaceLayout)).toBe(2)
  })
})

function savedResult(
  input: { layout: SavedWorkspaceLayout },
  version: number,
  workspaceId = "workspace-1",
) {
  return {
    workspace: {
      id: workspaceId,
      name: workspaceId === "workspace-2" ? "Second workspace" : "Fixture workspace",
      scope: { type: "project" as const, projectId: "project-1" },
      owner: { kind: "manual" as const },
      layoutVersion: 1 as const,
      layout: input.layout,
      layoutIssue: null,
      sortOrder: "a0",
      version,
      createdAt: 1,
      updatedAt: version,
      archivedAt: null,
    },
    invalidation: { queries: [], workspaceIds: [workspaceId], removeWorkspaceIds: [] },
  }
}

function duplicateResult() {
  const workspace = {
    ...savedResult({ layout: fixtureLayout }, 1, "workspace-copy").workspace,
    name: "Fixture workspace copy",
  }
  return {
    workspace,
    invalidation: { queries: [], workspaceIds: [workspace.id], removeWorkspaceIds: [] },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function countPanes(layout: SavedWorkspaceLayout): number {
  const visit = (node: SavedWorkspaceLayout["root"]): number =>
    node.type === "tabs"
      ? node.panes.length
      : node.children.reduce((total, child) => total + visit(child), 0)
  return visit(layout.root)
}
