// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentModeSelector } from "../src/renderer/features/agents/components/agent-mode-selector"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("AgentModeSelector", () => {
  it("opens and selects Plan mode", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const onChange = vi.fn()

    act(() => {
      root!.render(React.createElement(AgentModeSelector, { value: "write", onChange }))
    })

    const trigger = container.querySelector('button[aria-label="Chat mode"]') as HTMLButtonElement
    expect(trigger.textContent).toContain("Write")
    expect(trigger.textContent).not.toContain("Agent")
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      )
    })

    const plan = [...document.body.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.includes("Plan"),
    ) as HTMLElement | undefined
    expect(plan).not.toBeUndefined()
    await act(async () => plan!.click())
    expect(onChange).toHaveBeenCalledWith("plan")
  })

  it.each(["read", "review"] as const)("selects %s mode", async (mode) => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const onChange = vi.fn()

    act(() => {
      root!.render(React.createElement(AgentModeSelector, { value: "write", onChange }))
    })

    const trigger = container.querySelector('button[aria-label="Chat mode"]') as HTMLButtonElement
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      )
    })
    const option = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent?.trim().toLowerCase() === mode,
    ) as HTMLElement
    await act(async () => option.click())
    expect(onChange).toHaveBeenCalledWith(mode)
  })
})
