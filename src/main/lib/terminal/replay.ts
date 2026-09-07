import { randomUUID } from "node:crypto"
import { Terminal, type ITerminalAddon } from "@xterm/headless"
import { SerializeAddon } from "@xterm/addon-serialize"
import { createTerminalOutputBatcher } from "./output-batcher"
import {
  MAX_TERMINAL_COLS,
  MAX_TERMINAL_ROWS,
  type TerminalReplayEvent,
  type TerminalReplayPayload,
} from "../../../shared/terminal-replay"

const MAX_QUEUED_BYTES = 4 * 1024 * 1024
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024
const MAX_SUBSCRIBERS = 8
const SCROLLBACK_ROWS = 10_000
type Subscriber = {
  next: (event: TerminalReplayEvent) => void
  error: (error: Error) => void
  complete: () => void
  deliveryId: number
  pending: boolean
  dirty: boolean
  scheduled: boolean
  canStream: boolean
  timer?: ReturnType<typeof setTimeout>
}

/** Owns parsed screen state even when every renderer has detached. No disk log or input indexing. */
export class TerminalReplay {
  private terminal: Terminal
  private serializer = new SerializeAddon()
  private jobs: Array<() => Promise<void> | void> = []
  private running = false
  private disposed = false
  private failure: Error | null = null
  private queuedBytes = 0
  private paused = false
  private subscribers = new Map<string, Subscriber>()
  private exit: { type: "exit"; exitCode: number; signal?: number } | null = null
  private ending = false
  private batcher = createTerminalOutputBatcher((data) => this.queueData(data))

  constructor(
    cols: number,
    rows: number,
    private readonly flow: { pause: () => void; resume: () => void },
  ) {
    assertTerminalGeometry(cols, rows)
    this.terminal = new Terminal({
      cols,
      rows,
      scrollback: SCROLLBACK_ROWS,
      allowProposedApi: true,
    })
    // The official serializer supports headless terminals; its declaration names the browser Terminal.
    this.terminal.loadAddon(this.serializer as unknown as ITerminalAddon)
  }

  write(data: string): void {
    if (!this.disposed && !this.failure && !this.ending) this.batcher.push(data)
  }

  private queueData(data: string): void {
    const bytes = Buffer.byteLength(data)
    if (this.queuedBytes + bytes > MAX_QUEUED_BYTES) {
      this.fail(
        new Error(
          "Terminal recovery exceeded its input limit. Restart this terminal to restore recovery.",
        ),
      )
      return
    }
    this.queuedBytes += bytes
    if (this.queuedBytes >= 256 * 1024 && !this.paused) {
      try {
        this.flow.pause()
        this.paused = true
      } catch {
        /* Hard queue limit remains enforced. */
      }
    }
    this.enqueue(
      () =>
        new Promise<void>((resolve) => {
          this.terminal.write(data, () => {
            this.queuedBytes -= bytes
            if (this.paused && this.queuedBytes < 64 * 1024) this.resume()
            this.broadcast({ type: "data", data })
            resolve()
          })
        }),
    )
  }

  resize(cols: number, rows: number): void {
    assertTerminalGeometry(cols, rows)
    this.batcher.flush()
    this.enqueue(() => {
      this.terminal.resize(cols, rows)
      this.invalidateSubscribers()
    })
  }

  clear(): void {
    this.batcher.flush()
    this.enqueue(() => {
      this.terminal.clear()
      this.invalidateSubscribers()
    })
  }

  finish(exitCode: number, signal?: number): void {
    this.batcher.flush()
    this.ending = true
    this.enqueue(() => {
      this.exit = { type: "exit", exitCode, signal }
      for (const [id, subscriber] of this.subscribers) {
        if (!subscriber.pending && !subscriber.dirty) this.deliver(id, subscriber, this.exit!)
      }
    })
  }

  subscribe(observer: Pick<Subscriber, "next" | "error" | "complete">): () => void {
    if (this.disposed || this.failure) {
      observer.error(this.failure ?? new Error("Terminal recovery is closed."))
      return () => {}
    }
    if (this.subscribers.size >= MAX_SUBSCRIBERS) {
      observer.error(new Error("Too many views are attached to this terminal."))
      return () => {}
    }
    const id = randomUUID()
    const subscriber: Subscriber = {
      ...observer,
      deliveryId: 0,
      pending: false,
      dirty: true,
      scheduled: true,
      canStream: false,
    }
    this.subscribers.set(id, subscriber)
    this.batcher.flush()
    this.snapshot(id, subscriber)
    return () => this.remove(id)
  }

  acknowledge(subscriptionId: string, deliveryId: number): void {
    const subscriber = this.subscribers.get(subscriptionId)
    if (!subscriber?.pending || subscriber.deliveryId !== deliveryId) return
    subscriber.pending = false
    if (subscriber.timer) clearTimeout(subscriber.timer)
    subscriber.timer = undefined
    if (subscriber.dirty) {
      this.scheduleSnapshot(subscriptionId, subscriber)
    } else if (this.exit) this.deliver(subscriptionId, subscriber, this.exit)
  }

  private scheduleSnapshot(id: string, subscriber: Subscriber): void {
    if (subscriber.scheduled) return
    // Bound resnapshots for slow views and snapshots taken inside unfinished input.
    subscriber.scheduled = true
    subscriber.timer = setTimeout(() => {
      subscriber.timer = undefined
      this.snapshot(id, subscriber)
    }, 100)
    subscriber.timer.unref()
  }

  private snapshot(id: string, subscriber: Subscriber): void {
    subscriber.scheduled = true
    this.enqueue(() => {
      if (this.subscribers.get(id) !== subscriber) return
      const data = this.serializer.serialize()
      if (Buffer.byteLength(data) > MAX_SNAPSHOT_BYTES) {
        this.remove(id)
        subscriber.error(new Error("Terminal screen exceeds the recovery size limit."))
        return
      }
      subscriber.dirty = false
      subscriber.scheduled = false
      subscriber.canStream = canStreamAfterTerminalSnapshot(this.terminal)
      this.deliver(id, subscriber, {
        type: "snapshot",
        data,
        cols: this.terminal.cols,
        rows: this.terminal.rows,
      })
    })
  }

  private broadcast(payload: TerminalReplayPayload): void {
    for (const [id, subscriber] of this.subscribers) {
      if (subscriber.pending || subscriber.scheduled) subscriber.dirty = true
      else if (!subscriber.canStream) {
        subscriber.dirty = true
        this.scheduleSnapshot(id, subscriber)
      } else this.deliver(id, subscriber, payload)
    }
  }

  private invalidateSubscribers(): void {
    for (const [id, subscriber] of this.subscribers) {
      subscriber.dirty = true
      if (!subscriber.pending && !subscriber.scheduled) this.snapshot(id, subscriber)
    }
  }

  private deliver(id: string, subscriber: Subscriber, payload: TerminalReplayPayload): void {
    if (this.subscribers.get(id) !== subscriber) return
    subscriber.pending = true
    subscriber.deliveryId++
    subscriber.timer = setTimeout(() => {
      this.remove(id)
      subscriber.error(
        new Error("Terminal view stopped acknowledging output. Reopen the view to recover."),
      )
    }, 30_000)
    subscriber.timer.unref()
    try {
      if (payload.type === "exit") this.remove(id)
      subscriber.next({ ...payload, subscriptionId: id, deliveryId: subscriber.deliveryId })
      if (payload.type === "exit") subscriber.complete()
    } catch {
      this.remove(id)
    }
  }

  private enqueue(job: () => Promise<void> | void): void {
    if (this.disposed || this.failure) return
    if (this.jobs.length >= 4096) {
      this.fail(new Error("Terminal recovery exceeded its operation limit."))
      return
    }
    this.jobs.push(job)
    if (!this.running) void this.drain()
  }

  private async drain(): Promise<void> {
    this.running = true
    try {
      while (!this.disposed && !this.failure && this.jobs.length) await this.jobs.shift()!()
    } catch {
      this.fail(
        new Error(
          "Terminal recovery could not process output. Restart this terminal to restore recovery.",
        ),
      )
    } finally {
      this.running = false
    }
  }

  private remove(id: string): void {
    const subscriber = this.subscribers.get(id)
    if (subscriber?.timer) clearTimeout(subscriber.timer)
    this.subscribers.delete(id)
  }

  private resume(): void {
    if (!this.paused) return
    this.paused = false
    try {
      this.flow.resume()
    } catch {
      /* PTY may already have exited. */
    }
  }

  private fail(error: Error): void {
    this.failure = error
    for (const [id, subscriber] of this.subscribers) {
      this.remove(id)
      subscriber.error(error)
    }
    this.jobs = []
    this.resume()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.batcher.dispose()
    this.jobs = []
    for (const [id, subscriber] of this.subscribers) {
      this.remove(id)
      subscriber.complete()
    }
    this.resume()
    this.terminal.dispose()
  }
}

/**
 * xterm 6.0.0's serializer omits unfinished input, character sets, saved cursor,
 * scroll margins and custom tab stops. Only stream from a compatible snapshot.
 * Keep this pinned, read-only compatibility probe isolated. Unknown shapes use
 * bounded snapshots, never raw continuations that could corrupt the display.
 * See upstream InputHandler, EscapeSequenceParser and StringToUtf32.
 */
export function canStreamAfterTerminalSnapshot(terminal: unknown): boolean {
  const core = (
    terminal as {
      _core?: {
        _charsetService?: { glevel?: unknown; _charsets?: unknown[] }
        _bufferService?: {
          buffer?: {
            scrollTop?: unknown
            scrollBottom?: unknown
            _rows?: unknown
            _cols?: unknown
            tabs?: Record<string, unknown>
            savedX?: unknown
            savedY?: unknown
            savedCharset?: unknown
            savedCurAttrData?: {
              fg?: unknown
              bg?: unknown
              extended?: { _ext?: unknown; _urlId?: unknown }
            }
          }
        }
        _inputHandler?: {
          _parser?: { currentState?: unknown }
          _stringDecoder?: { _interim?: unknown }
        }
      }
    } | null
  )?._core
  const input = core?._inputHandler
  const charset = core?._charsetService
  const buffer = core?._bufferService?.buffer
  return (
    input?._parser?.currentState === 0 &&
    input?._stringDecoder?._interim === 0 &&
    charset?.glevel === 0 &&
    Array.isArray(charset._charsets) &&
    charset._charsets.every((value) => value == null) &&
    buffer?.scrollTop === 0 &&
    typeof buffer._rows === "number" &&
    buffer.scrollBottom === buffer._rows - 1 &&
    buffer.savedX === 0 &&
    buffer.savedY === 0 &&
    buffer.savedCharset == null &&
    buffer.savedCurAttrData?.fg === 0 &&
    buffer.savedCurAttrData?.bg === 0 &&
    buffer.savedCurAttrData?.extended?._ext === 0 &&
    buffer.savedCurAttrData?.extended?._urlId === 0 &&
    typeof buffer._cols === "number" &&
    !!buffer.tabs &&
    Object.keys(buffer.tabs).every(
      (column) => Number(column) % 8 === 0 && buffer.tabs![column] === true,
    ) &&
    Array.from({ length: Math.ceil(buffer._cols / 8) }, (_, index) => index * 8).every(
      (column) => buffer.tabs![column] === true,
    )
  )
}

export function assertTerminalGeometry(cols: number, rows: number): void {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 1 ||
    rows < 1 ||
    cols > MAX_TERMINAL_COLS ||
    rows > MAX_TERMINAL_ROWS
  ) {
    throw new Error("Terminal dimensions must be within 500 columns and 200 rows.")
  }
}
