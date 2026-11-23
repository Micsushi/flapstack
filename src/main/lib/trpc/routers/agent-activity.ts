import { agentActivityQuerySchema } from "../../../../shared/agent-activity"
import { and, desc, eq } from "drizzle-orm"
import { agentRuns, getDatabase } from "../../db"
import { z } from "zod"
import { getAgentActivityStore } from "../../agent-runtime/activity-service"
import { publicProcedure, router } from "../index"

export const agentActivityRouter = router({
  localRunStatuses: publicProcedure
    .input(z.object({ chatId: z.string().trim().min(1).max(512) }))
    .query(({ input }) => {
      const rows = getDatabase()
        .select({
          id: agentRuns.id,
          status: agentRuns.status,
          startedAt: agentRuns.startedAt,
          completedAt: agentRuns.completedAt,
        })
        .from(agentRuns)
        .where(and(eq(agentRuns.chatId, input.chatId), eq(agentRuns.harness, "local")))
        .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
        .limit(501)
        .all()
      return {
        runs: rows
          .slice(0, 500)
          .reverse()
          .map((row) => ({
            ...row,
            startedAt: row.startedAt?.getTime() ?? null,
            completedAt: row.completedAt?.getTime() ?? null,
          })),
        hasMore: rows.length > 500,
      }
    }),
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
