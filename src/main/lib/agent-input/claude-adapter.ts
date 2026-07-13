import type { AgentInputQuestion } from "../../../shared/agent-input"

/** Translate Claude's AskUserQuestion input without leaking provider shapes into the renderer. */
export function normalizeClaudeInputQuestions(raw: unknown): AgentInputQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw.map((question: any, questionIndex) => ({
    id: `question-${questionIndex + 1}`,
    question:
      typeof question?.question === "string" ? question.question : `Question ${questionIndex + 1}`,
    ...(typeof question?.header === "string" && question.header.trim()
      ? { header: question.header }
      : {}),
    options: Array.isArray(question?.options)
      ? question.options.map((option: any, optionIndex: number) => ({
          id: `option-${optionIndex + 1}`,
          label: typeof option?.label === "string" ? option.label : `Option ${optionIndex + 1}`,
          ...(typeof option?.description === "string" && option.description.trim()
            ? { description: option.description }
            : {}),
        }))
      : [],
    multiSelect: question?.multiSelect === true,
    allowCustom: true,
  }))
}

/** Map the shared response back to the exact question-keyed shape Claude expects. */
export function formatClaudeInputAnswers(
  questions: AgentInputQuestion[],
  answers: Record<string, string[]>,
): Record<string, string> {
  return Object.fromEntries(
    questions.map((question) => [question.question, (answers[question.id] ?? []).join(", ")]),
  )
}
