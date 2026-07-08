import { z } from "zod"
import { publicProcedure, router } from "../index"

export const usageRouter = router({
  getCapabilities: publicProcedure.query(() => {
    return {
      enabled: false,
      normalizedFields: ["inputTokens", "outputTokens", "totalTokens", "costUsd"],
      rawProviderPayload: true,
      reason:
        "Usage capture is scaffolded; provider normalization and cost table policy are not decided yet.",
    }
  }),

  summarizeRun: publicProcedure.input(z.object({ runId: z.string() })).query(({ input }) => {
    return {
      runId: input.runId,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
      status: "not-captured" as const,
    }
  }),
})
