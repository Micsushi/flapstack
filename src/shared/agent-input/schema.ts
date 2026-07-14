import { z } from "zod"
import { AGENT_INPUT_CAPABILITY_MODES } from "./types"

export const AGENT_INPUT_LIMITS = {
  questions: 8,
  optionsPerQuestion: 12,
  questionText: 2_000,
  headerText: 120,
  optionLabel: 200,
  optionDescription: 500,
  answerText: 4_000,
} as const

const boundedText = (max: number) => z.string().trim().min(1).max(max)

export const agentInputOptionSchema = z.object({
  id: boundedText(120),
  label: boundedText(AGENT_INPUT_LIMITS.optionLabel),
  description: boundedText(AGENT_INPUT_LIMITS.optionDescription).optional(),
})

export const agentInputQuestionSchema = z.object({
  id: boundedText(120),
  question: boundedText(AGENT_INPUT_LIMITS.questionText),
  header: boundedText(AGENT_INPUT_LIMITS.headerText).optional(),
  options: z.array(agentInputOptionSchema).max(AGENT_INPUT_LIMITS.optionsPerQuestion),
  multiSelect: z.boolean(),
  allowCustom: z.boolean(),
})

export const agentInputRequestSchema = z
  .object({
    requestId: boundedText(200),
    chatId: boundedText(200),
    runId: boundedText(200),
    origin: z.object({
      harness: boundedText(120),
      provider: boundedText(200).optional(),
      model: boundedText(300).optional(),
      toolName: boundedText(200).optional(),
    }),
    capability: z.object({
      mode: z.enum(AGENT_INPUT_CAPABILITY_MODES),
      sameRun: z.boolean(),
      limitation: boundedText(1_000).optional(),
    }),
    questions: z.array(agentInputQuestionSchema).min(1).max(AGENT_INPUT_LIMITS.questions),
    status: z.literal("pending"),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative().optional(),
  })
  .superRefine((request, context) => {
    const questionIds = new Set<string>()
    for (const [questionIndex, question] of request.questions.entries()) {
      if (questionIds.has(question.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", questionIndex, "id"],
          message: "Question IDs must be unique",
        })
      }
      questionIds.add(question.id)

      if (question.options.length === 0 && !question.allowCustom) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["questions", questionIndex, "options"],
          message: "A question requires an option or custom-answer input",
        })
      }

      const optionIds = new Set<string>()
      for (const [optionIndex, option] of question.options.entries()) {
        if (optionIds.has(option.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["questions", questionIndex, "options", optionIndex, "id"],
            message: "Option IDs must be unique within a question",
          })
        }
        optionIds.add(option.id)
      }
    }
  })

export const agentInputResponseSchema = z.object({
  requestId: boundedText(200),
  mode: z.enum(["structured", "chat"]),
  answers: z.record(
    z
      .array(boundedText(AGENT_INPUT_LIMITS.answerText))
      .max(AGENT_INPUT_LIMITS.optionsPerQuestion + 1),
  ),
  submittedAt: z.number().int().nonnegative(),
})
