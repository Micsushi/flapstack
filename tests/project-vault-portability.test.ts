import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import * as schema from "../src/main/lib/db/schema"
import { createPortableExport } from "../src/main/lib/portability/exporter"
import {
  applyPortableImport,
  createPortableImportConfirmation,
  createPortableImportPlan,
} from "../src/main/lib/portability/importer"
import {
  listProjectVaultSectionBackups,
  readProjectVaultSection,
  readProjectVaultSectionBackup,
  scaffoldProjectVault,
  writeProjectVaultSection,
} from "../src/main/lib/project-vaults/storage"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("project vault portability", () => {
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
    await expect(
      readProjectVaultSection(restored, { projectId: "project-1", sectionId: "index" }),
    ).resolves.toMatchObject({
      content: "# Portable knowledge\n\nCurrent content.\n",
      version: 2,
      externallyModified: false,
    })
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
})
