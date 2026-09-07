import { z } from "zod"
import { betaProcedure, router } from "../index"
import { getDatabase, getDatabasePath, getSqliteDatabase } from "../../db"
import { DiffAnnotationService } from "../../diff-annotations/service"
import { DiffFeedbackService } from "../../diff-annotations/feedback"
import { requireRuntimeLaunchAuthority } from "../../agent-runtime/launch-access"
import { agentInputLifecycle } from "../../agent-input/service"
import { publishLocalProductInvalidation } from "../../mcp-control/invalidation-bridge"
import {
  diffAnnotationScopeSchema,
  createDiffAnnotationSchema,
  changeDiffAnnotationSchema,
  diffAnnotationAnchorSchema,
  diffAnnotationBodySchema,
  diffFeedbackBatchScopeSchema,
  sendDiffFeedbackSchema,
} from "../../../../shared/diff-annotations"

const procedure = betaProcedure("diffAnnotations")
const service = () => new DiffAnnotationService(getDatabase())
export const diffAnnotationsRouter = router({
  send: procedure.input(sendDiffFeedbackSchema).mutation(async ({ input }) => {
    const batch = await new DiffFeedbackService(getSqliteDatabase()).queue(input)
    publishRun(batch)
    return batch
  }),
  cancelFeedback: procedure.input(diffFeedbackBatchScopeSchema).mutation(async ({ input }) => {
    const batch = new DiffFeedbackService(getSqliteDatabase()).getBatchRun(input)
    agentInputLifecycle.cancelByRun(batch.runId, "Feedback run cancelled.")
    const cancelled = await requireRuntimeLaunchAuthority(getDatabasePath()).cancel(
      batch.runId,
      "user-cancelled",
    )
    publishRun(batch)
    return { cancelled }
  }),
  list: procedure.input(diffAnnotationScopeSchema).query(({ input }) => service().list(input)),
  create: procedure
    .input(createDiffAnnotationSchema)
    .mutation(({ input }) => service().create(input)),
  revise: procedure
    .input(
      changeDiffAnnotationSchema.extend({
        anchor: diffAnnotationAnchorSchema,
        body: diffAnnotationBodySchema,
      }),
    )
    .mutation(({ input }) => service().revise(input)),
  setDeleted: procedure
    .input(changeDiffAnnotationSchema.extend({ deleted: z.boolean() }))
    .mutation(({ input }) => service().setDeleted(input)),
})

function publishRun(batch: { runId: string; chatId: string }) {
  publishLocalProductInvalidation({
    version: 1,
    source: "product-mcp",
    domains: ["runs", "chats"],
    chatIds: [batch.chatId],
    runIds: [batch.runId],
  })
}
