import { z } from "zod"
import { app } from "electron"
import { publicProcedure, router } from "../index"
import { getDatabase } from "../../db"
import {
  getOrCreateProjectVaultPolicy,
  updateProjectVaultPolicy,
  vaultLocationModes,
} from "../../project-vaults/policy"

const sectionSchema = z.enum(["index", "handoff", "decisions", "context", "tasks", "logs"])

export const projectVaultsRouter = router({
  getPolicy: publicProcedure.input(z.object({ projectId: z.string().min(1) })).query(({ input }) =>
    getOrCreateProjectVaultPolicy(getDatabase(), {
      projectId: input.projectId,
      appDataRoot: app.getPath("userData"),
    }),
  ),

  updatePolicy: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        locationMode: z.enum(vaultLocationModes),
        projectOwnedOptIn: z.literal(true).optional(),
        gitTrackingEnabled: z.boolean().default(false),
        gitTrackingOptIn: z.literal(true).optional(),
      }),
    )
    .mutation(({ input }) =>
      updateProjectVaultPolicy(getDatabase(), {
        ...input,
        appDataRoot: app.getPath("userData"),
      }),
    ),

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
      const policy = getOrCreateProjectVaultPolicy(getDatabase(), {
        projectId: input.projectId,
        appDataRoot: app.getPath("userData"),
      })
      return {
        projectId: input.projectId,
        sections: input.sections,
        policy,
        enabled: false,
        secretsPolicy: "exclude-by-default" as const,
        reason: "Vault section storage is not implemented yet.",
      }
    }),
})
