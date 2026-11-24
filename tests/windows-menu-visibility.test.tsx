// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { WindowsTitleBar } from "../src/renderer/components/windows-title-bar"

it("reveals the custom Windows menus with Alt alone and returns focus on Escape", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal("desktopApi", { platform: "win32", getWindowFrameState: async () => false })
  const editor = document.createElement("input")
  const container = document.createElement("div")
  document.body.append(editor, container)
  const root = createRoot(container)
  const key = (type: string, value: string, altKey = false) =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent(type, { key: value, altKey }))
    })
  const menus = () => container.querySelector('[aria-label="Application menus"]')
  try {
    await act(async () => root.render(<WindowsTitleBar />))
    editor.focus()
    expect(menus()).toBeNull()
    key("keydown", "Alt", true)
    key("keydown", "ArrowLeft", true)
    key("keyup", "Alt")
    expect(menus()).toBeNull()
    key("keydown", "Alt", true)
    key("keyup", "Alt")
    expect(menus()?.querySelectorAll("button")).toHaveLength(4)
    expect(document.activeElement?.textContent).toBe("File")
    key("keydown", "Escape")
    expect(menus()).toBeNull()
    expect(document.activeElement).toBe(editor)
  } finally {
    act(() => root.unmount())
    editor.remove()
    container.remove()
    vi.unstubAllGlobals()
  }
})
