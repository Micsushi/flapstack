import { z } from "zod"
import { projectRecordPathSchema } from "../../../shared/project-records"

export const previewRecordChatSchema = z
  .object({
    path: projectRecordPathSchema,
    recordId: z.string().min(1).max(200),
    canonicalProjectId: z.string().min(1).max(200),
    localProjectId: z.string().min(1).max(200),
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    claimId: z.string().min(1).max(200),
  })
  .strict()
export const openRecordChatSchema = previewRecordChatSchema.extend({
  expectedTarget: z.string().regex(/^[a-f0-9]{64}$/),
})
