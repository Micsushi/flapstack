import { and, desc, eq } from "drizzle-orm"
import { createHash, randomUUID } from "node:crypto"
import { lstat, readdir, rm } from "node:fs/promises"
import { basename, dirname, join, relative, resolve } from "node:path"
import type { getDatabase } from "../db"
import {
  filesystemRootRegistrations,
  projectVaultBackups,
  projectVaultSections,
  projectVaults,
} from "../db/schema"
import {
  actOnPathInsideRoot,
  readFileInsideRoot,
  renamePathInsideRoot,
  writeFileInsideRoot,
} from "../path-safety"
import {
  assertRegisteredFilesystemRoot,
  bindFilesystemRootIdentity,
} from "../git/security/path-validation"
import {
  getDefaultCentralVaultPath,
  getDefaultProjectOwnedVaultPath,
  getOrCreateProjectVaultPolicy,
  type ProjectVaultPolicy,
} from "./policy"
import {
  getProjectVaultSectionDefinition,
  PROJECT_VAULT_SCHEMA_VERSION,
  projectVaultSectionRegistry,
  type ProjectVaultSectionId,
} from "./registry"
import { assertProjectVaultContentSafe } from "./content-safety"

type Database = ReturnType<typeof getDatabase>
type VaultRow = typeof projectVaults.$inferSelect
type SectionRow = typeof projectVaultSections.$inferSelect

const MAX_VAULT_SECTION_BYTES = 4_000_000
const sectionLocks = new Map<string, Promise<void>>()

export class ProjectVaultConflictError extends Error {
  constructor(
    message: string,
    public readonly currentVersion: number,
    public readonly currentContentHash: string,
  ) {
    super(message)
    this.name = "ProjectVaultConflictError"
  }
}

export type ProjectVaultDeleteContract = {
  kind: "delete-project-knowledge-vault"
  projectId: string
  rootPath: string
  schemaVersion: number
  sectionVersions: Array<{ sectionId: string; version: number; contentHash: string }>
  requiredPhrase: string
}

export type ProjectVaultWriteHooks = {
  /** Test seam for proving content CAS immediately before atomic replace. */
  beforeContentCommit?: () => void | Promise<void>
  /** Test seam for proving filesystem rollback after a post-write failure. */
  afterContentWrite?: () => void | Promise<void>
}

export type ProjectVaultRestoreHooks = {
  /** Test seam for proving missing-file recovery cleanup ownership. */
  afterMissingContentWrite?: () => void | Promise<void>
}

class ProjectVaultCleanupRefusedError extends Error {}

export async function scaffoldProjectVault(
  database: Database,
  input: {
    projectId: string
    appDataRoot: string
    sections: readonly ProjectVaultSectionId[]
  },
): Promise<{ vault: VaultRow; sections: SectionRow[] }> {
  return withVaultMutationLock(input.projectId, () => scaffoldProjectVaultUnlocked(database, input))
}

async function scaffoldProjectVaultUnlocked(
  database: Database,
  input: {
    projectId: string
    appDataRoot: string
    sections: readonly ProjectVaultSectionId[]
  },
): Promise<{ vault: VaultRow; sections: SectionRow[] }> {
  const selected = uniqueSectionDefinitions(input.sections)
  if (selected.length === 0) throw new Error("Select at least one project vault section.")
  if (
    database
      .select({ projectId: projectVaults.projectId })
      .from(projectVaults)
      .where(eq(projectVaults.projectId, input.projectId))
      .get()
  ) {
    throw new Error("Project vault is already scaffolded.")
  }

  const policy = getOrCreateProjectVaultPolicy(database, input)
  const plan = bindVaultContainer(database, policy)
  if (await pathExists(policy.vaultPath)) {
    throw new Error("Project vault path already exists and cannot be adopted implicitly.")
  }

  const rows = selected.map((definition) => {
    const bytes = Buffer.from(definition.initialContent, "utf8")
    return {
      projectId: input.projectId,
      sectionId: definition.id,
      sectionType: definition.id,
      title: definition.title,
      relativePath: definition.fileName,
      version: 1,
      contentHash: sha256(bytes),
      byteLength: bytes.byteLength,
    }
  })

  let createdRoot = false
  let metadataCommitted = false
  try {
    for (const [index, definition] of selected.entries()) {
      await writeFileInsideRoot(
        plan.container.canonicalPath,
        join(plan.vaultRelativePath, definition.fileName),
        { data: definition.initialContent },
      )
      if (index === 0) createdRoot = true
    }
    bindFilesystemRootIdentity(policy.vaultPath, database)

    const created = database.transaction((tx) => {
      const vault = tx
        .insert(projectVaults)
        .values({
          projectId: input.projectId,
          rootPath: policy.vaultPath,
          schemaVersion: PROJECT_VAULT_SCHEMA_VERSION,
        })
        .returning()
        .get()
      tx.insert(projectVaultSections).values(rows).run()
      return vault
    })
    metadataCommitted = true
    return { vault: created, sections: listProjectVaultSections(database, input.projectId) }
  } catch (error) {
    if (metadataCommitted) {
      database.delete(projectVaults).where(eq(projectVaults.projectId, input.projectId)).run()
    }
    database
      .delete(filesystemRootRegistrations)
      .where(eq(filesystemRootRegistrations.path, policy.vaultPath))
      .run()
    if (createdRoot)
      await removeCreatedVaultRoot(plan.container.canonicalPath, plan.vaultRelativePath)
    throw error
  }
}

export function listProjectVaultSections(database: Database, projectId: string): SectionRow[] {
  const rows = database
    .select()
    .from(projectVaultSections)
    .where(eq(projectVaultSections.projectId, projectId))
    .all()
  const order = new Map(projectVaultSectionRegistry.map((section, index) => [section.id, index]))
  return rows.sort(
    (left, right) =>
      (order.get(left.sectionId as ProjectVaultSectionId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.sectionId as ProjectVaultSectionId) ?? Number.MAX_SAFE_INTEGER),
  )
}

export async function createProjectVaultSection(
  database: Database,
  input: {
    projectId: string
    sectionId: ProjectVaultSectionId
    expectedVersion: 0
    content: string
  },
): Promise<SectionRow> {
  return withVaultMutationLock(input.projectId, async () => {
    if (input.expectedVersion !== 0) {
      throw new ProjectVaultConflictError(
        "New project vault sections require expectedVersion 0.",
        0,
        "",
      )
    }
    assertProjectVaultContentSafe(input.content)
    const definition = getProjectVaultSectionDefinition(input.sectionId)
    const vault = getVaultOrThrow(database, input.projectId)
    const root = assertRegisteredFilesystemRoot(vault.rootPath, database)
    const existing = database
      .select()
      .from(projectVaultSections)
      .where(
        and(
          eq(projectVaultSections.projectId, input.projectId),
          eq(projectVaultSections.sectionId, input.sectionId),
        ),
      )
      .get()
    if (existing || (await pathExists(join(root.canonicalPath, definition.fileName)))) {
      throw new ProjectVaultConflictError(
        "Project vault section already exists.",
        existing?.version ?? 0,
        existing?.contentHash ?? "",
      )
    }

    const bytes = Buffer.from(input.content, "utf8")
    if (bytes.byteLength > MAX_VAULT_SECTION_BYTES) {
      throw new Error("Project vault section exceeds the storage size limit.")
    }
    const values = {
      projectId: input.projectId,
      sectionId: definition.id,
      sectionType: definition.id,
      title: definition.title,
      relativePath: definition.fileName,
      version: 1,
      contentHash: sha256(bytes),
      byteLength: bytes.byteLength,
    }

    await writeFileInsideRoot(root.canonicalPath, definition.fileName, { data: bytes })
    try {
      return database.transaction((tx) => {
        const created = tx.insert(projectVaultSections).values(values).returning().get()
        tx.update(projectVaults)
          .set({ updatedAt: new Date() })
          .where(eq(projectVaults.projectId, vault.projectId))
          .run()
        return created
      })
    } catch (error) {
      await removeVaultFile(root.canonicalPath, definition.fileName)
      throw error
    }
  })
}

export async function readProjectVaultSection(
  database: Database,
  input: { projectId: string; sectionId: ProjectVaultSectionId },
): Promise<
  SectionRow & { content: string; currentContentHash: string; externallyModified: boolean }
> {
  const { vault, section, root } = getVerifiedSection(database, input)
  const bytes = await readFileInsideRoot(root.canonicalPath, section.relativePath, {
    maxBytes: MAX_VAULT_SECTION_BYTES,
  })
  const currentContentHash = sha256(bytes)
  return {
    ...section,
    content: bytes.toString("utf8"),
    currentContentHash,
    externallyModified: currentContentHash !== section.contentHash,
    projectId: vault.projectId,
  }
}

export async function writeProjectVaultSection(
  database: Database,
  input: {
    projectId: string
    sectionId: ProjectVaultSectionId
    expectedVersion: number
    expectedCurrentContentHash?: string
    content: string
  },
  hooks: ProjectVaultWriteHooks = {},
): Promise<SectionRow> {
  return withVaultMutationLock(input.projectId, async () => {
    assertProjectVaultContentSafe(input.content)
    const { vault, section, root } = getVerifiedSection(database, input)
    if (section.version !== input.expectedVersion) {
      throw new ProjectVaultConflictError(
        "Project vault section version is stale.",
        section.version,
        section.contentHash,
      )
    }

    const previous = await readFileInsideRoot(root.canonicalPath, section.relativePath, {
      maxBytes: MAX_VAULT_SECTION_BYTES,
    })
    const previousHash = sha256(previous)
    if (previousHash !== section.contentHash && previousHash !== input.expectedCurrentContentHash) {
      throw new ProjectVaultConflictError(
        "Project vault section changed outside Flapstack.",
        section.version,
        previousHash,
      )
    }

    const next = Buffer.from(input.content, "utf8")
    if (next.byteLength > MAX_VAULT_SECTION_BYTES) {
      throw new Error("Project vault section exceeds the storage size limit.")
    }
    const nextHash = sha256(next)
    const backupRelativePath = `.backups/${section.sectionId}/v${section.version}-${previousHash}.md`
    await writeFileInsideRoot(
      root.canonicalPath,
      backupRelativePath,
      { data: previous },
      { overwrite: true },
    )

    let contentWritten = false
    try {
      await writeFileInsideRoot(
        root.canonicalPath,
        section.relativePath,
        { data: next },
        {
          overwrite: true,
          expectedSha256: previousHash,
          beforeCommit: hooks.beforeContentCommit,
        },
      )
      contentWritten = true
      await hooks.afterContentWrite?.()

      return commitProjectVaultSectionVersion(
        database,
        {
          vault,
          section,
          projectId: input.projectId,
          sectionId: input.sectionId,
          contentHash: nextHash,
          byteLength: next.byteLength,
        },
        (tx) =>
          tx
            .insert(projectVaultBackups)
            .values({
              projectId: input.projectId,
              sectionId: input.sectionId,
              version: section.version,
              relativePath: backupRelativePath,
              contentHash: previousHash,
              byteLength: previous.byteLength,
            })
            .run(),
      )
    } catch (error) {
      if (contentWritten) {
        try {
          await writeFileInsideRoot(
            root.canonicalPath,
            section.relativePath,
            { data: previous },
            { overwrite: true, expectedSha256: nextHash },
          )
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Project vault write failed and content rollback also failed.",
          )
        }
      }
      await removeVaultFile(root.canonicalPath, backupRelativePath)
      if (!contentWritten && isStaleWriteTargetError(error)) {
        let currentHash = section.contentHash
        try {
          currentHash = sha256(
            await readFileInsideRoot(root.canonicalPath, section.relativePath, {
              maxBytes: MAX_VAULT_SECTION_BYTES,
            }),
          )
        } catch {
          // The target is still a conflict even when the replacement cannot be read safely.
        }
        throw new ProjectVaultConflictError(
          "Project vault section changed outside Flapstack.",
          section.version,
          currentHash,
        )
      }
      throw error
    }
  })
}

export function listProjectVaultSectionBackups(
  database: Database,
  input: { projectId: string; sectionId: ProjectVaultSectionId },
) {
  getVerifiedSection(database, input)
  return database
    .select()
    .from(projectVaultBackups)
    .where(
      and(
        eq(projectVaultBackups.projectId, input.projectId),
        eq(projectVaultBackups.sectionId, input.sectionId),
      ),
    )
    .orderBy(desc(projectVaultBackups.version))
    .all()
}

export async function readProjectVaultSectionBackup(
  database: Database,
  input: { projectId: string; sectionId: ProjectVaultSectionId; backupId: string },
) {
  const { root } = getVerifiedSection(database, input)
  const backup = database
    .select()
    .from(projectVaultBackups)
    .where(
      and(
        eq(projectVaultBackups.id, input.backupId),
        eq(projectVaultBackups.projectId, input.projectId),
        eq(projectVaultBackups.sectionId, input.sectionId),
      ),
    )
    .get()
  if (!backup) throw new Error("Project vault backup not found.")
  const bytes = await readFileInsideRoot(root.canonicalPath, backup.relativePath, {
    maxBytes: MAX_VAULT_SECTION_BYTES,
  })
  if (bytes.byteLength !== backup.byteLength || sha256(bytes) !== backup.contentHash) {
    throw new Error("Project vault backup content does not match its recorded identity.")
  }
  const content = bytes.toString("utf8")
  assertProjectVaultContentSafe(content)
  return { ...backup, content }
}

export async function restoreProjectVaultSectionBackup(
  database: Database,
  input: {
    projectId: string
    sectionId: ProjectVaultSectionId
    backupId: string
    expectedVersion: number
  },
  hooks: ProjectVaultRestoreHooks = {},
): Promise<SectionRow> {
  const backup = await readProjectVaultSectionBackup(database, input)
  try {
    return await writeProjectVaultSection(database, {
      projectId: input.projectId,
      sectionId: input.sectionId,
      expectedVersion: input.expectedVersion,
      content: backup.content,
    })
  } catch (error) {
    if (!isMissingPathError(error)) throw error
  }

  return withVaultMutationLock(input.projectId, async () => {
    assertProjectVaultContentSafe(backup.content)
    const { vault, section, root } = getVerifiedSection(database, input)
    if (section.version !== input.expectedVersion) {
      throw new ProjectVaultConflictError(
        "Project vault section version is stale.",
        section.version,
        section.contentHash,
      )
    }
    try {
      const current = await readFileInsideRoot(root.canonicalPath, section.relativePath, {
        maxBytes: MAX_VAULT_SECTION_BYTES,
      })
      throw new ProjectVaultConflictError(
        "Project vault section reappeared before missing-file recovery.",
        section.version,
        sha256(current),
      )
    } catch (error) {
      if (!isMissingPathError(error)) throw error
    }

    const restored = Buffer.from(backup.content, "utf8")
    const restoredHash = sha256(restored)
    await writeFileInsideRoot(
      root.canonicalPath,
      section.relativePath,
      { data: restored },
      { createParents: false, expectedSha256: null },
    )
    try {
      await hooks.afterMissingContentWrite?.()
      return commitProjectVaultSectionVersion(database, {
        vault,
        section,
        projectId: input.projectId,
        sectionId: input.sectionId,
        contentHash: restoredHash,
        byteLength: restored.byteLength,
      })
    } catch (error) {
      await removeVaultFileIfContentMatches(root.canonicalPath, section.relativePath, restoredHash)
      throw error
    }
  })
}

export async function adoptExternalProjectVaultSectionChange(
  database: Database,
  input: {
    projectId: string
    sectionId: ProjectVaultSectionId
    expectedVersion: number
    expectedCurrentContentHash: string
  },
): Promise<SectionRow> {
  return withVaultMutationLock(input.projectId, async () => {
    const { vault, section, root } = getVerifiedSection(database, input)
    if (section.version !== input.expectedVersion) {
      throw new ProjectVaultConflictError(
        "Project vault section version is stale.",
        section.version,
        section.contentHash,
      )
    }
    const bytes = await readFileInsideRoot(root.canonicalPath, section.relativePath, {
      maxBytes: MAX_VAULT_SECTION_BYTES,
    })
    assertProjectVaultContentSafe(bytes.toString("utf8"))
    const currentHash = sha256(bytes)
    if (currentHash !== input.expectedCurrentContentHash || currentHash === section.contentHash) {
      throw new ProjectVaultConflictError(
        "Project vault external change no longer matches the reviewed content.",
        section.version,
        currentHash,
      )
    }
    return commitProjectVaultSectionVersion(database, {
      vault,
      section,
      projectId: input.projectId,
      sectionId: input.sectionId,
      contentHash: currentHash,
      byteLength: bytes.byteLength,
    })
  })
}

export function getProjectVaultDeleteContract(
  database: Database,
  projectId: string,
): ProjectVaultDeleteContract {
  const vault = getVaultOrThrow(database, projectId)
  return {
    kind: "delete-project-knowledge-vault",
    projectId,
    rootPath: vault.rootPath,
    schemaVersion: vault.schemaVersion,
    sectionVersions: listProjectVaultSections(database, projectId).map((section) => ({
      sectionId: section.sectionId,
      version: section.version,
      contentHash: section.contentHash,
    })),
    requiredPhrase: `DELETE PROJECT KNOWLEDGE ${projectId}`,
  }
}

export async function deleteProjectVault(
  database: Database,
  input: { contract: ProjectVaultDeleteContract; confirmationPhrase: string },
): Promise<{ projectId: string; deleted: true }> {
  return withVaultMutationLock(input.contract.projectId, () =>
    deleteProjectVaultUnlocked(database, input),
  )
}

async function deleteProjectVaultUnlocked(
  database: Database,
  input: { contract: ProjectVaultDeleteContract; confirmationPhrase: string },
): Promise<{ projectId: string; deleted: true }> {
  const current = getProjectVaultDeleteContract(database, input.contract.projectId)
  if (input.confirmationPhrase !== current.requiredPhrase) {
    throw new Error("Project vault deletion requires the exact confirmation phrase.")
  }
  if (JSON.stringify(input.contract) !== JSON.stringify(current)) {
    throw new Error("Project vault changed after deletion confirmation was prepared.")
  }

  const policy = getOrCreateProjectVaultPolicy(database, {
    projectId: current.projectId,
    appDataRoot: dirname(dirname(current.rootPath)),
  })
  if (policy.deletionMode !== "retain-until-explicit-delete") {
    throw new Error("Project vault policy does not permit explicit deletion.")
  }
  if (resolve(policy.vaultPath) !== resolve(current.rootPath)) {
    throw new Error("Project vault policy path changed after scaffold.")
  }

  const root = assertRegisteredFilesystemRoot(current.rootPath, database)
  await assertTreeContainsNoSymlinks(root.canonicalPath)
  const plan = bindVaultContainer(database, policy)
  const stagedName = `.flapstack-delete-${randomUUID()}`
  const staged = await renamePathInsideRoot(
    plan.container.canonicalPath,
    plan.vaultRelativePath,
    stagedName,
  )

  try {
    database.transaction((tx) => {
      tx.delete(projectVaults).where(eq(projectVaults.projectId, current.projectId)).run()
      tx.delete(filesystemRootRegistrations)
        .where(eq(filesystemRootRegistrations.path, current.rootPath))
        .run()
    })
  } catch (error) {
    await renamePathInsideRoot(
      plan.container.canonicalPath,
      relative(plan.container.canonicalPath, staged.newPath),
      basename(root.canonicalPath),
    )
    throw error
  }

  await actOnPathInsideRoot(
    plan.container.canonicalPath,
    relative(plan.container.canonicalPath, staged.newPath),
    (targetPath) => rm(targetPath, { recursive: true }),
  )
  return { projectId: current.projectId, deleted: true }
}

function commitProjectVaultSectionVersion(
  database: Database,
  input: {
    vault: VaultRow
    section: SectionRow
    projectId: string
    sectionId: string
    contentHash: string
    byteLength: number
  },
  beforeVaultUpdate?: (tx: Pick<Database, "insert">) => unknown,
): SectionRow {
  return database.transaction((tx) => {
    const updated = tx
      .update(projectVaultSections)
      .set({
        version: input.section.version + 1,
        contentHash: input.contentHash,
        byteLength: input.byteLength,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(projectVaultSections.projectId, input.projectId),
          eq(projectVaultSections.sectionId, input.sectionId),
          eq(projectVaultSections.version, input.section.version),
          eq(projectVaultSections.contentHash, input.section.contentHash),
        ),
      )
      .returning()
      .get()
    if (!updated) {
      throw new ProjectVaultConflictError(
        "Project vault section version is stale.",
        input.section.version,
        input.section.contentHash,
      )
    }
    beforeVaultUpdate?.(tx as unknown as Pick<Database, "insert">)
    tx.update(projectVaults)
      .set({ updatedAt: new Date() })
      .where(eq(projectVaults.projectId, input.vault.projectId))
      .run()
    return updated
  })
}

function getVerifiedSection(
  database: Database,
  input: { projectId: string; sectionId: ProjectVaultSectionId },
): {
  vault: VaultRow
  section: SectionRow
  root: ReturnType<typeof assertRegisteredFilesystemRoot>
} {
  const vault = getVaultOrThrow(database, input.projectId)
  const section = database
    .select()
    .from(projectVaultSections)
    .where(
      and(
        eq(projectVaultSections.projectId, input.projectId),
        eq(projectVaultSections.sectionId, input.sectionId),
      ),
    )
    .get()
  if (!section) throw new Error("Project vault section not found.")
  getProjectVaultSectionDefinition(input.sectionId)
  return {
    vault,
    section,
    root: assertRegisteredFilesystemRoot(vault.rootPath, database),
  }
}

function getVaultOrThrow(database: Database, projectId: string): VaultRow {
  const vault = database
    .select()
    .from(projectVaults)
    .where(eq(projectVaults.projectId, projectId))
    .get()
  if (!vault) throw new Error("Project vault is not scaffolded.")
  return vault
}

function bindVaultContainer(
  database: Database,
  policy: ProjectVaultPolicy,
): {
  container: ReturnType<typeof bindFilesystemRootIdentity>
  vaultRelativePath: string
} {
  const vaultPath = resolve(policy.vaultPath)
  const containerPath = dirname(dirname(vaultPath))
  const expectedPath =
    policy.locationMode === "app-managed"
      ? getDefaultCentralVaultPath(containerPath, policy.projectId)
      : getDefaultProjectOwnedVaultPath(containerPath)
  if (resolve(expectedPath) !== vaultPath) {
    throw new Error("Project vault policy path does not match its registered location mode.")
  }
  return {
    container: bindFilesystemRootIdentity(containerPath, database),
    vaultRelativePath: relative(containerPath, vaultPath),
  }
}

function uniqueSectionDefinitions(sectionIds: readonly ProjectVaultSectionId[]) {
  const seen = new Set<ProjectVaultSectionId>()
  return sectionIds.map((sectionId) => {
    if (seen.has(sectionId)) throw new Error(`Duplicate project vault section: ${sectionId}`)
    seen.add(sectionId)
    return getProjectVaultSectionDefinition(sectionId)
  })
}

async function removeCreatedVaultRoot(
  containerRoot: string,
  vaultRelativePath: string,
): Promise<void> {
  try {
    await actOnPathInsideRoot(containerRoot, vaultRelativePath, (targetPath) =>
      rm(targetPath, { recursive: true }),
    )
  } catch {
    // Preserve the original scaffold failure. Rooted cleanup never follows an
    // unverified replacement path.
  }
}

async function removeVaultFile(rootPath: string, relativePath: string): Promise<void> {
  try {
    await actOnPathInsideRoot(rootPath, relativePath, (targetPath) => rm(targetPath))
  } catch {
    // Best-effort cleanup only. The typed backup row was not committed.
  }
}

async function removeVaultFileIfContentMatches(
  rootPath: string,
  relativePath: string,
  expectedHash: string,
): Promise<void> {
  try {
    await actOnPathInsideRoot(rootPath, relativePath, (targetPath) => rm(targetPath), {
      beforeCommit: async () => {
        const current = await readFileInsideRoot(rootPath, relativePath, {
          maxBytes: MAX_VAULT_SECTION_BYTES,
        })
        if (sha256(current) !== expectedHash) {
          throw new ProjectVaultCleanupRefusedError()
        }
      },
    })
  } catch {
    // Cleanup is ownership-conditional and best effort. If another process
    // replaced or changed the recovered file, preserve its content.
  }
}

async function assertTreeContainsNoSymlinks(rootPath: string): Promise<void> {
  for (const entry of await readdir(rootPath, { withFileTypes: true })) {
    const path = resolve(rootPath, entry.name)
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error("Project vault deletion refuses symbolic links.")
    if (info.isDirectory()) await assertTreeContainsNoSymlinks(path)
    else if (!info.isFile()) throw new Error("Project vault contains an unsupported file type.")
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function isStaleWriteTargetError(error: unknown): boolean {
  return error instanceof Error && error.message === "Write target content is stale"
}

function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex")
}

async function withVaultMutationLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = sectionLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const held = new Promise<void>((resolveHeld) => {
    release = resolveHeld
  })
  const queued = previous.then(() => held)
  sectionLocks.set(key, queued)
  await previous
  try {
    return await action()
  } finally {
    release()
    if (sectionLocks.get(key) === queued) sectionLocks.delete(key)
  }
}
