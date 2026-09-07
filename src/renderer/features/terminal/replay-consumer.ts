import type { TerminalReplayEvent } from "../../../shared/terminal-replay"

/** Serialize resets behind outstanding xterm parsing, including pane/fallback replacement. */
export function createTerminalReplayConsumer(
  terminal: {
    reset: () => void
    resize: (cols: number, rows: number) => void
    write: (data: string, callback: () => void) => void
  },
  callbacks: {
    acknowledge: (event: TerminalReplayEvent) => void
    data: (data: string) => void
    exit: (exitCode: number, signal?: number) => void
  },
) {
  let disposed = false
  let parsing = false
  let activeSubscription = ""
  let deliveryId = 0
  let pending: TerminalReplayEvent | null = null
  function drain() {
    if (disposed || parsing || !pending) return
    const event = pending
    pending = null
    if (event.type === "exit") {
      callbacks.exit(event.exitCode, event.signal)
      return
    }
    parsing = true
    if (event.type === "snapshot") {
      terminal.reset()
      terminal.resize(event.cols, event.rows)
    }
    terminal.write(event.data, () => {
      if (disposed) return
      parsing = false
      if (event.subscriptionId === activeSubscription) {
        callbacks.data(event.data)
        callbacks.acknowledge(event)
      }
      drain()
    })
  }
  return {
    accept(event: TerminalReplayEvent) {
      if (disposed) return
      if (event.subscriptionId !== activeSubscription) {
        if (event.type !== "snapshot") return
        activeSubscription = event.subscriptionId
        deliveryId = 0
      }
      if (event.deliveryId <= deliveryId) return
      deliveryId = event.deliveryId
      // The server allows one unacknowledged delivery. Replacement snapshots may
      // supersede an old subscription, but never queue an unlimited byte backlog.
      pending = event
      drain()
    },
    dispose() {
      disposed = true
      pending = null
    },
  }
}
