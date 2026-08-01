import { randomUUID } from "node:crypto"
import type { VisualCaptureActor, VisualCaptureScope } from "./session"

export type PendingVisualCapture = {
  requestId: string
  sourceClass: "screen" | "window" | "application-window" | "region"
  bytes: Buffer
  actor: VisualCaptureActor
  scope: VisualCaptureScope
  approvalId: string | null
  capturedAt: number
  scaleFactor: number
}

type PendingEntry = PendingVisualCapture & { expiresAt: number }

export class VisualCapturePendingStore {
  readonly #pending = new Map<string, PendingEntry>()
  readonly #reservations = new Set<string>()
  readonly #consuming = new Set<string>()
  readonly #expiredWhileConsuming = new Set<string>()
  readonly #expiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #now: () => number
  readonly #maxPending: number
  readonly #timeoutMs: number
  #closed = false

  constructor(
    now: () => number = Date.now,
    options: { maxPending?: number; timeoutMs?: number } = {},
  ) {
    this.#now = now
    this.#maxPending = options.maxPending ?? 3
    this.#timeoutMs = options.timeoutMs ?? 5 * 60_000
  }

  reserve(): string {
    if (this.#closed) throw new Error("Visual capture pending store is shut down.")
    this.prune()
    if (this.#pending.size + this.#reservations.size >= this.#maxPending) {
      throw new Error("Finish or cancel an open visual capture preview before starting another.")
    }
    const reservation = randomUUID()
    this.#reservations.add(reservation)
    return reservation
  }

  release(reservation: string): void {
    this.#reservations.delete(reservation)
  }

  add(reservation: string, capture: PendingVisualCapture): string {
    if (!this.#reservations.delete(reservation)) {
      throw new Error("Visual capture pending reservation is no longer active.")
    }
    if (!Buffer.isBuffer(capture.bytes) || capture.bytes.byteLength === 0) {
      throw new Error("Visual capture pending frame is empty.")
    }
    const resultId = randomUUID()
    const entry = {
      ...capture,
      expiresAt: this.#now() + this.#timeoutMs,
    }
    this.#pending.set(resultId, entry)
    this.#scheduleExpiry(resultId, entry)
    return resultId
  }

  get(resultId: string): PendingEntry {
    this.prune()
    const capture = this.#pending.get(resultId)
    if (!capture) throw new Error("Visual capture preview expired or was already confirmed.")
    return capture
  }

  cancel(resultId: string): void {
    if (this.#consuming.has(resultId)) {
      throw new Error("Visual capture confirmation is in progress.")
    }
    const capture = this.#pending.get(resultId)
    if (capture) this.#remove(resultId, capture)
  }

  async consume<T>(resultId: string, operation: (capture: PendingEntry) => Promise<T>): Promise<T> {
    if (this.#consuming.has(resultId)) {
      throw new Error("Visual capture confirmation is already in progress.")
    }
    const capture = this.get(resultId)
    this.#consuming.add(resultId)
    try {
      const result = await operation(capture)
      this.#remove(resultId, capture)
      return result
    } finally {
      this.#consuming.delete(resultId)
      if (
        this.#pending.get(resultId) === capture &&
        (this.#closed ||
          this.#expiredWhileConsuming.delete(resultId) ||
          capture.expiresAt <= this.#now())
      ) {
        this.#remove(resultId, capture)
      }
    }
  }

  prune(): void {
    const now = this.#now()
    for (const [resultId, capture] of this.#pending) {
      if (capture.expiresAt > now || this.#consuming.has(resultId)) continue
      this.#remove(resultId, capture)
    }
  }

  shutdown(): void {
    if (this.#closed) return
    this.#closed = true
    this.#reservations.clear()
    for (const capture of this.#pending.values()) purge(capture.bytes)
    this.#pending.clear()
    this.#consuming.clear()
    this.#expiredWhileConsuming.clear()
    for (const timer of this.#expiryTimers.values()) clearTimeout(timer)
    this.#expiryTimers.clear()
  }

  #scheduleExpiry(resultId: string, capture: PendingEntry): void {
    const timer = setTimeout(
      () => {
        this.#expiryTimers.delete(resultId)
        if (this.#pending.get(resultId) !== capture) return
        if (this.#consuming.has(resultId)) {
          this.#expiredWhileConsuming.add(resultId)
          return
        }
        this.#remove(resultId, capture)
      },
      Math.max(0, capture.expiresAt - this.#now()),
    )
    timer.unref?.()
    this.#expiryTimers.set(resultId, timer)
  }

  #remove(resultId: string, capture: PendingEntry): void {
    if (this.#pending.get(resultId) !== capture) return
    this.#pending.delete(resultId)
    this.#expiredWhileConsuming.delete(resultId)
    const timer = this.#expiryTimers.get(resultId)
    if (timer) clearTimeout(timer)
    this.#expiryTimers.delete(resultId)
    purge(capture.bytes)
  }
}

export const appVisualCapturePendingStore = new VisualCapturePendingStore()

export function shutdownAppVisualCapturePendingStore(): void {
  appVisualCapturePendingStore.shutdown()
}

function purge(bytes: Buffer): void {
  bytes.fill(0)
}
