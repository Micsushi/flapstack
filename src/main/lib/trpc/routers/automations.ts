import { z } from "zod"
import { publicProcedure, router } from "../index"

const automationTriggerSchema = z.enum(["schedule", "file-change", "run-complete", "manual"])

export const automationsRouter = router({
  getCapabilities: publicProcedure.query(() => {
    return {
      enabled: false,
      scheduler: "disabled" as const,
      triggers: ["schedule", "file-change", "run-complete", "manual"] as const,
      requires: ["Stage 3 audit gate", "automation grill-me decisions"],
    }
  }),

  validateDraft: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        trigger: automationTriggerSchema,
        dryRun: z.boolean().default(true),
      }),
    )
    .mutation(({ input }) => {
      return {
        ok: true,
        draft: input,
        runnable: false,
        reason: "Automation scheduler execution is intentionally disabled in scaffold mode.",
      }
    }),
})
