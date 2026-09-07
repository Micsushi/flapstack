import { z } from "zod"

export const diffAnnotationScopeSchema = z.object({
  projectId: z.string().min(1).max(200),
  chatId: z.string().min(1).max(200),
})
export const diffAnnotationAnchorSchema = z
  .object({
    diffHash: z.string().regex(/^[a-f0-9]{64}$/),
    filePath: z
      .string()
      .min(1)
      .max(4096)
      .refine(
        (value) =>
          !/^[A-Za-z]:|^[\/\\]|[\x00-\x1f\\]/.test(value) &&
          !value.split("/").some((part) => part === ".." || part === "." || part === ""),
        "Use a relative diff file path",
      ),
    side: z.enum(["left", "right"]),
    startLine: z.number().int().min(1).max(10_000_000),
    endLine: z.number().int().min(1).max(10_000_000),
  })
  .refine(
    (value) => value.endLine >= value.startLine && value.endLine - value.startLine < 1000,
    "Select at most 1,000 consecutive lines",
  )
export const diffAnnotationBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(16_384)
  .refine((value) => new TextEncoder().encode(value).byteLength <= 16_384, "Comment exceeds 16 KiB")
export const createDiffAnnotationSchema = diffAnnotationScopeSchema.extend({
  id: z.string().uuid(),
  anchor: diffAnnotationAnchorSchema,
  body: diffAnnotationBodySchema,
})
export const changeDiffAnnotationSchema = diffAnnotationScopeSchema.extend({
  id: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
})
export const diffFeedbackLimits = { comments: 25, promptBytes: 512 * 1024 } as const
export const sendDiffFeedbackSchema = diffAnnotationScopeSchema.extend({
  id: z.string().uuid(),
  subChatId: z.string().min(1).max(200),
  comments: z
    .array(z.object({ id: z.string().uuid(), version: z.number().int().positive() }))
    .min(1)
    .max(diffFeedbackLimits.comments)
    .refine(
      (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
      "Select each comment once",
    ),
})
export type DiffAnnotationScope = z.infer<typeof diffAnnotationScopeSchema>
export type DiffAnnotationAnchor = z.infer<typeof diffAnnotationAnchorSchema>
export type DiffAnnotationDto = DiffAnnotationScope &
  DiffAnnotationAnchor & {
    id: string
    body: string
    version: number
    deletedAt: number | null
    createdAt: number
    updatedAt: number
    freshness: "current" | "stale" | "unverified"
    lastFeedbackBatchId?: string | null
    lastFeedbackVersion?: number | null
    feedback?: { batchId: string; subChatId: string; runId: string; status: string } | null
  }
