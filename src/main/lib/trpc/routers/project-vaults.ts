import { z } from "zod"
import { app } from "electron"
import { publicProcedure, router } from "../index"
import { getDatabase } from "../../db"
import {
  getOrCreateProjectVaultPolicy,
  updateProjectVaultPolicy,
  vaultLocationModes,
} from "../../project-vaults/policy"
import {
  deleteProjectVault,
  getProjectVaultDeleteContract,
  listProjectVaultSections,
  readProjectVaultSection,
  scaffoldProjectVault,
  writeProjectVaultSection,
} from "../../project-vaults/storage"
import { projectVaultSectionIds, projectVaultSectionRegistry } from "../../project-vaults/registry"
import {
  getProjectVaultContextSelection,
  updateProjectVaultContextSelection,
} from "../../project-vaults/run-context"

const sectionSchema = z.enum(projectVaultSectionIds)
const deleteContractSchema = z.object({
  kind: z.literal("delete-project-knowledge-vault"),
  projectId: z.string().min(1),
  rootPath: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  sectionVersions: z.array(
    z.object({
      sectionId: z.string().min(1),
      version: z.number().int().positive(),
      contentHash: z.string().length(64),
    }),
  ),
  requiredPhrase: z.string().min(1),
})

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

  getSectionRegistry: publicProcedure.query(() =>
    projectVaultSectionRegistry.map(({ initialContent: _initialContent, ...section }) => section),
  ),

  getContextSelection: publicProcedure
    .input(z.object({ projectId: z.string().min(1), taskId: z.string().min(1).optional() }))
    .query(({ input }) => getProjectVaultContextSelection(getDatabase(), input)),

  updateContextSelection: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        taskId: z.string().min(1).optional(),
        // Null is valid only for tasks and means inherit the project selection.
        sectionIds: z.array(sectionSchema).nullable(),
      }),
    )
    .mutation(({ input }) => updateProjectVaultContextSelection(getDatabase(), input)),

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
        enabled: true,
        secretsPolicy: "exclude-by-default" as const,
      }
    }),

  scaffold: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        sections: z.array(sectionSchema).min(1).default(["index", "handoff"]),
      }),
    )
    .mutation(({ input }) =>
      scaffoldProjectVault(getDatabase(), {
        ...input,
        appDataRoot: app.getPath("userData"),
      }),
    ),

  listSections: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(({ input }) => listProjectVaultSections(getDatabase(), input.projectId)),

  readSection: publicProcedure
    .input(z.object({ projectId: z.string().min(1), sectionId: sectionSchema }))
    .query(({ input }) => readProjectVaultSection(getDatabase(), input)),

  writeSection: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        sectionId: sectionSchema,
        expectedVersion: z.number().int().positive(),
        content: z.string(),
      }),
    )
    .mutation(({ input }) => writeProjectVaultSection(getDatabase(), input)),

  getDeleteContract: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(({ input }) => getProjectVaultDeleteContract(getDatabase(), input.projectId)),

  deleteVault: publicProcedure
    .input(
      z.object({
        contract: deleteContractSchema,
        confirmationPhrase: z.string(),
      }),
    )
    .mutation(({ input }) => deleteProjectVault(getDatabase(), input)),
})
