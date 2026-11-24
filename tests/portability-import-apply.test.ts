import Database from "better-sqlite3"
import { spawnSync } from "node:child_process"
import { mkdir, readFile, readdir, rename, symlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { createPortableExport } from "../src/main/lib/portability/exporter"
import {
  applyPortableImport as applyPortableImportUnchecked,
  createPortableImportConfirmation,
  createPortableImportPlan,
  listCompletedImportBackups,
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

  it.each(["after-files", "after-database-commit"] as const)(
    "rolls back a fault at %s without mixed database/files",
    async (faultAt) => {
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
    },
  )

  it("recovers a process crash after the durable database-committed phase", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath, "Incoming")
    const configRoot = await createConfigRoot(root, "incoming")
    const bundlePath = join(root, "committed-crash.flapstack-export")
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
    const targetRoots = { config: targetConfig }
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
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
    const inputPath = join(root, "committed-crash-input.json")
    await writeFile(
      inputPath,
      JSON.stringify({
        crashAt: "after-database-committed",
        planId: plan.id,
        expectedFingerprint: plan.bundleFingerprint,
        expectedConfirmationHash: confirmation.confirmationHash,
        databasePath: targetPath,
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
        inputPath,
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 30_000, windowsHide: true },
    )
    expect(child.status, child.stderr).toBe(93)
    const journalFiles = await readdir(join(stateRoot, "journals"))
    expect(journalFiles).toHaveLength(1)
    const journal = JSON.parse(
      await readFile(join(stateRoot, "journals", journalFiles[0]), "utf8"),
    ) as { phase: string }
    expect(journal.phase).toBe("database-committed")
    expect(await readFile(targetFile, "utf8")).toContain('"label":"incoming"')
    const committed = new Database(targetPath, { readonly: true })
    expect(committed.prepare("SELECT name FROM projects WHERE id = 'p1'").pluck().get()).toBe(
      "Incoming",
    )
    committed.close()

    await expect(recoverInterruptedImports(stateRoot, targetPath)).resolves.toEqual([
      { operationId: journalFiles[0].replace(/\.json$/, ""), action: "rolled-back" },
    ])
    expect(await readFile(targetFile, "utf8")).toBe("local")
    const recovered = new Database(targetPath, { readonly: true })
    expect(recovered.prepare("SELECT name FROM projects WHERE id = 'p1'").pluck().get()).toBe(
      "Local",
    )
    recovered.close()
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
    const listed = await listCompletedImportBackups({
      stateRoot: fixture.stateRoot,
      databasePath: fixture.targetPath,
    })
    expect(listed.backups).toEqual([
      { operationId: fixture.operationId, available: true, recordedAt: expect.any(String) },
    ])
    expect(
      (
        await listCompletedImportBackups({
          stateRoot: fixture.stateRoot,
          databasePath: join(fixture.stateRoot, "other-profile.db"),
        })
      ).backups,
    ).toEqual([])
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
    expect(
      (
        await listCompletedImportBackups({
          stateRoot: fixture.stateRoot,
          databasePath: fixture.targetPath,
        })
      ).backups,
    ).toEqual([])
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
    const unresolved = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
      stateRoot,
      targetRoots: { extensions: targetExtensions },
    })
    expect(unresolved.mappingRequirements).toEqual([
      {
        kind: "project-vault",
        projectId: "p1",
        targetRootField: "projectVaults",
        reason: "missing-current-target",
      },
      {
        kind: "project",
        projectId: "p1",
        targetRootField: "projects",
        reason: "missing-current-target",
      },
    ])
    expect(
      unresolved.files
        .filter((file) => file.scopeId === "project-vaults")
        .every((file) => file.targetPath === null && file.targetBinding === null),
    ).toBe(true)
    await expect(
      createPortableImportConfirmation({ stateRoot, planId: unresolved.id }),
    ).rejects.toThrow(/mappings are incomplete/i)
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
    const applied = await applyPortableImport({
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
    await restorePortableBackup({
      stateRoot,
      operationId: applied.operationId,
      databasePath: targetPath,
    })
    await expect(readFile(join(targetVault, "knowledge.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    })
    const restored = new Database(targetPath, { readonly: true })
    expect(restored.prepare("SELECT COUNT(*) FROM projects").pluck().get()).toBe(0)
    restored.close()
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
            await symlink(
              outside,
              fixture.targetConfig,
              process.platform === "win32" ? "junction" : "dir",
            )
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
            await symlink(
              outside,
              fixture.targetConfig,
              process.platform === "win32" ? "junction" : "dir",
            )
          },
        },
      }),
    ).rejects.toThrow(/identity changed|unsafe path/i)
    expect(await readFile(outsideFile, "utf8")).toBe("outside-safe")
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
