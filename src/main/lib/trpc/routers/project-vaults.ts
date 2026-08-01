import { z } from "zod"
import { app } from "electron"
import { betaProcedure, router } from "../index"

const publicProcedure = betaProcedure("projectMemory")
import { getDatabase } from "../../db"
import {
  getOrCreateProjectVaultPolicy,
  updateProjectVaultPolicy,
  vaultLocationModes,
} from "../../project-vaults/policy"
import {
  adoptExternalProjectVaultSectionChange,
  deleteProjectVault,
  getProjectVaultDeleteContract,
  listProjectVaultSectionBackups,
  listProjectVaultSections,
  readProjectVaultSectionBackup,
  restoreProjectVaultSectionBackup,
  scaffoldProjectVault,
  writeProjectVaultSection,
} from "../../project-vaults/storage"
import { readProjectVaultSectionForPreview, searchProjectVault } from "../../project-vaults/browser"
import { assertProjectVaultContentSafe } from "../../project-vaults/content-safety"
import { projectVaultSectionIds, projectVaultSectionRegistry } from "../../project-vaults/registry"
import {
  getProjectVaultContextSelection,
  updateProjectVaultContextSelection,
} from "../../project-vaults/run-context"
import { publishLocalProjectVaultInvalidation } from "../../mcp-control/invalidation-bridge"
import { currentProjectVaultGraph, projectVaultGraphIndex } from "../../project-vaults/graph-index"
import { ProjectVaultCustomNotes } from "../../project-vaults/custom-notes"
import { openProjectVaultInObsidian } from "../../project-vaults/obsidian-open"
import { buildProjectVaultGraphContext } from "../../project-vaults/graph-context"

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
    .mutation(async ({ input }) => {
      const database = getDatabase()
      const result = await scaffoldProjectVault(database, {
        ...input,
        appDataRoot: app.getPath("userData"),
      })
      void projectVaultGraphIndex(database)
        .scheduleRebuild(input.projectId)
        .catch(() => undefined)
      return result
    }),

  listSections: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(({ input }) => listProjectVaultSections(getDatabase(), input.projectId)),

  rebuildGraph: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const index = projectVaultGraphIndex(getDatabase())
      const result = await index.rebuild(input.projectId)
      await index.startWatching(input.projectId)
      return result
    }),

  openInObsidian: publicProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(({ input }) => openProjectVaultInObsidian(getDatabase(), input.projectId)),

  getGraph: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        query: z.string().trim().max(500).optional(),
        focusNodeId: z.string().trim().min(1).max(200).optional(),
        scope: z.enum(["local", "whole"]).default("whole"),
        noteType: z.string().trim().max(80).optional(),
        tag: z.string().trim().max(200).optional(),
        folder: z.string().trim().max(1_000).optional(),
        linkState: z.enum(["resolved", "unresolved", "ambiguous"]).optional(),
      }),
    )
    .query(async ({ input }) => {
      const database = getDatabase()
      await projectVaultGraphIndex(database).startWatching(input.projectId)
      const graph = currentProjectVaultGraph(database, input.projectId)
      const matchedNodes = (input.query ? graph.search(input.query) : graph.nodes).filter(
        (node) =>
          (!input.noteType || node.noteType === input.noteType) &&
          (!input.tag || node.tags.includes(input.tag)) &&
          (!input.folder ||
            node.relativePath === input.folder ||
            node.relativePath.startsWith(`${input.folder.replace(/\/+$/, "")}/`)) &&
          (!input.linkState ||
            graph.edges.some(
              (edge) =>
                edge.status === input.linkState &&
                (edge.sourceNodeId === node.nodeId || edge.targetNodeId === node.nodeId),
            )),
      )
      const selectedIds = new Set(
        input.scope === "local" && input.focusNodeId
          ? [input.focusNodeId]
          : matchedNodes.map((node) => node.nodeId),
      )
      if (input.scope === "local" && input.focusNodeId) {
        selectedIds.add(input.focusNodeId)
        for (const edge of graph.edges) {
          if (edge.sourceNodeId === input.focusNodeId && edge.targetNodeId) {
            selectedIds.add(edge.targetNodeId)
          }
          if (edge.targetNodeId === input.focusNodeId) selectedIds.add(edge.sourceNodeId)
        }
      }
      return {
        generationId: graph.generationId,
        nodes: graph.nodes.filter((node) => selectedIds.has(node.nodeId)),
        edges: graph.edges.filter(
          (edge) =>
            selectedIds.has(edge.sourceNodeId) &&
            (edge.targetNodeId === null || selectedIds.has(edge.targetNodeId)),
        ),
      }
    }),

  createNote: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          title: z.string().min(1).max(200),
          body: z.string().max(1_048_576).optional(),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const database = getDatabase()
      const result = await new ProjectVaultCustomNotes(database).create(input)
      await projectVaultGraphIndex(database).scheduleRebuild(input.projectId)
      return result
    }),

  readNote: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
        })
        .strict(),
    )
    .query(({ input }) =>
      new ProjectVaultCustomNotes(getDatabase()).read(input.projectId, input.relativePath),
    ),

  updateNote: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          expectedVersion: z.number().int().positive(),
          expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
          content: z.string().max(1_048_576),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const database = getDatabase()
      const result = await new ProjectVaultCustomNotes(database).update(input)
      await projectVaultGraphIndex(database).scheduleRebuild(input.projectId)
      return result
    }),

  renameNote: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          newName: z.string().min(1).max(255),
          expectedVersion: z.number().int().positive(),
          expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const database = getDatabase()
      const result = await new ProjectVaultCustomNotes(database).rename(input)
      await projectVaultGraphIndex(database).scheduleRebuild(input.projectId)
      return result
    }),

  removeNote: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          expectedVersion: z.number().int().positive(),
          expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const database = getDatabase()
      const result = await new ProjectVaultCustomNotes(database).remove(input)
      await projectVaultGraphIndex(database).scheduleRebuild(input.projectId)
      return result
    }),

  restoreNote: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          trashId: z.string().uuid(),
          relativePath: z.string().min(1).max(1_000),
          expectedVersion: z.number().int().positive(),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const database = getDatabase()
      const result = await new ProjectVaultCustomNotes(database).restore(input)
      await projectVaultGraphIndex(database).scheduleRebuild(input.projectId)
      return result
    }),

  keepBothNotes: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          destinationPath: z.string().min(1).max(1_000),
          expectedVersion: z.number().int().positive(),
          expectedCurrentHash: z.string().regex(/^[0-9a-f]{64}$/),
          draftContent: z.string().max(1_048_576),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const database = getDatabase()
      const result = await new ProjectVaultCustomNotes(database).keepBoth(input)
      await projectVaultGraphIndex(database).scheduleRebuild(input.projectId)
      return result
    }),

  createFolder: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
        })
        .strict(),
    )
    .mutation(({ input }) => new ProjectVaultCustomNotes(getDatabase()).createFolder(input)),

  renameFolder: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          newName: z.string().min(1).max(255),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const database = getDatabase()
      const result = await new ProjectVaultCustomNotes(database).renameFolder(input)
      await projectVaultGraphIndex(database).scheduleRebuild(input.projectId)
      return result
    }),

  removeFolder: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
        })
        .strict(),
    )
    .mutation(({ input }) => new ProjectVaultCustomNotes(getDatabase()).removeFolder(input)),

  moveNote: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          destinationPath: z.string().min(1).max(1_000),
          expectedVersion: z.number().int().positive(),
          expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const database = getDatabase()
      const result = await new ProjectVaultCustomNotes(database).move(input)
      await projectVaultGraphIndex(database).scheduleRebuild(input.projectId)
      return result
    }),

  adoptExternalNote: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          expectedVersion: z.number().int().positive(),
          expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict(),
    )
    .mutation(async ({ input }) => {
      const database = getDatabase()
      const result = await new ProjectVaultCustomNotes(database).adoptExternal(input)
      await projectVaultGraphIndex(database).scheduleRebuild(input.projectId)
      return result
    }),

  createAttachment: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          declaredMimeType: z.string().min(1).max(255),
          dataBase64: z.string().min(1).max(22_369_624),
        })
        .strict(),
    )
    .mutation(({ input }) => {
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64)) {
        throw new Error("Project vault attachment encoding is invalid.")
      }
      const bytes = Buffer.from(input.dataBase64, "base64")
      return new ProjectVaultCustomNotes(getDatabase()).createAttachment({
        projectId: input.projectId,
        relativePath: input.relativePath,
        declaredMimeType: input.declaredMimeType,
        bytes,
      })
    }),

  readAttachment: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
        })
        .strict(),
    )
    .query(({ input }) =>
      new ProjectVaultCustomNotes(getDatabase()).readAttachment(
        input.projectId,
        input.relativePath,
      ),
    ),

  renameAttachment: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          newName: z.string().min(1).max(255),
          expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict(),
    )
    .mutation(({ input }) => new ProjectVaultCustomNotes(getDatabase()).renameAttachment(input)),

  moveAttachment: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          destinationPath: z.string().min(1).max(1_000),
          expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict(),
    )
    .mutation(({ input }) => new ProjectVaultCustomNotes(getDatabase()).moveAttachment(input)),

  removeAttachment: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          relativePath: z.string().min(1).max(1_000),
          expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict(),
    )
    .mutation(({ input }) => new ProjectVaultCustomNotes(getDatabase()).removeAttachment(input)),

  restoreAttachment: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          trashId: z.string().uuid(),
          relativePath: z.string().min(1).max(1_000),
          expectedHash: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict(),
    )
    .mutation(({ input }) => new ProjectVaultCustomNotes(getDatabase()).restoreAttachment(input)),

  previewGraphContext: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1),
          nodeIds: z.array(z.string().trim().min(1).max(200)).max(24),
          expectedGenerationId: z.string().uuid(),
          expansion: z
            .object({
              depth: z.number().int().min(0).max(2),
              direction: z.enum(["outgoing", "incoming", "both"]),
              maxNodes: z.number().int().min(1).max(24),
            })
            .strict()
            .optional(),
          budget: z
            .object({
              maxBytes: z.number().int().min(0).max(24_000),
              maxEstimatedTokens: z.number().int().min(0).max(6_000),
            })
            .strict()
            .optional(),
        })
        .strict(),
    )
    .query(async ({ input }) => {
      const result = await buildProjectVaultGraphContext(getDatabase(), input)
      return result.manifest
    }),

  readSection: publicProcedure
    .input(z.object({ projectId: z.string().min(1), sectionId: sectionSchema }))
    .query(({ input }) => readProjectVaultSectionForPreview(getDatabase(), input)),

  writeSection: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        sectionId: sectionSchema,
        expectedVersion: z.number().int().positive(),
        expectedCurrentContentHash: z.string().length(64).optional(),
        content: z.string(),
        changeKind: z.enum(["section-saved", "conflict-resolved"]).default("section-saved"),
      }),
    )
    .mutation(async ({ input }) => {
      assertProjectVaultContentSafe(input.content)
      const updated = await writeProjectVaultSection(getDatabase(), input)
      publishLocalProjectVaultInvalidation({
        projectId: input.projectId,
        sectionId: input.sectionId,
        revision: updated.version,
        kind: input.changeKind,
      })
      void projectVaultGraphIndex(getDatabase())
        .scheduleRebuild(input.projectId)
        .catch(() => undefined)
      return updated
    }),

  search: publicProcedure
    .input(z.object({ projectId: z.string().min(1), query: z.string().min(1).max(500) }))
    .query(({ input }) => searchProjectVault(getDatabase(), input)),

  listBackups: publicProcedure
    .input(z.object({ projectId: z.string().min(1), sectionId: sectionSchema }))
    .query(({ input }) => listProjectVaultSectionBackups(getDatabase(), input)),

  readBackup: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        sectionId: sectionSchema,
        backupId: z.string().min(1),
      }),
    )
    .query(({ input }) => readProjectVaultSectionBackup(getDatabase(), input)),

  restoreBackup: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        sectionId: sectionSchema,
        backupId: z.string().min(1),
        expectedVersion: z.number().int().positive(),
      }),
    )
    .mutation(async ({ input }) => {
      const backup = await readProjectVaultSectionBackup(getDatabase(), input)
      assertProjectVaultContentSafe(backup.content)
      const updated = await restoreProjectVaultSectionBackup(getDatabase(), input)
      publishLocalProjectVaultInvalidation({
        projectId: input.projectId,
        sectionId: input.sectionId,
        revision: updated.version,
        kind: "backup-restored",
      })
      void projectVaultGraphIndex(getDatabase())
        .scheduleRebuild(input.projectId)
        .catch(() => undefined)
      return updated
    }),

  adoptExternalChange: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        sectionId: sectionSchema,
        expectedVersion: z.number().int().positive(),
        expectedCurrentContentHash: z.string().length(64),
      }),
    )
    .mutation(async ({ input }) => {
      const updated = await adoptExternalProjectVaultSectionChange(getDatabase(), input)
      publishLocalProjectVaultInvalidation({
        projectId: input.projectId,
        sectionId: input.sectionId,
        revision: updated.version,
        kind: "external-change-adopted",
      })
      void projectVaultGraphIndex(getDatabase())
        .scheduleRebuild(input.projectId)
        .catch(() => undefined)
      return updated
    }),

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
