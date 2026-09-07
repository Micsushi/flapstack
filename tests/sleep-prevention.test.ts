import { describe, expect, it, vi } from "vitest"
import { SleepPreventionController } from "../src/main/lib/sleep-prevention/controller"

function fixture() {
  let work = { agentWork: false, terminals: 0 }
  let active = false
  const stop = vi.fn(() => {
    active = false
  })
  const start = vi.fn(() => {
    active = true
    return { stop, isStarted: () => active }
  })
  const persist = vi.fn()
  const readWork = vi.fn(() => work)
  const controller = new SleepPreventionController({ mode: "off", persist, start, readWork })
  return {
    controller,
    start,
    stop,
    persist,
    readWork,
    setWork: (value: typeof work) => {
      work = value
    },
    loseAssertion: () => {
      active = false
    },
  }
}

describe("owned sleep prevention", () => {
  it("defaults off, asserts once for owned work and releases after the last owner", () => {
    const f = fixture()
    expect(f.controller.refresh().active).toBe(false)
    f.controller.setMode("automatic")
    expect(f.start).not.toHaveBeenCalled()
    f.setWork({ agentWork: true, terminals: 2 })
    expect(f.controller.refresh().active).toBe(true)
    f.controller.refresh()
    expect(f.start).toHaveBeenCalledOnce()
    f.setWork({ agentWork: false, terminals: 1 })
    expect(f.controller.refresh().active).toBe(true)
    f.setWork({ agentWork: false, terminals: 0 })
    expect(f.controller.refresh().active).toBe(false)
    expect(f.stop).toHaveBeenCalledOnce()
  })

  it("persists before applying a mode and leaves current state intact on persistence failure", () => {
    const f = fixture()
    f.controller.setMode("on")
    f.persist.mockImplementationOnce(() => {
      throw new Error("disk full")
    })
    expect(() => f.controller.setMode("off")).toThrow("disk full")
    expect(f.controller.status()).toMatchObject({ mode: "on", active: true })
  })

  it("reacquires a lost assertion and never restarts after disposal", () => {
    const f = fixture()
    f.controller.setMode("on")
    f.loseAssertion()
    expect(f.controller.refresh().active).toBe(true)
    expect(f.start).toHaveBeenCalledTimes(2)
    f.controller.dispose()
    f.controller.refresh()
    expect(f.controller.status().active).toBe(false)
    expect(f.start).toHaveBeenCalledTimes(2)
    expect(() => f.controller.setMode("on")).toThrow("shutting down")
  })

  it("reports start failures and recovers on the next bounded refresh", () => {
    const f = fixture()
    f.start.mockImplementationOnce(() => {
      throw new Error("unavailable")
    })
    expect(f.controller.setMode("on")).toMatchObject({ active: false, error: expect.any(String) })
    expect(f.controller.refresh()).toMatchObject({ active: true, error: null })
  })

  it("retains ownership after stop failure so Off can retry", () => {
    const f = fixture()
    f.controller.setMode("on")
    f.stop.mockImplementationOnce(() => {
      throw new Error("busy")
    })
    expect(f.controller.setMode("off")).toMatchObject({ active: true, error: expect.any(String) })
    expect(f.controller.refresh()).toMatchObject({ active: false, error: null })
    expect(f.stop).toHaveBeenCalledTimes(2)
  })

  it("releases automatic assertions when work ownership cannot be verified", () => {
    const f = fixture()
    f.setWork({ agentWork: true, terminals: 0 })
    f.controller.setMode("automatic")
    f.readWork.mockImplementationOnce(() => {
      throw new Error("unavailable")
    })
    expect(f.controller.refresh()).toMatchObject({ active: false, error: expect.any(String) })
  })
})
