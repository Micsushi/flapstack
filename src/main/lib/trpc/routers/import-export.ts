import { openAppDatabase } from "../../db/access"
import { app, BrowserWindow, dialog } from "electron"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { PORTABLE_SCOPE_IDS, portableProjectIdSchema } from "../../../../shared/portability"
import { beginDatabaseMaintenance, endDatabaseMaintenance, getDatabasePath } from "../../db"
import { createPortableExport, type PortableFileSource } from "../../portability/exporter"
import {
  applyPortableImport,
  createPortableImportConfirmation,
  createPortableImportPlan,
  mergePortableImportTargetRoots,
  readPortableImportPlan,
  recoverInterruptedImports,
  restorePortableBackup,
  type PortabilityTargetRoots,
} from "../../portability/importer"
import {
  commitPrivateSync,
  getPrivateSyncConfig,
  linkPrivateSync,
  previewPrivateSync,
  pullPrivateSync,
  pushPrivateSync,
  unlinkPrivateSync,
} from "../../portability/private-sync"
import {
  beginExclusivePortabilityOperation,
  beginPortabilityReader,
} from "../../portability/operations"
import { portableScopeRegistry } from "../../portability/scope-registry"
import { databaseMaintenanceProcedure, publicProcedure, router } from "../index"

const scopeIdSchema = z.enum(PORTABLE_SCOPE_IDS)
const operationIdSchema = z.string().uuid()
const conflictResolutionSchema = z.enum(["keep-local", "use-incoming", "keep-both"])
const activeExports = new Map<string, AbortController>()

export const importExportRouter = router({
  getCapabilities: publicProcedure.query(() => ({
    enabled: true,
    bundleVersion: 1,
    secrets: "excluded-by-default" as const,
    dryRunImport: true,
    transactionalApply: true,
    privateSync: "explicit-user-owned-git" as const,
    scopes: portableScopeRegistry.list().map((scope) => ({
      id: scope.id,
      label: scope.label,
      sensitivity: scope.sensitivity,
      projectFilter: scope.projectFilter,
      privateSync: scope.handler.privateSync === "eligible-after-secret-scan",
      dependencies: [...scope.dependencies],
    })),
  })),

  listProjects: publicProcedure.query(() => listProjects()),

  chooseExportPath: publicProcedure.mutation(async () => {
    const options = {
      title: "Choose portable export directory",
      defaultPath: "flapstack-backup.flapstack-export",
      buttonLabel: "Choose",
      properties: ["createDirectory", "showOverwriteConfirmation"] as Array<
        "createDirectory" | "showOverwriteConfirmation"
      >,
    }
    const window = BrowserWindow.getFocusedWindow()
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    return result.canceled ? null : result.filePath
  }),

  chooseDirectory: publicProcedure
    .input(z.object({ title: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const options = {
        title: input.title,
        properties: ["openDirectory", "createDirectory"] as Array<
          "openDirectory" | "createDirectory"
        >,
      }
      const window = BrowserWindow.getFocusedWindow()
      const result = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }),

  createExport: publicProcedure
    .input(
      z.object({
        operationId: operationIdSchema,
        outputPath: z.string().min(1).max(4_096),
        scopes: z
          .array(
            z.object({
              id: scopeIdSchema,
              projectIds: z.array(portableProjectIdSchema).min(1).max(1_024).optional(),
            }),
          )
          .min(1)
          .max(PORTABLE_SCOPE_IDS.length),
      }),
    )
    .mutation(async ({ input }) => {
      if (activeExports.has(input.operationId)) throw new Error("Export operation already exists.")
      const releaseReader = beginPortabilityReader()
      const controller = new AbortController()
      activeExports.set(input.operationId, controller)
      try {
        return await createPortableExport({
          outputPath: input.outputPath,
          databasePath: getDatabasePath(),
          appVersion: app.getVersion(),
          selection: input.scopes,
          fileSources: discoverFileSources(input.scopes.flatMap((scope) => scope.projectIds ?? [])),
          signal: controller.signal,
        })
      } finally {
        activeExports.delete(input.operationId)
        releaseReader()
      }
    }),

  cancelExport: publicProcedure
    .input(z.object({ operationId: operationIdSchema }))
    .mutation(({ input }) => ({
      cancelled:
        activeExports.get(input.operationId)?.abort() === undefined &&
        activeExports.has(input.operationId),
    })),

  dryRunImport: publicProcedure
    .input(
      z.object({
        bundlePath: z.string().min(1).max(4_096),
        targetRoots: z
          .object({
            extensions: z.string().min(1).max(4_096).optional(),
            projects: z.record(z.string().min(1), z.string().min(1).max(4_096)).optional(),
            projectVaults: z.record(z.string().min(1), z.string().min(1).max(4_096)).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const releaseReader = beginPortabilityReader()
      try {
        return await createPortableImportPlan({
          bundlePath: input.bundlePath,
          databasePath: getDatabasePath(),
          stateRoot: stateRoot(),
          targetRoots: mergeTargetRoots(input.targetRoots),
        })
      } finally {
        releaseReader()
      }
    }),

  getImportPlan: publicProcedure
    .input(z.object({ planId: operationIdSchema }))
    .query(({ input }) => readPortableImportPlan(stateRoot(), input.planId)),

  prepareImportConfirmation: publicProcedure
    .input(
      z.object({
        planId: operationIdSchema,
        resolutions: z.record(z.string().length(64), conflictResolutionSchema).optional(),
      }),
    )
    .mutation(({ input }) =>
      createPortableImportConfirmation({ stateRoot: stateRoot(), ...input }),
    ),

  applyImport: databaseMaintenanceProcedure
    .input(
      z.object({
        planId: operationIdSchema,
        expectedFingerprint: z.string().length(64),
        expectedConfirmationHash: z.string().length(64),
        confirmed: z.literal(true),
        resolutions: z.record(z.string().length(64), conflictResolutionSchema).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const releaseExclusive = await beginExclusivePortabilityOperation()
      try {
        const databasePath = getDatabasePath()
        const reviewed = await readPortableImportPlan(stateRoot(), input.planId)
        return await applyPortableImport({
          planId: input.planId,
          expectedFingerprint: input.expectedFingerprint,
          expectedConfirmationHash: input.expectedConfirmationHash,
          databasePath,
          stateRoot: stateRoot(),
          targetRoots: reviewed.targetRoots,
          resolutions: input.resolutions,
          hooks: {
            beforeApply: () => beginDatabaseMaintenance("portability-import"),
            afterApply: () => endDatabaseMaintenance("portability-import"),
          },
        })
      } finally {
        releaseExclusive()
      }
    }),

  recoverInterrupted: databaseMaintenanceProcedure
    .input(z.object({ confirmed: z.literal(true) }))
    .mutation(async () => {
      const releaseExclusive = await beginExclusivePortabilityOperation()
      try {
        return await recoverInterruptedImports(stateRoot(), getDatabasePath(), {
          beforeApply: () => beginDatabaseMaintenance("portability-recovery"),
          afterApply: () => endDatabaseMaintenance("portability-recovery"),
        })
      } finally {
        releaseExclusive()
      }
    }),

  restoreBackup: databaseMaintenanceProcedure
    .input(z.object({ operationId: operationIdSchema, confirmed: z.literal(true) }))
    .mutation(async ({ input }) => {
      const releaseExclusive = await beginExclusivePortabilityOperation()
      try {
        await restorePortableBackup({
          stateRoot: stateRoot(),
          operationId: input.operationId,
          databasePath: getDatabasePath(),
          hooks: {
            beforeApply: () => beginDatabaseMaintenance("portability-restore"),
            afterApply: () => endDatabaseMaintenance("portability-restore"),
          },
        })
      } finally {
        releaseExclusive()
      }
    }),

  getPrivateSync: publicProcedure.query(() => getPrivateSyncConfig(stateRoot())),

  linkPrivateSync: publicProcedure
    .input(
      z.object({
        repoPath: z.string().min(1).max(4_096),
        remote: z.string().min(1).max(4_096),
        branch: z.string().min(1).max(255),
        scopes: z.array(scopeIdSchema).min(1).max(PORTABLE_SCOPE_IDS.length),
        initialize: z.boolean().default(false),
        clone: z.boolean().default(false),
        confirmed: z.literal(true),
      }),
    )
    .mutation(({ input }) => linkPrivateSync({ stateRoot: stateRoot(), ...input })),

  previewPrivateSync: publicProcedure
    .input(z.object({ action: z.enum(["pull", "commit", "push"]) }))
    .query(({ input }) => previewPrivateSync(stateRoot(), input.action)),

  pullPrivateSync: publicProcedure
    .input(z.object({ expectedFingerprint: z.string().min(1), confirmed: z.literal(true) }))
    .mutation(({ input }) => pullPrivateSync({ stateRoot: stateRoot(), ...input })),

  commitPrivateSync: publicProcedure
    .input(
      z.object({
        expectedFingerprint: z.string().min(1),
        message: z.string().min(1).max(200),
        confirmed: z.literal(true),
      }),
    )
    .mutation(({ input }) => commitPrivateSync({ stateRoot: stateRoot(), ...input })),

  pushPrivateSync: publicProcedure
    .input(z.object({ expectedFingerprint: z.string().min(1), confirmed: z.literal(true) }))
    .mutation(({ input }) => pushPrivateSync({ stateRoot: stateRoot(), ...input })),

  unlinkPrivateSync: publicProcedure
    .input(z.object({ confirmed: z.literal(true) }))
    .mutation(() => unlinkPrivateSync(stateRoot())),
})

function stateRoot(): string {
  return join(app.getPath("userData"), "data", "portability")
}

function listProjects(): Array<{ id: string; name: string; path: string }> {
  const database = openAppDatabase(getDatabasePath(), { readonly: true, fileMustExist: true })
  try {
    return database
      .prepare("SELECT id, name, path FROM projects ORDER BY name, id")
      .all() as Array<{
      id: string
      name: string
      path: string
    }>
  } finally {
    database.close()
  }
}

function discoverFileSources(projectIds: readonly string[]): PortableFileSource[] {
  const dataRoot = join(app.getPath("userData"), "data")
  const sources: PortableFileSource[] = [
    {
      scopeId: "settings",
      root: dataRoot,
      include: [
        "permissions.json",
        "usage-settings.json",
        "voice-settings.json",
        "hook-management.json",
      ],
      target: { kind: "config" },
    },
  ]
  const extensionRoot = join(homedir(), ".agents")
  if (pathExistsSync(extensionRoot)) {
    sources.push({ scopeId: "extensions", root: extensionRoot, target: { kind: "extensions" } })
  }
  const database = openAppDatabase(getDatabasePath(), { readonly: true, fileMustExist: true })
  try {
    const placeholders = projectIds.length
      ? ` WHERE project_id IN (${projectIds.map(() => "?").join(",")})`
      : ""
    const rows = database
      .prepare(
        `SELECT project_id, root_path FROM project_vaults${placeholders} ORDER BY project_id`,
      )
      .all(...projectIds) as Array<{ project_id: string; root_path: string }>
    for (const row of rows) {
      if (pathExistsSync(row.root_path)) {
        sources.push({
          scopeId: "project-vaults",
          root: row.root_path,
          target: { kind: "project-vault", projectId: row.project_id },
        })
      }
    }
  } finally {
    database.close()
  }
  return sources
}

function discoverTargetRoots(): PortabilityTargetRoots {
  const projectVaults: Record<string, string> = {}
  const database = openAppDatabase(getDatabasePath(), { readonly: true, fileMustExist: true })
  try {
    const rows = database
      .prepare("SELECT project_id, root_path FROM project_vaults")
      .all() as Array<{
      project_id: string
      root_path: string
    }>
    for (const row of rows) {
      if (pathExistsSync(row.root_path)) projectVaults[row.project_id] = row.root_path
    }
  } finally {
    database.close()
  }
  return {
    config: join(app.getPath("userData"), "data"),
    extensions: join(homedir(), ".agents"),
    projectVaults,
  }
}

function mergeTargetRoots(
  reviewed?: Pick<PortabilityTargetRoots, "extensions" | "projects" | "projectVaults">,
): PortabilityTargetRoots {
  return mergePortableImportTargetRoots(discoverTargetRoots(), reviewed)
}

function pathExistsSync(path: string): boolean {
  return existsSync(path)
}
