import { z } from "zod"
import { publicProcedure, router } from "../index"

const sectionSchema = z.enum(["index", "handoff", "decisions", "context", "tasks", "logs"])

export const projectVaultsRouter = router({
  getSectionRegistry: publicProcedure.query(() => {
    return [
      { id: "index", label: "Index", autoLoad: true },
      { id: "handoff", label: "Current Handoff", autoLoad: true },
      { id: "decisions", label: "Decision Log", autoLoad: false },
      { id: "context", label: "Durable Context", autoLoad: false },
      { id: "tasks", label: "Task Notes", autoLoad: false },
      { id: "logs", label: "Run Logs", autoLoad: false },
    ]
  }),

  getScaffoldPlan: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        sections: z.array(sectionSchema).default(["index", "handoff"]),
      }),
    )
    .query(({ input }) => {
      return {
        projectId: input.projectId,
        sections: input.sections,
        enabled: false,
        secretsPolicy: "exclude-by-default" as const,
        reason: "Vault location and tracking policy must be decided before files are created.",
      }
    }),
})
