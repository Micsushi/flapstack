// @vitest-environment jsdom

import { Provider } from "jotai"
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProductTour, startProductTour } from "../src/renderer/features/onboarding/product-tour"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("ProductTour interactions", () => {
  let container: HTMLDivElement
  let root: Root
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    const target = document.createElement("div")
    target.dataset.tour = "workspace"
    target.getBoundingClientRect = () => new DOMRect(20, 20, 200, 100)
    document.body.append(target)

    scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    window.matchMedia = vi.fn().mockReturnValue({ matches: true })
    window.desktopApi = { isPackaged: vi.fn().mockResolvedValue(false) } as never
    window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(0), 0)
    window.cancelAnimationFrame = (handle) => window.clearTimeout(handle)

    root = createRoot(container)
    act(() =>
      root.render(
        <Provider>
          <ProductTour />
        </Provider>,
      ),
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  const openTour = async () => {
    await act(async () => {
      startProductTour()
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
  }

  it("does not smooth-scroll when reduced motion is requested", async () => {
    await openTour()

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      inline: "nearest",
      behavior: "auto",
    })
  })

  it("moves initial focus into the modal coachmark", async () => {
    await openTour()

    const dialog = document.querySelector<HTMLElement>("section[role=dialog]")
    const done = document.querySelector<HTMLButtonElement>("section[role=dialog] button:last-child")
    expect(dialog?.getAttribute("aria-describedby")).toBe("product-tour-description")
    expect(document.getElementById("product-tour-description")?.textContent).toContain(
      "main work area",
    )
    expect(document.activeElement).toBe(done)
  })

  it("keeps Tab focus inside the modal coachmark", async () => {
    await openTour()

    const done = document.querySelector<HTMLButtonElement>(
      "section[role=dialog] button:last-child",
    )!
    const close = document.querySelector<HTMLButtonElement>('[aria-label="Close tutorial"]')
    done.focus()

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })))
    expect(document.activeElement).toBe(close)

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true })))
    expect(document.activeElement).toBe(done)
  })

  it("skips a responsive anchor with no rendered area", async () => {
    const workspace = document.querySelector<HTMLElement>('[data-tour="workspace"]')!
    workspace.getBoundingClientRect = () => new DOMRect()
    const sidebar = document.createElement("div")
    sidebar.dataset.tour = "sidebar"
    sidebar.getBoundingClientRect = () => new DOMRect(20, 20, 200, 100)
    document.body.append(sidebar)

    await openTour()

    expect(document.querySelector("[role=dialog]")?.textContent).toContain("Projects and chats")
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }))
    expect(scrollIntoView.mock.instances.at(-1)).toBe(sidebar)
  })
})
