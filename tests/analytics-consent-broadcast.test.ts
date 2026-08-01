import { describe, expect, it, vi } from "vitest"
import { broadcastAnalyticsConsent } from "../src/main/lib/analytics-consent-broadcast"

describe("analytics consent broadcast", () => {
  it("notifies every live renderer and skips destroyed windows", () => {
    const firstSend = vi.fn()
    const secondSend = vi.fn()
    const destroyedSend = vi.fn()

    broadcastAnalyticsConsent(
      [
        {
          isDestroyed: () => false,
          webContents: { isDestroyed: () => false, send: firstSend },
        },
        {
          isDestroyed: () => false,
          webContents: { isDestroyed: () => false, send: secondSend },
        },
        {
          isDestroyed: () => true,
          webContents: { isDestroyed: () => false, send: destroyedSend },
        },
      ],
      false,
    )

    expect(firstSend).toHaveBeenCalledWith("analytics:consent-changed", false)
    expect(secondSend).toHaveBeenCalledWith("analytics:consent-changed", false)
    expect(destroyedSend).not.toHaveBeenCalled()
  })

  it("isolates destroyed and throwing webContents so later windows are still notified", () => {
    const throwingSend = vi.fn(() => {
      throw new Error("renderer is gone")
    })
    const destroyedSend = vi.fn()
    const healthySend = vi.fn()

    expect(() =>
      broadcastAnalyticsConsent(
        [
          {
            isDestroyed: () => false,
            webContents: { isDestroyed: () => false, send: throwingSend },
          },
          {
            isDestroyed: () => false,
            webContents: { isDestroyed: () => true, send: destroyedSend },
          },
          {
            isDestroyed: () => false,
            webContents: { isDestroyed: () => false, send: healthySend },
          },
        ],
        false,
      ),
    ).not.toThrow()
    expect(destroyedSend).not.toHaveBeenCalled()
    expect(healthySend).toHaveBeenCalledWith("analytics:consent-changed", false)
  })
})
