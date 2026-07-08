import { z } from "zod"
import { futureStageIds } from "../../../../shared/future-stage-types"
import {
  getFutureStageCapability,
  listFutureStageCapabilities,
} from "../../future-stage/capabilities"
import { publicProcedure, router } from "../index"

const futureStageIdSchema = z.enum(futureStageIds)

export const futureStagesRouter = router({
  listCapabilities: publicProcedure.query(() => {
    return listFutureStageCapabilities()
  }),

  getCapability: publicProcedure.input(z.object({ id: futureStageIdSchema })).query(({ input }) => {
    return getFutureStageCapability(input.id)
  }),
})
