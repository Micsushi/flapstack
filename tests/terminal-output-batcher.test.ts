import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  TERMINAL_FLUSH_BYTES,
  TERMINAL_FLUSH_MS,
  createTerminalOutputBatcher,
} from "../src/main/lib/terminal/output-batcher"

describe("terminal output batcher", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("coalesces chunks emitted within one flush window into a single message", () => {
    const flushed: string[] = []
    const batcher = createTerminalOutputBatcher((data) => flushed.push(data))

    for (let i = 0; i < 50; i++) batcher.push(`line ${i}\n`)
    expect(flushed).toEqual([])

    vi.advanceTimersByTime(TERMINAL_FLUSH_MS)

    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toContain("line 0\n")
    expect(flushed[0]).toContain("line 49\n")
  })

  it("preserves byte order across flushes", () => {
    const flushed: string[] = []
    const batcher = createTerminalOutputBatcher((data) => flushed.push(data))

    batcher.push("a")
    batcher.push("b")
    vi.advanceTimersByTime(TERMINAL_FLUSH_MS)
    batcher.push("c")
    vi.advanceTimersByTime(TERMINAL_FLUSH_MS)

    expect(flushed.join("")).toBe("abc")
  })

  it("flushes immediately once the size threshold is reached", () => {
    const flushed: string[] = []
    const batcher = createTerminalOutputBatcher((data) => flushed.push(data))

    batcher.push("x".repeat(TERMINAL_FLUSH_BYTES))

    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toHaveLength(TERMINAL_FLUSH_BYTES)
  })

  it("emits buffered output before an explicit flush caller (exit ordering)", () => {
    const events: string[] = []
    const batcher = createTerminalOutputBatcher((data) => events.push(`data:${data}`))

    batcher.push("tail output")
    batcher.flush()
    events.push("exit")

    expect(events).toEqual(["data:tail output", "exit"])
  })

  it("does not emit after dispose", () => {
    const flushed: string[] = []
    const batcher = createTerminalOutputBatcher((data) => flushed.push(data))

    batcher.push("dropped")
    batcher.dispose()
    vi.advanceTimersByTime(TERMINAL_FLUSH_MS * 10)

    expect(flushed).toEqual([])
  })

  it("loses nothing when flushed before dispose", () => {
    const flushed: string[] = []
    const batcher = createTerminalOutputBatcher((data) => flushed.push(data))

    batcher.push("buffered tail")
    // Subscription teardown ordering: flush, then drop the buffer.
    batcher.flush()
    batcher.dispose()
    vi.advanceTimersByTime(TERMINAL_FLUSH_MS * 10)

    expect(flushed).toEqual(["buffered tail"])
  })

  it("ignores empty chunks instead of scheduling an empty flush", () => {
    const flushed: string[] = []
    const batcher = createTerminalOutputBatcher((data) => flushed.push(data))

    batcher.push("")
    vi.advanceTimersByTime(TERMINAL_FLUSH_MS * 10)

    expect(flushed).toEqual([])
  })
})
