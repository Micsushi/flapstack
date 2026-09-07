import { expect, it } from "vitest"
import { findPromptById, insertAssistantForPrompt } from "../src/main/lib/harness/message-order"
const first = { id: "first", role: "user", parts: [{ type: "text", text: "same" }] }
const second = { ...first, id: "second" }
it("selects identity instead of equal text and rejects changed content", () => {
  expect(findPromptById([first, second], "first", "same")).toBe(first)
  expect(findPromptById([first], "missing", "same")).toBeUndefined()
  expect(() => findPromptById([first], "first", "changed")).toThrow("identity")
  expect(() => findPromptById([{ ...first, role: "assistant" }], "first", "same")).toThrow(
    "identity",
  )
})
it("preserves source and existing reply order while inserting before the next user", () => {
  const oldReply = { id: "old", role: "assistant" }
  const reply = { id: "new", role: "assistant" }
  const messages = [first, oldReply, second]
  expect(insertAssistantForPrompt(messages, reply, "first")).toEqual([
    first,
    oldReply,
    reply,
    second,
  ])
  expect(insertAssistantForPrompt(messages, reply, "missing")).toEqual([...messages, reply])
  expect(messages).toEqual([first, oldReply, second])
})
