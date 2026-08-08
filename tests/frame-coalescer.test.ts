import { describe, expect, it, vi } from "vitest"

import { createFrameCoalescer } from "../src/renderer/lib/frame-coalescer"

describe("frame coalescer", () => {
  it("runs a burst once on the next frame and keeps the newest callback", () => {
    const callbacks: FrameRequestCallback[] = []
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    })
    const cancelFrame = vi.fn()
    const first = vi.fn()
    const latest = vi.fn()
    const coalescer = createFrameCoalescer({ requestFrame, cancelFrame })

    coalescer.schedule(first)
    coalescer.schedule(latest)

    expect(requestFrame).toHaveBeenCalledTimes(1)
    callbacks[0](16)
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })

  it("can flush immediately for terminal events", () => {
    const callbacks: FrameRequestCallback[] = []
    const requestFrame = (callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }
    const cancelFrame = vi.fn()
    const pending = vi.fn()
    const immediate = vi.fn()
    const coalescer = createFrameCoalescer({ requestFrame, cancelFrame })

    coalescer.schedule(pending)
    coalescer.flush(immediate)

    expect(cancelFrame).toHaveBeenCalledWith(1)
    expect(pending).not.toHaveBeenCalled()
    expect(immediate).toHaveBeenCalledTimes(1)
  })
})
