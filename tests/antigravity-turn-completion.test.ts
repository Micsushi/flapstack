import { expect, it } from "vitest"
import { AntigravityEvents } from "../src/main/lib/agent-runtime/antigravity/events"
import { RuntimeActivityChatChunkMapper } from "../src/renderer/features/agents/lib/runtime-activity-chat-chunks"
import { activity } from "./runtime-activity-test-helpers"

it("finishes a user-declined file change without an invented reply or a failure notification", () => {
  const turn = new AntigravityEvents("gemini-session", false)
  const file = {
    toolCallId: "edit-1",
    kind: "edit",
    title: "Write file",
    locations: [{ path: "note.txt" }],
  } as const
  const patch = { ...file, locations: [...file.locations] }
  turn.update({
    sessionUpdate: "tool_call",
    toolCallId: "read",
    kind: "read",
    title: "Read file",
    status: "completed",
  })
  const started = turn.update({ ...patch, sessionUpdate: "tool_call", status: "pending" })
  turn.setFileChangeDeclined({ toolCallId: patch.toolCallId, locations: patch.locations }, true)
  const pending = turn.update({
    sessionUpdate: "tool_call_update",
    toolCallId: patch.toolCallId,
    status: "in_progress",
  })
  const terminal = turn.update({
    sessionUpdate: "tool_call_update",
    toolCallId: patch.toolCallId,
    status: "failed",
  })
  expect(terminal).toMatchObject([
    {
      kind: "patch",
      providerSessionId: "gemini-session",
      providerToolId: patch.toolCallId,
      phase: "cancelled",
      payload: { state: "declined", summary: "File change declined" },
    },
  ])
  expect(turn.finishTurn()).toEqual([])
  expect(turn.completionError()).toBeNull()
  const events = [...started, ...pending, ...terminal].map((event, index) =>
    activity(event.kind, event.payload, { ...event, sequence: index + 1 }),
  )
  const chunks = new RuntimeActivityChatChunkMapper("run").map(events)
  expect(chunks.map((chunk) => chunk.type)).toEqual([
    "tool-input-available",
    "tool-output-available",
  ])
  expect(chunks.at(-1)).toMatchObject({
    output: { state: "declined", summary: "File change declined" },
  })
  turn.update({
    sessionUpdate: "tool_call",
    toolCallId: "different",
    title: "Run command",
    kind: "execute",
    status: "failed",
  })
  expect(turn.completionError()?.message).toMatch(/command failed/)
})

it("preserves a genuine failed edit, a new approval, and a decline without a final tool callback", () => {
  const turn = new AntigravityEvents("session", false)
  const file = { toolCallId: "edit-1", kind: "edit" as const, title: "Write file" }
  turn.setFileChangeDeclined(file, true)
  expect(turn.completionError()).toBeNull()
  expect(turn.finishTurn()).toMatchObject([{ kind: "patch", phase: "cancelled" }])
  turn.setFileChangeDeclined(file, false)
  expect(turn.completionError()).toBeInstanceOf(Error)
  const failed = turn.update({
    sessionUpdate: "tool_call_update",
    toolCallId: file.toolCallId,
    status: "failed",
  })
  expect(failed).toMatchObject([{ kind: "patch", phase: "failed" }])
  expect(turn.completionError()).toBeInstanceOf(Error)
})

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
  const command = turn.update({
    sessionUpdate: "tool_call",
    toolCallId: "b",
    kind: "execute",
    title: "Read file",
    status: "completed",
    rawOutput: { exit_code: 3 },
  })
  expect(command.at(-1)).toMatchObject({
    kind: "command",
    phase: "completed",
    payload: { exitCode: 3 },
  })
  expect(turn.completionError()).toBeNull()
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
