// @vitest-environment jsdom

import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import { Provider } from "jotai"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AgentsKeyboardTab } from "../src/renderer/components/dialogs/settings-tabs/agents-keyboard-tab"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("Keyboard Settings", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement("div")
    document.body.append(container)
  })

  afterEach(() => {
    container.remove()
  })

  it("persists a valid edit, rejects a conflict, and resets the override", async () => {
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(Provider, null, createElement(AgentsKeyboardTab)))
    })

    const changeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Change Toggle sidebar shortcut"]',
    )
    expect(changeButton).not.toBeNull()

    const dispatch = async (event: KeyboardEvent) => {
      await act(async () => window.dispatchEvent(event))
    }

    await act(async () => changeButton?.click())
    await dispatch(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }))
    await dispatch(new KeyboardEvent("keydown", { key: "p", code: "KeyP", ctrlKey: true }))
    await dispatch(new KeyboardEvent("keyup", { key: "p", code: "KeyP", ctrlKey: true }))
    expect(container.textContent).toContain("Go to file already uses this shortcut")

    await act(async () => changeButton?.click())
    await dispatch(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }))
    await dispatch(new KeyboardEvent("keydown", { key: "Shift", ctrlKey: true, shiftKey: true }))
    await dispatch(
      new KeyboardEvent("keydown", { key: "b", code: "KeyB", ctrlKey: true, shiftKey: true }),
    )
    await dispatch(
      new KeyboardEvent("keyup", { key: "b", code: "KeyB", ctrlKey: true, shiftKey: true }),
    )

    expect(localStorage.getItem("preferences:custom-hotkeys")).toContain("ctrl+shift+b")
    const reset = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Reset to platform default"),
    )
    await act(async () => reset?.click())
    expect(localStorage.getItem("preferences:custom-hotkeys")).toContain('"bindings":{}')

    await act(async () => root.unmount())
  })
})
