import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { z } from "zod"
import * as appDatabaseSchema from "../db/schema"
import { bindFilesystemRootIdentity } from "../git/security/path-validation"
import {
  PORTABLE_BUNDLE_LAYOUT,
  PORTABLE_SCOPE_IDS,
  PORTABILITY_LIMITS,
  portableCollisionKey,
  portableExclusionEntrySchema,
  portableManifestSchema,
  safeRelativeBundlePathSchema,
  type PortableExclusionDocument,
  type PortableManifest,
  type PortableScopeId,
} from "../../../shared/portability"
import {
  decodePortableRow,
  encodePortableRow,
  PORTABLE_LOCAL_PATH_PREFIX,
  quoteIdentifier,
  readPortableDatabase,
  type PortableDatabaseRecord,
} from "./database"
import type { PortableFileIndexEntry } from "./exporter"
import {
  assertSafeDirectory,
  copyDirectory,
  copyRegularFileNoFollow,
  listFiles,
  readJsonFile,
  removeIfExists,
  resolveInsideRoot,
  sha256,
  sha256File,
  snapshotRegularFileNoFollow,
  stableJson,
  type RegularFileSnapshot,
  writeJsonAtomic,
} from "./io"
import { portableScopeRegistry } from "./scope-registry"
import { redactText, sanitizeStructuredValue } from "./secrets"

export type PortabilityTargetRoots = {
  config?: string
  extensions?: string
  historyFiles?: string
  projects?: Readonly<Record<string, string>>
  projectVaults?: Readonly<Record<string, string>>
}

export function mergePortableImportTargetRoots(
  discovered: PortabilityTargetRoots,
  reviewed?: Pick<PortabilityTargetRoots, "extensions" | "projects" | "projectVaults">,
): PortabilityTargetRoots {
  return {
    config: discovered.config,
    ...(reviewed?.extensions ? { extensions: reviewed.extensions } : {}),
    ...(reviewed?.projects ? { projects: reviewed.projects } : {}),
    projectVaults: { ...discovered.projectVaults, ...reviewed?.projectVaults },
  }
}

export type PortabilityDiffKind = "create" | "update" | "conflict" | "skip"

export type PortableDatabaseDiff = {
  id: string
  kind: PortabilityDiffKind
  scopeId: PortableScopeId
  tableName: string
  identity: Record<string, unknown>
  incoming: Record<string, unknown>
  localPreview: Record<string, unknown> | null
  incomingPreview: Record<string, unknown>
  incomingSha256: string
  localSha256: string | null
}

export type PortableFileDiff = {
  id: string
  kind: PortabilityDiffKind
  scopeId: PortableScopeId
  bundlePath: string
  targetPath: string | null
  incomingSha256: string
  localSha256: string | null
  localPreview: string | null
  incomingPreview: string
  targetBinding: PortableTargetBinding | null
}

export type PortableMappingRequirement = {
  kind: "project" | "project-vault"
  projectId: string
  targetRootField: "projects" | "projectVaults"
  reason: "missing-current-target"
}

export type PortableTargetBinding = {
  rootPath: string
  anchorPath: string
  deviceId: string
  inodeId: string
  leaf: {
    sha256: string
    bytes: number
    deviceId: string
    inodeId: string
  } | null
}

export type PortableImportPlan = {
  id: string
  schemaVersion: 1
  bundlePath: string
  bundleFingerprint: string
  createdAt: string
  manifest: PortableManifest
  migrations: Array<{ scopeId: PortableScopeId; fromVersion: number; toVersion: number }>
  exclusions: PortableExclusionDocument["entries"]
  targetRoots: PortabilityTargetRoots
  mappingRequirements: PortableMappingRequirement[]
  database: PortableDatabaseDiff[]
  files: PortableFileDiff[]
  summary: Record<PortabilityDiffKind, number>
}

export type PortableConflictResolution = "keep-local" | "use-incoming" | "keep-both"

export type ImportApplyHooks = {
  faultAt?:
    | "after-backup"
    | "after-files"
    | "before-database-commit"
    | "after-database-commit-before-journal"
    | "after-database-commit"
  beforeApply?: () => void | Promise<void>
  afterApply?: () => void | Promise<void>
  beforeDatabaseRestore?: () => void | Promise<void>
  afterDatabaseRestore?: () => void | Promise<void>
  afterRevalidation?: () => void | Promise<void>
  beforeFileRollback?: () => void | Promise<void>
  beforeReviewedLeafRead?: () => void | Promise<void>
}

type ImportJournal = {
  schemaVersion: 2
  operationId: string
  planId: string
  phase:
    | "backup-created"
    | "files-publishing"
    | "files-published"
    | "database-applying"
    | "database-committed"
    | "complete"
    | "rolled-back"
  databasePath: string
  databaseBackupPath: string
  databaseBackupBinding: BackupSourceBinding
  fileBackups: Array<{
    targetPath: string
    backupPath: string | null
    backupBinding: BackupSourceBinding | null
    existed: boolean
    targetBinding: PortableTargetBinding
  }>
  conflictArtifactPath: string
}

type BackupSourceBinding = Pick<RegularFileSnapshot, "sha256" | "bytes" | "deviceId" | "inodeId">

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const backupSourceBindingSchema = z
  .object({
    sha256: digestSchema,
    bytes: z.number().int().nonnegative(),
    deviceId: z.string().regex(/^\d+$/),
    inodeId: z.string().regex(/^\d+$/),
  })
  .strict()
const scopeIdSchema = z.enum(PORTABLE_SCOPE_IDS)
const jsonObjectSchema = z.record(z.string(), z.unknown())
const targetRootsSchema = z
  .object({
    config: z.string().min(1).optional(),
    extensions: z.string().min(1).optional(),
    historyFiles: z.string().min(1).optional(),
    projects: z.record(z.string().min(1), z.string().min(1)).optional(),
    projectVaults: z.record(z.string().min(1), z.string().min(1)).optional(),
  })
  .strict()
const databaseDiffSchema = z
  .object({
    id: digestSchema,
    kind: z.enum(["create", "update", "conflict", "skip"]),
    scopeId: scopeIdSchema,
    tableName: z.string().min(1),
    identity: jsonObjectSchema,
    incoming: jsonObjectSchema,
    localPreview: jsonObjectSchema.nullable(),
    incomingPreview: jsonObjectSchema,
    incomingSha256: digestSchema,
    localSha256: digestSchema.nullable(),
  })
  .strict()
const fileDiffSchema = z
  .object({
    id: digestSchema,
    kind: z.enum(["create", "update", "conflict", "skip"]),
    scopeId: scopeIdSchema,
    bundlePath: safeRelativeBundlePathSchema,
    targetPath: z.string().min(1).nullable(),
    incomingSha256: digestSchema,
    localSha256: digestSchema.nullable(),
    localPreview: z.string().nullable(),
    incomingPreview: z.string(),
    targetBinding: z
      .object({
        rootPath: z.string().min(1),
        anchorPath: z.string().min(1),
        deviceId: z.string().regex(/^\d+$/),
        inodeId: z.string().regex(/^\d+$/),
        leaf: z
          .object({
            sha256: digestSchema,
            bytes: z.number().int().nonnegative(),
            deviceId: z.string().regex(/^\d+$/),
            inodeId: z.string().regex(/^\d+$/),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict()
const mappingRequirementSchema = z
  .object({
    kind: z.enum(["project", "project-vault"]),
    projectId: z.string().min(1),
    targetRootField: z.enum(["projects", "projectVaults"]),
    reason: z.literal("missing-current-target"),
  })
  .strict()
const importPlanSchema = z
  .object({
    id: z.string().uuid(),
    schemaVersion: z.literal(1),
    bundlePath: z.string().min(1),
    bundleFingerprint: digestSchema,
    createdAt: z.string().datetime({ offset: true }),
    manifest: portableManifestSchema,
    migrations: z.array(
      z
        .object({
          scopeId: scopeIdSchema,
          fromVersion: z.number().int().positive(),
          toVersion: z.number().int().positive(),
        })
        .strict(),
    ),
    exclusions: z.array(portableExclusionEntrySchema),
    targetRoots: targetRootsSchema,
    mappingRequirements: z.array(mappingRequirementSchema),
    database: z.array(databaseDiffSchema),
    files: z.array(fileDiffSchema),
    summary: z
      .object({
        create: z.number().int().nonnegative(),
        update: z.number().int().nonnegative(),
        conflict: z.number().int().nonnegative(),
        skip: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
const importJournalSchema = z
  .object({
    schemaVersion: z.literal(2),
    operationId: z.string().uuid(),
    planId: z.string().uuid(),
    phase: z.enum([
      "backup-created",
      "files-publishing",
      "files-published",
      "database-applying",
      "database-committed",
      "complete",
      "rolled-back",
    ]),
    databasePath: z.string().min(1),
    databaseBackupPath: z.string().min(1),
    databaseBackupBinding: backupSourceBindingSchema,
    fileBackups: z.array(
      z
        .object({
          targetPath: z.string().min(1),
          backupPath: z.string().min(1).nullable(),
          backupBinding: backupSourceBindingSchema.nullable(),
          existed: z.boolean(),
          targetBinding: z
            .object({
              rootPath: z.string().min(1),
              anchorPath: z.string().min(1),
              deviceId: z.string().regex(/^\d+$/),
              inodeId: z.string().regex(/^\d+$/),
              leaf: z
                .object({
                  sha256: digestSchema,
                  bytes: z.number().int().nonnegative(),
                  deviceId: z.string().regex(/^\d+$/),
                  inodeId: z.string().regex(/^\d+$/),
                })
                .strict()
                .nullable(),
            })
            .strict(),
        })
        .strict(),
    ),
    conflictArtifactPath: z.string().min(1),
  })
  .strict()

const fileIndexSchema = z.array(
  z.object({
    bundlePath: safeRelativeBundlePathSchema,
    relativePath: safeRelativeBundlePathSchema,
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("config") }),
      z.object({ kind: z.literal("extensions") }),
      z.object({ kind: z.literal("project-vault"), projectId: z.string().min(1) }),
      z.object({ kind: z.literal("history-files"), projectId: z.string().min(1).optional() }),
    ]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().nonnegative(),
  }),
)

export async function verifyPortableBundle(bundlePath: string): Promise<{
  manifest: PortableManifest
  exclusions: PortableExclusionDocument
  fingerprint: string
}> {
  const root = await assertSafeDirectory(bundlePath)
  const manifest = portableScopeRegistry.validateManifest(
    await readJsonFile(join(root, PORTABLE_BUNDLE_LAYOUT.manifest)),
  )
  if (manifest.directoryName !== basename(root))
    throw new Error("Bundle directory name does not match its manifest.")
  const checksums = portableScopeRegistry.validateChecksums(
    await readJsonFile(join(root, PORTABLE_BUNDLE_LAYOUT.checksums)),
  )
  const exclusions = portableScopeRegistry.validateExclusions(
    await readJsonFile(join(root, PORTABLE_BUNDLE_LAYOUT.exclusions)),
  )
  const actualPaths = (await listFiles(root)).filter(
    (path) => path !== PORTABLE_BUNDLE_LAYOUT.checksums,
  )
  const expectedPaths = checksums.entries.map((entry) => entry.path).sort()
  if (stableJson(actualPaths) !== stableJson(expectedPaths))
    throw new Error("Bundle file set does not match checksums.")
  let totalBytes = 0
  for (const entry of checksums.entries) {
    const maxBytes =
      entry.path === manifest.layout.database
        ? PORTABILITY_LIMITS.databaseBytes
        : PORTABILITY_LIMITS.fileBytes
    if (entry.bytes > maxBytes) throw new Error(`Bundle file exceeds size limit: ${entry.path}`)
    totalBytes += entry.bytes
    if (totalBytes > PORTABILITY_LIMITS.totalBundleBytes)
      throw new Error("Bundle exceeds the supported total size limit.")
    const target = await resolveInsideRoot(root, entry.path)
    const digest = await sha256File(target, maxBytes)
    if (digest.sha256 !== entry.sha256 || digest.bytes !== entry.bytes) {
      throw new Error(`Bundle checksum mismatch: ${entry.path}`)
    }
  }
  readPortableDatabase(join(root, manifest.layout.database))
  const fingerprint = sha256(
    stableJson({
      manifest,
      checksums,
      exclusions,
    }),
  )
  return { manifest, exclusions, fingerprint }
}

export async function createPortableImportPlan(input: {
  bundlePath: string
  databasePath: string
  stateRoot: string
  targetRoots: PortabilityTargetRoots
  now?: () => Date
  stage?: boolean
  persist?: boolean
}): Promise<PortableImportPlan> {
  const sourceRoot = await assertSafeDirectory(input.bundlePath)
  await verifyPortableBundle(sourceRoot)
  const id = randomUUID()
  const bundleRoot =
    input.stage === false ? sourceRoot : join(input.stateRoot, "staging", id, basename(sourceRoot))
  if (input.stage !== false) await copyDirectory(sourceRoot, bundleRoot)
  const verified = await verifyPortableBundle(bundleRoot)
  const migratedRecords = migratePortableDatabaseRecords(
    readPortableDatabase(join(bundleRoot, verified.manifest.layout.database)),
    verified.manifest,
  )
  const database = new Database(input.databasePath, { fileMustExist: true })
  let databaseDiffs: PortableDatabaseDiff[]
  const mappingRequirements: PortableMappingRequirement[] = []
  try {
    await validateReviewedTargetRoots(
      input.targetRoots,
      collectPortableProjectIds(migratedRecords, verified.manifest),
      database,
    )
    const mappedRecords = mapPortableLocalPaths(
      migratedRecords,
      database,
      input.targetRoots,
      mappingRequirements,
    )
    databaseDiffs = planDatabaseDiffs(
      database,
      orderPortableDatabaseRecords(mappedRecords, verified.manifest),
    )
  } finally {
    database.close()
  }
  const filePlan = await planFileDiffs({
    bundleRoot,
    manifest: verified.manifest,
    targetRoots: input.targetRoots,
    stateRoot: input.stateRoot,
  })
  mappingRequirements.push(...filePlan.mappingRequirements)
  const reviewedMappingRequirements = deduplicateMappingRequirements(mappingRequirements)
  const fileDiffs = filePlan.diffs
  const allKinds = [...databaseDiffs, ...fileDiffs].map((entry) => entry.kind)
  const plan: PortableImportPlan = {
    id,
    schemaVersion: 1,
    bundlePath: bundleRoot,
    bundleFingerprint: verified.fingerprint,
    createdAt: (input.now ?? (() => new Date()))().toISOString(),
    manifest: verified.manifest,
    migrations: verified.manifest.scopes.flatMap((scope) => {
      const compatibility = portableScopeRegistry.compatibility(scope.id, scope.schemaVersion)
      return compatibility.status === "migration-required"
        ? [
            {
              scopeId: scope.id as PortableScopeId,
              fromVersion: compatibility.fromVersion,
              toVersion: compatibility.toVersion,
            },
          ]
        : []
    }),
    exclusions: verified.exclusions.entries,
    targetRoots: input.targetRoots,
    mappingRequirements: reviewedMappingRequirements,
    database: databaseDiffs,
    files: fileDiffs,
    summary: {
      create: allKinds.filter((kind) => kind === "create").length,
      update: allKinds.filter((kind) => kind === "update").length,
      conflict: allKinds.filter((kind) => kind === "conflict").length,
      skip: allKinds.filter((kind) => kind === "skip").length,
    },
  }
  if (Buffer.byteLength(stableJson(plan)) > PORTABILITY_LIMITS.importPlanBytes)
    throw new Error("Import plan exceeds the supported size limit; narrow the selected scopes.")
  if (input.persist !== false) await writeJsonAtomic(planPath(input.stateRoot, plan.id), plan)
  return plan
}

export async function readPortableImportPlan(
  stateRoot: string,
  planId: string,
): Promise<PortableImportPlan> {
  assertUuid(planId)
  return importPlanSchema.parse(
    await readJsonFile(planPath(stateRoot, planId), PORTABILITY_LIMITS.importPlanBytes),
  )
}

export async function createPortableImportConfirmation(input: {
  stateRoot: string
  planId: string
  resolutions?: Readonly<Record<string, PortableConflictResolution>>
}): Promise<{ confirmationHash: string; targetRoots: PortabilityTargetRoots }> {
  const plan = await readPortableImportPlan(input.stateRoot, input.planId)
  assertMappingsResolved(plan)
  return {
    confirmationHash: importConfirmationHash(plan, input.resolutions),
    targetRoots: plan.targetRoots,
  }
}

export async function applyPortableImport(input: {
  planId: string
  expectedFingerprint: string
  expectedConfirmationHash: string
  databasePath: string
  stateRoot: string
  targetRoots: PortabilityTargetRoots
  resolutions?: Readonly<Record<string, PortableConflictResolution>>
  hooks?: ImportApplyHooks
}): Promise<{
  operationId: string
  backupPath: string
  applied: number
  skipped: number
  preservedConflicts: number
  conflictArtifactPath: string | null
}> {
  let lifecycleStarted = false
  try {
    await input.hooks?.beforeApply?.()
    lifecycleStarted = true
    return await applyPortableImportInsideLifecycle(input)
  } finally {
    if (lifecycleStarted) await input.hooks?.afterApply?.()
  }
}

async function applyPortableImportInsideLifecycle(input: {
  planId: string
  expectedFingerprint: string
  expectedConfirmationHash: string
  databasePath: string
  stateRoot: string
  targetRoots: PortabilityTargetRoots
  resolutions?: Readonly<Record<string, PortableConflictResolution>>
  hooks?: ImportApplyHooks
}): Promise<{
  operationId: string
  backupPath: string
  applied: number
  skipped: number
  preservedConflicts: number
  conflictArtifactPath: string | null
}> {
  const plan = await readPortableImportPlan(input.stateRoot, input.planId)
  assertMappingsResolved(plan)
  if (stableJson(input.targetRoots) !== stableJson(plan.targetRoots))
    throw new Error("Import target mappings changed after review; run dry-run again.")
  if (importConfirmationHash(plan, input.resolutions) !== input.expectedConfirmationHash)
    throw new Error("Import confirmation is stale; review targets and resolutions again.")
  const verified = await verifyPortableBundle(plan.bundlePath)
  if (
    verified.fingerprint !== input.expectedFingerprint ||
    verified.fingerprint !== plan.bundleFingerprint
  ) {
    throw new Error("Import plan is stale; run dry-run again.")
  }
  const refreshed = await createPortableImportPlan({
    bundlePath: plan.bundlePath,
    databasePath: input.databasePath,
    stateRoot: input.stateRoot,
    targetRoots: plan.targetRoots,
    stage: false,
    persist: false,
  })
  if (diffFingerprint(refreshed) !== diffFingerprint(plan)) {
    throw new Error("Live state changed after dry-run; review a new import plan.")
  }
  await input.hooks?.afterRevalidation?.()
  const unresolved = [...plan.database, ...plan.files].filter(
    (entry) => entry.kind === "conflict" && !input.resolutions?.[entry.id],
  )
  if (unresolved.length > 0) throw new Error("Resolve every import conflict before apply.")

  const operationId = randomUUID()
  const operationRoot = join(input.stateRoot, "operations", operationId)
  const databaseBackupPath = join(operationRoot, "backup", "agents.db")
  const conflictArtifactPath = join(operationRoot, "conflicts.json")
  await mkdir(dirname(databaseBackupPath), { recursive: true, mode: 0o700 })
  const source = new Database(input.databasePath, { readonly: true, fileMustExist: true })
  try {
    await source.backup(databaseBackupPath)
  } finally {
    source.close()
  }
  const databaseBackupBinding = await snapshotBackupSource(databaseBackupPath)
  const journal: ImportJournal = {
    schemaVersion: 2,
    operationId,
    planId: plan.id,
    phase: "backup-created",
    databasePath: input.databasePath,
    databaseBackupPath,
    databaseBackupBinding,
    fileBackups: [],
    conflictArtifactPath,
  }
  await writeJournal(input.stateRoot, journal)
  fault(input.hooks, "after-backup")

  let applied = 0
  let skipped = 0
  let preservedConflicts = 0
  const conflictArtifacts: unknown[] = []
  try {
    journal.phase = "files-publishing"
    await writeJournal(input.stateRoot, journal)
    for (const file of plan.files) {
      const resolution = input.resolutions?.[file.id]
      if (file.kind === "skip" || resolution === "keep-local") {
        skipped += 1
        continue
      }
      if (!file.targetPath) throw new Error(`No live target is available for ${file.bundlePath}.`)
      if (resolution === "keep-both") {
        const artifactRoot = join(operationRoot, "conflicts", "files", file.id)
        const localArtifact = join(artifactRoot, "local")
        const incomingArtifact = join(artifactRoot, "incoming")
        if (!file.targetBinding) throw new Error("Reviewed import target binding is missing.")
        await assertBoundTarget(file.targetBinding, file.targetPath)
        if (!file.targetBinding.leaf)
          throw new Error("Reviewed local conflict file disappeared before preservation.")
        await input.hooks?.beforeReviewedLeafRead?.()
        await copyRegularFileNoFollow(file.targetPath, localArtifact, file.targetBinding.leaf)
        await copyReviewedBundleFile(
          join(plan.bundlePath, file.bundlePath),
          incomingArtifact,
          file.incomingSha256,
        )
        conflictArtifacts.push({
          type: "file",
          id: file.id,
          scopeId: file.scopeId,
          bundlePath: file.bundlePath,
          liveResolution: "kept-local",
          local: { path: localArtifact, sha256: file.localSha256 },
          incoming: { path: incomingArtifact, sha256: file.incomingSha256 },
        })
        preservedConflicts += 1
        skipped += 1
        continue
      }
      const targetPath = file.targetPath
      if (!file.targetBinding) throw new Error("Reviewed import target binding is missing.")
      await assertBoundTarget(file.targetBinding, targetPath)
      const existed = file.targetBinding.leaf !== null
      const backupPath = existed
        ? join(operationRoot, "files", String(journal.fileBackups.length))
        : null
      if (backupPath) {
        await assertBoundTarget(file.targetBinding, targetPath)
        await input.hooks?.beforeReviewedLeafRead?.()
        await copyRegularFileNoFollow(targetPath, backupPath, file.targetBinding.leaf!)
      }
      const backupBinding = backupPath ? await snapshotBackupSource(backupPath) : null
      journal.fileBackups.push({
        targetPath,
        backupPath,
        backupBinding,
        existed,
        targetBinding: file.targetBinding,
      })
      await writeJournal(input.stateRoot, journal)
      await copyFileAtomicBound(
        join(plan.bundlePath, file.bundlePath),
        targetPath,
        file.targetBinding,
      )
      applied += 1
    }
    journal.phase = "files-published"
    await writeJournal(input.stateRoot, journal)
    fault(input.hooks, "after-files")

    journal.phase = "database-applying"
    await writeJournal(input.stateRoot, journal)
    const database = new Database(input.databasePath)
    try {
      database.pragma("foreign_keys = ON")
      const transaction = database.transaction(() => {
        database.pragma("defer_foreign_keys = ON")
        ensureBaseTable(database)
        for (const diff of plan.database) {
          const resolution = input.resolutions?.[diff.id]
          if (diff.kind === "skip" || resolution === "keep-local") {
            skipped += 1
            continue
          }
          if (resolution === "keep-both") {
            const local = readLocalRow(database, diff)
            conflictArtifacts.push({
              type: "database",
              id: diff.id,
              scopeId: diff.scopeId,
              tableName: diff.tableName,
              identity: diff.identity,
              liveResolution: "kept-local",
              local: { row: encodePortableRow(local), sha256: diff.localSha256 },
              incoming: { row: diff.incoming, sha256: diff.incomingSha256 },
            })
            preservedConflicts += 1
            skipped += 1
            continue
          }
          upsertRecord(database, diff)
          recordDatabaseBase(database, diff)
          applied += 1
        }
        bindImportedProjectVaultRoots(database, plan.database, input.resolutions)
        const foreignKeyFailures = database.pragma("foreign_key_check") as Array<unknown>
        if (foreignKeyFailures.length > 0)
          throw new Error("Imported database records violate foreign key integrity.")
        fault(input.hooks, "before-database-commit")
      })
      transaction.immediate()
      fault(input.hooks, "after-database-commit-before-journal")
    } finally {
      database.close()
    }
    journal.phase = "database-committed"
    await writeJournal(input.stateRoot, journal)
    fault(input.hooks, "after-database-commit")
    if (conflictArtifacts.length > 0) await writeJsonAtomic(conflictArtifactPath, conflictArtifacts)
    await recordFileBases(input.stateRoot, plan.files, input.resolutions)
    journal.phase = "complete"
    await writeJournal(input.stateRoot, journal)
    return {
      operationId,
      backupPath: operationRoot,
      applied,
      skipped,
      preservedConflicts,
      conflictArtifactPath: conflictArtifacts.length > 0 ? conflictArtifactPath : null,
    }
  } catch (error) {
    await rollbackJournal(journal, input.databasePath, input.hooks)
    journal.phase = "rolled-back"
    await writeJournal(input.stateRoot, journal)
    throw error
  }
}

function bindImportedProjectVaultRoots(
  database: Database.Database,
  diffs: readonly PortableDatabaseDiff[],
  resolutions: Readonly<Record<string, PortableConflictResolution>> | undefined,
): void {
  if (!tableExists(database, "filesystem_root_registrations")) return
  const projectIds = new Set(
    diffs
      .filter((diff) => {
        const resolution = resolutions?.[diff.id]
        return (
          diff.scopeId === "project-vaults" &&
          diff.tableName === "project_vaults" &&
          diff.kind !== "skip" &&
          resolution !== "keep-local" &&
          resolution !== "keep-both"
        )
      })
      .map((diff) => String(diff.identity.project_id ?? ""))
      .filter(Boolean),
  )
  if (projectIds.size === 0) return

  const typed = drizzle(database, { schema: appDatabaseSchema })
  const selectRoot = database.prepare("SELECT root_path FROM project_vaults WHERE project_id = ?")
  for (const projectId of projectIds) {
    const row = selectRoot.get(projectId) as { root_path: string } | undefined
    if (!row) throw new Error(`Imported project vault ${projectId} is missing its target root.`)
    bindFilesystemRootIdentity(row.root_path, typed)
  }
}

export async function recoverInterruptedImports(
  stateRoot: string,
  expectedDatabasePath: string,
  hooks?: ImportApplyHooks,
): Promise<Array<{ operationId: string; action: "rolled-back" | "none" }>> {
  let lifecycleStarted = false
  try {
    await hooks?.beforeApply?.()
    lifecycleStarted = true
    return await recoverInterruptedImportsInsideLifecycle(stateRoot, expectedDatabasePath, hooks)
  } finally {
    if (lifecycleStarted) await hooks?.afterApply?.()
  }
}

async function recoverInterruptedImportsInsideLifecycle(
  stateRoot: string,
  expectedDatabasePath: string,
  hooks?: ImportApplyHooks,
): Promise<Array<{ operationId: string; action: "rolled-back" | "none" }>> {
  const journalRoot = join(stateRoot, "journals")
  if (!(await pathExists(journalRoot))) return []
  const results: Array<{ operationId: string; action: "rolled-back" | "none" }> = []
  for (const file of await listFiles(journalRoot)) {
    if (!file.endsWith(".json")) continue
    const journal = importJournalSchema.parse(await readJsonFile(join(journalRoot, file)))
    if (journal.phase === "complete" || journal.phase === "rolled-back") {
      results.push({ operationId: journal.operationId, action: "none" })
      continue
    }
    await rollbackJournal(journal, expectedDatabasePath, hooks)
    journal.phase = "rolled-back"
    await writeJournal(stateRoot, journal)
    results.push({ operationId: journal.operationId, action: "rolled-back" })
  }
  return results
}

export async function restorePortableBackup(input: {
  stateRoot: string
  operationId: string
  databasePath: string
  hooks?: ImportApplyHooks
}): Promise<void> {
  let lifecycleStarted = false
  try {
    await input.hooks?.beforeApply?.()
    lifecycleStarted = true
    assertUuid(input.operationId)
    const journal = importJournalSchema.parse(
      await readJsonFile(journalPath(input.stateRoot, input.operationId)),
    )
    await rollbackJournal(journal, input.databasePath, input.hooks)
    journal.phase = "rolled-back"
    await writeJournal(input.stateRoot, journal)
  } finally {
    if (lifecycleStarted) await input.hooks?.afterApply?.()
  }
}

function planDatabaseDiffs(
  database: Database.Database,
  records: readonly PortableDatabaseRecord[],
): PortableDatabaseDiff[] {
  const output: PortableDatabaseDiff[] = []
  let plannedBytes = 0
  const hasBases = tableExists(database, "portable_import_bases")
  for (const record of records) {
    if (!tableExists(database, record.tableName))
      throw new Error(`Import target lacks table ${record.tableName}.`)
    const identityEntries = Object.entries(record.identity)
    if (identityEntries.length === 0) throw new Error("Portable database record has no identity.")
    const where = identityEntries.map(([key]) => `${quoteIdentifier(key)} = ?`).join(" AND ")
    const identityValues = identityEntries.map(([, value]) => decodeValue(value))
    const columns = (
      database.prepare(`PRAGMA table_info(${quoteIdentifier(record.tableName)})`).all() as Array<{
        name: string
      }>
    ).map((column) => column.name)
    const localBytes = database
      .prepare(
        `SELECT ${columns
          .map((column) => `COALESCE(length(CAST(${quoteIdentifier(column)} AS BLOB)), 0)`)
          .join(" + ")} FROM ${quoteIdentifier(record.tableName)} WHERE ${where} LIMIT 1`,
      )
      .pluck()
      .get(...identityValues) as number | undefined
    if (localBytes !== undefined && localBytes > PORTABILITY_LIMITS.recordJsonBytes)
      throw new Error("Local import comparison row exceeds the supported size limit.")
    const local = database
      .prepare(`SELECT * FROM ${quoteIdentifier(record.tableName)} WHERE ${where} LIMIT 1`)
      .get(...identityValues) as Record<string, unknown> | undefined
    if (
      local &&
      Buffer.byteLength(stableJson(encodePortableRow(local))) > PORTABILITY_LIMITS.recordJsonBytes
    )
      throw new Error("Local import comparison row exceeds the JSON size limit.")
    const incoming = decodePortableRow(record.row)
    const incomingHash = rowHash(incoming)
    const localHash = local ? rowHash(local) : null
    const baseHash = hasBases
      ? (database
          .prepare(
            "SELECT row_hash FROM portable_import_bases WHERE scope_id = ? AND table_name = ? AND identity_json = ?",
          )
          .pluck()
          .get(record.scopeId, record.tableName, stableJson(record.identity)) as string | undefined)
      : undefined
    const kind: PortabilityDiffKind = !local
      ? "create"
      : localHash === incomingHash
        ? "skip"
        : baseHash && baseHash === localHash
          ? "update"
          : "conflict"
    const diff: PortableDatabaseDiff = {
      id: sha256(stableJson(["database", record.scopeId, record.tableName, record.identity])),
      kind,
      scopeId: record.scopeId,
      tableName: record.tableName,
      identity: record.identity,
      incoming: record.row,
      localPreview: local
        ? sanitizeStructuredValue(encodePortableRow(local), {
            scopeId: record.scopeId,
            path: `preview/${record.scopeId}/${record.tableName}/local`,
          }).value
        : null,
      incomingPreview: sanitizeStructuredValue(record.row, {
        scopeId: record.scopeId,
        path: `preview/${record.scopeId}/${record.tableName}/incoming`,
      }).value,
      incomingSha256: incomingHash,
      localSha256: localHash,
    }
    plannedBytes += Buffer.byteLength(stableJson(diff))
    if (plannedBytes > PORTABILITY_LIMITS.importPlanBytes)
      throw new Error("Import plan exceeds the supported size limit; split the export.")
    output.push(diff)
  }
  return output
}

function migratePortableDatabaseRecords(
  records: readonly PortableDatabaseRecord[],
  manifest: PortableManifest,
): PortableDatabaseRecord[] {
  const versions = new Map(manifest.scopes.map((scope) => [scope.id, scope.schemaVersion]))
  return records.map((record) => {
    let version = versions.get(record.scopeId)
    if (!version) throw new Error(`Portable database contains unselected scope ${record.scopeId}.`)
    let migrated = record
    const target = portableScopeRegistry.get(record.scopeId).schema.current
    while (version < target) {
      const migrator = PORTABLE_RECORD_MIGRATORS[record.scopeId]?.[version]
      if (!migrator) {
        throw new Error(`No portable migration exists for ${record.scopeId} version ${version}.`)
      }
      migrated = migrator(migrated)
      version += 1
    }
    return migrated
  })
}

const PORTABLE_RECORD_MIGRATORS: Partial<
  Record<
    PortableScopeId,
    Record<number, (record: PortableDatabaseRecord) => PortableDatabaseRecord>
  >
> = {
  // Settings v2 formalizes the shared placeholder/category-only secret boundary.
  // V1 records were already value-free, so their row shape migrates unchanged.
  settings: { 1: (record) => ({ ...record, row: { ...record.row } }) },
}

function mapPortableLocalPaths(
  records: readonly PortableDatabaseRecord[],
  database: Database.Database,
  roots: PortabilityTargetRoots,
  mappingRequirements: PortableMappingRequirement[],
): PortableDatabaseRecord[] {
  return records.map((record) => {
    const row = { ...record.row }
    for (const [column, value] of Object.entries(row)) {
      if (typeof value !== "string" || !value.startsWith(PORTABLE_LOCAL_PATH_PREFIX)) continue
      const projectId = String(record.identity.project_id ?? record.identity.id ?? "")
      let mapped: string | undefined
      if (value.startsWith(`${PORTABLE_LOCAL_PATH_PREFIX}projects/`)) {
        mapped =
          roots.projects?.[projectId] ?? readExistingMappedPath(database, "projects", projectId)
      } else if (value.startsWith(`${PORTABLE_LOCAL_PATH_PREFIX}project-vaults/`)) {
        mapped = roots.projectVaults?.[projectId]
      }
      if (!mapped || !isAbsolute(mapped)) {
        mappingRequirements.push({
          kind: value.startsWith(`${PORTABLE_LOCAL_PATH_PREFIX}project-vaults/`)
            ? "project-vault"
            : "project",
          projectId,
          targetRootField: value.startsWith(`${PORTABLE_LOCAL_PATH_PREFIX}project-vaults/`)
            ? "projectVaults"
            : "projects",
          reason: "missing-current-target",
        })
        continue
      }
      row[column] = mapped
    }
    return { ...record, row }
  })
}

function readExistingMappedPath(
  database: Database.Database,
  tableName: "projects" | "project_vaults",
  projectId: string,
): string | undefined {
  if (!tableExists(database, tableName)) return undefined
  const column = tableName === "projects" ? "path" : "root_path"
  const identity = tableName === "projects" ? "id" : "project_id"
  return database
    .prepare(
      `SELECT ${quoteIdentifier(column)} FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(identity)} = ?`,
    )
    .pluck()
    .get(projectId) as string | undefined
}

function orderPortableDatabaseRecords(
  records: readonly PortableDatabaseRecord[],
  manifest: PortableManifest,
): PortableDatabaseRecord[] {
  const scopeOrder = new Map(
    portableScopeRegistry.importOrder(manifest).map((scopeId, index) => [scopeId, index]),
  )
  return [...records].sort((left, right) => {
    const byScope = (scopeOrder.get(left.scopeId) ?? 999) - (scopeOrder.get(right.scopeId) ?? 999)
    if (byScope !== 0) return byScope
    const byTable = tableImportRank(left.tableName) - tableImportRank(right.tableName)
    if (byTable !== 0) return byTable
    return `${left.tableName}\0${stableJson(left.identity)}`.localeCompare(
      `${right.tableName}\0${stableJson(right.identity)}`,
    )
  })
}

function tableImportRank(tableName: string): number {
  const rank: Readonly<Record<string, number>> = {
    projects: 10,
    tasks: 20,
    plan_source_registrations: 20,
    project_vaults: 20,
    project_vault_sections: 30,
    project_vault_backups: 40,
    chats: 30,
    sub_chats: 40,
    task_orchestrations: 40,
    agent_runs: 50,
    orchestration_agents: 60,
    checkpoints: 60,
    file_change_manifests: 60,
    attachments: 60,
    voice_artifacts: 60,
  }
  return rank[tableName] ?? 100
}

async function planFileDiffs(input: {
  bundleRoot: string
  manifest: PortableManifest
  targetRoots: PortabilityTargetRoots
  stateRoot: string
}): Promise<{
  diffs: PortableFileDiff[]
  mappingRequirements: PortableMappingRequirement[]
}> {
  const bases = await readFileBases(input.stateRoot)
  const output: PortableFileDiff[] = []
  const mappingRequirements: PortableMappingRequirement[] = []
  let plannedBytes = 0
  const collisionKeys = new Set<string>()
  for (const scope of input.manifest.scopes) {
    const indexPath = join(input.bundleRoot, scope.contentPath, "files.json")
    const index = fileIndexSchema.parse(await readJsonFile(indexPath)) as PortableFileIndexEntry[]
    for (const entry of index) {
      if (!entry.bundlePath.startsWith(`${scope.contentPath}/files/`))
        throw new Error("Portable file index escapes its scope.")
      const collisionKey = portableCollisionKey(entry.bundlePath)
      if (collisionKeys.has(collisionKey))
        throw new Error("Portable file index contains a cross-platform path collision.")
      collisionKeys.add(collisionKey)
      const bundledPath = await resolveInsideRoot(input.bundleRoot, entry.bundlePath)
      const bundled = await snapshotRegularFileNoFollow(bundledPath, {
        maxBytes: PORTABILITY_LIMITS.fileBytes,
        previewBytes: 2_000,
      })
      if (bundled.sha256 !== entry.sha256 || bundled.bytes !== entry.bytes)
        throw new Error("Portable file index checksum mismatch.")
      const targetRoot = targetRootFor(entry, input.targetRoots)
      if (!targetRoot) {
        if (entry.target.kind !== "project-vault")
          throw new Error(`Reviewed target root mapping required for ${entry.bundlePath}.`)
        mappingRequirements.push({
          kind: "project-vault",
          projectId: entry.target.projectId,
          targetRootField: "projectVaults",
          reason: "missing-current-target",
        })
        const diff: PortableFileDiff = {
          id: sha256(stableJson(["file", entry.bundlePath, entry.target])),
          kind: "conflict",
          scopeId: scope.id as PortableScopeId,
          bundlePath: entry.bundlePath,
          targetPath: null,
          incomingSha256: entry.sha256,
          localSha256: null,
          localPreview: null,
          incomingPreview: safeFilePreview(bundled.preview, scope.id as PortableScopeId),
          targetBinding: null,
        }
        plannedBytes += Buffer.byteLength(stableJson(diff))
        if (plannedBytes > PORTABILITY_LIMITS.importPlanBytes)
          throw new Error("Import plan exceeds the supported size limit; split the export.")
        output.push(diff)
        continue
      }
      const { targetPath, targetBinding, targetSnapshot } = await resolveTarget(
        targetRoot,
        entry.relativePath,
      )
      const localSha256 = targetSnapshot?.sha256 ?? null
      const base = bases[entry.bundlePath]
      const kind: PortabilityDiffKind = !localSha256
        ? "create"
        : localSha256 === entry.sha256
          ? "skip"
          : base && base === localSha256
            ? "update"
            : "conflict"
      const diff: PortableFileDiff = {
        id: sha256(stableJson(["file", entry.bundlePath, entry.target])),
        kind,
        scopeId: scope.id as PortableScopeId,
        bundlePath: entry.bundlePath,
        targetPath,
        incomingSha256: entry.sha256,
        localSha256,
        localPreview: targetSnapshot
          ? safeFilePreview(targetSnapshot.preview, scope.id as PortableScopeId)
          : null,
        incomingPreview: safeFilePreview(bundled.preview, scope.id as PortableScopeId),
        targetBinding,
      }
      plannedBytes += Buffer.byteLength(stableJson(diff))
      if (plannedBytes > PORTABILITY_LIMITS.importPlanBytes)
        throw new Error("Import plan exceeds the supported size limit; split the export.")
      output.push(diff)
    }
  }
  return { diffs: output, mappingRequirements }
}

function upsertRecord(database: Database.Database, diff: PortableDatabaseDiff): void {
  const row = decodePortableRow(diff.incoming)
  const columns = Object.keys(row)
  const tableColumns = new Set(
    (
      database.prepare(`PRAGMA table_info(${quoteIdentifier(diff.tableName)})`).all() as Array<{
        name: string
      }>
    ).map((entry) => entry.name),
  )
  if (columns.some((column) => !tableColumns.has(column)))
    throw new Error(`Portable row has unknown columns for ${diff.tableName}.`)
  const identityColumns = Object.keys(diff.identity)
  const updates = columns.filter((column) => !identityColumns.includes(column))
  const sql = `INSERT INTO ${quoteIdentifier(diff.tableName)} (${columns.map(quoteIdentifier).join(",")}) VALUES (${columns.map(() => "?").join(",")}) ON CONFLICT (${identityColumns.map(quoteIdentifier).join(",")}) DO ${updates.length ? `UPDATE SET ${updates.map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`).join(",")}` : "NOTHING"}`
  database.prepare(sql).run(...columns.map((column) => row[column]))
}

function ensureBaseTable(database: Database.Database): void {
  database.exec(`CREATE TABLE IF NOT EXISTS portable_import_bases (
    scope_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    identity_json TEXT NOT NULL,
    row_hash TEXT NOT NULL,
    imported_at INTEGER NOT NULL,
    PRIMARY KEY (scope_id, table_name, identity_json)
  )`)
}

function recordDatabaseBase(database: Database.Database, diff: PortableDatabaseDiff): void {
  database
    .prepare(
      `INSERT INTO portable_import_bases (scope_id, table_name, identity_json, row_hash, imported_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (scope_id, table_name, identity_json)
     DO UPDATE SET row_hash = excluded.row_hash, imported_at = excluded.imported_at`,
    )
    .run(
      diff.scopeId,
      diff.tableName,
      stableJson(diff.identity),
      rowHash(decodePortableRow(diff.incoming)),
      Math.floor(Date.now() / 1000),
    )
}

async function rollbackJournal(
  journal: ImportJournal,
  expectedDatabasePath: string,
  hooks?: ImportApplyHooks,
): Promise<void> {
  if (resolve(journal.databasePath) !== resolve(expectedDatabasePath))
    throw new Error("Import journal database target does not match the active profile database.")
  await hooks?.beforeFileRollback?.()
  const restoresDatabase =
    journal.phase === "database-applying" ||
    journal.phase === "database-committed" ||
    journal.phase === "complete"
  if (restoresDatabase) await hooks?.beforeDatabaseRestore?.()
  for (const backup of journal.fileBackups) {
    if (backup.existed && (!backup.backupPath || !backup.backupBinding))
      throw new Error("Import journal file backup binding is incomplete.")
    if (backup.backupPath && backup.backupBinding)
      await assertBackupSource(backup.backupPath, backup.backupBinding)
  }
  if (restoresDatabase)
    await assertBackupSource(journal.databaseBackupPath, journal.databaseBackupBinding)
  for (const backup of [...journal.fileBackups].reverse()) {
    await assertBoundTarget(backup.targetBinding, backup.targetPath, "safe-only")
    if (backup.existed && backup.backupPath)
      await copyFileAtomicBound(
        backup.backupPath,
        backup.targetPath,
        backup.targetBinding,
        "safe-only",
        backup.backupBinding!,
      )
    else {
      await assertBoundTarget(backup.targetBinding, backup.targetPath, "safe-only")
      await rm(backup.targetPath, { force: true })
    }
  }
  if (restoresDatabase) {
    try {
      await copyRegularFileNoFollow(
        journal.databaseBackupPath,
        journal.databasePath,
        journal.databaseBackupBinding,
      )
      await rm(`${journal.databasePath}-wal`, { force: true })
      await rm(`${journal.databasePath}-shm`, { force: true })
    } finally {
      await hooks?.afterDatabaseRestore?.()
    }
  }
}

function targetRootFor(
  entry: PortableFileIndexEntry,
  roots: PortabilityTargetRoots,
): string | null {
  if (entry.target.kind === "config") return roots.config ?? null
  if (entry.target.kind === "extensions") return roots.extensions ?? null
  if (entry.target.kind === "history-files") return roots.historyFiles ?? null
  return roots.projectVaults?.[entry.target.projectId] ?? null
}

async function resolveTarget(
  root: string,
  relativePath: string,
): Promise<{
  targetPath: string
  targetBinding: PortableTargetBinding
  targetSnapshot: Awaited<ReturnType<typeof snapshotRegularFileNoFollow>> | null
}> {
  safeRelativeBundlePathSchema.parse(relativePath)
  if (!isAbsolute(root)) throw new Error("Import target root must be absolute.")
  const absoluteRoot = resolve(root)
  let ancestor = absoluteRoot
  while (!(await pathExists(ancestor))) {
    const parent = dirname(ancestor)
    if (parent === ancestor) throw new Error("Import target root has no verified parent.")
    ancestor = parent
  }
  const info = await lstat(ancestor, { bigint: true })
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Import target root is unsafe.")
  const canonicalAncestor = await realpath(ancestor)
  const canonicalRoot = resolve(canonicalAncestor, relative(ancestor, absoluteRoot))
  if (
    canonicalRoot !== canonicalAncestor &&
    !canonicalRoot.startsWith(`${canonicalAncestor}${sep}`)
  )
    throw new Error("Import target root escapes its verified parent.")
  const target = resolve(canonicalRoot, relativePath)
  if (target !== canonicalRoot && !target.startsWith(`${canonicalRoot}${sep}`))
    throw new Error("Import target path escapes its reviewed root.")
  let targetSnapshot: Awaited<ReturnType<typeof snapshotRegularFileNoFollow>> | null = null
  try {
    const leaf = await lstat(target)
    if (!leaf.isFile() || leaf.isSymbolicLink())
      throw new Error("Import target leaf must be a regular non-symlink file.")
    targetSnapshot = await snapshotRegularFileNoFollow(target, {
      maxBytes: PORTABILITY_LIMITS.fileBytes,
      previewBytes: 2_000,
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  return {
    targetPath: target,
    targetSnapshot,
    targetBinding: {
      rootPath: canonicalRoot,
      anchorPath: canonicalAncestor,
      deviceId: info.dev.toString(),
      inodeId: info.ino.toString(),
      leaf: targetSnapshot
        ? {
            sha256: targetSnapshot.sha256,
            bytes: targetSnapshot.bytes,
            deviceId: targetSnapshot.deviceId,
            inodeId: targetSnapshot.inodeId,
          }
        : null,
    },
  }
}

async function assertBoundTarget(
  binding: PortableTargetBinding,
  targetPath: string,
  leafMode: "reviewed" | "safe-only" = "reviewed",
): Promise<void> {
  const target = resolve(targetPath)
  if (target !== binding.rootPath && !target.startsWith(`${binding.rootPath}${sep}`))
    throw new Error("Import target path escaped its reviewed root.")
  const anchor = await lstat(binding.anchorPath, { bigint: true })
  if (
    !anchor.isDirectory() ||
    anchor.isSymbolicLink() ||
    anchor.dev.toString() !== binding.deviceId ||
    anchor.ino.toString() !== binding.inodeId
  )
    throw new Error("Import target root identity changed after review.")
  const parent = dirname(target)
  const segments = relative(binding.anchorPath, parent).split(sep).filter(Boolean)
  if (segments.includes("..")) throw new Error("Import target escaped its reviewed anchor.")
  let current = binding.anchorPath
  for (const segment of segments) {
    current = join(current, segment)
    try {
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Import target ancestor changed to an unsafe path.")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break
      throw error
    }
  }
  let leafExists = false
  try {
    const leaf = await lstat(target)
    leafExists = true
    if (!leaf.isFile() || leaf.isSymbolicLink())
      throw new Error("Import target leaf changed to an unsafe path.")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  if (leafMode === "safe-only") return
  if (!binding.leaf) {
    if (leafExists) throw new Error("Import target leaf appeared after review.")
    return
  }
  if (!leafExists) throw new Error("Import target leaf disappeared after review.")
  const snapshot = await snapshotRegularFileNoFollow(target, {
    maxBytes: PORTABILITY_LIMITS.fileBytes,
    previewBytes: 0,
  })
  if (
    snapshot.sha256 !== binding.leaf.sha256 ||
    snapshot.bytes !== binding.leaf.bytes ||
    snapshot.deviceId !== binding.leaf.deviceId ||
    snapshot.inodeId !== binding.leaf.inodeId
  )
    throw new Error("Import target leaf identity or content changed after review.")
}

async function copyFileAtomicBound(
  source: string,
  target: string,
  binding: PortableTargetBinding,
  leafMode: "reviewed" | "safe-only" = "reviewed",
  expectedSource?: BackupSourceBinding,
): Promise<void> {
  await assertBoundTarget(binding, target, leafMode)
  await createBoundParentDirectories(binding, dirname(target))
  await assertBoundTarget(binding, target, leafMode)
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  try {
    await copyRegularFileNoFollow(source, temporary, expectedSource)
    await assertBoundTarget(binding, target, leafMode)
    await rename(temporary, target)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function snapshotBackupSource(path: string): Promise<BackupSourceBinding> {
  const snapshot = await snapshotRegularFileNoFollow(path, {
    maxBytes: Number.MAX_SAFE_INTEGER,
    previewBytes: 0,
  })
  return {
    sha256: snapshot.sha256,
    bytes: snapshot.bytes,
    deviceId: snapshot.deviceId,
    inodeId: snapshot.inodeId,
  }
}

async function assertBackupSource(path: string, expected: BackupSourceBinding): Promise<void> {
  const actual = await snapshotBackupSource(path)
  if (
    actual.sha256 !== expected.sha256 ||
    actual.bytes !== expected.bytes ||
    actual.deviceId !== expected.deviceId ||
    actual.inodeId !== expected.inodeId
  )
    throw new Error("Import backup source identity or content changed after creation.")
}

async function createBoundParentDirectories(
  binding: PortableTargetBinding,
  parentPath: string,
): Promise<void> {
  const segments = relative(binding.anchorPath, parentPath).split(sep).filter(Boolean)
  if (segments.includes("..")) throw new Error("Import target escaped its reviewed anchor.")
  let current = binding.anchorPath
  for (const segment of segments) {
    current = join(current, segment)
    try {
      const info = await lstat(current)
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Import target ancestor changed to an unsafe path.")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      await mkdir(current, { mode: 0o700 })
      const created = await lstat(current)
      if (!created.isDirectory() || created.isSymbolicLink())
        throw new Error("Import target directory creation was redirected.")
    }
  }
}

async function copyReviewedBundleFile(
  source: string,
  target: string,
  expectedSha256: string,
): Promise<void> {
  const snapshot = await snapshotRegularFileNoFollow(source, {
    maxBytes: PORTABILITY_LIMITS.fileBytes,
    previewBytes: 0,
  })
  if (snapshot.sha256 !== expectedSha256)
    throw new Error("Portable bundle file changed after review.")
  await copyRegularFileNoFollow(source, target, snapshot)
}

function safeFilePreview(contents: Buffer, scopeId: PortableScopeId): string {
  const value = contents.toString("utf8").slice(0, 2_000)
  const redacted = redactText(value, { scopeId, path: "import-preview" }).value
  try {
    return stableJson(
      sanitizeStructuredValue(JSON.parse(redacted) as unknown, {
        scopeId,
        path: "import-preview",
      }).value,
    ).slice(0, 2_000)
  } catch {
    return redacted
  }
}

function collectPortableProjectIds(
  records: readonly PortableDatabaseRecord[],
  manifest: PortableManifest,
): Set<string> {
  const projectIds = new Set(manifest.scopes.flatMap((scope) => scope.projectIds ?? []))
  for (const record of records) {
    const candidates = [
      record.identity.project_id,
      record.row.project_id,
      record.tableName === "projects" ? record.identity.id : undefined,
      record.tableName === "projects" ? record.row.id : undefined,
    ]
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.length > 0) projectIds.add(candidate)
    }
  }
  return projectIds
}

async function validateReviewedTargetRoots(
  roots: PortabilityTargetRoots,
  importedProjectIds: ReadonlySet<string>,
  database: Database.Database,
): Promise<void> {
  const destinations = new Map<string, string>()
  for (const [field, mappings] of [
    ["projects", roots.projects],
    ["projectVaults", roots.projectVaults],
  ] as const) {
    for (const [projectId, root] of Object.entries(mappings ?? {})) {
      if (!importedProjectIds.has(projectId))
        throw new Error(`Target mapping for unrelated project ${projectId} is not allowed.`)
      if (!isAbsolute(root)) throw new Error(`Target mapping for ${projectId} must be absolute.`)
      if (root.split(/[\\/]/).includes(".."))
        throw new Error(`Target mapping for ${projectId} contains path traversal.`)
      const destinationKey = portableCollisionKey(resolve(root))
      const owner = destinations.get(destinationKey)
      if (owner && owner !== `${field}:${projectId}`)
        throw new Error(`Target mapping for ${projectId} is ambiguous with ${owner}.`)
      destinations.set(destinationKey, `${field}:${projectId}`)

      assertDestinationNotOwnedByAnotherProject(database, field, projectId, root)
      if (field === "projects") {
        const info = await lstat(root)
        if (!info.isDirectory() || info.isSymbolicLink())
          throw new Error(
            `Project target for ${projectId} must be an existing non-symlink directory.`,
          )
      } else {
        await resolveTarget(root, ".flapstack-import-root-probe")
      }
    }
  }
}

function assertDestinationNotOwnedByAnotherProject(
  database: Database.Database,
  field: "projects" | "projectVaults",
  projectId: string,
  root: string,
): void {
  const tableName = field === "projects" ? "projects" : "project_vaults"
  if (!tableExists(database, tableName)) return
  const idColumn = field === "projects" ? "id" : "project_id"
  const pathColumn = field === "projects" ? "path" : "root_path"
  const owner = database
    .prepare(
      `SELECT ${quoteIdentifier(idColumn)} FROM ${quoteIdentifier(tableName)} WHERE ${quoteIdentifier(pathColumn)} = ? AND ${quoteIdentifier(idColumn)} <> ? LIMIT 1`,
    )
    .pluck()
    .get(root, projectId) as string | undefined
  if (owner)
    throw new Error(`Target mapping for ${projectId} belongs to unrelated project ${owner}.`)
}

function deduplicateMappingRequirements(
  requirements: readonly PortableMappingRequirement[],
): PortableMappingRequirement[] {
  return [
    ...new Map(requirements.map((entry) => [`${entry.kind}\0${entry.projectId}`, entry])).values(),
  ].sort((left, right) =>
    `${left.kind}\0${left.projectId}`.localeCompare(`${right.kind}\0${right.projectId}`),
  )
}

function assertMappingsResolved(plan: PortableImportPlan): void {
  if (plan.mappingRequirements.length > 0)
    throw new Error("Import target mappings are incomplete; review mappings and run dry-run again.")
}

function readLocalRow(
  database: Database.Database,
  diff: PortableDatabaseDiff,
): Record<string, unknown> {
  const entries = Object.entries(diff.identity)
  const where = entries.map(([key]) => `${quoteIdentifier(key)} = ?`).join(" AND ")
  const row = database
    .prepare(`SELECT * FROM ${quoteIdentifier(diff.tableName)} WHERE ${where} LIMIT 1`)
    .get(...entries.map(([, value]) => decodeValue(value))) as Record<string, unknown> | undefined
  if (!row) throw new Error(`Local conflict value disappeared for ${diff.tableName}.`)
  return row
}

async function recordFileBases(
  stateRoot: string,
  files: readonly PortableFileDiff[],
  resolutions?: Readonly<Record<string, PortableConflictResolution>>,
): Promise<void> {
  const bases = await readFileBases(stateRoot)
  for (const file of files) {
    const resolution = resolutions?.[file.id]
    if (
      file.kind === "skip" ||
      resolution === "use-incoming" ||
      file.kind === "create" ||
      file.kind === "update"
    ) {
      bases[file.bundlePath] = file.incomingSha256
    }
  }
  await writeJsonAtomic(join(stateRoot, "file-bases.json"), bases)
}

async function readFileBases(stateRoot: string): Promise<Record<string, string>> {
  try {
    return await readJsonFile(join(stateRoot, "file-bases.json"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw error
  }
}

function diffFingerprint(plan: PortableImportPlan): string {
  return sha256(
    stableJson({
      targetRoots: plan.targetRoots,
      mappingRequirements: plan.mappingRequirements,
      database: plan.database,
      files: plan.files,
    }),
  )
}

function importConfirmationHash(
  plan: PortableImportPlan,
  resolutions?: Readonly<Record<string, PortableConflictResolution>>,
): string {
  const conflictIds = new Set(
    [...plan.database, ...plan.files]
      .filter((entry) => entry.kind === "conflict")
      .map((entry) => entry.id),
  )
  const selected = Object.entries(resolutions ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )
  for (const [id, resolution] of selected) {
    if (!conflictIds.has(id) || !["keep-local", "use-incoming", "keep-both"].includes(resolution))
      throw new Error("Import resolution set does not match the reviewed conflicts.")
  }
  return sha256(
    stableJson({
      bundleFingerprint: plan.bundleFingerprint,
      targetRoots: plan.targetRoots,
      mappingRequirements: plan.mappingRequirements,
      database: plan.database.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        scopeId: entry.scopeId,
        tableName: entry.tableName,
        identity: entry.identity,
        incomingSha256: entry.incomingSha256,
        localSha256: entry.localSha256,
      })),
      files: plan.files.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        scopeId: entry.scopeId,
        bundlePath: entry.bundlePath,
        targetPath: entry.targetPath,
        targetBinding: entry.targetBinding,
        incomingSha256: entry.incomingSha256,
        localSha256: entry.localSha256,
      })),
      resolutions: Object.fromEntries(selected),
    }),
  )
}

function rowHash(row: Record<string, unknown>): string {
  return sha256(stableJson(normalizeRow(row)))
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      Buffer.isBuffer(value)
        ? { $flapstack: "bytes", base64: value.toString("base64") }
        : typeof value === "bigint"
          ? { $flapstack: "bigint", value: value.toString() }
          : value,
    ]),
  )
}

function decodeValue(value: unknown): unknown {
  return decodePortableRow({ value }).value
}

function planPath(stateRoot: string, planId: string): string {
  return join(stateRoot, "plans", `${planId}.json`)
}

function journalPath(stateRoot: string, operationId: string): string {
  return join(stateRoot, "journals", `${operationId}.json`)
}

async function writeJournal(stateRoot: string, journal: ImportJournal): Promise<void> {
  await writeJsonAtomic(journalPath(stateRoot, journal.operationId), journal)
}

function assertUuid(value: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(value)) throw new Error("Invalid portability operation ID.")
}

function tableExists(database: Database.Database, tableName: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  )
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false
    throw error
  }
}

function fault(hooks: ImportApplyHooks | undefined, phase: ImportApplyHooks["faultAt"]): void {
  if (hooks?.faultAt === phase) throw new Error(`Injected portability fault: ${phase}`)
}
