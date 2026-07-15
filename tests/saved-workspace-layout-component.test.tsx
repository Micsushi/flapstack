// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SavedWorkspaceLayout } from "../src/shared/saved-workspaces"
import { WorkspaceLayoutShell } from "../src/renderer/features/saved-workspaces/workspace-layout-shell"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("saved workspace layout shell", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("renders reachable tabs, tab panels, split separators, and pane content", async () => {
    const onLayoutChange = vi.fn()
    await act(async () => {
      root.render(
        createElement(WorkspaceLayoutShell, {
          layout: componentLayout(),
          onLayoutChange,
          renderPane: (pane) => createElement("p", null, `Rendered ${pane.id}`),
        }),
      )
    })
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3)
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(2)
    expect(container.querySelector('[role="separator"]')?.getAttribute("tabindex")).toBe("0")
    expect(container.textContent).toContain("Rendered pane-1")

    const inactive = container.querySelector<HTMLButtonElement>("#workspace-tab-group-1-pane-2")!
    await act(async () =>
      inactive.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    )
    expect(onLayoutChange).toHaveBeenCalled()
  })

  it("exposes stale and missing bindings without hiding other groups", async () => {
    await act(async () => {
      root.render(
        createElement(WorkspaceLayoutShell, {
          layout: componentLayout(),
          onLayoutChange: vi.fn(),
          paneStates: { "pane-1": { kind: "stale", message: "Chat was archived." } },
        }),
      )
    })
    expect(container.textContent).toContain("Pane target is stale")
    expect(container.textContent).toContain("Chat was archived.")
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(2)
  })

  it("supports keyboard resize persistence", async () => {
    const onLayoutChange = vi.fn()
    await act(async () => {
      root.render(
        createElement(WorkspaceLayoutShell, { layout: componentLayout(), onLayoutChange }),
      )
    })
    const separator = container.querySelector<HTMLElement>('[role="separator"]')!
    await act(async () =>
      separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    )
    const nextLayout = onLayoutChange.mock.calls[0]?.[0] as SavedWorkspaceLayout
    expect(nextLayout.root).toMatchObject({ type: "split", sizes: [0.55, 0.45] })
  })
})

function componentLayout(): SavedWorkspaceLayout {
  return {
    version: 1,
    root: {
      type: "split",
      id: "split-root",
      direction: "row",
      sizes: [1, 1],
      children: [
        {
          type: "tabs",
          id: "group-1",
          activePaneId: "pane-1",
          panes: [
            { id: "pane-1", title: "First", binding: { type: "chat", chatId: "chat-1" } },
            { id: "pane-2", title: "Second", binding: { type: "chat", chatId: "chat-2" } },
          ],
        },
        {
          type: "tabs",
          id: "group-2",
          activePaneId: "pane-3",
          panes: [
            {
              id: "pane-3",
              title: "Third",
              binding: { type: "file", path: "/tmp/a", worktreePath: null, line: null },
            },
          ],
        },
      ],
    },
  }
}
