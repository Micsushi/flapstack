// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RuntimeSelector } from "../src/renderer/features/agents/runtime-settings/runtime-selector"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("RuntimeSelector", () => {
  it("stays open and selects a compatible runtime", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    const onChange = vi.fn()

    act(() => {
      root!.render(
        React.createElement(RuntimeSelector, {
          harness: "claude-code",
          value: "auto",
          onChange,
        }),
      )
    })

    const trigger = container.querySelector('button[aria-label="Runtime"]') as HTMLButtonElement
    expect(trigger.textContent).toContain("Automatic runtime")
    expect(trigger.querySelector("svg")).not.toBeNull()
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      )
    })

    const menuItems = [...document.body.querySelectorAll('[role="menuitem"]')]
    const automaticRuntime = menuItems.find((item) =>
      item.textContent?.includes("Automatic runtime"),
    )
    expect(automaticRuntime?.textContent).toContain("Automatic runtime (Claude Code)")
    expect(automaticRuntime?.querySelector("svg")).not.toBeNull()
    expect(menuItems.some((item) => item.textContent?.trim() === "Codex")).toBe(false)

    const nativeRuntime = menuItems.find((item) =>
      item.textContent?.startsWith("Flapstack Native"),
    ) as HTMLElement | undefined
    expect(nativeRuntime).not.toBeUndefined()
    expect(nativeRuntime?.querySelector("svg")).not.toBeNull()
    await act(async () => nativeRuntime!.click())
    expect(onChange).toHaveBeenCalledWith("flapstack-native")
  })

  it("never offers Claude Code Runtime to the Codex harness", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root!.render(
        React.createElement(RuntimeSelector, {
          harness: "codex",
          value: "auto",
          onChange: vi.fn(),
        }),
      )
    })

    const trigger = container.querySelector('button[aria-label="Runtime"]') as HTMLButtonElement
    await act(async () => {
      trigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      )
    })

    const menuItems = [...document.body.querySelectorAll('[role="menuitem"]')]
    expect(menuItems.some((item) => item.textContent?.trim() === "Codex")).toBe(true)
    expect(menuItems.some((item) => item.textContent?.trim() === "Claude Code")).toBe(false)
  })
})
