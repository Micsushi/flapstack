import { z } from "zod"
import { publicProcedure, router } from "../index"

const exportScopeSchema = z.enum(["settings", "history", "project", "full"])

export const importExportRouter = router({
  getCapabilities: publicProcedure.query(() => {
    return {
      enabled: false,
      scopes: ["settings", "history", "project", "full"] as const,
      secrets: "excluded-by-default" as const,
      dryRunImport: true,
    }
  }),

  createExportPlan: publicProcedure
    .input(z.object({ scope: exportScopeSchema, projectId: z.string().optional() }))
    .query(({ input }) => {
      return {
        scope: input.scope,
        projectId: input.projectId ?? null,
        writable: false,
        files: [],
        reason: "Export bundle format and schema-version migration policy are not finalized.",
      }
    }),
})
