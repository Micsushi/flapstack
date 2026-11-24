import { describe, expect, it } from "vitest"
import { readUIMessageStream } from "ai"
import { RuntimeTextChatChunkMapper } from "../src/renderer/features/agents/lib/runtime-text-chat-chunks"

describe("direct runtime chat transport", () => {
  it("retains commentary and final phases in the rendered message stream", async () => {
    const mapper = new RuntimeTextChatChunkMapper("phase-test")
    const chunks = [
      { type: "start", messageId: "phase-test" },
      ...mapper.map({
        phase: "started",
        text: "",
        providerItemId: "progress",
        providerMessageId: null,
        contentIndex: null,
        sectionBoundary: "commentary",
      }),
      ...mapper.map({
        phase: "delta",
        text: "I'll check.",
        providerItemId: "progress",
        providerMessageId: null,
        contentIndex: null,
        sectionBoundary: null,
      }),
      ...mapper.beforeActivity(),
      ...mapper.map({
        phase: "started",
        text: "",
        providerItemId: "answer",
        providerMessageId: null,
        contentIndex: null,
        sectionBoundary: "final_answer",
      }),
      ...mapper.map({
        phase: "completed",
        text: "Here is the answer.",
        providerItemId: "answer",
        providerMessageId: null,
        contentIndex: null,
        sectionBoundary: "final_answer",
      }),
      { type: "finish" },
    ]
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    let message: any
    for await (const next of readUIMessageStream({ stream, terminateOnError: true })) message = next
    expect(message.parts.map((part: any) => part.providerMetadata?.runtime?.phase)).toEqual([
      "commentary",
      "final_answer",
    ])
  })
})
