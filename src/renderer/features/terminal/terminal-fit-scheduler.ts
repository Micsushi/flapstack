import { incrementPerformanceCounter } from "../../lib/performance-counters"

type TerminalFitSchedulerOptions = {
  fit: () => void
  readSize: () => { cols: number; rows: number }
  onResize: (cols: number, rows: number) => void
  /** Undefined keeps legacy fitting; null defers an unmeasurable recovery view. */
  proposeSize?: () => { cols: number; rows: number } | null | undefined
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

export function createTerminalFitScheduler({
  fit,
  readSize,
  onResize,
  proposeSize,
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
          const proposed = proposeSize?.()
          if (proposed === null) return
          if (proposed === undefined) fit()
          const size = proposed ?? readSize()
          if (
            !Number.isFinite(size.cols) ||
            !Number.isFinite(size.rows) ||
            size.cols < 1 ||
            size.rows < 1
          )
            return
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
