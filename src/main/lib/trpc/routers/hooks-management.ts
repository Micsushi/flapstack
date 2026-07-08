import { z } from "zod"
import { publicProcedure, router } from "../index"

const hookHarnessSchema = z.enum(["claude-code", "codex"])

export const hooksManagementRouter = router({
  getCapabilities: publicProcedure.query(() => {
    return {
      enabled: false,
      harnesses: ["claude-code", "codex"] as const,
      execution: "disabled" as const,
      reason: "Hook editing requires validation and dry-run policy before enablement.",
    }
  }),

  listTemplates: publicProcedure
    .input(z.object({ harness: hookHarnessSchema.optional() }))
    .query(({ input }) => {
      return {
        harness: input.harness ?? null,
        templates: [],
        status: "scaffolded" as const,
      }
    }),
})
