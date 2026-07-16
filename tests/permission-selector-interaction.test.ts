// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PermissionSelector } from "../src/renderer/features/agents/components/permission-selector"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("PermissionSelector", () => {
  it("opens and selects Full access", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const onChange = vi.fn()

    act(() => {
      root!.render(
        React.createElement(PermissionSelector, {
          harness: "claude-code",
          value: "ask-before-edits",
          options: ["read-only", "ask-before-edits", "full-access"],
          onChange,
        }),
      )
    })

    const trigger = container.querySelector(
      'button[aria-label="Permission mode"]',
    ) as HTMLButtonElement
    expect(trigger.textContent).toContain("Ask before edits")
    expect(trigger.querySelector("svg")).not.toBeNull()
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      )
    })

    const fullAccess = [...document.body.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Full access"),
    ) as HTMLElement | undefined
    expect(fullAccess).not.toBeUndefined()
    expect(fullAccess?.querySelector("svg")).not.toBeNull()
    await act(async () => fullAccess!.click())
    expect(onChange).toHaveBeenCalledWith("full-access")
  })
})
