import { z } from "zod"
import { publicProcedure, router } from "../index"

export const spawnedAgentsRouter = router({
  getPolicy: publicProcedure.query(() => {
    return {
      enabled: false,
      spawnTier: 3,
      maxDepth: 0,
      maxChildrenPerRun: 0,
      requiresApproval: true,
      reason: "Spawning remains disabled until budget, lineage, and kill policies are finalized.",
    }
  }),

  previewLineage: publicProcedure.input(z.object({ chatId: z.string() })).query(({ input }) => {
    return {
      chatId: input.chatId,
      nodes: [],
      edges: [],
      status: "no-lineage-schema" as const,
    }
  }),
})
