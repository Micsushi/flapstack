import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import * as schema from "../src/main/lib/db/schema"
import { createPortableExport } from "../src/main/lib/portability/exporter"
import {
  applyPortableImport,
  createPortableImportConfirmation,
  createPortableImportPlan,
  mergePortableImportTargetRoots,
  restorePortableBackup,
  type PortableImportPlan,
  type PortabilityTargetRoots,
} from "../src/main/lib/portability/importer"
import {
  scaffoldProjectVault,
  writeProjectVaultSection,
} from "../src/main/lib/project-vaults/storage"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("portable project-vault destination remapping", () => {
  it("never treats stale discovered source roots as dry-run prerequisites", async () => {
    const fixture = await portableVaultFixture()
    const roots = mergePortableImportTargetRoots(
      {
        projects: {
          "project-1": fixture.removedSourceProjectRoot,
          "stale-unrelated": fixture.removedUnrelatedRoot,
        },
      },
      undefined,
    )

    expect(roots.projects).toBeUndefined()
    const before = targetRows(fixture.targetDatabasePath)
    const plan = await planImport(fixture, roots)

    expect(plan.mappingRequirements).toEqual([
      {
        kind: "project-vault",
        projectId: "project-1",
        targetRootField: "projectVaults",
        reason: "missing-current-target",
      },
    ])
    expect(plan.files.length).toBeGreaterThan(0)
    expect(
      plan.files.every((file) => file.targetPath === null && file.targetBinding === null),
    ).toBe(true)
    expect(plan.database.find((entry) => entry.tableName === "projects")?.incoming).not.toContain(
      fixture.removedSourceProjectRoot,
    )
    expect(targetRows(fixture.targetDatabasePath)).toEqual(before)
    await expect(access(fixture.targetVaultRoot)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(
      createPortableImportConfirmation({ stateRoot: fixture.stateRoot, planId: plan.id }),
    ).rejects.toThrow(/mappings are incomplete/i)
  })

  it("applies an exact reviewed target mapping and restores the pre-import vault state", async () => {
    const fixture = await portableVaultFixture()
    const targetRoots: PortabilityTargetRoots = {
      projects: { "project-1": fixture.targetProjectRoot },
      projectVaults: { "project-1": fixture.targetVaultRoot },
    }
    const before = targetRows(fixture.targetDatabasePath)
    const plan = await planImport(fixture, targetRoots)
    expect(plan.mappingRequirements).toEqual([])
    const resolutions = incomingResolutions(plan)
    const confirmation = await createPortableImportConfirmation({
      stateRoot: fixture.stateRoot,
      planId: plan.id,
      resolutions,
    })
    const applied = await applyPortableImport({
      planId: plan.id,
      expectedFingerprint: plan.bundleFingerprint,
      expectedConfirmationHash: confirmation.confirmationHash,
      databasePath: fixture.targetDatabasePath,
      stateRoot: fixture.stateRoot,
      targetRoots,
      resolutions,
    })

    const restored = new Database(fixture.targetDatabasePath, { readonly: true })
    expect(vaultMetadata(restored)).toEqual(fixture.sourceVaultMetadata)
    expect(
      restored
        .prepare("SELECT root_path FROM project_vaults WHERE project_id = ?")
        .pluck()
        .get("project-1"),
    ).toBe(fixture.targetVaultRoot)
    restored.close()
    expect(await readFile(join(fixture.targetVaultRoot, "index.md"), "utf8")).toBe(
      "# Portable knowledge\n\nVersion two.\n",
    )
    expect(await readFile(fixture.unrelatedSentinel, "utf8")).toBe("do-not-touch")

    await restorePortableBackup({
      stateRoot: fixture.stateRoot,
      operationId: applied.operationId,
      databasePath: fixture.targetDatabasePath,
    })
    expect(targetRows(fixture.targetDatabasePath)).toEqual(before)
    const rolledBack = new Database(fixture.targetDatabasePath, { readonly: true })
    expect(rolledBack.prepare("SELECT COUNT(*) FROM project_vaults").pluck().get()).toBe(0)
    rolledBack.close()
    await expect(access(join(fixture.targetVaultRoot, "index.md"))).rejects.toMatchObject({
      code: "ENOENT",
    })
    expect(await readFile(fixture.unrelatedSentinel, "utf8")).toBe("do-not-touch")
  })

  it("rejects unrelated, ambiguous, missing, symlinked, traversing, and owned targets", async () => {
    const fixture = await portableVaultFixture()
    await expect(
      planImport(fixture, {
        projects: { unrelated: fixture.targetProjectRoot },
      }),
    ).rejects.toThrow(/unrelated project/i)
    await expect(
      planImport(fixture, {
        projects: { "project-1": fixture.targetProjectRoot },
        projectVaults: { "project-1": fixture.targetProjectRoot },
      }),
    ).rejects.toThrow(/ambiguous/i)
    await expect(
      planImport(fixture, {
        projects: { "project-1": join(fixture.root, "missing-project") },
      }),
    ).rejects.toThrow(/project target|ENOENT/i)

    const symlinkTarget = join(fixture.root, "vault-link")
    await symlink(fixture.unrelatedRoot, symlinkTarget)
    await expect(
      planImport(fixture, {
        projects: { "project-1": fixture.targetProjectRoot },
        projectVaults: { "project-1": symlinkTarget },
      }),
    ).rejects.toThrow(/unsafe/i)
    await expect(
      planImport(fixture, {
        projects: { "project-1": fixture.targetProjectRoot },
        projectVaults: { "project-1": `${fixture.root}/reviewed/../escaped` },
      }),
    ).rejects.toThrow(/traversal/i)

    const database = new Database(fixture.targetDatabasePath)
    database
      .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
      .run("owned", "Owned", fixture.unrelatedRoot)
    database.close()
    await expect(
      planImport(fixture, {
        projects: { "project-1": fixture.unrelatedRoot },
      }),
    ).rejects.toThrow(/belongs to unrelated project owned/i)
    expect(await readFile(fixture.unrelatedSentinel, "utf8")).toBe("do-not-touch")
  })

  it("rejects mapping, manifest, fingerprint, and destination precondition drift before writes", async () => {
    const fixture = await portableVaultFixture()
    const targetRoots: PortabilityTargetRoots = {
      projects: { "project-1": fixture.targetProjectRoot },
      projectVaults: { "project-1": fixture.targetVaultRoot },
    }
    const before = targetRows(fixture.targetDatabasePath)
    const mappingPlan = await planImport(fixture, targetRoots)
    const mappingResolutions = incomingResolutions(mappingPlan)
    const mappingConfirmation = await createPortableImportConfirmation({
      stateRoot: fixture.stateRoot,
      planId: mappingPlan.id,
      resolutions: mappingResolutions,
    })
    await expect(
      applyPortableImport({
        planId: mappingPlan.id,
        expectedFingerprint: mappingPlan.bundleFingerprint,
        expectedConfirmationHash: mappingConfirmation.confirmationHash,
        databasePath: fixture.targetDatabasePath,
        stateRoot: fixture.stateRoot,
        targetRoots: {
          ...targetRoots,
          projectVaults: { "project-1": join(fixture.root, "changed-target") },
        },
        resolutions: mappingResolutions,
      }),
    ).rejects.toThrow(/mappings changed after review/i)

    await mkdir(fixture.targetVaultRoot, { recursive: true })
    await writeFile(join(fixture.targetVaultRoot, "index.md"), "appeared after preview")
    await expect(
      applyPortableImport({
        planId: mappingPlan.id,
        expectedFingerprint: mappingPlan.bundleFingerprint,
        expectedConfirmationHash: mappingConfirmation.confirmationHash,
        databasePath: fixture.targetDatabasePath,
        stateRoot: fixture.stateRoot,
        targetRoots,
        resolutions: mappingResolutions,
      }),
    ).rejects.toThrow(/live state changed after dry-run/i)
    await rm(fixture.targetVaultRoot, { recursive: true, force: true })

    const manifestPlan = await planImport(fixture, targetRoots)
    const manifestResolutions = incomingResolutions(manifestPlan)
    const manifestConfirmation = await createPortableImportConfirmation({
      stateRoot: fixture.stateRoot,
      planId: manifestPlan.id,
      resolutions: manifestResolutions,
    })
    await writeFile(join(manifestPlan.bundlePath, "manifest.json"), "{}")
    await expect(
      applyPortableImport({
        planId: manifestPlan.id,
        expectedFingerprint: manifestPlan.bundleFingerprint.replace(/^./, "0"),
        expectedConfirmationHash: manifestConfirmation.confirmationHash,
        databasePath: fixture.targetDatabasePath,
        stateRoot: fixture.stateRoot,
        targetRoots,
        resolutions: manifestResolutions,
      }),
    ).rejects.toThrow(/manifest|checksum|bundle/i)
    expect(targetRows(fixture.targetDatabasePath)).toEqual(before)
    expect(await readFile(fixture.unrelatedSentinel, "utf8")).toBe("do-not-touch")
  })
})

async function portableVaultFixture() {
  const root = await mkdtemp(join(tmpdir(), "flapstack-vault-remap-"))
  roots.push(root)
  const sourceDatabasePath = join(root, "source.db")
  const removedSourceProjectRoot = join(root, "removed-source-project")
  const removedUnrelatedRoot = join(root, "removed-unrelated-worktree")
  const sourceAppData = join(root, "removed-source-profile")
  await mkdir(removedSourceProjectRoot)
  await mkdir(removedUnrelatedRoot)
  await mkdir(sourceAppData)

  const sourceSqlite = new Database(sourceDatabasePath)
  sourceSqlite.pragma("foreign_keys = ON")
  const source = drizzle(sourceSqlite, { schema })
  migrate(source, { migrationsFolder: resolve(process.cwd(), "drizzle") })
  source
    .insert(schema.projects)
    .values({ id: "project-1", name: "Portable vault", path: removedSourceProjectRoot })
    .run()
  const scaffold = await scaffoldProjectVault(source, {
    projectId: "project-1",
    appDataRoot: sourceAppData,
    sections: ["index", "handoff"],
  })
  await writeProjectVaultSection(source, {
    projectId: "project-1",
    sectionId: "index",
    expectedVersion: 1,
    content: "# Portable knowledge\n\nVersion two.\n",
  })
  const sourceVaultMetadata = vaultMetadata(sourceSqlite)
  sourceSqlite.close()

  const bundlePath = join(root, "vault.flapstack-export")
  await createPortableExport({
    outputPath: bundlePath,
    databasePath: sourceDatabasePath,
    appVersion: "test",
    selection: [{ id: "project-vaults", projectIds: ["project-1"] }],
    fileSources: [
      {
        scopeId: "project-vaults",
        root: scaffold.vault.rootPath,
        target: { kind: "project-vault", projectId: "project-1" },
      },
    ],
  })
  await rm(removedSourceProjectRoot, { recursive: true })
  await rm(removedUnrelatedRoot, { recursive: true })
  await rm(sourceAppData, { recursive: true })

  const targetDatabasePath = join(root, "target.db")
  const targetProjectRoot = join(root, "current-project")
  const unrelatedRoot = join(root, "unrelated-data")
  const unrelatedSentinel = join(unrelatedRoot, "sentinel.txt")
  await mkdir(targetProjectRoot)
  await mkdir(unrelatedRoot)
  await writeFile(unrelatedSentinel, "do-not-touch")
  const targetSqlite = new Database(targetDatabasePath)
  targetSqlite.pragma("foreign_keys = ON")
  const target = drizzle(targetSqlite, { schema })
  migrate(target, { migrationsFolder: resolve(process.cwd(), "drizzle") })
  target
    .insert(schema.projects)
    .values({ id: "project-1", name: "Portable vault", path: targetProjectRoot })
    .run()
  targetSqlite.close()

  return {
    root,
    sourceDatabasePath,
    removedSourceProjectRoot,
    removedUnrelatedRoot,
    sourceAppData,
    sourceVaultMetadata,
    bundlePath,
    targetDatabasePath,
    targetProjectRoot,
    targetVaultRoot: join(root, "current-profile", "knowledge-vaults", "project-1"),
    unrelatedRoot,
    unrelatedSentinel,
    stateRoot: join(root, "state"),
  }
}

function planImport(
  fixture: Awaited<ReturnType<typeof portableVaultFixture>>,
  targetRoots: PortabilityTargetRoots,
): Promise<PortableImportPlan> {
  return createPortableImportPlan({
    bundlePath: fixture.bundlePath,
    databasePath: fixture.targetDatabasePath,
    stateRoot: fixture.stateRoot,
    targetRoots,
  })
}

function incomingResolutions(plan: PortableImportPlan) {
  return Object.fromEntries(
    [...plan.database, ...plan.files]
      .filter((entry) => entry.kind === "conflict")
      .map((entry) => [entry.id, "use-incoming" as const]),
  )
}

function targetRows(databasePath: string): unknown[] {
  const database = new Database(databasePath, { readonly: true })
  try {
    return database.prepare("SELECT id, name, path FROM projects ORDER BY id").all() as unknown[]
  } finally {
    database.close()
  }
}

function vaultMetadata(database: Database.Database): unknown {
  return {
    sections: database
      .prepare(
        "SELECT section_id, section_type, title, relative_path, version, content_hash, byte_length, created_at, updated_at FROM project_vault_sections ORDER BY section_id",
      )
      .all(),
    backups: database
      .prepare(
        "SELECT id, section_id, version, relative_path, content_hash, byte_length, created_at FROM project_vault_backups ORDER BY section_id, version",
      )
      .all(),
  }
}
