import { afterEach, describe, expect, it, vi } from "vitest"
import { VisualCapturePendingStore } from "../src/main/lib/visual-capture/pending-store"

function captured(bytes = Buffer.from("sensitive raw frame")) {
  return {
    requestId: "request-a",
    sourceClass: "screen" as const,
    bytes,
    actor: { kind: "user" as const, id: "owner" },
    scope: { projectId: "project-a", chatId: "chat-a" },
    approvalId: null,
    capturedAt: 1,
    scaleFactor: 1,
  }
}

describe("visual capture pending raw-frame boundary", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("reserves capacity before capture and never exceeds the bounded pending count", () => {
    const pending = new VisualCapturePendingStore(() => 1, { maxPending: 2 })
    const first = pending.reserve()
    const second = pending.reserve()
    expect(() => pending.reserve()).toThrow(/finish or cancel/i)
    pending.add(first, captured())
    pending.release(second)
    expect(() => pending.reserve()).not.toThrow()
  })

  it("serializes consumption, rejects cancellation during confirmation, and purges raw bytes", async () => {
    const raw = Buffer.from("sensitive raw frame")
    const pending = new VisualCapturePendingStore(() => 1)
    const resultId = pending.add(pending.reserve(), captured(raw))
    let release!: () => void
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = pending.consume(resultId, async () => {
      await blocked
      return "stored"
    })

    await expect(pending.consume(resultId, async () => "duplicate")).rejects.toThrow(
      /confirmation.*progress/i,
    )
    expect(() => pending.cancel(resultId)).toThrow(/confirmation.*progress/i)
    release()
    await expect(first).resolves.toBe("stored")
    expect(raw.equals(Buffer.alloc(raw.byteLength))).toBe(true)
    expect(() => pending.get(resultId)).toThrow(/expired|confirmed/i)
  })

  it("purges cancelled and expired raw frames but retains a failed confirmation for correction", async () => {
    let now = 1
    const pending = new VisualCapturePendingStore(() => now, { timeoutMs: 10 })
    const cancelledRaw = Buffer.from("cancel")
    const cancelled = pending.add(pending.reserve(), captured(cancelledRaw))
    pending.cancel(cancelled)
    expect(cancelledRaw.equals(Buffer.alloc(cancelledRaw.byteLength))).toBe(true)

    const failedRaw = Buffer.from("retry")
    const failed = pending.add(pending.reserve(), captured(failedRaw))
    await expect(
      pending.consume(failed, async () => {
        throw new Error("preview hash changed")
      }),
    ).rejects.toThrow(/preview hash changed/i)
    expect(pending.get(failed).bytes).toBe(failedRaw)

    now = 12
    pending.prune()
    expect(failedRaw.equals(Buffer.alloc(failedRaw.byteLength))).toBe(true)
    expect(() => pending.get(failed)).toThrow(/expired|confirmed/i)
  })

  it("purges expired raw frames from a timer without waiting for another store access", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const pending = new VisualCapturePendingStore(Date.now, { timeoutMs: 25 })
    const raw = Buffer.from("timer-owned secret")
    const resultId = pending.add(pending.reserve(), captured(raw))

    vi.advanceTimersByTime(24)
    expect(raw.equals(Buffer.alloc(raw.byteLength))).toBe(false)
    vi.advanceTimersByTime(1)

    expect(raw.equals(Buffer.alloc(raw.byteLength))).toBe(true)
    expect(() => pending.get(resultId)).toThrow(/expired|confirmed/i)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("cancels expiry timers and purges every raw frame during shutdown", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const pending = new VisualCapturePendingStore(Date.now, { timeoutMs: 25 })
    const first = Buffer.from("first shutdown secret")
    const second = Buffer.from("second shutdown secret")
    pending.add(pending.reserve(), captured(first))
    pending.add(pending.reserve(), captured(second))

    expect(vi.getTimerCount()).toBe(2)
    pending.shutdown()

    expect(first.equals(Buffer.alloc(first.byteLength))).toBe(true)
    expect(second.equals(Buffer.alloc(second.byteLength))).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    expect(() => pending.reserve()).toThrow(/shut down/i)
  })
})
