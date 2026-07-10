import { describe, expect, it } from "vitest"
import { createTransformer } from "../src/main/lib/claude/transform"

function transformAll(messages: unknown[]) {
  const transform = createTransformer()
  return messages.flatMap((message) => [...transform(message)])
}

describe("Claude visible reasoning-output transform", () => {
  it("streams reasoning-output deltas before the final assistant message without duplication", () => {
    const chunks = transformAll([
      { type: "stream_event", event: { type: "message_start" } },
      {
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "Check " },
        },
      },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "tests." },
        },
      },
      { type: "stream_event", event: { type: "content_block_stop", index: 0 } },
      { type: "assistant", message: { content: [{ type: "thinking", thinking: "Check tests." }] } },
    ])

    const starts = chunks.filter((chunk) => chunk.type === "tool-input-start")
    const deltas = chunks.filter((chunk) => chunk.type === "tool-input-delta")
    const completed = chunks.filter((chunk) => chunk.type === "tool-input-available")

    expect(starts).toHaveLength(1)
    expect(starts[0]).toMatchObject({ toolCallId: "claude-code-0", toolName: "ReasoningOutput" })
    expect(deltas.map((chunk) => chunk.inputTextDelta)).toEqual(['{"text":"Check ', "tests."])
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({
      toolCallId: "claude-code-0",
      input: { text: "Check tests." },
    })
  })

  it("uses the final provider block when no visible deltas arrived", () => {
    const chunks = transformAll([
      {
        type: "assistant",
        message: { content: [{ type: "thinking", thinking: "Use the fallback." }] },
      },
    ])

    expect(chunks.filter((chunk) => chunk.type === "tool-input-delta")).toHaveLength(0)
    expect(chunks.filter((chunk) => chunk.type === "tool-input-available")).toEqual([
      expect.objectContaining({ input: { text: "Use the fallback." } }),
    ])
  })
})
