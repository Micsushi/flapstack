import { expect, it } from "vitest"
import { AntigravityEvents } from "../src/main/lib/agent-runtime/antigravity/events"
import { RuntimeActivityChatChunkMapper } from "../src/renderer/features/agents/lib/runtime-activity-chat-chunks"
import { activity } from "./runtime-activity-test-helpers"

it("fails an ACP end_turn containing only an executor diagnostic, including split chunks", () => {
  const turn = new AntigravityEvents("error-session", true)
  const message = (text: string) =>
    turn.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } })
  message("\n⚠ agent exec")
  message("utor error: building toolbox: invalid schema. Bearer secret-fixture-token")
  turn.update({ sessionUpdate: "usage_update", used: 2, size: 1000 })
  expect(turn.confirmedCompaction("/compact")).toBeUndefined()
  const failure = turn.completionError()
  expect(failure?.message).toContain("building toolbox: invalid schema")
  expect(failure?.message).not.toContain("secret-fixture-token")
  expect(turn.finishTurn()).not.toContainEqual(
    expect.objectContaining({ sectionBoundary: "final_answer" }),
  )
})

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

it("records ACP context occupancy independently of token billing and recognizes a confirmed compact", () => {
  const turn = new AntigravityEvents("qa-session", true)
  expect(turn.confirmedCompaction("/compact")).toBeUndefined()
  const usage = turn.update({ sessionUpdate: "usage_update", used: 1351, size: 65536 })
  expect(usage[0]).toMatchObject({
    kind: "usage",
    payload: { contextUsed: 1351, contextWindow: 65536 },
  })
  expect(usage[0]?.payload).not.toHaveProperty("inputTokens")
  expect(turn.confirmedCompaction("explain /compact")).toBeUndefined()
  expect(turn.completionError()).toBeInstanceOf(Error)
  expect(turn.confirmedCompaction("/compact")).toMatchObject({
    kind: "compaction",
    payload: { state: "compacted" },
  })
})
