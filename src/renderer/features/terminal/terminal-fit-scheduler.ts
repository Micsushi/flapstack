import { incrementPerformanceCounter } from "../../lib/performance-counters"

type TerminalFitSchedulerOptions = {
  fit: () => void
  readSize: () => { cols: number; rows: number }
  onResize: (cols: number, rows: number) => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

export function createTerminalFitScheduler({
  fit,
  readSize,
  onResize,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
}: TerminalFitSchedulerOptions) {
  let frame: number | null = null
  let lastSize: { cols: number; rows: number } | null = null

  return {
    schedule() {
      if (frame !== null) return
      frame = requestFrame(() => {
        frame = null
        try {
          fit()
          const size = readSize()
          if (lastSize?.cols === size.cols && lastSize.rows === size.rows) return
          lastSize = size
          incrementPerformanceCounter("terminal-resize")
          onResize(size.cols, size.rows)
        } catch {
          // The terminal may disappear between observation and the next frame.
        }
      })
    },
    cancel() {
      if (frame !== null) cancelFrame(frame)
      frame = null
    },
  }
}
