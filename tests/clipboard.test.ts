// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { writeClipboardText } from "../src/renderer/lib/clipboard"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("clipboard writing", () => {
  it("uses the browser clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })

    await writeClipboardText("visible message")
    expect(writeText).toHaveBeenCalledWith("visible message")
  })

  it("falls back to the Electron clipboard when browser permission fails", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    })
    const clipboardWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: { clipboardWrite },
    })

    await writeClipboardText("visible message")
    expect(clipboardWrite).toHaveBeenCalledWith("visible message")
  })
})
