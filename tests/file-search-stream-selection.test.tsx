// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { Provider, createStore } from "jotai"
import { expect, it, vi } from "vitest"
import { FileSearchDialog } from "../src/renderer/features/file-viewer/components/file-search-dialog"
import { recentlyOpenedFilesAtom } from "../src/renderer/features/agents/atoms"
import type { WorkspaceFileSearchEvent } from "../src/shared/workspace-search"

const stream = vi.hoisted(() => ({
  requestId: "",
  onData: (_event: WorkspaceFileSearchEvent) => {},
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    files: { search: { useQuery: () => ({ data: [], refetch: vi.fn(), isFetching: false }) } },
  },
  trpcClient: {
    files: {
      searchStream: {
        subscribe: (input, handlers) => {
          stream.requestId = input.requestId
          stream.onData = handlers.onData
          return { unsubscribe: vi.fn() }
        },
      },
    },
  },
}))
vi.mock("../src/renderer/features/agents/mentions/agents-file-mention", () => ({
  getFileIconByExtension: () => null,
}))
vi.mock("../src/renderer/features/settings/use-beta-features", () => ({
  useBetaFeatures: () => ({ streamedFileSearch: true }),
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

it("removes the second recent file without opening it and returns focus to search", async () => {
  const store = createStore()
  store.set(recentlyOpenedFilesAtom, ["C:/repo/first.ts", "C:/repo/second.ts"])
  const select = vi.fn()
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  })
  try {
    await act(async () =>
      root.render(
        <Provider store={store}>
          <FileSearchDialog
            open
            onOpenChange={() => {}}
            projectPath="C:/repo"
            onSelectFile={select}
          />
        </Provider>,
      ),
    )
    const removal = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Remove recent file"]',
    )!
    expect(removal.closest('[role="listbox"]')).toBeNull()
    const second = [...removal.options].find((option) => option.text === "second.ts")!
    expect(second).toBeDefined()
    await act(async () => {
      removal.focus()
      removal.value = second.value
      removal.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(store.get(recentlyOpenedFilesAtom)).toEqual(["C:/repo/first.ts"])
    expect(select).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(document.querySelector('[role="combobox"]'))
  } finally {
    await act(async () => root.unmount())
    container.remove()
    if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll)
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
  }
})

it.each([false, true])(
  "keeps streamed keyboard selection by identity (drop selected: %s)",
  async (drop) => {
    const store = createStore()
    store.set(recentlyOpenedFilesAtom, [])
    const select = vi.fn()
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
    const emit = (names: string[]) =>
      stream.onData({
        requestId: stream.requestId,
        provider: "filesystem",
        status: "partial",
        results: names.map((name) => ({
          id: name,
          label: name + ".ts",
          path: name + ".ts",
          repository: "local",
          type: "file",
        })),
      })
    const key = (value: string) =>
      document
        .querySelector('[role="combobox"]')!
        .dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }))
    try {
      await act(async () =>
        root.render(
          <Provider store={store}>
            <FileSearchDialog
              open
              onOpenChange={() => {}}
              projectPath="C:/repo"
              onSelectFile={select}
            />
          </Provider>,
        ),
      )
      await act(async () => emit(["b", "c"]))
      await act(async () => {
        key("ArrowDown")
      })
      if (drop) await act(async () => emit(["a", "b"]))
      await act(async () => emit(["a", "b", "c"]))
      const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!
      const active = document.getElementById(input.getAttribute("aria-activedescendant")!)!
      expect(active.getAttribute("role")).toBe("option")
      expect(active.getAttribute("aria-selected")).toBe("true")
      expect(active.textContent).toContain(drop ? "a.ts" : "c.ts")
      expect(document.querySelector('[role="listbox"] button')).toBeNull()
      await act(async () => {
        key("Enter")
      })
      expect(select).toHaveBeenCalledExactlyOnceWith(drop ? "C:/repo/a.ts" : "C:/repo/c.ts")
    } finally {
      await act(async () => root.unmount())
      container.remove()
      if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll)
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
    }
  },
)
