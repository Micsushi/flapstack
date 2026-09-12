import { z } from "zod"

export const projectRecordPathSchema = z
  .string()
  .regex(
    /^(?:lanes\/(?:vault|flapstack)\/(?:questions|done|tasks)|projects\/[a-z0-9][a-z0-9-]*\/features)\.md$/,
  )
export const projectBlockerDetailsSchema = z.object({
  category: z.enum([
    "authority",
    "access",
    "credentials",
    "environment",
    "external_dependency",
    "review_budget",
    "decision",
  ]),
  affectedWork: z.array(z.string()),
  cause: z.string().trim().min(1),
  missingPrerequisite: z.string().trim().min(1),
  whyAgentCannotResolve: z.string().trim().min(1),
  resolutionSteps: z.array(z.string().trim().min(1)).min(1),
  attemptedResolutions: z.array(z.string()),
  evidence: z.array(z.string()),
  independentWork: z.array(z.string()),
  ownerAction: z.string().trim().min(1).nullable(),
  continuationPrompt: z
    .string()
    .refine((value) => value.trim().length > 0)
    .optional(),
  resolutionVerification: z.array(z.string().trim().min(1)).min(1),
  sourceLinks: z.array(z.string()),
  questionIds: z.array(z.string()),
  resolutionEvidence: z.array(z.string().trim().min(1)).optional(),
})
const nonblank = z.string().refine((value) => value.trim().length > 0)
export const projectQuestionReviewSchema = z
  .object({
    reviewedAnswer: nonblank,
    reviewedAnswerSource: z.enum(["owner", "ai"]).nullable(),
    status: z.enum(["confirmed", "follow_up"]),
    note: nonblank,
  })
  .passthrough()
export const projectQuestionFollowUpSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(1000),
    state: z.enum(["open", "answered", "resolved_independently", "superseded", "agent_research"]),
    context: z.string(),
    choices: z.array(z.string()),
    recommendation: z.string(),
    draft: z.string(),
    answer: z.string(),
    affectedWork: z.array(z.string()),
    answerSource: z.enum(["owner", "ai"]).nullish(),
    agentReview: projectQuestionReviewSchema.nullish(),
    followUps: z.null().optional(),
  })
  .passthrough()
const questionFollowUpsSchema = z.array(projectQuestionFollowUpSchema).superRefine((items, ctx) => {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.id))
      ctx.addIssue({
        code: "custom",
        path: [index, "id"],
        message: "Follow-up IDs must be unique within this question",
      })
    seen.add(item.id)
  })
})
export const projectRecordSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(1000),
    kind: z.enum(["feature", "question", "outcome", "blocker", "task", "note", "decision"]),
    state: z.string().min(1).max(100),
    history: z.array(z.unknown()),
    agentReview: projectQuestionReviewSchema.nullish(),
    followUps: questionFollowUpsSchema.nullish(),
  })
  .passthrough()
  .superRefine((record, context) => {
    if (record.kind !== "blocker") return
    const result = projectBlockerDetailsSchema.safeParse(record)
    if (!result.success) {
      for (const issue of result.error.issues) context.addIssue(issue)
    }
    if (!["blocked", "resolved", "superseded"].includes(record.state)) {
      context.addIssue({ code: "custom", path: ["state"], message: "Invalid blocker state" })
    }
    if (record.state === "resolved" && !result.data?.resolutionEvidence?.length) {
      context.addIssue({
        code: "custom",
        path: ["resolutionEvidence"],
        message: "Blocker resolution requires evidence",
      })
    }
  })
export const projectRecordDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string(),
  records: z.array(projectRecordSchema).max(10_000),
})
export const projectRecordSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  path: projectRecordPathSchema,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  document: projectRecordDocumentSchema,
})
export const projectRecordIndexSchema = z.object({
  schemaVersion: z.literal(1),
  documents: z
    .array(
      z.object({
        path: projectRecordPathSchema,
        title: z.string(),
        revision: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(10_000),
})
export const patchProjectRecordSchema = z
  .object({
    path: projectRecordPathSchema,
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    recordId: z.string().min(1).max(200),
    changes: z.record(z.unknown()),
  })
  .strict()
export type ProjectRecord = z.infer<typeof projectRecordSchema>
export type ProjectQuestionFollowUp = z.infer<typeof projectQuestionFollowUpSchema>
export function questionNeedsOwner(record: ProjectRecord): boolean {
  return record.state === "open" || !!record.followUps?.some((child) => child.state === "open")
}
export function questionReviewState(record: {
  answer?: unknown
  answerSource?: unknown
  agentReview?: z.infer<typeof projectQuestionReviewSchema> | null
}): "unrecorded" | "stale" | "confirmed" | "follow_up" {
  const review = record.agentReview
  if (!review) return "unrecorded"
  const source =
    record.answerSource === "owner" || record.answerSource === "ai" ? record.answerSource : null
  return review.reviewedAnswer === record.answer && review.reviewedAnswerSource === source
    ? review.status
    : "stale"
}
export type ProjectRecordSnapshot = z.infer<typeof projectRecordSnapshotSchema>
export type ProjectRecordPatch = z.infer<typeof patchProjectRecordSchema>
export type ProjectRecordWriteResult = {
  conflict: boolean
  snapshot: ProjectRecordSnapshot
}

// Yap source/proposal contracts are intentionally independent of legacy chat
// attachment/task foreign keys.  A source instance keeps identity/order even
// when two instances point at the same immutable content-addressed bytes.
export const yapAttachmentSourceSchema = z
  .object({
    attachmentId: z.string().min(1).max(160),
    sourceId: z.string().min(1).max(160),
    order: z.number().int().nonnegative(),
    name: z.string().min(1).max(240),
    mime: z.string().regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/),
    byteLength: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    origin: z.record(z.unknown()).nullable().optional(),
    status: z.enum(["complete", "missing", "failed"]),
    instructionText: z.string().optional(),
  })
  .strict()

export const yapSourceSegmentSchema = z
  .object({
    id: z.string().min(1).max(160),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    text: z.string(),
  })
  .strict()

export const yapInputSchema = z
  .object({
    inputId: z.string().min(1).max(160),
    version: z.number().int().positive(),
    creatorId: z.string().min(1),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    originalText: z.string(),
    segments: z.array(yapSourceSegmentSchema),
    attachments: z.array(yapAttachmentSourceSchema),
    origin: z.record(z.unknown()).nullable().optional(),
    sourceValidity: z
      .object({
        valid: z.boolean(),
        invalidAttachmentIds: z.array(z.string()),
        reason: z.string().optional(),
      })
      .optional(),
    reviewable: z.boolean().optional(),
  })
  .passthrough()

export const yapProposalRowSchema = z
  .object({
    id: z.string().min(1).max(160),
    actionId: z.string().nullable().optional(),
    sourceSegmentIds: z.array(z.string()),
    sourceImageIds: z.array(z.string()),
    interpretedRequest: z.string(),
    projectId: z.string().nullable(),
    projectName: z.string().nullable().optional(),
    action: z.unknown().optional(),
    destination: z.unknown().optional(),
    uncertainty: z.boolean(),
    uncertaintyReason: z.string().nullable().optional(),
    instructionText: z.string().optional(),
  })
  .passthrough()

export const yapProposalActionSchema = z
  .object({
    id: z.string().min(1).max(160),
    kind: z.string().min(1),
    destination: z.unknown().optional(),
    rowIds: z.array(z.string()),
    executable: z.literal(false),
  })
  .passthrough()

export const yapProposalSchema = z
  .object({
    proposalId: z.string().min(1).max(160),
    version: z.number().int().positive(),
    creatorId: z.string().min(1),
    inputId: z.string().min(1).max(160),
    inputVersion: z.number().int().positive(),
    inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
    rows: z.array(yapProposalRowSchema),
    actions: z.array(yapProposalActionSchema),
    status: z.enum([
      "draft",
      "proposed",
      "reviewed",
      "approved",
      "applying",
      "applied",
      "partially-applied",
      "cancelled",
      "reconciliation-required",
    ]),
    executable: z.literal(false),
    sourceValidity: z
      .object({
        valid: z.boolean(),
        invalidAttachmentIds: z.array(z.string()),
        reason: z.string().optional(),
      })
      .optional(),
    reviewable: z.boolean().optional(),
  })
  .passthrough()

export const yapUploadStartSchema = z
  .object({
    name: z.string().min(1).max(240),
    mime: z.string().min(3).max(255),
    byteLength: z.number().int().positive(),
    totalChunks: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: z.string().min(1).max(200).optional(),
  })
  .strict()

export const yapUploadSchema = z
  .object({
    uploadId: z.string().min(1).max(160),
    creatorId: z.string().min(1),
    idempotencyKey: z.string().nullable().optional(),
    name: z.string().min(1).max(240),
    mime: z.string().min(3).max(255),
    byteLength: z.number().int().positive(),
    totalChunks: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    receivedChunks: z.array(z.number().int().nonnegative()),
    receivedBytes: z.number().int().nonnegative(),
    status: z.enum(["staging", "complete", "failed"]),
    error: z.string().optional(),
  })
  .passthrough()

export type YapAttachmentSource = z.infer<typeof yapAttachmentSourceSchema>
export type YapInput = z.infer<typeof yapInputSchema>
export type YapProposalRow = z.infer<typeof yapProposalRowSchema>
export type YapProposal = z.infer<typeof yapProposalSchema>
export type YapUpload = z.infer<typeof yapUploadSchema>
