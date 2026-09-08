import { z } from "zod"

const id = z.string().trim().min(1).max(200)
const body = z.string().trim().min(1).max(16_384)
export const discussionScopeSchema = z
  .object({
    projectId: id,
    chatId: id.nullable().default(null),
    hostId: id,
  })
  .strict()
export const discussionListSchema = z
  .object({
    scope: discussionScopeSchema,
    limit: z.number().int().min(1).max(20).default(20),
    cursor: z.object({ updatedAt: z.number().int().nonnegative(), id }).strict().optional(),
  })
  .strict()
export const discussionSourceSchema = z
  .object({
    subChatId: id,
    messageId: id,
    role: z.enum(["user", "assistant"]),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    target: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("text"),
          quote: body,
          start: z.number().int().nonnegative(),
          end: z.number().int().positive(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("image"),
          partIndex: z.number().int().nonnegative(),
          imageIdentity: id,
          region: z
            .object({
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              width: z.number().positive().max(1),
              height: z.number().positive().max(1),
            })
            .strict()
            .refine((r) => r.x + r.width <= 1 && r.y + r.height <= 1),
        })
        .strict(),
    ]),
  })
  .strict()
export const discussionCaptureSchema = z
  .object({
    body,
    kind: z.enum(["fix", "idea", "note"]),
    source: discussionSourceSchema.optional(),
  })
  .strict()
export const discussionQuestionSchema = z
  .object({
    prompt: body,
    choices: z.array(z.object({ id, label: body }).strict()).max(12),
    blocking: z.boolean().default(false),
  })
  .strict()
export const discussionAnswerSchema = z
  .object({ choiceIds: z.array(id).max(12), text: z.string().max(16_384) })
  .strict()
export const discussionChangeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("capture"), capture: discussionCaptureSchema }).strict(),
  z.object({ type: z.literal("summary"), summary: z.string().trim().max(2000) }).strict(),
  z.object({ type: z.literal("question"), question: discussionQuestionSchema }).strict(),
  z.object({ type: z.literal("draft"), questionId: id, answer: discussionAnswerSchema }).strict(),
  z.object({ type: z.literal("answer"), questionId: id, answer: discussionAnswerSchema }).strict(),
  z.object({ type: z.literal("annotation"), source: discussionSourceSchema, body }).strict(),
  z
    .object({
      type: z.literal("followup"),
      annotationId: id,
      body,
      role: z.enum(["user", "assistant"]),
      model: z.string().trim().min(1).max(512).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("promote"),
      annotationId: id,
      title: z.string().trim().min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("status"),
      status: z.enum(["more-work", "needs-help", "blocked", "done"]),
    })
    .strict(),
  z.object({ type: z.literal("read"), read: z.boolean() }).strict(),
  z.object({ type: z.literal("archive"), archived: z.boolean() }).strict(),
  z.object({ type: z.literal("link"), canonicalRecordId: id }).strict(),
])
export const createDiscussionSchema = z
  .object({
    scope: discussionScopeSchema,
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(2000).default(""),
    capture: discussionCaptureSchema,
  })
  .strict()
export const updateDiscussionSchema = z
  .object({
    scope: discussionScopeSchema,
    id,
    expectedRevision: z.number().int().positive(),
    change: discussionChangeSchema,
  })
  .strict()
export const restoreDiscussionSchema = updateDiscussionSchema
  .omit({ change: true })
  .extend({ targetRevision: z.number().int().positive() })
  .strict()
export const captureMixedSchema = z
  .object({
    scope: discussionScopeSchema,
    body: z
      .string()
      .min(1)
      .max(6000)
      .refine((value) => value.trim().length > 0),
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
export const restoreMixedSchema = z
  .object({
    scope: discussionScopeSchema,
    changes: z
      .array(
        z
          .object({
            id,
            expectedRevision: z.number().int().positive(),
            targetRevision: z.number().int().positive().nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(9),
  })
  .strict()
export type MixedCaptureState = {
  state: "grouped" | "unsorted"
  dedupStatus: "available" | "unavailable"
  warning: string | null
  model: string | null
  topicIds: string[]
  review?: { model: string; repairs: number }
}
export type DiscussionCaptureSpan = { id: string; start: number; end: number; text: string }
export type MixedCaptureResult = Omit<MixedCaptureState, "topicIds"> & {
  topics: DiscussionTopic[]
  originalTopicId: string
  undo: z.infer<typeof restoreMixedSchema>
}
export type DiscussionScope = z.infer<typeof discussionScopeSchema>
export type DiscussionSource = z.infer<typeof discussionSourceSchema>
export type DiscussionAnswer = z.infer<typeof discussionAnswerSchema>
export type DiscussionChange = z.infer<typeof discussionChangeSchema>
export type DiscussionTopic = {
  id: string
  scope: DiscussionScope
  title: string
  summary: string
  revision: number
  createdAt: number
  updatedAt: number
  archived: boolean
  read: boolean
  status: "more-work" | "needs-help" | "blocked" | "done"
  captures: Array<
    z.infer<typeof discussionCaptureSchema> & {
      id: string
      createdAt: number
      origin?: { topicId: string; captureId: string; start: number; end: number }
    }
  >
  captureBatch?: MixedCaptureState
  summaryHistory: Array<{ summary: string; createdAt: number }>
  questions: Array<
    z.infer<typeof discussionQuestionSchema> & {
      id: string
      createdAt: number
      draft: DiscussionAnswer
      answers: Array<DiscussionAnswer & { createdAt: number }>
    }
  >
  annotations: Array<{
    id: string
    source: DiscussionSource
    body: string
    createdAt: number
    followups: Array<{
      id: string
      body: string
      role: "user" | "assistant"
      createdAt: number
      model?: string
    }>
    promotedTopicId: string | null
  }>
  canonicalRecordIds: string[]
  promotedFrom: { topicId: string; annotationId: string } | null
}
