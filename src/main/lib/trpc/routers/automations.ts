import { automationDraftSchema, automationTriggerTypes } from "../../../../shared/automation"
import { publicProcedure, router } from "../index"

export const automationsRouter = router({
  getCapabilities: publicProcedure.query(() => {
    return {
      enabled: false,
      scheduler: "disabled" as const,
      triggers: automationTriggerTypes,
      requires: ["Stage 3 approval/audit gate", "local scheduler service"],
    }
  }),

  validateDraft: publicProcedure.input(automationDraftSchema).mutation(({ input }) => {
    return {
      ok: true,
      draft: input,
      runnable: false,
      reason: "Automation scheduler execution is intentionally disabled in scaffold mode.",
    }
  }),
})
