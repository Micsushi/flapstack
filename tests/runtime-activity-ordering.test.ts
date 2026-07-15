import { describe, expect, it, vi } from "vitest"
import {
  createRuntimeActivityBatcher,
  createRuntimeActivityTimelineState,
  mergeRuntimeActivityPages,
  runtimeActivityTimelineReducer,
  selectRuntimeActivitySource,
} from "../src/renderer/features/agents/runtime-activity"
import { activity } from "./runtime-activity-test-helpers"

describe("Runtime activity ordering, pagination, replay, and state", () => {
  it("merges backward/forward pages by stable storage identity", () => {
    const page = mergeRuntimeActivityPages(
      [
        activity("status", { message: "two" }, { storageId: 2, eventId: "two" }),
        activity("status", { message: "four" }, { storageId: 4, eventId: "four" }),
      ],
      [
        activity("status", { message: "one" }, { storageId: 1, eventId: "one" }),
        activity("status", { message: "two retry" }, { storageId: 2, eventId: "two" }),
        activity("status", { message: "three" }, { storageId: 3, eventId: "three" }),
      ],
    )
    expect(page.map((event) => "storageId" in event && event.storageId)).toEqual([1, 2, 3, 4])
    expect(page[1].payload).toEqual({ message: "two retry" })
  })

  it("uses a read-only legacy projection without durable provider identity", () => {
    const sources = selectRuntimeActivitySource(
      [],
      [
        {
          role: "assistant",
          parts: [
            { type: "text", text: "Legacy answer" },
            { type: "reasoning", text: "Legacy summary" },
            { type: "tool-Read", state: "completed" },
          ],
        },
      ],
    )
    expect(sources).toHaveLength(3)
    expect(sources.every((source) => "persisted" in source && !source.persisted)).toBe(true)
    expect(
      sources.every((source) => "providerIdentity" in source && source.providerIdentity === null),
    ).toBe(true)
  })

  it("preserves legacy history before durable activity and removes exact duplicate text", () => {
    const durable = activity("agent-text", { text: "New answer" }, { eventId: "new-answer" })
    const sources = selectRuntimeActivitySource(
      [durable],
      [
        { role: "user", parts: [{ type: "text", text: "Old question" }] },
        { role: "assistant", parts: [{ type: "text", text: "Old answer" }] },
        { role: "assistant", parts: [{ type: "text", text: "New answer" }] },
      ],
    )

    expect(
      sources.map((source) => ("eventId" in source ? source.eventId : source.projectionId)),
    ).toEqual(["legacy:0:0", "legacy:1:0", "new-answer"])
  })

  it("does not remove a user message that matches durable assistant text", () => {
    const durable = activity("agent-text", { text: "Repeat this exactly" }, { eventId: "echo" })
    const sources = selectRuntimeActivitySource(
      [durable],
      [{ role: "user", parts: [{ type: "text", text: "Repeat this exactly" }] }],
    )

    expect(
      sources.map((source) => ("eventId" in source ? source.eventId : source.projectionId)),
    ).toEqual(["legacy:0:0", "echo"])
  })

  it("preserves selection while invalidation marks the replay stale", () => {
    let state = createRuntimeActivityTimelineState({
      events: [activity("status", { message: "live" }, { eventId: "stable" })],
      status: "live",
    })
    state = runtimeActivityTimelineReducer(state, { type: "select", key: "event:stable" })
    state = runtimeActivityTimelineReducer(state, {
      type: "invalidated",
      invalidation: {
        reason: "append",
        runId: "run-1",
        chatId: "chat-1",
        firstSequence: 2,
        lastSequence: 2,
        lastStorageId: 2,
        insertedCount: 1,
      },
    })
    expect(state).toMatchObject({ status: "stale", selectedKey: "event:stable", generation: 1 })
  })

  it("batches streaming callbacks with bounded flushes", () => {
    vi.useFakeTimers()
    const emitted: number[] = []
    const batcher = createRuntimeActivityBatcher((events) => emitted.push(events.length), {
      maxBatch: 3,
      delayMs: 10,
    })
    batcher.push([activity("status", { message: "1" })])
    batcher.push([activity("status", { message: "2" }, { eventId: "2" })])
    expect(emitted).toEqual([])
    vi.advanceTimersByTime(10)
    expect(emitted).toEqual([2])
    batcher.push([
      activity("status", { message: "3" }, { eventId: "3" }),
      activity("status", { message: "4" }, { eventId: "4" }),
      activity("status", { message: "5" }, { eventId: "5" }),
    ])
    expect(emitted).toEqual([2, 3])
    batcher.dispose()
    vi.useRealTimers()
  })
})
