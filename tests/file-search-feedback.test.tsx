// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FileSearchFeedback } from "../src/renderer/features/file-viewer/components/file-search-feedback"

const containers: HTMLDivElement[] = []
globalThis.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => {
  for (const container of containers.splice(0)) container.remove()
})

describe("file discovery feedback", () => {
  it("announces the actual failure and offers a working retry without selecting a file", async () => {
    const container = document.createElement("div")
    containers.push(container)
    document.body.append(container)
    const root = createRoot(container)
    const retry = vi.fn()
    const select = vi.fn()
    try {
      await act(async () =>
        root.render(
          <div onKeyDown={select}>
            <FileSearchFeedback
              error="Directory depth limit exceeded: 雪/long-path"
              busy={false}
              onRetry={retry}
            />
          </div>,
        ),
      )
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "Directory depth limit",
      )
      const button = container.querySelector("button")!
      await act(async () => button.click())
      expect(retry).toHaveBeenCalledOnce()
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
      expect(select).not.toHaveBeenCalled()
      await act(async () =>
        root.render(<FileSearchFeedback error="Still unavailable" busy onRetry={retry} />),
      )
      expect(container.querySelector("button")?.disabled).toBe(true)
      expect(container.textContent).toContain("Retrying")
      await act(async () => root.render(<FileSearchFeedback busy onRetry={retry} />))
      expect(container.querySelector('[role="status"]')?.textContent).toContain("Searching files")
    } finally {
      await act(async () => root.unmount())
    }
  })
})
