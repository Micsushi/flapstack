import { TRPCError } from "@trpc/server"
import { z } from "zod"
import {
  createDiscussionSchema,
  discussionListSchema,
  discussionScopeSchema,
  restoreDiscussionSchema,
  updateDiscussionSchema,
} from "../../../../shared/discussions"
import { getSqliteDatabase } from "../../db"
import { DiscussionError, DiscussionService } from "../../discussions/service"
import { betaProcedure, router } from "../index"

const procedure = betaProcedure("planning")
const service = () => new DiscussionService(getSqliteDatabase())
function handle<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof DiscussionError)
      throw new TRPCError({ code: error.code, message: error.message })
    throw error
  }
}
export const discussionsRouter = router({
  metadata: procedure.query(() => service().metadata()),
  list: procedure
    .input(discussionListSchema)
    .query(({ input }) => handle(() => service().list(input))),
  read: procedure
    .input(z.object({ scope: discussionScopeSchema, id: z.string().min(1).max(200) }).strict())
    .query(({ input }) => handle(() => service().read(input.scope, input.id))),
  sources: procedure
    .input(
      z
        .object({
          scope: discussionScopeSchema,
          subChatId: z.string().min(1).max(200),
          messageId: z.string().min(1).max(200),
        })
        .strict(),
    )
    .query(({ input }) =>
      handle(() => service().sources(input.scope, input.subChatId, input.messageId)),
    ),
  create: procedure
    .input(createDiscussionSchema)
    .mutation(({ input }) => handle(() => service().create(input))),
  update: procedure.input(updateDiscussionSchema).mutation(({ input }) => {
    if (input.change.type === "followup" && input.change.role !== "user") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Assistant replies must come from a model response",
      })
    }
    return handle(() => service().update(input))
  }),
  restore: procedure
    .input(restoreDiscussionSchema)
    .mutation(({ input }) => handle(() => service().restore(input))),
})
