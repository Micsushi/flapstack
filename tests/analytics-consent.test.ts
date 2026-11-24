import { existsSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const posthog = vi.hoisted(() => ({
  captures: vi.fn(),
  constructed: vi.fn(),
  failShutdown: false,
  moduleLoads: vi.fn(),
  shutdown: vi.fn(async () => {
    if (posthog.failShutdown) throw new Error("simulated shutdown failure")
  }),
}))

const electron = vi.hoisted(() => ({
  userDataPath: "",
}))

const writes = vi.hoisted(() => ({
  active: 0,
  failPreferences: false,
  failRemoval: false,
  failRevocation: false,
  maxActive: 0,
}))

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electron.userDataPath),
    getVersion: vi.fn(() => "0.1.0-test"),
    isPackaged: true,
  },
}))

vi.mock("posthog-node", () => {
  posthog.moduleLoads()
  return {
    PostHog: class {
      constructor(key: string, options: unknown) {
        posthog.constructed(key, options)
      }

      capture = posthog.captures
      shutdown = posthog.shutdown
    },
  }
})

vi.mock("../src/main/lib/path-safety", async () => {
  const actual = await vi.importActual<typeof import("../src/main/lib/path-safety")>(
    "../src/main/lib/path-safety",
  )
  return {
    ...actual,
    writeFileInsideRoot: async (
      rootPath: string,
      relativePath: string,
      ...rest: Parameters<typeof actual.writeFileInsideRoot> extends [string, string, ...infer Tail]
        ? Tail
        : never
    ) => {
      writes.active += 1
      writes.maxActive = Math.max(writes.maxActive, writes.active)
      try {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
        if (writes.failPreferences && relativePath === "analytics-preferences.json") {
          throw new Error("simulated preferences write failure")
        }
        if (writes.failRevocation && relativePath === "analytics-consent-revoked") {
          throw new Error("simulated revocation write failure")
        }
        return await actual.writeFileInsideRoot(rootPath, relativePath, ...rest)
      } finally {
        writes.active -= 1
      }
    },
    removeFileInsideRoot: async (
      ...args: Parameters<typeof actual.removeFileInsideRoot>
    ): ReturnType<typeof actual.removeFileInsideRoot> => {
      if (writes.failRemoval && args[1] === "analytics-preferences.json") {
        throw new Error("simulated preference removal failure")
      }
      return actual.removeFileInsideRoot(...args)
    },
  }
})

describe("hosted analytics consent", () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    writes.active = 0
    writes.failPreferences = false
    writes.failRemoval = false
    writes.failRevocation = false
    writes.maxActive = 0
    posthog.failShutdown = false
    electron.userDataPath = await mkdtemp(join(tmpdir(), "flapstack-analytics-consent-"))
  })

  afterEach(async () => {
    await rm(electron.userDataPath, { recursive: true, force: true })
  })

  it("does not even load posthog-node when durable consent is unset", async () => {
    const analytics = await import("../src/main/lib/analytics")

    analytics.loadAnalyticsConsent()
    await analytics.initAnalytics()
    await analytics.capture("must_not_leave_device")

    expect(posthog.moduleLoads).not.toHaveBeenCalled()
    expect(posthog.constructed).not.toHaveBeenCalled()
    expect(posthog.captures).not.toHaveBeenCalled()
  })

  it("rechecks consent when a pending client import races with opt-out", async () => {
    const analytics = await import("../src/main/lib/analytics")
    await analytics.setOptOut(false)

    const initialization = analytics.initAnalytics()
    await analytics.setOptOut(true)
    await initialization

    expect(posthog.constructed).not.toHaveBeenCalled()
  })

  it("leaves a durable revocation when the canonical opt-out write fails", async () => {
    const analytics = await import("../src/main/lib/analytics")
    await analytics.setOptOut(false)
    writes.failPreferences = true

    await expect(analytics.setOptOut(true)).rejects.toThrow("simulated preferences write failure")

    expect(analytics.getAnalyticsConsent()).toBe(false)
    expect(analytics.loadAnalyticsConsent()).toBe(false)
    expect(existsSync(join(electron.userDataPath, "analytics-consent-revoked"))).toBe(true)
  })
})
