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
  it("renders a three-stop segmented control and selects Plan", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const onChange = vi.fn()

    act(() => {
      root!.render(React.createElement(AgentModeSelector, { value: "write", onChange }))
    })

    const group = container.querySelector('[role="radiogroup"][aria-label="Chat mode"]')
    const options = [...container.querySelectorAll('[role="radio"]')] as HTMLButtonElement[]
    expect(group).not.toBeNull()
    expect(options.map((option) => option.textContent?.trim())).toEqual(["Write", "Plan", "Review"])
    expect(options[0].getAttribute("aria-checked")).toBe("true")
    await act(async () => options[1].click())
    expect(onChange).toHaveBeenCalledWith("plan")
  })

  it("supports arrow-key selection", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const onChange = vi.fn()

    act(() => {
      root!.render(React.createElement(AgentModeSelector, { value: "write", onChange }))
    })

    const group = container.querySelector('[role="radiogroup"]') as HTMLElement
    await act(async () => {
      group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith("plan")
  })
})
