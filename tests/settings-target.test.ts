// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { revealSettingsTarget } from "../src/renderer/features/settings/settings-target"

afterEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("Settings search targets", () => {
  it("focuses a target directly when it is programmatically focusable", () => {
    document.body.innerHTML = '<div data-settings-id="credential" tabindex="-1"></div>'
    const target = document.querySelector<HTMLElement>('[data-settings-id="credential"]')!
    target.scrollIntoView = vi.fn()
    target.animate = vi.fn() as unknown as typeof target.animate

    expect(revealSettingsTarget("credential")).toBe(true)
    expect(document.activeElement).toBe(target)
  })

  it("focuses the first usable control inside a non-focusable target", () => {
    document.body.innerHTML =
      '<div data-settings-id="provider-extensions"><button>Provider filter</button></div>'
    const target = document.querySelector<HTMLElement>('[data-settings-id="provider-extensions"]')!
    const button = target.querySelector("button")!
    target.scrollIntoView = vi.fn()
    target.animate = vi.fn() as unknown as typeof target.animate

    expect(revealSettingsTarget("provider-extensions")).toBe(true)
    expect(document.activeElement).toBe(button)
  })

  it("keeps a missing target pending for the caller to handle", () => {
    expect(revealSettingsTarget("missing")).toBe(false)
    expect(revealSettingsTarget('\"] [data-settings-id="credential')).toBe(false)
  })
})
