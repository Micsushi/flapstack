// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const posthog = vi.hoisted(() => ({
  moduleLoads: vi.fn(),
}))

const consent = vi.hoisted(() => ({
  capture: vi.fn(async () => {}),
  get: vi.fn(async () => false),
}))

vi.mock("posthog-js", () => {
  posthog.moduleLoads()
  return { default: {} }
})

describe("renderer analytics consent", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    consent.get.mockResolvedValue(false)
    ;(window as typeof window & { __FORCE_ANALYTICS__?: boolean }).__FORCE_ANALYTICS__ = true
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: {
        captureAnalyticsEvent: consent.capture,
        getAnalyticsConsent: consent.get,
      },
    })
  })

  it("never loads a hosted renderer SDK, even after consent", async () => {
    consent.get.mockResolvedValue(true)
    const analytics = await import("../src/renderer/lib/analytics")

    await analytics.initAnalytics()
    await analytics.capture("consented_event", { mode: "agent" })

    expect(posthog.moduleLoads).not.toHaveBeenCalled()
    expect(consent.capture).toHaveBeenCalledWith("consented_event", { mode: "agent" })
  })

  it("uses main durable consent as the sole authority", async () => {
    localStorage.setItem("preferences:analytics-consent", "true")
    localStorage.setItem("preferences:analytics-opt-out", "false")
    const analytics = await import("../src/renderer/lib/analytics")

    await analytics.initAnalytics()
    await analytics.capture("must_not_leave_device")

    expect(consent.get).toHaveBeenCalled()
    expect(consent.capture).not.toHaveBeenCalled()
  })

  it("rechecks main authority immediately before routing every event", async () => {
    consent.get.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const analytics = await import("../src/renderer/lib/analytics")

    await analytics.initAnalytics()
    await analytics.capture("revoked_event")

    expect(consent.capture).not.toHaveBeenCalled()
  })

  it("cancels pending initialization when opt-out wins the race", async () => {
    let resolveConsent!: (granted: boolean) => void
    consent.get.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolveConsentRequest) => {
          resolveConsent = resolveConsentRequest
        }),
    )
    const analytics = await import("../src/renderer/lib/analytics")

    const initialization = analytics.initAnalytics()
    await Promise.resolve()
    await analytics.shutdown()
    resolveConsent(true)
    await initialization
    await analytics.capture("must_not_leave_device")

    expect(consent.capture).not.toHaveBeenCalled()
  })

  it("invalidates a stale initialization when a cross-window opt-in arrives", async () => {
    let resolveStaleConsent!: (granted: boolean) => void
    consent.get
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolveConsentRequest) => {
            resolveStaleConsent = resolveConsentRequest
          }),
      )
      .mockResolvedValue(true)
    const analytics = await import("../src/renderer/lib/analytics")

    const staleInitialization = analytics.initAnalytics()
    await Promise.resolve()
    const broadcastInitialization = analytics.syncAnalyticsConsent(true)
    resolveStaleConsent(false)
    await Promise.all([staleInitialization, broadcastInitialization])
    await analytics.capture("message_sent", { mode: "write" })

    expect(consent.capture).toHaveBeenCalledWith("message_sent", { mode: "write" })
  })

  it("wires cross-window consent broadcasts through preload and App", () => {
    const preload = readFileSync(resolve("src/preload/index.ts"), "utf8")
    const app = readFileSync(resolve("src/renderer/App.tsx"), "utf8")
    const mainWindow = readFileSync(resolve("src/main/windows/main.ts"), "utf8")

    expect(preload).toContain('ipcRenderer.on("analytics:consent-changed"')
    expect(app).toContain("onAnalyticsConsentChanged")
    expect(mainWindow).toContain("BrowserWindow.getAllWindows()")
    expect(mainWindow).toContain("broadcastAnalyticsConsent")
  })

  it("keeps the renderer preference default off", () => {
    const source = readFileSync(resolve("src/renderer/lib/atoms/index.ts"), "utf8")
    const preference = source.match(/analyticsOptOutAtom = atom<boolean>\([^)]+\)/)?.[0]

    expect(preference).toContain("true")
    expect(source).not.toContain("analyticsOptOutStorage")
  })

  it("surfaces preference persistence failure and re-reads main authority", () => {
    const source = readFileSync(
      resolve("src/renderer/components/dialogs/settings-tabs/agents-preferences-tab.tsx"),
      "utf8",
    )

    expect(source).toContain("Could not save analytics preference")
    expect(source).toMatch(/catch[\s\S]*getAnalyticsConsent\(\)/)
  })
})
