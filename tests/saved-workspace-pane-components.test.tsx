// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SavedWorkspaceLayout } from "../src/shared/saved-workspaces"

const terminalMount = vi.hoisted(() => vi.fn())

vi.mock("../src/renderer/features/terminal", () => ({
  Terminal: (props: { cwd: string }) => {
    terminalMount(props)
    return createElement("div", { "data-terminal": true }, props.cwd)
  },
}))
vi.mock("../src/renderer/features/changes", () => ({ ChangesPanel: () => null }))
vi.mock("../src/renderer/features/file-viewer", () => ({ FileViewerSidebar: () => null }))
vi.mock("../src/renderer/lib/trpc", () => ({ trpc: {} }))

import {
  WorkspacePaneBindingForm,
  WorkspaceTerminalPane,
} from "../src/renderer/features/saved-workspaces/pane-adapters"
import {
  getWorkspaceGroups,
  reduceWorkspaceLayout,
} from "../src/renderer/features/saved-workspaces/layout-reducer"
import { WorkspaceLayoutShell } from "../src/renderer/features/saved-workspaces/workspace-layout-shell"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("saved workspace bound pane components", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    terminalMount.mockReset()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("restores terminal metadata without creating a process until explicit activation", async () => {
    const pane = {
      id: "terminal-pane",
      binding: {
        type: "terminal" as const,
        cwd: "relative",
        worktreePath: "/repo",
        restorePolicy: "prompt" as const,
      },
    }
    await act(async () => {
      root.render(
        createElement(WorkspaceTerminalPane, {
          workspaceId: "workspace-1",
          pane,
          terminalCwd: "/verified/repo/relative",
        }),
      )
    })
    expect(terminalMount).not.toHaveBeenCalled()
    expect(container.textContent).toContain("No PTY process was restored")

    const start = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Start fresh terminal"),
    )!
    await act(async () => start.click())
    expect(terminalMount).toHaveBeenCalledTimes(1)
    expect(terminalMount).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/verified/repo/relative",
        initialCwd: "/verified/repo/relative",
      }),
    )
  })

  it("adds, repairs, pins, unpins, and removes panes while keeping one reachable pane", () => {
    let current = baseLayout()
    current = reduceWorkspaceLayout(current, {
      type: "add-pane",
      groupId: "group-1",
      pane: { id: "browser-pane", binding: { type: "browser", url: "https://example.com" } },
    })
    current = reduceWorkspaceLayout(current, {
      type: "replace-binding",
      paneId: "browser-pane",
      binding: { type: "file", path: "README.md", worktreePath: "/repo", line: null },
    })
    current = reduceWorkspaceLayout(current, {
      type: "pin-context",
      paneId: "browser-pane",
      context: { id: "context-1", type: "browser", url: "https://example.com/docs" },
    })
    current = reduceWorkspaceLayout(current, {
      type: "unpin-context",
      paneId: "browser-pane",
      contextId: "context-1",
    })
    current = reduceWorkspaceLayout(current, {
      type: "remove-pane",
      groupId: "group-1",
      paneId: "browser-pane",
    })
    expect(getWorkspaceGroups(current)[0].panes).toEqual([
      { id: "chat-pane", binding: { type: "chat", chatId: "chat-1" } },
    ])
    expect(
      reduceWorkspaceLayout(current, {
        type: "remove-pane",
        groupId: "group-1",
        paneId: "chat-pane",
      }),
    ).toEqual(current)
  })

  it("exposes keyboard-reachable add and remove controls", async () => {
    const onAdd = vi.fn()
    await act(async () => {
      root.render(
        createElement(WorkspaceLayoutShell, {
          layout: baseLayout(),
          onLayoutChange: vi.fn(),
          onRequestAddPane: onAdd,
        }),
      )
    })
    const add = container.querySelector<HTMLButtonElement>('[aria-label="Add pane to this group"]')!
    expect(add).not.toBeNull()
    expect(
      container.querySelector('[aria-label="Remove active pane"]')?.hasAttribute("disabled"),
    ).toBe(true)
    await act(async () => add.click())
    expect(onAdd).toHaveBeenCalledWith("group-1")
  })

  it("rejects unsafe browser repair input before submit", async () => {
    const onSubmit = vi.fn()
    await act(async () => {
      root.render(
        createElement(WorkspacePaneBindingForm, {
          initialBinding: { type: "browser", url: "https://example.com" },
          submitLabel: "Repair pane",
          onSubmit,
        }),
      )
    })
    const input = container.querySelector<HTMLInputElement>("input")!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        input,
        "javascript:alert(1)",
      )
      input.dispatchEvent(new Event("input", { bubbles: true }))
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  })
})

function baseLayout(): SavedWorkspaceLayout {
  return {
    version: 1,
    root: {
      type: "tabs",
      id: "group-1",
      activePaneId: "chat-pane",
      panes: [{ id: "chat-pane", binding: { type: "chat", chatId: "chat-1" } }],
    },
  }
}
