type FrameCoalescerOptions = {
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

export function createFrameCoalescer({
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
}: FrameCoalescerOptions = {}) {
  let frame: number | null = null
  let pending: (() => void) | null = null

  const cancel = () => {
    if (frame !== null) cancelFrame(frame)
    frame = null
    pending = null
  }

  return {
    schedule(callback: () => void) {
      pending = callback
      if (frame !== null) return
      frame = requestFrame(() => {
        frame = null
        const run = pending
        pending = null
        run?.()
      })
    },
    flush(callback?: () => void) {
      if (frame !== null) cancelFrame(frame)
      frame = null
      pending = null
      callback?.()
    },
    cancel,
  }
}
