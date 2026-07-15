// @vitest-environment jsdom

import { act, createElement, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SavedWorkspaceLayout } from "../src/shared/saved-workspaces"
import type {
  WorkspaceOwnershipInvalidation,
  WorkspacePaneClaimResult,
} from "../src/shared/workspace-window-ownership"
import { WorkspaceLayoutShell } from "../src/renderer/features/saved-workspaces/workspace-layout-shell"
import { WorkspacePaneOwnershipBoundary } from "../src/renderer/features/saved-workspaces/workspace-window-ownership"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("saved workspace window controls", () => {
  let root: Root
  let container: HTMLDivElement
  let claimWorkspacePane: ReturnType<typeof vi.fn>
  let releaseWorkspacePane: ReturnType<typeof vi.fn>
  let ownershipCallback: ((payload: WorkspaceOwnershipInvalidation) => void) | undefined

  beforeEach(() => {
    ownershipCallback = undefined
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
    claimWorkspacePane = vi.fn().mockResolvedValue({
      ok: true,
      state: "claimed",
      ownerStableId: "main",
    })
    releaseWorkspacePane = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: {
        claimWorkspacePane,
        releaseWorkspacePane,
        onWorkspaceOwnershipChanged: vi.fn(
          (callback: (payload: WorkspaceOwnershipInvalidation) => void) => {
            ownershipCallback = callback
            return vi.fn()
          },
        ),
        focusWorkspacePaneOwner: vi.fn().mockResolvedValue(true),
        focusChatOwner: vi.fn().mockResolvedValue(true),
        openWorkspaceRemainder: vi.fn().mockResolvedValue({
          ok: true,
          state: "opened",
          ownerStableId: "remainder",
        }),
      },
    })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("keeps the claim target stable across unrelated cloned pane renders", async () => {
    const render = (title: string) =>
      createElement(
        WorkspacePaneOwnershipBoundary,
        {
          workspaceId: "workspace",
          pane: { id: "pane", title, binding: { type: "chat", chatId: "chat" } },
        },
        createElement("p", null, title),
      )

    await act(async () => root.render(render("First title")))
    await act(async () => root.render(render("Cloned layout title")))

    expect(claimWorkspacePane).toHaveBeenCalledTimes(1)
    expect(releaseWorkspacePane).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Cloned layout title")

    await act(async () =>
      ownershipCallback?.({
        revision: 2,
        reason: "move",
        workspaceId: "workspace",
        paneId: "pane",
        chatIds: ["chat"],
      }),
    )
    expect(claimWorkspacePane).toHaveBeenCalledTimes(2)
  })

  it("restores mounted authority state during StrictMode effect replay", async () => {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(
            WorkspacePaneOwnershipBoundary,
            {
              workspaceId: "workspace",
              pane: { id: "pane", binding: { type: "chat", chatId: "chat" } },
            },
            createElement("p", null, "Strict live controller"),
          ),
        ),
      )
    })

    expect(container.textContent).toContain("Strict live controller")
    expect(claimWorkspacePane.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it("fails closed when an invalidation re-claim rejects", async () => {
    await act(async () => {
      root.render(
        createElement(
          WorkspacePaneOwnershipBoundary,
          {
            workspaceId: "workspace",
            pane: { id: "pane", binding: { type: "chat", chatId: "chat" } },
          },
          createElement("p", null, "Live controller"),
        ),
      )
    })
    expect(container.textContent).toContain("Live controller")

    claimWorkspacePane.mockRejectedValueOnce(new Error("ownership transport failed"))
    await act(async () =>
      ownershipCallback?.({
        revision: 3,
        reason: "move",
        workspaceId: "workspace",
        paneId: "pane",
        chatIds: ["chat"],
      }),
    )

    expect(container.textContent).not.toContain("Live controller")
    expect(container.textContent).toContain("Pane is already active")
    expect(container.textContent).toContain("ownership transport failed")
  })

  it("keeps a newer successful claim when an older request rejects later", async () => {
    const older = deferred<WorkspacePaneClaimResult>()
    claimWorkspacePane
      .mockReset()
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce({ ok: true, state: "claimed", ownerStableId: "main" })
    await act(async () => {
      root.render(
        createElement(
          WorkspacePaneOwnershipBoundary,
          {
            workspaceId: "workspace",
            pane: { id: "pane", binding: { type: "chat", chatId: "chat" } },
          },
          createElement("p", null, "Newest live controller"),
        ),
      )
    })
    await act(async () =>
      ownershipCallback?.({
        revision: 4,
        reason: "move",
        workspaceId: "workspace",
        paneId: "pane",
        chatIds: ["chat"],
      }),
    )
    expect(container.textContent).toContain("Newest live controller")

    await act(async () => older.reject(new Error("late older failure")))
    expect(container.textContent).toContain("Newest live controller")
    expect(container.textContent).not.toContain("late older failure")
  })

  it("ignores an old binding completion after the pane target changes", async () => {
    const oldTarget = deferred<WorkspacePaneClaimResult>()
    claimWorkspacePane
      .mockReset()
      .mockReturnValueOnce(oldTarget.promise)
      .mockResolvedValueOnce({ ok: true, state: "claimed", ownerStableId: "main" })
    const render = (chatId: string) =>
      createElement(
        WorkspacePaneOwnershipBoundary,
        {
          workspaceId: "workspace",
          pane: { id: "pane", binding: { type: "chat", chatId } },
        },
        createElement("p", null, `Live ${chatId}`),
      )

    await act(async () => root.render(render("chat-a")))
    await act(async () => root.render(render("chat-b")))
    expect(container.textContent).toContain("Live chat-b")

    await act(async () =>
      oldTarget.resolve({
        ok: false,
        ownerStableId: "old-owner",
        conflicts: [{ kind: "chat", chatId: "chat-a", ownerStableId: "old-owner" }],
      }),
    )
    expect(container.textContent).toContain("Live chat-b")
    expect(container.textContent).not.toContain("old-owner")
  })

  it("releases stale successful A authority while preserving current B", async () => {
    const oldTarget = deferred<WorkspacePaneClaimResult>()
    const authority = new Set<string>()
    let currentPaneChatIds: string[] = []
    claimWorkspacePane
      .mockReset()
      .mockImplementationOnce((target: { chatIds: string[] }) => {
        currentPaneChatIds = [...target.chatIds]
        target.chatIds.forEach((chatId) => authority.add(chatId))
        return oldTarget.promise
      })
      .mockImplementationOnce(async (target: { chatIds: string[] }) => {
        authority.clear()
        currentPaneChatIds = [...target.chatIds]
        authority.add(target.chatIds[0])
        return { ok: true, state: "claimed", ownerStableId: "main" }
      })
    releaseWorkspacePane.mockImplementation(async (target: { chatIds: string[] }) => {
      if (
        target.chatIds.length === currentPaneChatIds.length &&
        target.chatIds.every((chatId) => currentPaneChatIds.includes(chatId))
      ) {
        target.chatIds.forEach((chatId) => authority.delete(chatId))
        currentPaneChatIds = []
      }
    })
    const render = (chatId: string) =>
      createElement(
        WorkspacePaneOwnershipBoundary,
        {
          workspaceId: "workspace",
          pane: { id: "pane", binding: { type: "chat", chatId } },
        },
        createElement("p", null, `Live ${chatId}`),
      )

    await act(async () => root.render(render("chat-a")))
    await act(async () => root.render(render("chat-b")))
    await act(async () => oldTarget.resolve({ ok: true, state: "claimed", ownerStableId: "main" }))

    expect(authority).toEqual(new Set(["chat-b"]))
    expect(releaseWorkspacePane).toHaveBeenCalledWith({
      projectId: undefined,
      workspaceId: "workspace",
      paneId: "pane",
      chatIds: ["chat-a"],
    })
    expect(container.textContent).toContain("Live chat-b")
  })

  it("offers focus, move, skip, and separate-window recovery with live status", async () => {
    claimWorkspacePane
      .mockResolvedValueOnce({
        ok: false,
        ownerStableId: "workspace-owner",
        conflicts: [{ kind: "chat", chatId: "chat", ownerStableId: "workspace-owner" }],
      })
      .mockResolvedValue({ ok: true, state: "moved", ownerStableId: "main" })

    await act(async () => {
      root.render(
        createElement(
          WorkspacePaneOwnershipBoundary,
          {
            projectId: "project",
            workspaceId: "workspace",
            pane: { id: "pane", binding: { type: "chat", chatId: "chat" } },
          },
          createElement("p", null, "Live chat"),
        ),
      )
    })

    const labels = [...container.querySelectorAll("button")].map((button) => button.textContent)
    expect(labels).toEqual([
      "Focus owner",
      "Move here",
      "Skip pane",
      "Open remaining workspace separately",
    ])
    expect(container.querySelector('[aria-live="assertive"]')).not.toBeNull()

    const move = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Move here",
    )!
    await act(async () => move.click())
    expect(claimWorkspacePane).toHaveBeenLastCalledWith(
      { projectId: "project", workspaceId: "workspace", paneId: "pane", chatIds: ["chat"] },
      "move",
    )
    expect(container.textContent).toContain("Live chat")
  })

  it("exposes keyboard-focusable pop-out and pull-back controls", async () => {
    const onPopOutPane = vi.fn()
    const layout = singlePaneLayout()
    await act(async () => {
      root.render(
        createElement(WorkspaceLayoutShell, {
          layout,
          onLayoutChange: vi.fn(),
          onPopOutPane,
        }),
      )
    })
    const popout = container.querySelector<HTMLButtonElement>(
      '[aria-label="Pop active pane out to a new window"]',
    )!
    popout.focus()
    expect(document.activeElement).toBe(popout)
    await act(async () => popout.click())
    expect(onPopOutPane).toHaveBeenCalledWith(layout.root.type === "tabs" && layout.root.panes[0])

    const onPullBackPane = vi.fn()
    await act(async () => {
      root.render(
        createElement(WorkspaceLayoutShell, {
          layout,
          onLayoutChange: vi.fn(),
          popoutPaneId: "pane",
          onPullBackPane,
        }),
      )
    })
    const pullback = container.querySelector<HTMLButtonElement>(
      '[aria-label="Pull active pane back into its workspace window"]',
    )!
    expect(pullback).not.toBeNull()
    expect(container.querySelector('[aria-label="Duplicate active pane as tab"]')).toBeNull()
  })

  it("does not expose structural mutation callbacks for a derived target layout", async () => {
    const onLayoutChange = vi.fn()
    const onRequestAddPane = vi.fn()
    const layout: SavedWorkspaceLayout = {
      version: 1,
      root: {
        type: "split",
        id: "split",
        direction: "row",
        sizes: [0.5, 0.5],
        children: [singlePaneLayout().root, { ...singlePaneLayout().root, id: "other-group" }],
      },
    }
    await act(async () => {
      root.render(
        createElement(WorkspaceLayoutShell, {
          layout,
          onLayoutChange,
          onRequestAddPane,
          structuralReadOnly: true,
        }),
      )
    })

    expect(container.querySelector('[role="separator"]')).toBeNull()
    expect(container.querySelector('[aria-label="Add pane to this group"]')).toBeNull()
    expect(container.querySelector('[aria-label="Duplicate active pane as tab"]')).toBeNull()
    expect(container.querySelector('[aria-label="Remove active pane"]')).toBeNull()
    expect(
      [...container.querySelectorAll<HTMLElement>('[role="tab"]')].every((tab) => !tab.draggable),
    ).toBe(true)
    expect(onLayoutChange).not.toHaveBeenCalled()
  })
})

function singlePaneLayout(): SavedWorkspaceLayout {
  return {
    version: 1,
    root: {
      type: "tabs",
      id: "group",
      activePaneId: "pane",
      panes: [{ id: "pane", binding: { type: "chat", chatId: "chat" } }],
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
