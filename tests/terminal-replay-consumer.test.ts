// @vitest-environment jsdom
import { expect, it, vi } from "vitest"
import { Terminal } from "xterm"
import { TerminalReplay } from "../src/main/lib/terminal/replay"
import { createTerminalReplayConsumer } from "../src/renderer/features/terminal/replay-consumer"
import type { TerminalReplayEvent } from "../src/shared/terminal-replay"

function fixture() {
  const parsed: Array<() => void> = []
  const terminal = {
    reset: vi.fn(),
    resize: vi.fn(),
    write: vi.fn((_data: string, done: () => void) => parsed.push(done)),
  }
  const callbacks = { acknowledge: vi.fn(), afterSnapshot: vi.fn(), data: vi.fn(), exit: vi.fn() }
  return {
    terminal,
    callbacks,
    parsed,
    consumer: createTerminalReplayConsumer(terminal, callbacks),
  }
}
const snapshot = (subscriptionId: string, deliveryId = 1): TerminalReplayEvent => ({
  type: "snapshot",
  subscriptionId,
  deliveryId,
  cols: 80,
  rows: 24,
  data: subscriptionId,
})

it("acknowledges only after parsing and ignores duplicate deliveries", () => {
  const { consumer, callbacks, parsed, terminal } = fixture()
  consumer.accept(snapshot("one"))
  expect(callbacks.acknowledge).not.toHaveBeenCalled()
  parsed.shift()!()
  expect(callbacks.acknowledge).toHaveBeenCalledWith(snapshot("one"))
  consumer.accept(snapshot("one"))
  expect(terminal.write).toHaveBeenCalledOnce()
})

it("waits for old parsing before resetting and keeps only the latest replacement snapshot", () => {
  const { consumer, terminal, callbacks, parsed } = fixture()
  consumer.accept(snapshot("old"))
  consumer.accept(snapshot("replacement"))
  consumer.accept(snapshot("newest"))
  expect(terminal.reset).toHaveBeenCalledOnce()
  parsed.shift()!()
  expect(terminal.reset).toHaveBeenCalledTimes(2)
  expect(terminal.write.mock.calls.map(([data]) => data)).toEqual(["old", "newest"])
  expect(callbacks.acknowledge).not.toHaveBeenCalled()
  parsed.shift()!()
  expect(callbacks.acknowledge).toHaveBeenCalledWith(snapshot("newest"))
})

it("does not acknowledge or refit a disposed terminal and ignores stale subscription deltas", () => {
  const { consumer, callbacks, parsed, terminal } = fixture()
  consumer.accept(snapshot("current"))
  consumer.accept({ type: "data", subscriptionId: "old", deliveryId: 2, data: "wrong" })
  consumer.dispose()
  parsed.shift()!()
  expect(callbacks.acknowledge).not.toHaveBeenCalled()
  expect(callbacks.afterSnapshot).not.toHaveBeenCalled()
  expect(terminal.write).toHaveBeenCalledOnce()
})

it("parses an empty snapshot with the installed browser xterm before acknowledging", async () => {
  const terminal = new Terminal({ cols: 80, rows: 24 })
  const acknowledge = vi.fn()
  const consumer = createTerminalReplayConsumer(terminal, {
    acknowledge,
    afterSnapshot() {},
    data() {},
    exit() {},
  })
  try {
    consumer.accept({ ...snapshot("empty"), type: "snapshot", data: "", cols: 80, rows: 24 })
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledOnce())
  } finally {
    consumer.dispose()
    terminal.dispose()
  }
})

it.each([
  ["CSI", "prefix\x1b[", "31mRED", "prefixRED"],
  ["OSC", "prefix\x1b]0;part", "ial title\x07RED", "prefixRED"],
  ["surrogate pair", "prefix\ud83d", "\ude80RED", "prefix🚀RED"],
  ["character set", "prefix\x1b(0", "q", "prefix─"],
  ["saved cursor", "ab\x1b7cd", "\x1b8X", "abXd"],
  ["cleared tab stops", "ab\x1b[3g", "\tX", `ab${" ".repeat(77)}X`],
])(
  "recovers attachment inside an unfinished %s without exposing its continuation as text",
  async (_kind, prefix, suffix, expected) => {
    const terminal = new Terminal({ cols: 80, rows: 24 })
    const replay = new TerminalReplay(80, 24, { pause() {}, resume() {} })
    const acknowledged: TerminalReplayEvent[] = []
    const consumer = createTerminalReplayConsumer(terminal, {
      acknowledge(event) {
        acknowledged.push(event)
        replay.acknowledge(event.subscriptionId, event.deliveryId)
      },
      afterSnapshot() {},
      data() {},
      exit() {},
    })
    replay.write(prefix)
    const unsubscribe = replay.subscribe({
      next: consumer.accept,
      error(error) {
        throw error
      },
      complete() {},
    })
    try {
      await vi.waitFor(() => expect(acknowledged).toHaveLength(1))
      replay.write(suffix)
      await vi.waitFor(() =>
        expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(expected),
      )
      expect(acknowledged.at(-1)?.type).toBe("snapshot")
    } finally {
      unsubscribe()
      consumer.dispose()
      replay.dispose()
      terminal.dispose()
    }
  },
)
