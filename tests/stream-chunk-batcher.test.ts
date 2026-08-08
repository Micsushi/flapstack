import { describe, expect, it } from "vitest"

import { createStreamChunkBatcher } from "../src/renderer/lib/stream-chunk-batcher"

type Chunk =
  | { type: "text-delta" | "reasoning-delta"; id: string; delta: string }
  | { type: "tool"; id: string }
  | { type: "finish" }

describe("stream chunk batching", () => {
  it("merges adjacent deltas and commits at most once per animation frame", () => {
    const frames: FrameRequestCallback[] = []
    const delivered: Chunk[][] = []
    const batcher = createStreamChunkBatcher<Chunk>({
      deliver: (chunks) => delivered.push(chunks),
      requestFrame: (callback) => {
        frames.push(callback)
        return frames.length
      },
      cancelFrame: () => undefined,
    })

    batcher.push({ type: "text-delta", id: "a", delta: "hel" })
    batcher.push({ type: "text-delta", id: "a", delta: "lo" })
    batcher.push({ type: "reasoning-delta", id: "r", delta: "why" })

    expect(frames).toHaveLength(1)
    expect(delivered).toEqual([])
    frames[0](16)
    expect(delivered).toEqual([
      [
        { type: "text-delta", id: "a", delta: "hello" },
        { type: "reasoning-delta", id: "r", delta: "why" },
      ],
    ])
  })

  it("flushes pending deltas before tools and finish events", () => {
    const delivered: Chunk[][] = []
    const batcher = createStreamChunkBatcher<Chunk>({
      deliver: (chunks) => delivered.push(chunks),
      requestFrame: () => 1,
      cancelFrame: () => undefined,
    })

    batcher.push({ type: "text-delta", id: "a", delta: "ready" })
    batcher.push({ type: "tool", id: "tool-1" })
    batcher.push({ type: "finish" })

    expect(delivered).toEqual([
      [{ type: "text-delta", id: "a", delta: "ready" }],
      [{ type: "tool", id: "tool-1" }],
      [{ type: "finish" }],
    ])
  })
})
