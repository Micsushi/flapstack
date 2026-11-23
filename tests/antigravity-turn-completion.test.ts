import { expect, it } from "vitest"
import { AntigravityEvents } from "../src/main/lib/agent-runtime/antigravity/events"

it("preserves the resumed tool timeline and rejects an end_turn with a failed command and no answer", () => {
  const turn = new AntigravityEvents("resumed-session", true)
  const timeline = [
    ...turn.update({
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "Checking the input." },
    }),
    ...turn.update({
      sessionUpdate: "tool_call",
      toolCallId: "read",
      title: "Read CSV",
      kind: "read",
      status: "in_progress",
    }),
    ...turn.update({ sessionUpdate: "tool_call_update", toolCallId: "read", status: "completed" }),
    ...turn.update({
      sessionUpdate: "tool_call",
      toolCallId: "command",
      title: "Compute",
      kind: "execute",
      status: "in_progress",
    }),
    ...turn.update({ sessionUpdate: "tool_call_update", toolCallId: "command", status: "failed" }),
    ...turn.finish(),
  ]
  expect(timeline.map((e) => e.kind)).toEqual([
    "provider-visible-reasoning",
    "provider-visible-reasoning",
    "tool",
    "tool",
    "command",
    "command",
  ])
  expect(timeline.at(-1)).toMatchObject({ providerSessionId: "resumed-session", phase: "failed" })
  expect(turn.completionError()?.message).toMatch(/without a reply after a command failed/)
})
it("accepts successful tool-only turns and actual answers after a failure, including streamed tails", () => {
  const turn = new AntigravityEvents("session", false)
  expect(turn.completionError()).toBeInstanceOf(Error)
  turn.update({
    sessionUpdate: "tool_call",
    toolCallId: "a",
    kind: "execute",
    title: "Write report",
    status: "completed",
    rawOutput: { exit_code: 0 },
  })
  expect(turn.completionError()).toBeNull()
  turn.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Checking again." },
  })
  turn.update({
    sessionUpdate: "tool_call",
    toolCallId: "b",
    kind: "execute",
    title: "Read file",
    status: "completed",
    rawOutput: { exit_code: 3 },
  })
  expect(turn.completionError()).toBeInstanceOf(Error)
  turn.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Could not read the file." },
  })
  expect(turn.completionError()).toBeNull()
  expect(turn.finish()[0]).toMatchObject({
    kind: "agent-text",
    sectionBoundary: "final_answer",
    payload: { text: "Could not read the file." },
  })
})
