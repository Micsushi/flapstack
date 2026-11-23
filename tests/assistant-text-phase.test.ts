import { describe, expect, it } from "vitest"
import {
  findAnswerPartIndex,
  isProgressText,
} from "../src/renderer/features/agents/lib/assistant-text-phase"

const text = (value: string, phase?: string) => ({
  type: "text",
  text: value,
  providerMetadata: { runtime: { phase } },
})
describe("assistant progress and answer placement", () => {
  it("keeps commentary in activity before any tools arrive and after completion", () => {
    const part = text("I'll check that.", "commentary")
    expect(isProgressText(part, true)).toBe(true)
    expect(isProgressText(part, false)).toBe(true)
    expect(findAnswerPartIndex([part], false)).toBe(-1)
  })
  it("streams an explicitly final answer outside progress immediately", () => {
    const parts = [text("Checking.", "commentary"), text("The answer is", "final_answer")]
    expect(findAnswerPartIndex(parts, true)).toBe(1)
    expect(isProgressText(parts[1]!, true)).toBe(false)
  })
  it("shows Claude public text immediately and keeps it with a later native tool", () => {
    const greeting = text("Hi!", "assistant_text")
    expect(findAnswerPartIndex([greeting], true)).toBe(0)
    const steps = [
      { type: "reasoning" },
      text("I'll read the file.", "assistant_text"),
      { type: "tool-Read" },
    ]
    expect(findAnswerPartIndex(steps, true)).toBe(-1)
    expect(findAnswerPartIndex(steps, false)).toBe(-1)
    expect(isProgressText(steps[1]!, false, 1, 2)).toBe(true)
    const answered = [...steps, text("The result is 24.", "assistant_text")]
    expect(findAnswerPartIndex(answered, true)).toBe(3)
    expect(findAnswerPartIndex(answered, false)).toBe(3)
  })
  it("keeps unclassified live text in progress until completion confirms an answer", () => {
    const parts = [
      text("I'll inspect the file."),
      { type: "tool-Read" },
      text("Here is the result."),
    ]
    expect(findAnswerPartIndex(parts, true)).toBe(-1)
    expect(findAnswerPartIndex(parts, false)).toBe(2)
  })
})
