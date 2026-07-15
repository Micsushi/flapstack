import { agentActivityQuerySchema } from "../../../../shared/agent-activity"
import { z } from "zod"
import { getAgentActivityStore } from "../../agent-runtime/activity-service"
import { publicProcedure, router } from "../index"

export const agentActivityRouter = router({
  list: publicProcedure.input(agentActivityQuerySchema).query(({ input }) => {
    return getAgentActivityStore().query(input)
  }),
  replayRun: publicProcedure
    .input(
      z.object({
        runId: z.string().trim().min(1).max(512),
        afterSequence: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(10_000).default(500),
      }),
    )
    .query(({ input }) => {
      return getAgentActivityStore().replayRun(input.runId, input.afterSequence, input.limit)
    }),
  export: publicProcedure.input(agentActivityQuerySchema).query(({ input }) => {
    return getAgentActivityStore().export(input)
  }),
})
