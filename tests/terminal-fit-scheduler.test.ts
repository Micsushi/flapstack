import { describe, expect, it, vi } from "vitest"

import { createTerminalFitScheduler } from "../src/renderer/features/terminal/terminal-fit-scheduler"

describe("terminal fit scheduler", () => {
  it("proposes recovery geometry without locally refitting or feeding snapshots back", () => {
    const frames: FrameRequestCallback[] = []
    const fit = vi.fn()
    const resize = vi.fn()
    let proposed: { cols: number; rows: number } | null = { cols: 40, rows: 24 }
    const scheduler = createTerminalFitScheduler({
      fit,
      readSize: () => ({ cols: 80, rows: 24 }),
      proposeSize: () => proposed,
      onResize: resize,
      requestFrame: (callback) => {
        frames.push(callback)
        return frames.length
      },
      cancelFrame() {},
    })
    const frame = () => {
      scheduler.schedule()
      frames.shift()!(16)
    }
    frame()
    frame()
    expect(resize).toHaveBeenCalledExactlyOnceWith(40, 24)
    proposed = null
    frame()
    expect(resize).toHaveBeenCalledOnce()
    proposed = { cols: NaN, rows: 24 }
    frame()
    expect(resize).toHaveBeenCalledOnce()
    proposed = { cols: 60, rows: 24 }
    frame()
    expect(resize).toHaveBeenLastCalledWith(60, 24)
    expect(fit).not.toHaveBeenCalled()
  })
  it("fits once per frame and skips identical PTY resize writes", () => {
    const frames: FrameRequestCallback[] = []
    const fit = vi.fn()
    const resize = vi.fn()
    const size = { cols: 80, rows: 24 }
    const scheduler = createTerminalFitScheduler({
      fit,
      readSize: () => size,
      onResize: resize,
      requestFrame: (callback) => {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: () => undefined,
    })

    scheduler.schedule()
    scheduler.schedule()
    frames.shift()!(16)
    scheduler.schedule()
    frames.shift()!(32)

    expect(fit).toHaveBeenCalledTimes(2)
    expect(resize).toHaveBeenCalledTimes(1)
    expect(resize).toHaveBeenCalledWith(80, 24)
  })
})
