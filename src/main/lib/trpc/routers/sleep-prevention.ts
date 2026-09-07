import { z } from "zod"
import { SLEEP_PREVENTION_MODES } from "../../../../shared/sleep-prevention"
import { getSleepPreventionStatus, setSleepPreventionMode } from "../../sleep-prevention/service"
import { publicProcedure, router } from "../index"

export const sleepPreventionRouter = router({
  status: publicProcedure.query(() => getSleepPreventionStatus()),
  setMode: publicProcedure
    .input(
      z.object({
        mode: z.enum(SLEEP_PREVENTION_MODES),
        expectedMode: z.enum(SLEEP_PREVENTION_MODES),
      }),
    )
    .mutation(({ input }) => {
      if (getSleepPreventionStatus().mode !== input.expectedMode) {
        throw new Error("Sleep preference changed in another window. Refresh and retry.")
      }
      return setSleepPreventionMode(input.mode)
    }),
})
