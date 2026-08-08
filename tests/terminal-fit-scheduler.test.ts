import { describe, expect, it, vi } from "vitest"

import { createTerminalFitScheduler } from "../src/renderer/features/terminal/terminal-fit-scheduler"

describe("terminal fit scheduler", () => {
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
