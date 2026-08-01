import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
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

  it("fails closed when durable consent is malformed", async () => {
    await writeFile(join(electron.userDataPath, "analytics-preferences.json"), '{"consentGranted":')
    const analytics = await import("../src/main/lib/analytics")

    expect(analytics.loadAnalyticsConsent()).toBe(false)
    await analytics.initAnalytics()

    expect(posthog.moduleLoads).not.toHaveBeenCalled()
  })

  it("rechecks consent when a pending client import races with opt-out", async () => {
    const analytics = await import("../src/main/lib/analytics")
    await analytics.setOptOut(false)

    const initialization = analytics.initAnalytics()
    await analytics.setOptOut(true)
    await initialization

    expect(posthog.constructed).not.toHaveBeenCalled()
  })

  it("persists explicit opt-in atomically before loading the hosted SDK", async () => {
    const analytics = await import("../src/main/lib/analytics")

    await analytics.setOptOut(false)
    expect(posthog.moduleLoads).not.toHaveBeenCalled()
    await analytics.initAnalytics()

    await expect(
      readFile(join(electron.userDataPath, "analytics-preferences.json"), "utf8").then(JSON.parse),
    ).resolves.toEqual({ consentGranted: true })
    expect(posthog.moduleLoads).toHaveBeenCalledTimes(1)
    expect(posthog.constructed).toHaveBeenCalledTimes(1)
  })

  it("serializes concurrent consent transitions", async () => {
    const analytics = await import("../src/main/lib/analytics")

    await Promise.all([analytics.setOptOut(false), analytics.setOptOut(true)])

    expect(writes.maxActive).toBe(1)
    expect(analytics.loadAnalyticsConsent()).toBe(false)

    writes.maxActive = 0
    await Promise.all([analytics.setOptOut(true), analytics.setOptOut(false)])

    expect(writes.maxActive).toBe(1)
    expect(analytics.loadAnalyticsConsent()).toBe(true)
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

  it("surfaces total durable opt-out failure without claiming the old grant changed", async () => {
    const analytics = await import("../src/main/lib/analytics")
    await analytics.setOptOut(false)
    writes.failRevocation = true
    writes.failRemoval = true

    await expect(analytics.setOptOut(true)).rejects.toThrow("simulated revocation write failure")

    await expect(
      readFile(join(electron.userDataPath, "analytics-preferences.json"), "utf8").then(JSON.parse),
    ).resolves.toEqual({ consentGranted: true })
    expect(analytics.getAnalyticsConsent()).toBe(false)
  })

  it("persists revocation even when SDK shutdown fails", async () => {
    const analytics = await import("../src/main/lib/analytics")
    await analytics.setOptOut(false)
    await analytics.initAnalytics()
    posthog.failShutdown = true

    await expect(analytics.setOptOut(true)).rejects.toThrow("simulated shutdown failure")

    expect(analytics.loadAnalyticsConsent()).toBe(false)
    expect(existsSync(join(electron.userDataPath, "analytics-consent-revoked"))).toBe(true)
  })

  it("supports re-opt-in without using PostHog persistent opt-out state", async () => {
    const analytics = await import("../src/main/lib/analytics")

    await analytics.setOptOut(false)
    await analytics.initAnalytics()
    await analytics.setOptOut(true)
    await analytics.setOptOut(false)
    await analytics.initAnalytics()

    expect(posthog.constructed).toHaveBeenCalledTimes(2)
    expect(posthog.shutdown).toHaveBeenCalledTimes(1)
  })

  it("starts a fresh client when re-opt-in overtakes stale initialization", async () => {
    const analytics = await import("../src/main/lib/analytics")
    const firstOptIn = analytics.setOptOut(false)
    const staleInitialization = analytics.initAnalytics()
    const optOut = analytics.setOptOut(true)
    const secondOptIn = analytics.setOptOut(false)
    const freshInitialization = analytics.initAnalytics()
    await Promise.all([firstOptIn, staleInitialization, optOut, secondOptIn, freshInitialization])

    expect(posthog.constructed).toHaveBeenCalledTimes(1)
  })

  it("rechecks durable consent before every emission", async () => {
    const analytics = await import("../src/main/lib/analytics")
    await analytics.setOptOut(false)
    await analytics.initAnalytics()
    await writeFile(
      join(electron.userDataPath, "analytics-preferences.json"),
      JSON.stringify({ consentGranted: false }),
    )

    await analytics.capture("revoked_event")

    expect(posthog.captures).not.toHaveBeenCalled()
  })

  it("aborts requests and disables retries, flags, surveys, and exception capture", async () => {
    const analytics = await import("../src/main/lib/analytics")
    await analytics.setOptOut(false)
    await analytics.initAnalytics()

    expect(posthog.constructed).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        disableGeoip: true,
        disableRemoteFeatureFlags: true,
        disableSurveys: true,
        enableLocalEvaluation: false,
        enableExceptionAutocapture: false,
        fetchRetryCount: 0,
        flushAt: 1,
        flushInterval: 0,
        preloadFeatureFlags: false,
        personProfiles: "never",
        fetch: expect.any(Function),
      }),
    )

    await analytics.setOptOut(true)
    expect(posthog.shutdown).toHaveBeenCalledTimes(1)
  })

  it("allows only coarse event properties and no durable identity", async () => {
    const analytics = await import("../src/main/lib/analytics")
    await analytics.setOptOut(false)
    await analytics.initAnalytics()

    await analytics.capture("message_sent", {
      chat_id: "chat-secret",
      connection_id: "connection-secret",
      email: "private@example.com",
      mode: "agent",
      plan_id: "plan-secret",
      project_id: "project-secret",
      pr_number: 42,
      repository: "private/repo",
      sub_chat_id: "subchat-secret",
      user_id: "user-secret",
      workspace_id: "workspace-secret",
    })

    expect(posthog.captures).toHaveBeenCalledWith({
      distinctId: "flapstack-desktop",
      event: "message_sent",
      properties: {
        app_version: "0.1.0-test",
        mode: "agent",
        platform: process.platform,
        source: "desktop",
      },
    })
  })

  it("derives app version and platform in main instead of accepting renderer strings", async () => {
    const analytics = await import("../src/main/lib/analytics")
    await analytics.setOptOut(false)
    await analytics.initAnalytics()

    await analytics.capture("first_launch", {
      app_version: "private@example.com",
      platform: "C:\\Users\\private",
    })

    expect(posthog.captures).toHaveBeenCalledWith({
      distinctId: "flapstack-desktop",
      event: "first_launch",
      properties: {
        app_version: "0.1.0-test",
        platform: process.platform,
        source: "desktop",
      },
    })
  })

  it("loads durable consent before analytics initialization during main startup", () => {
    const source = readFileSync(resolve("src/main/index.ts"), "utf8")
    const loadIndex = source.indexOf("loadAnalyticsConsent()")
    const initIndex = source.indexOf("initAnalytics()", loadIndex)

    expect(loadIndex).toBeGreaterThan(-1)
    expect(initIndex).toBeGreaterThan(loadIndex)
  })
})
