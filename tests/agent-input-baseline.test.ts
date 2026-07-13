import { describe, expect, it } from "vitest"
import {
  formatClaudeInputAnswers,
  normalizeClaudeInputQuestions,
} from "../src/main/lib/agent-input/claude-adapter"
import { agentInputRequestSchema } from "../src/shared/agent-input"

describe("Claude structured-input migration baseline", () => {
  it("preserves single, multi, custom, headers, descriptions, and stable IDs", () => {
    const questions = normalizeClaudeInputQuestions([
      {
        question: "Choose a branch",
        header: "Branch",
        options: [{ label: "main", description: "Use the main branch" }],
        multiSelect: false,
      },
      {
        question: "Choose checks",
        header: "Checks",
        options: [{ label: "lint" }, { label: "test" }],
        multiSelect: true,
      },
    ])

    expect(questions).toEqual([
      {
        id: "question-1",
        question: "Choose a branch",
        header: "Branch",
        options: [{ id: "option-1", label: "main", description: "Use the main branch" }],
        multiSelect: false,
        allowCustom: true,
      },
      {
        id: "question-2",
        question: "Choose checks",
        header: "Checks",
        options: [
          { id: "option-1", label: "lint" },
          { id: "option-2", label: "test" },
        ],
        multiSelect: true,
        allowCustom: true,
      },
    ])
    expect(
      formatClaudeInputAnswers(questions, {
        "question-1": ["feature/stage3"],
        "question-2": ["lint", "test"],
      }),
    ).toEqual({
      "Choose a branch": "feature/stage3",
      "Choose checks": "lint, test",
    })
  })

  it("fails closed when Claude sends no usable questions", () => {
    const questions = normalizeClaudeInputQuestions(undefined)
    expect(questions).toEqual([])
    expect(() =>
      agentInputRequestSchema.parse({
        requestId: "tool-1",
        chatId: "chat-1",
        runId: "run-1",
        origin: { harness: "claude-code", toolName: "AskUserQuestion" },
        capability: { mode: "native", sameRun: true },
        questions,
        status: "pending",
        createdAt: 1,
      }),
    ).toThrow()
  })
})
