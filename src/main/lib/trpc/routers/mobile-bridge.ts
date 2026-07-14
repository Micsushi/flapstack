import { z } from "zod"
import { publicProcedure, router } from "../index"
import { getAppMobileBridgeService } from "../../mobile-bridge"

export const mobileBridgeRouter = router({
  getStatus: publicProcedure.query(() => getAppMobileBridgeService().getStatus()),

  configure: publicProcedure
    .input(
      z
        .object({
          enabled: z.boolean(),
          bindAddress: z.string().trim().min(1).max(128).nullable().optional(),
          port: z.number().int().min(1024).max(65_535).optional(),
        })
        .strict(),
    )
    .mutation(({ input }) => getAppMobileBridgeService().configure(input)),
})
