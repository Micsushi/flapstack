import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import * as schema from "../src/main/lib/db/schema"
import { createPortableExport } from "../src/main/lib/portability/exporter"
import { readPortableDatabase } from "../src/main/lib/portability/database"
import { PORTABLE_BUNDLE_LAYOUT } from "../src/shared/portability"
import { ProjectVaultGraphIndex } from "../src/main/lib/project-vaults/graph-index"
import {
  applyPortableImport,
  createPortableImportConfirmation,
  createPortableImportPlan,
  recoverInterruptedImports,
} from "../src/main/lib/portability/importer"
import {
  listProjectVaultSectionBackups,
  readProjectVaultSection,
  readProjectVaultSectionBackup,
  scaffoldProjectVault,
  writeProjectVaultSection,
} from "../src/main/lib/project-vaults/storage"
import { updateProjectVaultPolicy } from "../src/main/lib/project-vaults/policy"
import {
  ensureProjectVaultGitExclusion,
  removeProjectVaultGitExclusion,
} from "../src/main/lib/project-vaults/git-exclusion"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("project vault portability", () => {
  it("exports graph Markdown and safe attachments but excludes derived and Obsidian state", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-vault-graph-portability-"))
    roots.push(root)
    const databasePath = join(root, "source.db")
    const projectRoot = join(root, "project")
    const appDataRoot = join(root, "profile")
    await mkdir(projectRoot)
    await mkdir(appDataRoot)
    const sqlite = new Database(databasePath)
    sqlite.pragma("foreign_keys = ON")
    const database = drizzle(sqlite, { schema })
    migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })
    database
      .insert(schema.projects)
      .values({ id: "project-1", name: "Graph vault", path: projectRoot })
      .run()
    const scaffold = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index"],
    })
    const vaultRoot = scaffold.vault.rootPath
    await mkdir(join(vaultRoot, "Research"))
    await mkdir(join(vaultRoot, "Assets"))
    await mkdir(join(vaultRoot, ".obsidian"))
    await mkdir(join(vaultRoot, ".backups", "custom"), { recursive: true })
    await writeFile(join(vaultRoot, "Research", "Graph.md"), "# Graph\n")
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("portable"),
    ])
    await writeFile(join(vaultRoot, "Assets", "graph.png"), png)
    await writeFile(join(vaultRoot, ".obsidian", "community-plugins.json"), '["unsafe"]')
    await writeFile(join(vaultRoot, ".backups", "custom", "old.md"), "derived")
    await new ProjectVaultGraphIndex(sqlite).rebuild("project-1")
    sqlite.close()

    const bundlePath = join(root, "graph.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath,
      appVersion: "test",
      selection: [{ id: "project-vaults", projectIds: ["project-1"] }],
      fileSources: [
        {
          scopeId: "project-vaults",
          root: vaultRoot,
          target: { kind: "project-vault", projectId: "project-1" },
        },
      ],
    })

    const exportedRoot = join(bundlePath, "scopes", "project-vaults", "files", "0")
    await expect(readFile(join(exportedRoot, "Research", "Graph.md"), "utf8")).resolves.toBe(
      "# Graph\n",
    )
    await expect(readFile(join(exportedRoot, "Assets", "graph.png"))).resolves.toEqual(png)
    await expect(
      readFile(join(exportedRoot, ".obsidian", "community-plugins.json")),
    ).rejects.toMatchObject({ code: "ENOENT" })
    await expect(
      readFile(join(exportedRoot, ".backups", "custom", "old.md"), "utf8"),
    ).resolves.toBe("derived")
    expect(
      readPortableDatabase(join(bundlePath, PORTABLE_BUNDLE_LAYOUT.database)).some((record) =>
        record.tableName.startsWith("project_vault_graph_"),
      ),
    ).toBe(false)
  })

  it("round-trips content, section metadata, backups, schema, and root identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-vault-portability-"))
    roots.push(root)
    const sourceDatabasePath = join(root, "source.db")
    const sourceProjectRoot = join(root, "source-project")
    const sourceAppData = join(root, "source-profile")
    await mkdir(sourceProjectRoot)
    await mkdir(sourceAppData)

    const sourceSqlite = new Database(sourceDatabasePath)
    sourceSqlite.pragma("foreign_keys = ON")
    const source = drizzle(sourceSqlite, { schema })
    migrate(source, { migrationsFolder: resolve(process.cwd(), "drizzle") })
    source
      .insert(schema.projects)
      .values({ id: "project-1", name: "Portable vault", path: sourceProjectRoot })
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
      content: "# Portable knowledge\n\nCurrent content.\n",
    })
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

    const targetDatabasePath = join(root, "target.db")
    const targetSqlite = new Database(targetDatabasePath)
    targetSqlite.pragma("foreign_keys = ON")
    migrate(drizzle(targetSqlite, { schema }), {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    })
    targetSqlite.close()
    const targetProjectRoot = join(root, "target-project")
    const targetVaultParent = join(root, "target-profile", "knowledge-vaults")
    const targetVaultRoot = join(targetVaultParent, "project-1")
    await mkdir(targetProjectRoot)
    await mkdir(targetVaultParent, { recursive: true })
    const stateRoot = join(root, "import-state")
    const targetRoots = {
      projects: { "project-1": targetProjectRoot },
      projectVaults: { "project-1": targetVaultRoot },
    }
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetDatabasePath,
      stateRoot,
      targetRoots,
    })
    const confirmation = await createPortableImportConfirmation({
      stateRoot,
      planId: plan.id,
    })
    await applyPortableImport({
      planId: plan.id,
      expectedFingerprint: plan.bundleFingerprint,
      expectedConfirmationHash: confirmation.confirmationHash,
      databasePath: targetDatabasePath,
      stateRoot,
      targetRoots,
    })

    const restoredSqlite = new Database(targetDatabasePath)
    restoredSqlite.pragma("foreign_keys = ON")
    const restored = drizzle(restoredSqlite, { schema })
    const restoredSection = await readProjectVaultSection(restored, {
      projectId: "project-1",
      sectionId: "index",
    })
    expect(restoredSection).toMatchObject({
      content: "# Portable knowledge\n\nCurrent content.\n",
      sectionType: "index",
      title: "Index",
      relativePath: "index.md",
      version: 2,
      externallyModified: false,
    })
    expect(restoredSection.contentHash).toBe(
      createHash("sha256").update(restoredSection.content).digest("hex"),
    )
    expect(restoredSection.currentContentHash).toBe(restoredSection.contentHash)
    const [backup] = listProjectVaultSectionBackups(restored, {
      projectId: "project-1",
      sectionId: "index",
    })
    expect(backup).toMatchObject({ version: 1 })
    await expect(
      readProjectVaultSectionBackup(restored, {
        projectId: "project-1",
        sectionId: "index",
        backupId: backup!.id,
      }),
    ).resolves.toMatchObject({ content: "# Project Knowledge\n\n" })
    expect(restored.select().from(schema.projectVaults).get()).toMatchObject({
      projectId: "project-1",
      rootPath: targetVaultRoot,
      schemaVersion: 1,
    })
    expect(await readFile(join(targetVaultRoot, "current-handoff.md"), "utf8")).toBe(
      "# Current Handoff\n\n",
    )
    restoredSqlite.close()
  })

  it("installs and verifies a local exclusion before importing into project-owned storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-vault-portability-git-"))
    roots.push(root)
    const source = await createProjectOwnedVault(root, "source", "# Imported knowledge\n")
    const bundlePath = join(root, "project-owned.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: source.databasePath,
      appVersion: "test",
      selection: [{ id: "project-vaults", projectIds: ["project-1"] }],
      fileSources: [
        {
          scopeId: "project-vaults",
          root: source.vaultRoot,
          target: { kind: "project-vault", projectId: "project-1" },
        },
      ],
    })

    const targetDatabasePath = join(root, "target.db")
    migrateEmptyDatabase(targetDatabasePath)
    const targetProjectRoot = join(root, "target-project")
    await mkdir(targetProjectRoot)
    git(targetProjectRoot, ["init", "-q"])
    const targetVaultRoot = join(targetProjectRoot, ".flapstack", "knowledge")
    const stateRoot = join(root, "import-state")
    const targetRoots = {
      projects: { "project-1": targetProjectRoot },
      projectVaults: { "project-1": targetVaultRoot },
    }
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetDatabasePath,
      stateRoot,
      targetRoots,
    })
    const confirmation = await createPortableImportConfirmation({
      stateRoot,
      planId: plan.id,
    })

    await applyPortableImport({
      planId: plan.id,
      expectedFingerprint: plan.bundleFingerprint,
      expectedConfirmationHash: confirmation.confirmationHash,
      databasePath: targetDatabasePath,
      stateRoot,
      targetRoots,
    })

    expectGitIgnored(targetProjectRoot, ".flapstack/knowledge/index.md")
    expect(await readFile(join(targetVaultRoot, "index.md"), "utf8")).toBe("# Imported knowledge\n")
  })

  it("removes only the owned exclusion after importing a tracking-enabled policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-vault-portability-tracked-import-"))
    roots.push(root)
    const source = await createProjectOwnedVault(root, "source", "# Tracked incoming\n")
    const sourceSqlite = new Database(source.databasePath)
    updateProjectVaultPolicy(drizzle(sourceSqlite, { schema }), {
      projectId: "project-1",
      appDataRoot: source.appDataRoot,
      locationMode: "project-owned",
      projectOwnedOptIn: true,
      gitTrackingEnabled: true,
      gitTrackingOptIn: true,
    })
    sourceSqlite.close()
    const targetDatabasePath = join(root, "tracked-target.db")
    migrateEmptyDatabase(targetDatabasePath)
    const targetProjectRoot = join(root, "tracked-target-project")
    await mkdir(targetProjectRoot)
    git(targetProjectRoot, ["init", "-q"])
    ensureProjectVaultGitExclusion(targetProjectRoot)
    const targetVaultRoot = join(targetProjectRoot, ".flapstack", "knowledge")
    expectGitIgnored(targetProjectRoot, ".flapstack/knowledge/index.md")
    const bundlePath = join(root, "tracked-import.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: source.databasePath,
      appVersion: "test",
      selection: [{ id: "project-vaults", projectIds: ["project-1"] }],
      fileSources: [
        {
          scopeId: "project-vaults",
          root: source.vaultRoot,
          target: { kind: "project-vault", projectId: "project-1" },
        },
      ],
    })
    const stateRoot = join(root, "tracked-import-state")
    const targetRoots = {
      projects: { "project-1": targetProjectRoot },
      projectVaults: { "project-1": targetVaultRoot },
    }
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetDatabasePath,
      stateRoot,
      targetRoots,
    })
    const confirmation = await createPortableImportConfirmation({
      stateRoot,
      planId: plan.id,
    })

    await applyPortableImport({
      planId: plan.id,
      expectedFingerprint: plan.bundleFingerprint,
      expectedConfirmationHash: confirmation.confirmationHash,
      databasePath: targetDatabasePath,
      stateRoot,
      targetRoots,
    })

    expect(await readFile(join(targetVaultRoot, "index.md"), "utf8")).toBe("# Tracked incoming\n")
    expectGitNotIgnored(targetProjectRoot, ".flapstack/knowledge/index.md")
    const importedSqlite = new Database(targetDatabasePath, { readonly: true })
    expect(
      (
        importedSqlite
          .prepare("SELECT git_tracking_enabled FROM project_vault_policies WHERE project_id = ?")
          .get("project-1") as { git_tracking_enabled: number }
      ).git_tracking_enabled,
    ).toBe(1)
    importedSqlite.close()
  })

  it("reinstalls the exclusion before a fault rollback restores project-owned content", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-vault-portability-rollback-"))
    roots.push(root)
    const source = await createProjectOwnedVault(root, "source", "# Incoming\n")
    const target = await createProjectOwnedVault(root, "target", "# Local\n")
    const bundlePath = join(root, "rollback.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: source.databasePath,
      appVersion: "test",
      selection: [{ id: "project-vaults", projectIds: ["project-1"] }],
      fileSources: [
        {
          scopeId: "project-vaults",
          root: source.vaultRoot,
          target: { kind: "project-vault", projectId: "project-1" },
        },
      ],
    })
    removeProjectVaultGitExclusion(target.projectRoot)
    const stateRoot = join(root, "rollback-state")
    const targetRoots = {
      projects: { "project-1": target.projectRoot },
      projectVaults: { "project-1": target.vaultRoot },
    }
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: target.databasePath,
      stateRoot,
      targetRoots,
    })
    const resolutions = Object.fromEntries(
      [...plan.database, ...plan.files]
        .filter((entry) => entry.kind === "conflict")
        .map((entry) => [entry.id, "use-incoming" as const]),
    )
    const confirmation = await createPortableImportConfirmation({
      stateRoot,
      planId: plan.id,
      resolutions,
    })

    await expect(
      applyPortableImport({
        planId: plan.id,
        expectedFingerprint: plan.bundleFingerprint,
        expectedConfirmationHash: confirmation.confirmationHash,
        databasePath: target.databasePath,
        stateRoot,
        targetRoots,
        resolutions,
        hooks: {
          faultAt: "after-files",
          beforeFileRollback: () => removeProjectVaultGitExclusion(target.projectRoot),
        },
      }),
    ).rejects.toThrow("Injected portability fault")

    expect(await readFile(join(target.vaultRoot, "index.md"), "utf8")).toBe("# Local\n")
    expectGitIgnored(target.projectRoot, ".flapstack/knowledge/index.md")
  })

  it("restores tracking-enabled policy and exclusion state after a failed import", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-vault-portability-tracking-rollback-"))
    roots.push(root)
    const source = await createProjectOwnedVault(root, "source", "# Incoming\n")
    const target = await createProjectOwnedVault(root, "target", "# Local\n")
    const targetSqlite = new Database(target.databasePath)
    const targetDatabase = drizzle(targetSqlite, { schema })
    updateProjectVaultPolicy(targetDatabase, {
      projectId: "project-1",
      appDataRoot: target.appDataRoot,
      locationMode: "project-owned",
      projectOwnedOptIn: true,
      gitTrackingEnabled: true,
      gitTrackingOptIn: true,
    })
    targetSqlite.close()
    const excludePath = resolve(
      git(target.projectRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      "info",
      "exclude",
    )
    const excludeBefore = await readFile(excludePath, "utf8")
    expectGitNotIgnored(target.projectRoot, ".flapstack/knowledge/index.md")

    const bundlePath = join(root, "tracking-rollback.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: source.databasePath,
      appVersion: "test",
      selection: [{ id: "project-vaults", projectIds: ["project-1"] }],
      fileSources: [
        {
          scopeId: "project-vaults",
          root: source.vaultRoot,
          target: { kind: "project-vault", projectId: "project-1" },
        },
      ],
    })
    const stateRoot = join(root, "tracking-rollback-state")
    const targetRoots = {
      projects: { "project-1": target.projectRoot },
      projectVaults: { "project-1": target.vaultRoot },
    }
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: target.databasePath,
      stateRoot,
      targetRoots,
    })
    const resolutions = Object.fromEntries(
      [...plan.database, ...plan.files]
        .filter((entry) => entry.kind === "conflict")
        .map((entry) => [entry.id, "use-incoming" as const]),
    )
    const confirmation = await createPortableImportConfirmation({
      stateRoot,
      planId: plan.id,
      resolutions,
    })
    let durableJournalObserved = false

    await expect(
      applyPortableImport({
        planId: plan.id,
        expectedFingerprint: plan.bundleFingerprint,
        expectedConfirmationHash: confirmation.confirmationHash,
        databasePath: target.databasePath,
        stateRoot,
        targetRoots,
        resolutions,
        hooks: {
          faultAt: "after-git-exclusion",
          beforeFileRollback: async () => {
            const journalFiles = await readdir(join(stateRoot, "journals"))
            expect(journalFiles).toHaveLength(1)
            const journal = JSON.parse(
              await readFile(join(stateRoot, "journals", journalFiles[0]), "utf8"),
            ) as { phase: string }
            expect(journal.phase).toBe("backup-created")
            expectGitIgnored(target.projectRoot, ".flapstack/knowledge/index.md")
            durableJournalObserved = true
          },
        },
      }),
    ).rejects.toThrow("Injected portability fault: after-git-exclusion")

    expect(durableJournalObserved).toBe(true)
    expect(await readFile(join(target.vaultRoot, "index.md"), "utf8")).toBe("# Local\n")
    expect(await readFile(excludePath, "utf8")).toBe(excludeBefore)
    expectGitNotIgnored(target.projectRoot, ".flapstack/knowledge/index.md")
    const restoredSqlite = new Database(target.databasePath, { readonly: true })
    expect(
      (
        restoredSqlite
          .prepare("SELECT git_tracking_enabled FROM project_vault_policies WHERE project_id = ?")
          .get("project-1") as { git_tracking_enabled: number }
      ).git_tracking_enabled,
    ).toBe(1)
    restoredSqlite.close()
  })

  it("rejects a linked-worktree tracking transition before journal or exclusion mutation", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-vault-portability-linked-"))
    roots.push(root)
    const source = await createProjectOwnedVault(root, "source", "# Incoming\n")
    const target = await createProjectOwnedVault(root, "target", "# Local\n")
    const targetSqlite = new Database(target.databasePath)
    updateProjectVaultPolicy(drizzle(targetSqlite, { schema }), {
      projectId: "project-1",
      appDataRoot: target.appDataRoot,
      locationMode: "project-owned",
      projectOwnedOptIn: true,
      gitTrackingEnabled: true,
      gitTrackingOptIn: true,
    })
    targetSqlite.close()
    await writeFile(join(target.projectRoot, "README.md"), "fixture\n")
    git(target.projectRoot, ["add", "README.md"])
    git(target.projectRoot, ["commit", "-q", "-m", "fixture"])
    git(target.projectRoot, [
      "worktree",
      "add",
      "-q",
      "-b",
      "linked-import-sibling",
      join(root, "target-sibling"),
    ])
    const excludePath = resolve(
      git(target.projectRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      "info",
      "exclude",
    )
    const excludeBefore = await readFile(excludePath, "utf8")
    expectGitNotIgnored(target.projectRoot, ".flapstack/knowledge/index.md")

    const bundlePath = join(root, "linked-import.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: source.databasePath,
      appVersion: "test",
      selection: [{ id: "project-vaults", projectIds: ["project-1"] }],
      fileSources: [
        {
          scopeId: "project-vaults",
          root: source.vaultRoot,
          target: { kind: "project-vault", projectId: "project-1" },
        },
      ],
    })
    const stateRoot = join(root, "linked-import-state")
    const targetRoots = {
      projects: { "project-1": target.projectRoot },
      projectVaults: { "project-1": target.vaultRoot },
    }
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: target.databasePath,
      stateRoot,
      targetRoots,
    })
    const resolutions = Object.fromEntries(
      [...plan.database, ...plan.files]
        .filter((entry) => entry.kind === "conflict")
        .map((entry) => [entry.id, "use-incoming" as const]),
    )
    const confirmation = await createPortableImportConfirmation({
      stateRoot,
      planId: plan.id,
      resolutions,
    })

    await expect(
      applyPortableImport({
        planId: plan.id,
        expectedFingerprint: plan.bundleFingerprint,
        expectedConfirmationHash: confirmation.confirmationHash,
        databasePath: target.databasePath,
        stateRoot,
        targetRoots,
        resolutions,
        hooks: { faultAt: "after-git-exclusion" },
      }),
    ).rejects.toThrow(/linked worktree/)

    expect(await readFile(excludePath, "utf8")).toBe(excludeBefore)
    expectGitNotIgnored(target.projectRoot, ".flapstack/knowledge/index.md")
    await expect(readdir(join(stateRoot, "journals"))).rejects.toMatchObject({ code: "ENOENT" })
    const restoredSqlite = new Database(target.databasePath, { readonly: true })
    expect(
      (
        restoredSqlite
          .prepare("SELECT git_tracking_enabled FROM project_vault_policies WHERE project_id = ?")
          .get("project-1") as { git_tracking_enabled: number }
      ).git_tracking_enabled,
    ).toBe(1)
    restoredSqlite.close()
  })

  it("exactly undoes its exclusion when a linked sibling appears after preflight", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-vault-portability-linked-race-"))
    roots.push(root)
    const source = await createProjectOwnedVault(root, "source", "# Incoming\n")
    const target = await createProjectOwnedVault(root, "target", "# Local\n")
    const targetSqlite = new Database(target.databasePath)
    updateProjectVaultPolicy(drizzle(targetSqlite, { schema }), {
      projectId: "project-1",
      appDataRoot: target.appDataRoot,
      locationMode: "project-owned",
      projectOwnedOptIn: true,
      gitTrackingEnabled: true,
      gitTrackingOptIn: true,
    })
    targetSqlite.close()
    await writeFile(join(target.projectRoot, "README.md"), "fixture\n")
    git(target.projectRoot, ["add", "README.md"])
    git(target.projectRoot, ["commit", "-q", "-m", "fixture"])
    const excludePath = resolve(
      git(target.projectRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      "info",
      "exclude",
    )
    const excludeBefore = await readFile(excludePath, "utf8")

    const bundlePath = join(root, "linked-race.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: source.databasePath,
      appVersion: "test",
      selection: [{ id: "project-vaults", projectIds: ["project-1"] }],
      fileSources: [
        {
          scopeId: "project-vaults",
          root: source.vaultRoot,
          target: { kind: "project-vault", projectId: "project-1" },
        },
      ],
    })
    const stateRoot = join(root, "linked-race-state")
    const siblingRoot = join(root, "late-sibling")
    const targetRoots = {
      projects: { "project-1": target.projectRoot },
      projectVaults: { "project-1": target.vaultRoot },
    }
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: target.databasePath,
      stateRoot,
      targetRoots,
    })
    const resolutions = Object.fromEntries(
      [...plan.database, ...plan.files]
        .filter((entry) => entry.kind === "conflict")
        .map((entry) => [entry.id, "use-incoming" as const]),
    )
    const confirmation = await createPortableImportConfirmation({
      stateRoot,
      planId: plan.id,
      resolutions,
    })

    await expect(
      applyPortableImport({
        planId: plan.id,
        expectedFingerprint: plan.bundleFingerprint,
        expectedConfirmationHash: confirmation.confirmationHash,
        databasePath: target.databasePath,
        stateRoot,
        targetRoots,
        resolutions,
        hooks: {
          faultAt: "after-git-exclusion",
          afterGitExclusionMutation: () => {
            git(target.projectRoot, [
              "worktree",
              "add",
              "-q",
              "-b",
              "late-linked-sibling",
              siblingRoot,
            ])
          },
        },
      }),
    ).rejects.toThrow("Injected portability fault: after-git-exclusion")

    expect(await readFile(excludePath, "utf8")).toBe(excludeBefore)
    expectGitNotIgnored(target.projectRoot, ".flapstack/knowledge/index.md")
    expectGitNotIgnored(siblingRoot, ".flapstack/knowledge/index.md")
    const restoredSqlite = new Database(target.databasePath, { readonly: true })
    expect(
      (
        restoredSqlite
          .prepare("SELECT git_tracking_enabled FROM project_vault_policies WHERE project_id = ?")
          .get("project-1") as { git_tracking_enabled: number }
      ).git_tracking_enabled,
    ).toBe(1)
    restoredSqlite.close()
  })

  it("recovers a crash immediately after exclusion mutation from a durable journal", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-vault-portability-crash-"))
    roots.push(root)
    const source = await createProjectOwnedVault(root, "source", "# Incoming\n")
    const target = await createProjectOwnedVault(root, "target", "# Local\n")
    const targetSqlite = new Database(target.databasePath)
    updateProjectVaultPolicy(drizzle(targetSqlite, { schema }), {
      projectId: "project-1",
      appDataRoot: target.appDataRoot,
      locationMode: "project-owned",
      projectOwnedOptIn: true,
      gitTrackingEnabled: true,
      gitTrackingOptIn: true,
    })
    targetSqlite.close()
    const excludePath = resolve(
      git(target.projectRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
      "info",
      "exclude",
    )
    const excludeBefore = await readFile(excludePath, "utf8")

    const bundlePath = join(root, "crash-import.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: source.databasePath,
      appVersion: "test",
      selection: [{ id: "project-vaults", projectIds: ["project-1"] }],
      fileSources: [
        {
          scopeId: "project-vaults",
          root: source.vaultRoot,
          target: { kind: "project-vault", projectId: "project-1" },
        },
      ],
    })
    const stateRoot = join(root, "crash-import-state")
    const targetRoots = {
      projects: { "project-1": target.projectRoot },
      projectVaults: { "project-1": target.vaultRoot },
    }
    for (const crash of [
      { at: "after-git-exclusion", status: 91, phase: "backup-created" },
      { at: "after-file-publish", status: 92, phase: "files-publishing" },
    ] as const) {
      const plan = await createPortableImportPlan({
        bundlePath,
        databasePath: target.databasePath,
        stateRoot,
        targetRoots,
      })
      const resolutions = Object.fromEntries(
        [...plan.database, ...plan.files]
          .filter((entry) => entry.kind === "conflict")
          .map((entry) => [entry.id, "use-incoming" as const]),
      )
      const confirmation = await createPortableImportConfirmation({
        stateRoot,
        planId: plan.id,
        resolutions,
      })
      const crashInputPath = join(root, `crash-input-${crash.status}.json`)
      await writeFile(
        crashInputPath,
        JSON.stringify({
          crashAt: crash.at,
          planId: plan.id,
          expectedFingerprint: plan.bundleFingerprint,
          expectedConfirmationHash: confirmation.confirmationHash,
          databasePath: target.databasePath,
          stateRoot,
          targetRoots,
          resolutions,
        }),
      )

      const child = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve("tests", "fixtures", "portability-import-crash-child.ts"),
          crashInputPath,
        ],
        { cwd: process.cwd(), encoding: "utf8", timeout: 30_000, windowsHide: true },
      )
      expect(child.status, child.stderr).toBe(crash.status)
      expectGitIgnored(target.projectRoot, ".flapstack/knowledge/index.md")
      const journals = await Promise.all(
        (await readdir(join(stateRoot, "journals"))).map(async (file) => ({
          file,
          value: JSON.parse(await readFile(join(stateRoot, "journals", file), "utf8")) as {
            phase: string
          },
        })),
      )
      const active = journals.filter(
        ({ value }) => value.phase !== "rolled-back" && value.phase !== "complete",
      )
      expect(active).toHaveLength(1)
      expect(active[0].value.phase).toBe(crash.phase)

      const recovery = await recoverInterruptedImports(stateRoot, target.databasePath)
      expect(recovery).toContainEqual({
        operationId: active[0].file.replace(/\.json$/, ""),
        action: "rolled-back",
      })
      expect(await readFile(excludePath, "utf8")).toBe(excludeBefore)
      expectGitNotIgnored(target.projectRoot, ".flapstack/knowledge/index.md")
      expect(await readFile(join(target.vaultRoot, "index.md"), "utf8")).toBe("# Local\n")
    }
  }, 60_000)
})

async function createProjectOwnedVault(
  root: string,
  prefix: string,
  content: string,
): Promise<{
  databasePath: string
  projectRoot: string
  vaultRoot: string
  appDataRoot: string
}> {
  const databasePath = join(root, `${prefix}.db`)
  const projectRoot = join(root, `${prefix}-project`)
  const appDataRoot = join(root, `${prefix}-profile`)
  await mkdir(projectRoot)
  await mkdir(appDataRoot)
  git(projectRoot, ["init", "-q"])
  const sqlite = new Database(databasePath)
  sqlite.pragma("foreign_keys = ON")
  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })
  database
    .insert(schema.projects)
    .values({ id: "project-1", name: "Portable vault", path: projectRoot })
    .run()
  updateProjectVaultPolicy(database, {
    projectId: "project-1",
    appDataRoot,
    locationMode: "project-owned",
    projectOwnedOptIn: true,
    gitTrackingEnabled: false,
  })
  const scaffold = await scaffoldProjectVault(database, {
    projectId: "project-1",
    appDataRoot,
    sections: ["index"],
  })
  await writeProjectVaultSection(database, {
    projectId: "project-1",
    sectionId: "index",
    expectedVersion: 1,
    content,
  })
  sqlite.close()
  return { databasePath, projectRoot, vaultRoot: scaffold.vault.rootPath, appDataRoot }
}

function migrateEmptyDatabase(path: string): void {
  const sqlite = new Database(path)
  sqlite.pragma("foreign_keys = ON")
  migrate(drizzle(sqlite, { schema }), {
    migrationsFolder: resolve(process.cwd(), "drizzle"),
  })
  sqlite.close()
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim()
}

function expectGitIgnored(root: string, relativePath: string): void {
  expect(() =>
    execFileSync("git", ["check-ignore", "-q", "--no-index", "--", relativePath], {
      cwd: root,
      stdio: "ignore",
    }),
  ).not.toThrow()
}

function expectGitNotIgnored(root: string, relativePath: string): void {
  expect(() =>
    execFileSync("git", ["check-ignore", "-q", "--no-index", "--", relativePath], {
      cwd: root,
      stdio: "ignore",
    }),
  ).toThrow()
}
