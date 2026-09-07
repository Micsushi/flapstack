import { afterEach, expect, it, vi } from "vitest"
import { TerminalReplay, canStreamAfterTerminalSnapshot } from "../src/main/lib/terminal/replay"
import type { TerminalReplayEvent } from "../src/shared/terminal-replay"

const replays: TerminalReplay[] = []
function fixture() {
  const flow = { pause: vi.fn(), resume: vi.fn() }
  const replay = new TerminalReplay(80, 24, flow)
  replays.push(replay)
  const events: TerminalReplayEvent[] = []
  const error = vi.fn()
  const complete = vi.fn()
  const attach = () => replay.subscribe({ next: (event) => events.push(event), error, complete })
  const ack = (event = events.at(-1)!) => replay.acknowledge(event.subscriptionId, event.deliveryId)
  return { replay, flow, events, error, complete, attach, ack }
}
afterEach(() => {
  for (const replay of replays.splice(0)) replay.dispose()
  vi.useRealTimers()
})

it("restores parsed output produced with no attached renderer, including ANSI overwrite and Unicode", async () => {
  const { replay, attach, events } = fixture()
  replay.write("Old screen\r\x1b[2KRecovered 雪\r\n")
  attach()
  await vi.waitFor(() => expect(events).toHaveLength(1))
  expect(events[0].type).toBe("snapshot")
  expect(events[0]).toMatchObject({
    cols: 80,
    rows: 24,
    data: expect.stringContaining("Recovered 雪"),
  })
  expect(events[0]).toMatchObject({ data: expect.not.stringContaining("Old screen") })
})

it("bounds a slow view to one outstanding delivery and recovers current state after exact acknowledgement", async () => {
  const { replay, attach, events, ack } = fixture()
  attach()
  await vi.waitFor(() => expect(events).toHaveLength(1))
  replay.write("later output\r\n")
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(events).toHaveLength(1)
  replay.acknowledge(events[0].subscriptionId, events[0].deliveryId + 1)
  expect(events).toHaveLength(1)
  ack()
  await vi.waitFor(() => expect(events).toHaveLength(2))
  expect(events[1]).toMatchObject({
    type: "snapshot",
    data: expect.stringContaining("later output"),
  })
  ack()
  replay.write("interactive")
  await vi.waitFor(() => expect(events).toHaveLength(3))
  expect(events[2]).toMatchObject({ type: "data", data: "interactive" })
})

it("delivers trailing output before exit, including synchronous acknowledgement", async () => {
  const { replay, attach, events, ack, complete } = fixture()
  attach()
  await vi.waitFor(() => expect(events).toHaveLength(1))
  replay.write("tail")
  replay.finish(7)
  ack()
  await vi.waitFor(() => expect(events).toHaveLength(2))
  expect(events[1].type).not.toBe("exit")
  ack()
  await vi.waitFor(() => expect(events.at(-1)).toMatchObject({ type: "exit", exitCode: 7 }))
  ack()
  expect(complete).toHaveBeenCalledOnce()
})

it("pauses only the owned input source under pressure and resumes after parsing", async () => {
  const { replay, flow, events, attach } = fixture()
  replay.write("x".repeat(300 * 1024))
  expect(flow.pause).toHaveBeenCalledOnce()
  attach()
  await vi.waitFor(() => expect(events).toHaveLength(1))
  expect(flow.resume).toHaveBeenCalledOnce()
})

it("reports input overflow without killing a PTY or claiming an empty recovered screen", () => {
  const { replay, attach, error, events } = fixture()
  replay.write("x".repeat(4 * 1024 * 1024 + 1))
  attach()
  expect(error).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining("input limit") }),
  )
  expect(events).toEqual([])
})

it("bounds subscriptions and removes detached views without losing main-owned state", async () => {
  const { replay, error, attach, events } = fixture()
  const dispose = Array.from({ length: 8 }, () => attach())
  attach()
  expect(error).toHaveBeenCalledOnce()
  dispose.forEach((stop) => stop())
  replay.write("retained")
  events.length = 0
  attach()
  await vi.waitFor(() => expect(events).toHaveLength(1))
  expect(events[0]).toMatchObject({ type: "snapshot", data: expect.stringContaining("retained") })
})

it("closes unacknowledged subscriptions on deadline and cancels their timer on dispose", async () => {
  const { replay, attach, error } = fixture()
  vi.useFakeTimers()
  attach()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(error).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining("acknowledging") }),
  )
  attach()
  replay.dispose()
  expect(vi.getTimerCount()).toBe(0)
})

it("rejects invalid or excessive dimensions before allocating a terminal", () => {
  for (const [cols, rows] of [
    [0, 24],
    [501, 24],
    [80, 201],
    [NaN, 24],
    [80.5, 24],
  ]) {
    expect(() => new TerminalReplay(cols, rows, { pause() {}, resume() {} })).toThrow("dimensions")
  }
})

it("fails closed when a headless dependency change hides parser or decoder state", () => {
  for (const terminal of [
    null,
    {},
    { _core: { _inputHandler: { _parser: { currentState: 0 } } } },
  ]) {
    expect(canStreamAfterTerminalSnapshot(terminal)).toBe(false)
  }
})
