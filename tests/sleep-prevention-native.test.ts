import { EventEmitter } from "node:events"
import type { ChildProcess, spawn } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import { createSleepAssertionStarter } from "../src/main/lib/sleep-prevention/native"

function fixture(platform = "win32") {
  const live = new Set<number>()
  const blocker = {
    start: vi.fn(() => {
      live.add(42)
      return 42
    }),
    isStarted: (id: number) => live.has(id),
    stop: vi.fn((id: number) => live.delete(id)),
  }
  const child = Object.assign(new EventEmitter(), {
    pid: 73,
    exitCode: null as number | null,
    signalCode: null,
    killed: false,
    kill: vi.fn(() => {
      child.killed = true
      return true
    }),
  })
  const spawnMock = vi.fn(() => child as unknown as ChildProcess)
  const start = createSleepAssertionStarter({
    platform,
    processId: 12,
    blocker,
    spawn: spawnMock as unknown as typeof spawn,
  })
  return { start, blocker, child, spawnMock, live }
}

describe("native owned power assertions", () => {
  it.each(["win32", "linux"])(
    "uses app suspension only on %s and releases only its own ID",
    (platform) => {
      const f = fixture(platform)
      f.live.add(99)
      const assertion = f.start()
      expect(f.blocker.start).toHaveBeenCalledWith("prevent-app-suspension")
      expect(assertion.isStarted()).toBe(true)
      assertion.stop()
      expect(f.live.has(99)).toBe(true)
      expect(assertion.isStarted()).toBe(false)
      expect(f.spawnMock).not.toHaveBeenCalled()
    },
  )

  it("launches a parent-PID-bound macOS helper without a shell or display assertion", () => {
    const f = fixture("darwin")
    const assertion = f.start()
    expect(f.spawnMock).toHaveBeenCalledWith(
      "/usr/bin/caffeinate",
      ["-i", "-w", "12"],
      expect.objectContaining({ shell: false, stdio: "ignore" }),
    )
    expect(assertion.isStarted()).toBe(true)
    assertion.stop()
    expect(f.child.kill).toHaveBeenCalledOnce()
    expect(assertion.isStarted()).toBe(false)
  })

  it("falls back after a helper error without unhandled errors or repeated helper launches", () => {
    const f = fixture("darwin")
    const assertion = f.start()
    f.child.emit("error", new Error("not executable"))
    expect(assertion.isStarted()).toBe(false)
    assertion.stop()
    expect(f.start().isStarted()).toBe(true)
    expect(f.spawnMock).toHaveBeenCalledOnce()
    expect(f.blocker.start).toHaveBeenCalledOnce()
  })

  it("does not mistake an intentionally stopped helper for a new helper failure", () => {
    const f = fixture("darwin")
    const first = f.start()
    first.stop()
    f.child.emit("exit", 0)
    f.child.killed = false
    const second = f.start()
    expect(second.isStarted()).toBe(true)
    expect(f.spawnMock).toHaveBeenCalledTimes(2)
    expect(f.blocker.start).not.toHaveBeenCalled()
  })

  it("keeps a failed stop retryable", () => {
    const f = fixture()
    const assertion = f.start()
    f.blocker.stop.mockReturnValueOnce(false)
    expect(() => assertion.stop()).toThrow("Could not release")
    expect(assertion.isStarted()).toBe(true)
    assertion.stop()
    expect(assertion.isStarted()).toBe(false)
  })
})
