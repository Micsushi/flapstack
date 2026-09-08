import { z } from "zod"

export const projectRecordPathSchema = z
  .string()
  .regex(
    /^(?:lanes\/(?:vault|flapstack)\/(?:questions|done)|projects\/[a-z0-9][a-z0-9-]*\/features)\.md$/,
  )
export const projectRecordSchema = z
  .object({
    id: z.string().min(1).max(200),
    title: z.string().min(1).max(1000),
    kind: z.enum(["feature", "question", "outcome"]),
    state: z.string().min(1).max(100),
    history: z.array(z.unknown()),
  })
  .passthrough()
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
