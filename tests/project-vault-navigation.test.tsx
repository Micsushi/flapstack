// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createVaultEditorState } from "../src/renderer/features/project-vault/editor-state"
import {
  SearchResults,
  SECTION_GROUPS,
  SectionTree,
} from "../src/renderer/features/project-vault/project-vault-navigation"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("project vault navigation accessibility", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it("uses tree semantics and moves focus and selection together from the keyboard", () => {
    const onSelect = vi.fn()
    act(() => {
      root.render(
        <SectionTree
          groups={SECTION_GROUPS}
          sections={[
            { sectionId: "index", title: "Project index", sectionType: "index" },
            { sectionId: "handoff", title: "Current handoff", sectionType: "handoff" },
          ]}
          selected="index"
          editors={{
            index: createVaultEditorState({
              version: 1,
              content: "base",
              contentHash: "a".repeat(64),
              currentContentHash: "a".repeat(64),
              externallyModified: false,
            }),
          }}
          onSelect={onSelect}
        />,
      )
    })

    const tree = container.querySelector('[role="tree"][aria-label="Typed vault sections"]')
    const items = [...container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')]
    expect(tree).not.toBeNull()
    expect(items).toHaveLength(2)
    expect(items[0]!.getAttribute("aria-selected")).toBe("true")
    expect(items[0]!.textContent).toContain("Saved")

    items[0]!.focus()
    act(() =>
      items[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
    )
    expect(onSelect).toHaveBeenCalledWith("handoff")
    expect(document.activeElement).toBe(items[1])

    act(() => {
      root.render(
        <SectionTree
          groups={SECTION_GROUPS}
          sections={[
            { sectionId: "index", title: "Project index", sectionType: "index" },
            { sectionId: "handoff", title: "Current handoff", sectionType: "handoff" },
          ]}
          selected={null}
          editors={{}}
          onSelect={onSelect}
        />,
      )
    })
    const unselectedItems = [...container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')]
    expect(unselectedItems.map((item) => item.tabIndex)).toEqual([0, -1])
  })

  it("supports roving search-result focus, escape, and live error reporting", () => {
    const onSelect = vi.fn()
    const onExit = vi.fn()
    act(() => {
      root.render(
        <SearchResults
          results={[
            {
              sectionId: "index",
              title: "Project index",
              snippet: "First match",
              externallyModified: false,
            },
            {
              sectionId: "handoff",
              title: "Current handoff",
              snippet: "Second match",
              externallyModified: true,
            },
          ]}
          loading={false}
          onSelect={onSelect}
          onExit={onExit}
        />,
      )
    })

    const results = [...container.querySelectorAll<HTMLButtonElement>("[data-vault-search-result]")]
    expect(container.querySelectorAll("ul > li")).toHaveLength(2)
    expect(container.textContent).toContain("2 project vault search results")
    expect(results[1]!.textContent).toContain("Changed outside Flapstack")

    results[0]!.focus()
    act(() =>
      results[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })),
    )
    expect(document.activeElement).toBe(results[1])
    act(() =>
      results[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    )
    expect(onExit).toHaveBeenCalledOnce()

    act(() => {
      root.render(
        <SearchResults
          results={[]}
          loading={false}
          error="Registered vault root was replaced"
          onSelect={onSelect}
          onExit={onExit}
        />,
      )
    })
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("Registered vault root was replaced")
    expect(container.textContent).toContain("Search unavailable")
  })
})
