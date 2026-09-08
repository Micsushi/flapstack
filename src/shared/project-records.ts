import { z } from "zod"

export const projectRecordPathSchema = z
  .string()
  .regex(
    /^(?:lanes\/(?:vault|flapstack)\/(?:questions|done)|projects\/[a-z0-9][a-z0-9-]*\/features)\.md$/,
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
  resolutionVerification: z.array(z.string().trim().min(1)).min(1),
  sourceLinks: z.array(z.string()),
  questionIds: z.array(z.string()),
  resolutionEvidence: z.array(z.string().trim().min(1)).optional(),
})
export const projectRecordSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(1000),
    kind: z.enum(["feature", "question", "outcome", "blocker"]),
    state: z.string().min(1).max(100),
    history: z.array(z.unknown()),
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
export type ProjectRecordSnapshot = z.infer<typeof projectRecordSnapshotSchema>
export type ProjectRecordPatch = z.infer<typeof patchProjectRecordSchema>
export type ProjectRecordWriteResult = {
  conflict: boolean
  snapshot: ProjectRecordSnapshot
}
