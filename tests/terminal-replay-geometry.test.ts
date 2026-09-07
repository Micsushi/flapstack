// @vitest-environment jsdom
import { expect, it, vi } from "vitest"
import { Terminal } from "xterm"
import { TerminalReplay } from "../src/main/lib/terminal/replay"
import { createTerminalReplayConsumer } from "../src/renderer/features/terminal/replay-consumer"

it("preserves the main grid across differently sized views and cursor-positioned output", async () => {
  const replay = new TerminalReplay(40, 24, { pause() {}, resume() {} })
  const terminals = [new Terminal({ cols: 40, rows: 24 }), new Terminal({ cols: 80, rows: 24 })]
  const acknowledged = [vi.fn(), vi.fn()]
  const consumers = terminals.map((terminal, index) =>
    createTerminalReplayConsumer(terminal, {
      acknowledge(event) {
        acknowledged[index]()
        replay.acknowledge(event.subscriptionId, event.deliveryId)
      },
      data() {},
      exit() {},
    }),
  )
  const stops = consumers.map((consumer) =>
    replay.subscribe({
      next: consumer.accept,
      error(error) {
        throw error
      },
      complete() {},
    }),
  )
  try {
    await vi.waitFor(() =>
      expect(acknowledged.every((ack) => ack.mock.calls.length >= 1)).toBe(true),
    )
    replay.resize(80, 24)
    await vi.waitFor(() =>
      expect(acknowledged.every((ack) => ack.mock.calls.length >= 2)).toBe(true),
    )
    replay.write("\x1b[1;61HX")
    await vi.waitFor(() =>
      expect(
        terminals.map((terminal) => terminal.buffer.active.getLine(0)?.getCell(60)?.getChars()),
      ).toEqual(["X", "X"]),
    )
    expect(terminals.map((terminal) => terminal.cols)).toEqual([80, 80])
  } finally {
    stops.forEach((stop) => stop())
    consumers.forEach((consumer) => consumer.dispose())
    terminals.forEach((terminal) => terminal.dispose())
    replay.dispose()
  }
})
