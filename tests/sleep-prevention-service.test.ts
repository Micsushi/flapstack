import { EventEmitter } from "node:events"
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => ({ path: "", ids: new Set<number>() }))
vi.mock("electron", async () => ({
  app: { getPath: () => native.path },
  powerMonitor: new (await import("node:events")).EventEmitter(),
  powerSaveBlocker: {
    start: () => {
      native.ids.add(7)
      return 7
    },
    isStarted: (id: number) => native.ids.has(id),
    stop: (id: number) => native.ids.delete(id),
  },
}))
vi.mock("../src/main/lib/sleep-prevention/native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/lib/sleep-prevention/native")>()
  return {
    createSleepAssertionStarter: (
      ports: Parameters<typeof actual.createSleepAssertionStarter>[0],
    ) => actual.createSleepAssertionStarter({ ...ports, platform: "win32" }),
  }
})

let service: typeof import("../src/main/lib/sleep-prevention/service")
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  native.path = mkdtempSync(join(tmpdir(), "flapstack-sleep-"))
  native.ids.clear()
  service = await import("../src/main/lib/sleep-prevention/service")
})
afterEach(() => {
  service.stopSleepPrevention()
  vi.useRealTimers()
  rmSync(native.path, { recursive: true, force: true })
})

describe("profile-owned sleep service", () => {
  it("persists one mode atomically and restores it after restart", async () => {
    service.initializeSleepPrevention(() => ({ agentWork: false, terminals: 0 }))
    expect(service.getSleepPreventionStatus()).toMatchObject({ mode: "off", active: false })
    service.setSleepPreventionMode("on")
    expect(
      JSON.parse(readFileSync(join(native.path, "data/sleep-prevention.json"), "utf8")),
    ).toEqual({ mode: "on" })
    expect(readdirSync(join(native.path, "data"))).toEqual(["sleep-prevention.json"])
    service.stopSleepPrevention()
    expect(native.ids.size).toBe(0)
    vi.resetModules()
    service = await import("../src/main/lib/sleep-prevention/service")
    service.initializeSleepPrevention(() => ({ agentWork: false, terminals: 0 }))
    expect(service.getSleepPreventionStatus()).toMatchObject({ mode: "on", active: true })
  })

  it("defaults corrupt settings off and allows an explicit repair", () => {
    mkdirSync(join(native.path, "data"))
    writeFileSync(join(native.path, "data/sleep-prevention.json"), "{broken")
    service.initializeSleepPrevention(() => ({ agentWork: true, terminals: 2 }))
    expect(service.getSleepPreventionStatus()).toMatchObject({
      mode: "off",
      active: false,
      error: expect.any(String),
    })
    expect(service.setSleepPreventionMode("automatic")).toMatchObject({ active: true, error: null })
  })

  it("refreshes on wake, bounds polling and releases on shutdown", async () => {
    let agentWork = true
    service.initializeSleepPrevention(() => ({ agentWork, terminals: 0 }))
    service.initializeSleepPrevention(() => ({ agentWork, terminals: 0 }))
    service.setSleepPreventionMode("automatic")
    expect(vi.getTimerCount()).toBe(1)
    agentWork = false
    await vi.advanceTimersByTimeAsync(5_000)
    expect(service.getSleepPreventionStatus().active).toBe(false)
    agentWork = true
    const { powerMonitor } = await import("electron")
    ;(powerMonitor as unknown as EventEmitter).emit("resume")
    expect(service.getSleepPreventionStatus().active).toBe(true)
    service.stopSleepPrevention()
    expect(vi.getTimerCount()).toBe(0)
    expect((powerMonitor as unknown as EventEmitter).listenerCount("resume")).toBe(0)
    expect(native.ids.size).toBe(0)
  })

  it("rejects stale changes from another window before altering the stored mode", async () => {
    service.initializeSleepPrevention(() => ({ agentWork: false, terminals: 0 }))
    const { sleepPreventionRouter } = await import("../src/main/lib/trpc/routers/sleep-prevention")
    const caller = sleepPreventionRouter.createCaller({ getWindow: () => null })
    await caller.setMode({ mode: "on", expectedMode: "off" })
    await expect(caller.setMode({ mode: "automatic", expectedMode: "off" })).rejects.toThrow(
      "another window",
    )
    expect(service.getSleepPreventionStatus()).toMatchObject({ mode: "on", active: true })
  })
})
