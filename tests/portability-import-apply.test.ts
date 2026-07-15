import Database from "better-sqlite3"
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createPortableExport } from "../src/main/lib/portability/exporter"
import {
  applyPortableImport as applyPortableImportUnchecked,
  createPortableImportConfirmation,
  createPortableImportPlan,
  recoverInterruptedImports,
  restorePortableBackup,
} from "../src/main/lib/portability/importer"
import {
  createConfigRoot,
  createRelationalTestDatabase,
  createTestDatabase,
  tempRoot,
} from "./portability-test-helpers"

async function applyPortableImport(
  input: Omit<Parameters<typeof applyPortableImportUnchecked>[0], "expectedConfirmationHash">,
) {
  const confirmation = await createPortableImportConfirmation({
    stateRoot: input.stateRoot,
    planId: input.planId,
    resolutions: input.resolutions,
  })
  return applyPortableImportUnchecked({
    ...input,
    expectedConfirmationHash: confirmation.confirmationHash,
  })
}

describe("portability-import-apply", () => {
  it("applies a reviewed plan, preserves unselected rows, and creates a restorable backup", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath, "Incoming")
    const bundlePath = join(root, "apply.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "projects" }],
    })
    const targetPath = join(root, "target.db")
    createTestDatabase(targetPath, "Local")
    const target = new Database(targetPath)
    target
      .prepare("INSERT INTO projects VALUES (?, ?, ?, ?)")
      .run("local-only", "Keep", "/tmp/keep", 1)
    target.close()
    const stateRoot = join(root, "state")
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
      stateRoot,
      targetRoots: {},
    })
    const conflict = plan.database.find(
      (entry) => entry.tableName === "projects" && entry.identity.id === "p1",
    )!
    const result = await applyPortableImport({
      planId: plan.id,
      expectedFingerprint: plan.bundleFingerprint,
      databasePath: targetPath,
      stateRoot,
      targetRoots: {},
      resolutions: { [conflict.id]: "use-incoming" },
    })
    expect(result.applied).toBeGreaterThan(0)
    await expect(readFile(join(result.backupPath, "backup", "agents.db"))).resolves.toBeInstanceOf(
      Buffer,
    )
    const database = new Database(targetPath, { readonly: true })
    expect(database.prepare("SELECT name FROM projects WHERE id = 'p1'").pluck().get()).toBe(
      "Incoming",
    )
    expect(
      database.prepare("SELECT name FROM projects WHERE id = 'local-only'").pluck().get(),
    ).toBe("Keep")
    database.close()
  })

  it("refuses a stale plan", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath, "Incoming")
    const bundlePath = join(root, "stale.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "projects" }],
    })
    const targetPath = join(root, "target.db")
    createTestDatabase(targetPath, "Local")
    const stateRoot = join(root, "state")
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
      stateRoot,
      targetRoots: {},
    })
    const database = new Database(targetPath)
    database.prepare("UPDATE projects SET name = 'Changed after preview' WHERE id = 'p1'").run()
    database.close()
    await expect(
      applyPortableImport({
        planId: plan.id,
        expectedFingerprint: plan.bundleFingerprint,
        databasePath: targetPath,
        stateRoot,
        targetRoots: {},
        resolutions: Object.fromEntries(
          plan.database
            .filter((entry) => entry.kind === "conflict")
            .map((entry) => [entry.id, "use-incoming" as const]),
        ),
      }),
    ).rejects.toThrow(/state changed|stale/i)
  })

  it.each([
    "after-backup",
    "after-files",
    "before-database-commit",
    "after-database-commit-before-journal",
    "after-database-commit",
  ] as const)("rolls back a fault at %s without mixed database/files", async (faultAt) => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath, "Incoming")
    const configRoot = await createConfigRoot(root, "incoming")
    const bundlePath = join(root, "fault.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "projects" }, { id: "settings" }],
      fileSources: [{ scopeId: "settings", root: configRoot, target: { kind: "config" } }],
    })
    const targetPath = join(root, "target.db")
    createTestDatabase(targetPath, "Local")
    const targetConfig = join(root, "target-config")
    await mkdir(targetConfig)
    const targetFile = join(targetConfig, "usage-settings.json")
    await writeFile(targetFile, "local")
    const stateRoot = join(root, "state")
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
      stateRoot,
      targetRoots: { config: targetConfig },
    })
    const resolutions = Object.fromEntries(
      [...plan.database, ...plan.files]
        .filter((entry) => entry.kind === "conflict")
        .map((entry) => [entry.id, "use-incoming" as const]),
    )
    await expect(
      applyPortableImport({
        planId: plan.id,
        expectedFingerprint: plan.bundleFingerprint,
        databasePath: targetPath,
        stateRoot,
        targetRoots: { config: targetConfig },
        resolutions,
        hooks: { faultAt },
      }),
    ).rejects.toThrow(/Injected portability fault/)
    expect(await readFile(targetFile, "utf8")).toBe("local")
    const database = new Database(targetPath, { readonly: true })
    expect(database.prepare("SELECT name FROM projects WHERE id = 'p1'").pluck().get()).toBe(
      "Local",
    )
    database.close()
  })

  it("keeps a locked restore pending and recovers the committed journal on retry", async () => {
    const fixture = await appliedFixture()
    const journalPath = join(fixture.stateRoot, "journals", `${fixture.operationId}.json`)
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as Record<string, unknown>
    journal.phase = "database-committed"
    await writeFile(journalPath, `${JSON.stringify(journal)}\n`)
    const database = new Database(fixture.targetPath)
    database.prepare("UPDATE projects SET name = 'Interrupted' WHERE id = 'p1'").run()
    database.close()
    await writeFile(fixture.targetFile, "interrupted")

    await expect(
      recoverInterruptedImports(fixture.stateRoot, fixture.targetPath, {
        beforeDatabaseRestore: () => {
          throw new Error("database file is locked")
        },
      }),
    ).rejects.toThrow(/locked/)
    expect(JSON.parse(await readFile(journalPath, "utf8")).phase).toBe("database-committed")
    await expect(recoverInterruptedImports(fixture.stateRoot, fixture.targetPath)).resolves.toEqual(
      [{ operationId: fixture.operationId, action: "rolled-back" }],
    )
    expect(await readFile(fixture.targetFile, "utf8")).toBe("local")
    const recovered = new Database(fixture.targetPath, { readonly: true })
    expect(recovered.prepare("SELECT name FROM projects WHERE id = 'p1'").pluck().get()).toBe(
      "Local",
    )
    recovered.close()
  })

  it("rejects a symlink-swapped database backup during recovery", async () => {
    const fixture = await appliedFixture()
    const journalPath = join(fixture.stateRoot, "journals", `${fixture.operationId}.json`)
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      phase: string
      databaseBackupPath: string
    }
    journal.phase = "database-committed"
    await writeFile(journalPath, `${JSON.stringify(journal)}\n`)
    const movedBackup = `${journal.databaseBackupPath}.moved`
    const outside = join(fixture.stateRoot, "outside-database-bytes")
    await writeFile(outside, "outside-must-never-replace-the-live-database")

    await expect(
      recoverInterruptedImports(fixture.stateRoot, fixture.targetPath, {
        beforeDatabaseRestore: async () => {
          await rename(journal.databaseBackupPath, movedBackup)
          await symlink(outside, journal.databaseBackupPath)
        },
      }),
    ).rejects.toThrow(/non-symlink/i)
    const database = new Database(fixture.targetPath, { readonly: true })
    expect(database.prepare("SELECT name FROM projects WHERE id = 'p1'").pluck().get()).toBe(
      "Incoming",
    )
    database.close()
    expect(await readFile(outside, "utf8")).toBe("outside-must-never-replace-the-live-database")
  })

  it("rejects a regular-file replacement of the bound database backup", async () => {
    const fixture = await appliedFixture()
    const journalPath = join(fixture.stateRoot, "journals", `${fixture.operationId}.json`)
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      phase: string
      databaseBackupPath: string
    }
    journal.phase = "database-committed"
    await writeFile(journalPath, `${JSON.stringify(journal)}\n`)
    const originalBackup = `${journal.databaseBackupPath}.original`

    await expect(
      recoverInterruptedImports(fixture.stateRoot, fixture.targetPath, {
        beforeDatabaseRestore: async () => {
          await rename(journal.databaseBackupPath, originalBackup)
          await writeFile(journal.databaseBackupPath, "unreviewed-regular-database-bytes")
        },
      }),
    ).rejects.toThrow(/backup source identity or content changed/i)
    const database = new Database(fixture.targetPath, { readonly: true })
    expect(database.prepare("SELECT name FROM projects WHERE id = 'p1'").pluck().get()).toBe(
      "Incoming",
    )
    database.close()
  })

  it("rejects a regular-file replacement of a bound file backup", async () => {
    const fixture = await appliedFixture()
    const journalPath = join(fixture.stateRoot, "journals", `${fixture.operationId}.json`)
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      fileBackups: Array<{ backupPath: string | null }>
    }
    const backupPath = journal.fileBackups.find((backup) => backup.backupPath)?.backupPath
    expect(backupPath).toBeTruthy()
    const originalBackup = `${backupPath}.original`

    await expect(
      restorePortableBackup({
        stateRoot: fixture.stateRoot,
        operationId: fixture.operationId,
        databasePath: fixture.targetPath,
        hooks: {
          beforeFileRollback: async () => {
            await rename(backupPath!, originalBackup)
            await writeFile(backupPath!, "unreviewed-regular-file-bytes")
          },
        },
      }),
    ).rejects.toThrow(/backup source identity or content changed/i)
    expect(JSON.parse(await readFile(fixture.targetFile, "utf8")).label).toBe("incoming")
  })

  it("rejects a journal bound to another profile database", async () => {
    const fixture = await appliedFixture()
    await expect(
      restorePortableBackup({
        stateRoot: fixture.stateRoot,
        operationId: fixture.operationId,
        databasePath: join(fixture.stateRoot, "different-profile.db"),
      }),
    ).rejects.toThrow(/active profile database/i)
    expect(JSON.parse(await readFile(fixture.targetFile, "utf8")).label).toBe("incoming")
  })

  it("manually restores a completed import backup", async () => {
    const fixture = await appliedFixture()
    await restorePortableBackup({
      stateRoot: fixture.stateRoot,
      operationId: fixture.operationId,
      databasePath: fixture.targetPath,
    })
    expect(await readFile(fixture.targetFile, "utf8")).toBe("local")
    const restored = new Database(fixture.targetPath, { readonly: true })
    expect(restored.prepare("SELECT name FROM projects WHERE id = 'p1'").pluck().get()).toBe(
      "Local",
    )
    restored.close()
  })

  it("materializes both database values and both file byte versions", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath, "Incoming")
    const sourceConfig = await createConfigRoot(root, "incoming")
    const bundlePath = join(root, "both.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "projects" }, { id: "settings" }],
      fileSources: [{ scopeId: "settings", root: sourceConfig, target: { kind: "config" } }],
    })
    const targetPath = join(root, "target.db")
    createTestDatabase(targetPath, "Local")
    const targetConfig = join(root, "target-config")
    await mkdir(targetConfig)
    const targetFile = join(targetConfig, "usage-settings.json")
    await writeFile(targetFile, "local-bytes")
    const stateRoot = join(root, "state")
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
      stateRoot,
      targetRoots: { config: targetConfig },
    })
    const conflicts = [...plan.database, ...plan.files].filter((entry) => entry.kind === "conflict")
    const result = await applyPortableImport({
      planId: plan.id,
      expectedFingerprint: plan.bundleFingerprint,
      databasePath: targetPath,
      stateRoot,
      targetRoots: plan.targetRoots,
      resolutions: Object.fromEntries(conflicts.map((entry) => [entry.id, "keep-both"])),
    })
    expect(result.preservedConflicts).toBe(conflicts.length)
    expect(await readFile(targetFile, "utf8")).toBe("local-bytes")
    const database = new Database(targetPath, { readonly: true })
    expect(database.prepare("SELECT name FROM projects WHERE id = 'p1'").pluck().get()).toBe(
      "Local",
    )
    database.close()
    const artifacts = JSON.parse(await readFile(result.conflictArtifactPath!, "utf8")) as Array<{
      type: string
      local: { path?: string; row?: { name?: string } }
      incoming: { path?: string; row?: { name?: string } }
    }>
    const databaseArtifact = artifacts.find((entry) => entry.type === "database")!
    expect(databaseArtifact.local.row?.name).toBe("Local")
    expect(databaseArtifact.incoming.row?.name).toBe("Incoming")
    const fileArtifact = artifacts.find((entry) => entry.type === "file")!
    expect(await readFile(fileArtifact.local.path!, "utf8")).toBe("local-bytes")
    expect(await readFile(fileArtifact.incoming.path!, "utf8")).toContain("incoming")
  })

  it("runs the apply lifecycle before revalidation and always resumes", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath, "Incoming")
    const bundlePath = join(root, "lifecycle.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "projects" }],
    })
    const targetPath = join(root, "target.db")
    createTestDatabase(targetPath, "Local")
    const stateRoot = join(root, "state")
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
      stateRoot,
      targetRoots: {},
    })
    const events: string[] = []
    await expect(
      applyPortableImport({
        planId: plan.id,
        expectedFingerprint: plan.bundleFingerprint,
        databasePath: targetPath,
        stateRoot,
        targetRoots: {},
        resolutions: Object.fromEntries(
          plan.database
            .filter((entry) => entry.kind === "conflict")
            .map((entry) => [entry.id, "use-incoming"]),
        ),
        hooks: {
          beforeApply: () => events.push("paused"),
          afterApply: () => events.push("resumed"),
        },
      }),
    ).resolves.toMatchObject({ applied: 1 })
    expect(events).toEqual(["paused", "resumed"])
  })

  it("imports parents and children with clean-profile mappings and FK integrity", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createRelationalTestDatabase(sourcePath)
    const extensionRoot = join(root, "source-extensions")
    const vaultRoot = join(root, "source-vault")
    await mkdir(extensionRoot)
    await mkdir(vaultRoot)
    await writeFile(join(extensionRoot, "skill.md"), "extension")
    await writeFile(join(vaultRoot, "knowledge.md"), "vault")
    const bundlePath = join(root, "clean.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [
        { id: "extensions", projectIds: ["p1"] },
        { id: "project-vaults", projectIds: ["p1"] },
        { id: "history", projectIds: ["p1"] },
      ],
      fileSources: [
        { scopeId: "extensions", root: extensionRoot, target: { kind: "extensions" } },
        {
          scopeId: "project-vaults",
          root: vaultRoot,
          target: { kind: "project-vault", projectId: "p1" },
        },
      ],
    })
    const targetPath = join(root, "target.db")
    createRelationalTestDatabase(targetPath, false)
    const targetExtensions = join(root, "empty-profile", ".agents")
    const targetProject = join(root, "projects", "p1")
    const targetVault = join(root, "empty-profile", "vaults", "p1")
    await mkdir(targetProject, { recursive: true })
    const stateRoot = join(root, "state")
    await expect(
      createPortableImportPlan({
        bundlePath,
        databasePath: targetPath,
        stateRoot,
        targetRoots: {},
      }),
    ).rejects.toThrow(/target mapping|required/i)
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
      stateRoot,
      targetRoots: {
        extensions: targetExtensions,
        projects: { p1: targetProject },
        projectVaults: { p1: targetVault },
      },
    })
    await applyPortableImport({
      planId: plan.id,
      expectedFingerprint: plan.bundleFingerprint,
      databasePath: targetPath,
      stateRoot,
      targetRoots: plan.targetRoots,
    })
    expect(await readFile(join(targetExtensions, "skill.md"), "utf8")).toBe("extension")
    expect(await readFile(join(targetVault, "knowledge.md"), "utf8")).toBe("vault")
    const database = new Database(targetPath, { readonly: true })
    expect(database.prepare("SELECT path FROM projects WHERE id = 'p1'").pluck().get()).toBe(
      targetProject,
    )
    expect(
      database
        .prepare("SELECT root_path FROM project_vaults WHERE project_id = 'p1'")
        .pluck()
        .get(),
    ).toBe(targetVault)
    expect(database.pragma("foreign_key_check")).toEqual([])
    expect(database.prepare("SELECT COUNT(*) FROM tasks").pluck().get()).toBe(1)
    expect(database.prepare("SELECT COUNT(*) FROM attachments").pluck().get()).toBe(1)
    database.close()
  })

  it("rolls back an invalid imported foreign-key reference", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createRelationalTestDatabase(sourcePath, false)
    const source = new Database(sourcePath)
    source.pragma("foreign_keys = OFF")
    source.prepare("INSERT INTO tasks VALUES (?, ?, ?, ?)").run("orphan", "missing", "Bad", null)
    source.close()
    const bundlePath = join(root, "invalid-fk.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "projects" }],
    })
    const targetPath = join(root, "target.db")
    createRelationalTestDatabase(targetPath, false)
    const stateRoot = join(root, "state")
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
      stateRoot,
      targetRoots: {},
    })
    await expect(
      applyPortableImport({
        planId: plan.id,
        expectedFingerprint: plan.bundleFingerprint,
        databasePath: targetPath,
        stateRoot,
        targetRoots: {},
      }),
    ).rejects.toThrow(/foreign key/i)
    const database = new Database(targetPath, { readonly: true })
    expect(database.prepare("SELECT COUNT(*) FROM tasks").pluck().get()).toBe(0)
    expect(database.pragma("foreign_key_check")).toEqual([])
    database.close()
  })

  it("rejects a root symlink swap after final revalidation without touching outside", async () => {
    const fixture = await fileApplyFixture("apply-swap")
    const outside = join(fixture.root, "outside")
    const moved = join(fixture.root, "reviewed-root-moved")
    await mkdir(outside)
    const outsideFile = join(outside, "usage-settings.json")
    await writeFile(outsideFile, "outside-safe")
    await expect(
      applyPortableImport({
        ...fixture.applyInput,
        hooks: {
          afterRevalidation: async () => {
            await rename(fixture.targetConfig, moved)
            await symlink(outside, fixture.targetConfig)
          },
        },
      }),
    ).rejects.toThrow(/identity changed|unsafe path/i)
    expect(await readFile(outsideFile, "utf8")).toBe("outside-safe")
  })

  it("rejects a root symlink swap during rollback without touching outside", async () => {
    const fixture = await fileApplyFixture("rollback-swap")
    const outside = join(fixture.root, "outside")
    const moved = join(fixture.root, "reviewed-root-moved")
    await mkdir(outside)
    const outsideFile = join(outside, "usage-settings.json")
    await writeFile(outsideFile, "outside-safe")
    await expect(
      applyPortableImport({
        ...fixture.applyInput,
        hooks: {
          faultAt: "after-files",
          beforeFileRollback: async () => {
            await rename(fixture.targetConfig, moved)
            await symlink(outside, fixture.targetConfig)
          },
        },
      }),
    ).rejects.toThrow(/identity changed|unsafe path/i)
    expect(await readFile(outsideFile, "utf8")).toBe("outside-safe")
  })

  it("rejects a reviewed leaf swapped to a symlink before backup without reading outside", async () => {
    const fixture = await fileApplyFixture("leaf-read-swap")
    const targetFile = join(fixture.targetConfig, "usage-settings.json")
    const moved = join(fixture.root, "reviewed-leaf-moved")
    const outsideFile = join(fixture.root, "outside-secret.txt")
    await writeFile(outsideFile, "outside-must-never-be-backed-up")
    await expect(
      applyPortableImport({
        ...fixture.applyInput,
        hooks: {
          beforeReviewedLeafRead: async () => {
            await rename(targetFile, moved)
            await symlink(outsideFile, targetFile)
          },
        },
      }),
    ).rejects.toThrow(/symlink|regular|identity|ELOOP/i)
    expect(await readFile(outsideFile, "utf8")).toBe("outside-must-never-be-backed-up")
  })

  it("rejects a published leaf swapped to a symlink during rollback", async () => {
    const fixture = await fileApplyFixture("leaf-rollback-swap")
    const targetFile = join(fixture.targetConfig, "usage-settings.json")
    const moved = join(fixture.root, "published-leaf-moved")
    const outsideFile = join(fixture.root, "outside-rollback.txt")
    await writeFile(outsideFile, "outside-must-never-change")
    await expect(
      applyPortableImport({
        ...fixture.applyInput,
        hooks: {
          faultAt: "after-files",
          beforeFileRollback: async () => {
            await rename(targetFile, moved)
            await symlink(outsideFile, targetFile)
          },
        },
      }),
    ).rejects.toThrow(/leaf|symlink|unsafe/i)
    expect(await readFile(outsideFile, "utf8")).toBe("outside-must-never-change")
  })

  it("binds apply to the reviewed plan targets and selected resolutions", async () => {
    const fixture = await fileApplyFixture("confirmation")
    const confirmation = await createPortableImportConfirmation({
      stateRoot: fixture.applyInput.stateRoot,
      planId: fixture.applyInput.planId,
      resolutions: fixture.applyInput.resolutions,
    })
    const planPath = join(
      fixture.applyInput.stateRoot,
      "plans",
      `${fixture.applyInput.planId}.json`,
    )
    const persisted = JSON.parse(await readFile(planPath, "utf8")) as {
      files: Array<{ targetPath: string }>
    }
    persisted.files[0]!.targetPath = join(fixture.root, "redirected", "settings.json")
    await writeFile(planPath, `${JSON.stringify(persisted)}\n`)
    await expect(
      applyPortableImportUnchecked({
        ...fixture.applyInput,
        expectedConfirmationHash: confirmation.confirmationHash,
      }),
    ).rejects.toThrow(/confirmation is stale/i)

    const cleanFixture = await fileApplyFixture("resolution-confirmation")
    const reviewed = await createPortableImportConfirmation({
      stateRoot: cleanFixture.applyInput.stateRoot,
      planId: cleanFixture.applyInput.planId,
      resolutions: cleanFixture.applyInput.resolutions,
    })
    const changedResolutions = Object.fromEntries(
      Object.keys(cleanFixture.applyInput.resolutions ?? {}).map((id) => [
        id,
        "keep-local" as const,
      ]),
    )
    await expect(
      applyPortableImportUnchecked({
        ...cleanFixture.applyInput,
        resolutions: changedResolutions,
        expectedConfirmationHash: reviewed.confirmationHash,
      }),
    ).rejects.toThrow(/confirmation is stale/i)
  })

  it("strictly rejects unknown persisted plan fields", async () => {
    const fixture = await fileApplyFixture("schema-tamper")
    const planPath = join(
      fixture.applyInput.stateRoot,
      "plans",
      `${fixture.applyInput.planId}.json`,
    )
    const persisted = JSON.parse(await readFile(planPath, "utf8")) as Record<string, unknown>
    persisted.redirectWritesTo = "/tmp/outside"
    await writeFile(planPath, `${JSON.stringify(persisted)}\n`)
    await expect(
      createPortableImportConfirmation({
        stateRoot: fixture.applyInput.stateRoot,
        planId: fixture.applyInput.planId,
      }),
    ).rejects.toThrow()
  })
})

async function fileApplyFixture(name: string) {
  const root = await tempRoot()
  const sourcePath = join(root, "source.db")
  createTestDatabase(sourcePath, "Incoming")
  const sourceConfig = await createConfigRoot(root, "incoming")
  const bundlePath = join(root, `${name}.flapstack-export`)
  await createPortableExport({
    outputPath: bundlePath,
    databasePath: sourcePath,
    appVersion: "1",
    selection: [{ id: "projects" }, { id: "settings" }],
    fileSources: [{ scopeId: "settings", root: sourceConfig, target: { kind: "config" } }],
  })
  const targetPath = join(root, "target.db")
  createTestDatabase(targetPath, "Local")
  const targetConfig = join(root, "target-config")
  await mkdir(targetConfig)
  await writeFile(join(targetConfig, "usage-settings.json"), "local")
  const stateRoot = join(root, "state")
  const plan = await createPortableImportPlan({
    bundlePath,
    databasePath: targetPath,
    stateRoot,
    targetRoots: { config: targetConfig },
  })
  const resolutions = Object.fromEntries(
    [...plan.database, ...plan.files]
      .filter((entry) => entry.kind === "conflict")
      .map((entry) => [entry.id, "use-incoming" as const]),
  )
  return {
    root,
    targetConfig,
    applyInput: {
      planId: plan.id,
      expectedFingerprint: plan.bundleFingerprint,
      databasePath: targetPath,
      stateRoot,
      targetRoots: plan.targetRoots,
      resolutions,
    },
  }
}

async function appliedFixture(): Promise<{
  stateRoot: string
  targetPath: string
  targetFile: string
  operationId: string
}> {
  const root = await tempRoot()
  const sourcePath = join(root, "source.db")
  createTestDatabase(sourcePath, "Incoming")
  const configRoot = await createConfigRoot(root, "incoming")
  const bundlePath = join(root, "recovery.flapstack-export")
  await createPortableExport({
    outputPath: bundlePath,
    databasePath: sourcePath,
    appVersion: "1",
    selection: [{ id: "projects" }, { id: "settings" }],
    fileSources: [{ scopeId: "settings", root: configRoot, target: { kind: "config" } }],
  })
  const targetPath = join(root, "target.db")
  createTestDatabase(targetPath, "Local")
  const targetConfig = join(root, "target-config")
  await mkdir(targetConfig)
  const targetFile = join(targetConfig, "usage-settings.json")
  await writeFile(targetFile, "local")
  const stateRoot = join(root, "state")
  const plan = await createPortableImportPlan({
    bundlePath,
    databasePath: targetPath,
    stateRoot,
    targetRoots: { config: targetConfig },
  })
  const resolutions = Object.fromEntries(
    [...plan.database, ...plan.files]
      .filter((entry) => entry.kind === "conflict")
      .map((entry) => [entry.id, "use-incoming" as const]),
  )
  const result = await applyPortableImport({
    planId: plan.id,
    expectedFingerprint: plan.bundleFingerprint,
    databasePath: targetPath,
    stateRoot,
    targetRoots: { config: targetConfig },
    resolutions,
  })
  return { stateRoot, targetPath, targetFile, operationId: result.operationId }
}
