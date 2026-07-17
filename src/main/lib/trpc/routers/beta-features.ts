import { z } from "zod"
import { BETA_FEATURE_IDS } from "../../../../shared/beta-features"
import { getBetaFeatureSettings, setBetaFeatureEnabled } from "../../beta-features/settings"
import { publicProcedure, router } from "../index"

export const betaFeaturesRouter = router({
  get: publicProcedure.query(() => getBetaFeatureSettings()),
  set: publicProcedure
    .input(z.object({ feature: z.enum(BETA_FEATURE_IDS), enabled: z.boolean() }))
    .mutation(({ input }) => setBetaFeatureEnabled(input.feature, input.enabled)),
})
