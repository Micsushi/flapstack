// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { Provider, createStore } from "jotai"
import { expect, it, vi } from "vitest"
import { FileSearchDialog } from "../src/renderer/features/file-viewer/components/file-search-dialog"
import { recentlyOpenedFilesAtom } from "../src/renderer/features/agents/atoms"
import {
  clearAppActionHistory,
  undoAppAction,
  redoAppAction,
} from "../src/renderer/lib/app-action-history"

vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    files: { search: { useQuery: () => ({ data: [], refetch: vi.fn(), isFetching: false }) } },
  },
}))
vi.mock("../src/renderer/features/agents/mentions/agents-file-mention", () => ({
  getFileIconByExtension: () => null,
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
vi.mock("../src/renderer/features/settings/use-beta-features", () => ({
  useBetaFeatures: () => ({ streamedFileSearch: false }),
}))

it("removes Windows recent aliases without opening the file and supports shared undo/redo", async () => {
  clearAppActionHistory()
  const store = createStore()
  const before = ["c:\\repo\\src\\App.tsx", "C:/repo/src/app.tsx"]
  store.set(recentlyOpenedFilesAtom, before)
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
            projectPath={"C:\\repo\\"}
            onSelectFile={select}
          />
        </Provider>,
      ),
    )
    const remove = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove App.tsx from recent files"]',
    )!
    expect(remove).not.toBeNull()
    await act(async () => {
      remove.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      remove.click()
    })
    expect(select).not.toHaveBeenCalled()
    expect(store.get(recentlyOpenedFilesAtom)).toEqual([])
    await act(async () => {
      await undoAppAction()
    })
    expect(store.get(recentlyOpenedFilesAtom)).toEqual(before)
    await act(async () => {
      await redoAppAction()
    })
    expect(store.get(recentlyOpenedFilesAtom)).toEqual([])
    await act(async () => {
      store.set(recentlyOpenedFilesAtom, ["C:/repo/new.ts"])
    })
    await act(async () => {
      await undoAppAction()
    })
    expect(store.get(recentlyOpenedFilesAtom)).toContain("C:/repo/new.ts")
    expect(store.get(recentlyOpenedFilesAtom)).toContain(before[0])
  } finally {
    await act(async () => root.unmount())
    container.remove()
    if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll)
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
    clearAppActionHistory()
  }
})
