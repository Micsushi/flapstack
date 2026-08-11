// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ProgressiveOverflowRow,
  resolveProgressiveVisibleCount,
  resolveProgressiveVisibleIndexes,
} from "../src/renderer/components/progressive-overflow-row"
import {
  capProjectLabel,
  resolveChatHeaderTagLayout,
} from "../src/renderer/features/agents/ui/chat-header-responsive"
import { RuntimeSelector } from "../src/renderer/features/agents/runtime-settings/runtime-selector"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ""
})

describe("progressive overflow", () => {
  it("removes controls from the right until the row stays within its usage budget", () => {
    expect(
      resolveProgressiveVisibleCount({
        containerWidth: 500,
        itemWidths: [90, 90, 90, 90, 90],
        usageRatio: 0.8,
        gap: 8,
        overflowWidth: 28,
      }),
    ).toBe(4)
  })

  it("accounts for mandatory controls and restores items as space returns", () => {
    const compact = resolveProgressiveVisibleCount({
      containerWidth: 420,
      itemWidths: [100, 90, 80, 70],
      usageRatio: 0.72,
      gap: 4,
      overflowWidth: 28,
      reservedWidth: 44,
    })
    const expanded = resolveProgressiveVisibleCount({
      containerWidth: 720,
      itemWidths: [100, 90, 80, 70],
      usageRatio: 0.72,
      gap: 4,
      overflowWidth: 28,
      reservedWidth: 44,
    })

    expect(compact).toBe(3)
    expect(expanded).toBe(4)
  })

  it("supports row-specific collapse priorities while preserving visual order", () => {
    expect(
      resolveProgressiveVisibleIndexes({
        containerWidth: 260,
        itemWidths: [70, 90, 90, 70],
        usageRatio: 0.8,
        gap: 4,
        overflowWidth: 28,
        collapseOrder: [1, 2, 0, 3],
      }),
    ).toEqual([0, 3])
  })

  it("keeps the settings panel open for nested controls and closes it only outside", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root!.render(
        React.createElement(
          ProgressiveOverflowRow,
          {
            usageRatio: 0.8,
            menuLabel: "More composer settings",
            forceOverflow: true,
            overflowLabels: ["Runtime"],
            overflowLayout: "rows",
          },
          React.createElement(RuntimeSelector, {
            harness: "codex",
            value: "auto",
            onChange: vi.fn(),
          }),
        ),
      )
    })

    const trigger = container.querySelector(
      'button[aria-label="More composer settings"]',
    ) as HTMLButtonElement
    await act(async () => trigger.click())

    const settingsPanel = document.body.querySelector('[data-popover="true"]') as HTMLElement
    expect(settingsPanel).not.toBeNull()

    const runtimeTrigger = settingsPanel.querySelector(
      'button[aria-label="Runtime"]',
    ) as HTMLButtonElement
    runtimeTrigger.focus()
    document.body.tabIndex = -1
    await act(async () => {
      settingsPanel
        .querySelector("span")!
        .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      document.body.focus()
    })
    expect(document.body.contains(settingsPanel)).toBe(true)

    await act(async () => {
      runtimeTrigger.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      )
    })

    const runtimeMenu = document.body.querySelector('[data-dropdown="true"]') as HTMLElement
    expect(runtimeMenu).not.toBeNull()
    expect(document.body.contains(settingsPanel)).toBe(true)

    const runtimeOption = [...runtimeMenu.querySelectorAll('[role="menuitem"]')].find((item) =>
      item.textContent?.trim().startsWith("Codex"),
    ) as HTMLElement
    await act(async () => runtimeOption.click())
    expect(document.body.contains(settingsPanel)).toBe(true)

    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
      )
      document.body.click()
    })
    expect(document.body.contains(settingsPanel)).toBe(false)
  })
})

describe("chat header tag priority", () => {
  it("keeps tags full while controls can collapse into overflow", () => {
    expect(
      resolveChatHeaderTagLayout({
        availableWidth: 360,
        fullTagsWidth: 190,
        compactTagWidths: [28, 28],
        projectTagWidth: 100,
        controlCount: 4,
      }),
    ).toEqual({ mode: "full", visibleAuxiliaryTagCount: 2 })
  })

  it("shrinks non-project tags only after every control is in overflow", () => {
    expect(
      resolveChatHeaderTagLayout({
        availableWidth: 208,
        fullTagsWidth: 240,
        compactTagWidths: [28, 28],
        projectTagWidth: 100,
        controlCount: 4,
      }),
    ).toEqual({ mode: "compact", visibleAuxiliaryTagCount: 2 })
  })

  it("removes non-project tags from the end after compact tags stop fitting", () => {
    expect(
      resolveChatHeaderTagLayout({
        availableWidth: 180,
        fullTagsWidth: 240,
        compactTagWidths: [28, 28],
        projectTagWidth: 100,
        controlCount: 4,
      }),
    ).toEqual({ mode: "compact", visibleAuxiliaryTagCount: 1 })

    expect(
      resolveChatHeaderTagLayout({
        availableWidth: 136,
        fullTagsWidth: 240,
        compactTagWidths: [28, 28],
        projectTagWidth: 100,
        controlCount: 4,
      }),
    ).toEqual({ mode: "compact", visibleAuxiliaryTagCount: 0 })
  })

  it("caps the always-visible project label at 30 characters", () => {
    expect(capProjectLabel("a".repeat(31))).toBe(`${"a".repeat(29)}\u2026`)
  })
})
