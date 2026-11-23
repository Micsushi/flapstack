import { z } from "zod"
import { randomUUID } from "node:crypto"
import {
  AGENT_INPUT_LIMITS as limits,
  type AgentInputQuestion,
  type AgentInputRequest,
  type AgentInputResolution,
} from "../../../../shared/agent-input"
import type { RuntimeAdapterContext } from "../../../../shared/agent-runtime"

const label = z.string().trim().min(1).max(limits.optionLabel)
const options = z.array(label).min(1).max(limits.optionsPerQuestion)
const namedOptions = z
  .array(z.strictObject({ const: z.string(), title: label }))
  .min(1)
  .max(limits.optionsPerQuestion)
const description = { title: z.string().optional(), description: z.string().optional() }
const fields = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("string"),
    ...description,
    enum: options.optional(),
    enumNames: options.optional(),
    oneOf: namedOptions.optional(),
  }),
  z.strictObject({ type: z.literal("boolean"), ...description }),
  z.strictObject({
    type: z.literal("array"),
    ...description,
    items: z.strictObject({
      type: z.literal("string").optional(),
      enum: options.optional(),
      anyOf: namedOptions.optional(),
    }),
  }),
])
const form = z.strictObject({
  type: z.literal("object"),
  ...description,
  properties: z.record(z.string().min(1), fields),
  required: z.array(z.string()).optional(),
  additionalProperties: z.literal(false).optional(),
})

export type AskAntigravityQuestion = (
  request: AgentInputRequest,
  signal: AbortSignal,
) => Promise<AgentInputResolution>

export async function answerAntigravityForm(
  context: RuntimeAdapterContext,
  params: Record<string, unknown>,
  ask: AskAntigravityQuestion,
): Promise<Record<string, unknown>> {
  const cancelled = { action: "cancel" }
  if (!context.subChatId || context.signal.aborted || params.mode !== "form") return cancelled
  const parsed = form.safeParse(params.requestedSchema)
  if (!parsed.success || typeof params.message !== "string" || !params.message.trim())
    return cancelled
  const entries = Object.entries(parsed.data.properties)
  const required = new Set(parsed.data.required ?? [])
  if (
    !entries.length ||
    entries.length > limits.questions ||
    [...required].some((k) => !Object.hasOwn(parsed.data.properties, k))
  )
    return cancelled
  const questions: AgentInputQuestion[] = []
  const encoders: Array<(answers: string[]) => string | boolean | string[] | undefined> = []
  for (const [key, field] of entries) {
    const id = `field-${questions.length + 1}`
    const names =
      field.type === "array" ? field.items.anyOf : field.type === "string" ? field.oneOf : undefined
    const values =
      field.type === "array" ? field.items.enum : field.type === "string" ? field.enum : undefined
    const titles = field.type === "string" ? field.enumNames : undefined
    if ((names && values) || (titles && titles.length !== values?.length)) return cancelled
    const choices =
      names?.map((item) => [item.title, item.const] as const) ??
      values?.map((v, i) => [titles?.[i] ?? v, v] as const) ??
      (field.type === "boolean"
        ? ([
            ["Yes", true],
            ["No", false],
          ] as const)
        : [])
    const mapping = new Map<string, string | boolean>(choices)
    if (mapping.size !== choices.length || (field.type === "array" && !choices.length))
      return cancelled
    const open = field.type === "string" && !choices.length
    const questionOptions = [...mapping.keys()].map((label, i) => ({
      id: `option-${i + 1}`,
      label,
    }))
    // The existing question UI requires an answer. Let users explicitly omit optional fields.
    const omit = !required.has(key) ? "Leave blank" : null
    if (omit && (mapping.has(omit) || questionOptions.length >= limits.optionsPerQuestion))
      return cancelled
    if (omit) questionOptions.push({ id: "omit", label: omit })
    const detail = field.description || field.title || (entries.length > 1 ? key : "")
    const question = [...new Set([params.message, detail].filter(Boolean))].join("\n\n")
    if (question.length > limits.questionText) return cancelled
    questions.push({
      id,
      question,
      options: questionOptions,
      multiSelect: field.type === "array",
      allowCustom: open,
    })
    encoders.push((answers) => {
      if (omit && answers.length === 1 && answers[0] === omit) return undefined
      if (open && answers.length === 1) return answers[0]
      const matched = answers.map((answer) => mapping.get(answer))
      if (!answers.length || matched.includes(undefined))
        throw new Error("Invalid Antigravity form selection.")
      if (field.type === "array") return matched as string[]
      if (matched.length !== 1) throw new Error("Invalid Antigravity form selection.")
      return matched[0]
    })
  }
  const resolution = await ask(
    {
      kind: "question",
      requestId: randomUUID(),
      chatId: context.subChatId,
      runId: context.runId,
      origin: {
        harness: "antigravity",
        provider: "antigravity",
        toolName: "elicitation/create",
        ...(context.launch.model ? { model: context.launch.model } : {}),
      },
      capability: { mode: "native", sameRun: true },
      questions,
      status: "pending",
      createdAt: Date.now(),
    },
    context.signal,
  )
  if (context.signal.aborted || resolution.status !== "answered")
    return { action: resolution.status === "skipped" ? "decline" : "cancel" }
  const content: Array<[string, string | boolean | string[]]> = []
  for (const [index, [key]] of entries.entries()) {
    const value = encoders[index]!(resolution.response.answers[questions[index]!.id] ?? [])
    if (value !== undefined) content.push([key, value])
  }
  return { action: "accept", content: Object.fromEntries(content) }
}
