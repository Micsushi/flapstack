/**
 * Coalesces node-pty output chunks before they cross the IPC boundary.
 *
 * node-pty emits one chunk per read, so a noisy command (an install, a test run,
 * a build) produces hundreds of chunks per second per pane. Each chunk otherwise
 * pays a superjson encode, a structured clone across IPC, a renderer
 * subscription callback and an `xterm.write`. Batching within a single frame
 * collapses that message count without making interactive echo perceptible.
 */

/** Flush window in ms. Kept at or below one frame so shell echo stays snappy. */
export const TERMINAL_FLUSH_MS = 8

/** Flush immediately once the buffer reaches this many characters. */
export const TERMINAL_FLUSH_BYTES = 32 * 1024

export interface TerminalOutputBatcher {
  /** Buffer a chunk, flushing if the size threshold is reached. */
  push: (data: string) => void
  /** Emit whatever is buffered right now and cancel any pending timer. */
  flush: () => void
  /** Cancel the pending timer and drop the buffer without emitting. */
  dispose: () => void
}

export function createTerminalOutputBatcher(
  onFlush: (data: string) => void,
  options: { flushMs?: number; maxBytes?: number } = {},
): TerminalOutputBatcher {
  const flushMs = options.flushMs ?? TERMINAL_FLUSH_MS
  const maxBytes = options.maxBytes ?? TERMINAL_FLUSH_BYTES

  let pending: string[] = []
  let pendingLength = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimer = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  const flush = () => {
    clearTimer()
    if (pendingLength === 0) return
    const data = pending.length === 1 ? pending[0] : pending.join("")
    pending = []
    pendingLength = 0
    onFlush(data)
  }

  return {
    push: (data: string) => {
      if (data.length === 0) return
      pending.push(data)
      pendingLength += data.length
      if (pendingLength >= maxBytes) {
        flush()
        return
      }
      if (flushTimer === null) {
        flushTimer = setTimeout(flush, flushMs)
      }
    },
    flush,
    dispose: () => {
      clearTimer()
      pending = []
      pendingLength = 0
    },
  }
}
