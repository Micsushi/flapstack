import Database from "better-sqlite3"
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { fileSymlinksSupported } from "./helpers/symlink-capability"
import { createPortableExport } from "../src/main/lib/portability/exporter"
import {
  createPortableImportPlan,
  mergePortableImportTargetRoots,
  verifyPortableBundle,
} from "../src/main/lib/portability/importer"
import { sha256File, stableJson } from "../src/main/lib/portability/io"
import {
  createConfigRoot,
  createRelationalTestDatabase,
  createTestDatabase,
  tempRoot,
} from "./portability-test-helpers"

describe("portability-import-plan", () => {
  it("keeps source project roots metadata-only while merging registered vault targets", () => {
    expect(
      mergePortableImportTargetRoots(
        {
          config: "/current/config",
          extensions: "/current/extensions",
          projects: { stale: "/removed/source-project" },
          projectVaults: { p1: "/current/vault-p1" },
        },
        {
          extensions: "/reviewed/extensions",
          projects: { p1: "/reviewed/project-p1" },
          projectVaults: { p2: "/reviewed/vault-p2" },
        },
      ),
    ).toEqual({
      config: "/current/config",
      extensions: "/reviewed/extensions",
      projects: { p1: "/reviewed/project-p1" },
      projectVaults: { p1: "/current/vault-p1", p2: "/reviewed/vault-p2" },
    })
  })

  it.skipIf(!fileSymlinksSupported)("rejects a symlinked bundle metadata JSON file", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath)
    const bundlePath = join(root, "metadata-symlink.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "projects" }],
    })
    const manifest = join(bundlePath, "manifest.json")
    const outside = join(root, "outside-manifest.json")
    await rename(manifest, outside)
    await symlink(outside, manifest)
    await expect(verifyPortableBundle(bundlePath)).rejects.toThrow(/non-symlink/i)
  })

  it.skipIf(!fileSymlinksSupported)(
    "rejects an existing target leaf symlink without reading outside content",
    async () => {
      const root = await tempRoot()
      const sourcePath = join(root, "source.db")
      createTestDatabase(sourcePath, "Incoming")
      const configRoot = await createConfigRoot(root, "incoming")
      const bundlePath = join(root, "leaf-symlink.flapstack-export")
      await createPortableExport({
        outputPath: bundlePath,
        databasePath: sourcePath,
        appVersion: "1",
        selection: [{ id: "settings" }],
        fileSources: [{ scopeId: "settings", root: configRoot, target: { kind: "config" } }],
      })
      const targetPath = join(root, "target.db")
      createTestDatabase(targetPath, "Local")
      const targetConfig = join(root, "target-config")
      await mkdir(targetConfig)
      const outside = join(root, "outside-secret.txt")
      await writeFile(outside, "outside-must-never-enter-preview")
      await symlink(outside, join(targetConfig, "usage-settings.json"))

      await expect(
        createPortableImportPlan({
          bundlePath,
          databasePath: targetPath,
          stateRoot: join(root, "state"),
          targetRoots: { config: targetConfig },
        }),
      ).rejects.toThrow(/leaf|symlink|regular/i)
      expect(await readFile(outside, "utf8")).toBe("outside-must-never-enter-preview")
    },
  )

  it("persists a deterministic create/update/conflict/skip dry-run without mutation", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath, "Incoming")
    const configRoot = await createConfigRoot(root, "incoming")
    const awsSecret = "plain-aws-secret-with-no-provider-prefix"
    await writeFile(join(configRoot, "aws.txt"), `AWS_SECRET_ACCESS_KEY=${awsSecret}\n`)
    const bundlePath = join(root, "plan.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "projects" }, { id: "settings" }, { id: "extensions" }],
      fileSources: [{ scopeId: "settings", root: configRoot, target: { kind: "config" } }],
    })
    const targetPath = join(root, "target.db")
    createTestDatabase(targetPath, "Local edit")
    const targetConfig = join(root, "target-config")
    await mkdir(targetConfig)
    await writeFile(join(targetConfig, "usage-settings.json"), "local")
    const before = await readFile(targetPath)
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
      stateRoot: join(root, "state"),
      targetRoots: { config: targetConfig },
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    })
    expect(plan.summary.conflict).toBeGreaterThan(0)
    expect(plan.summary.skip).toBeGreaterThan(0)
    expect(
      plan.database.some((entry) => entry.kind === "conflict" && entry.tableName === "projects"),
    ).toBe(true)
    expect(plan.files.some((entry) => entry.kind === "conflict")).toBe(true)
    const databaseConflict = plan.database.find(
      (entry) => entry.kind === "conflict" && entry.tableName === "projects",
    )!
    expect(databaseConflict.localPreview?.name).toBe("Local edit")
    expect(databaseConflict.incomingPreview.name).toBe("Incoming")
    const fileConflict = plan.files.find((entry) => entry.kind === "conflict")!
    expect(fileConflict.localPreview).toContain("local")
    expect(fileConflict.incomingPreview).toContain("__FLAPSTACK_SECRET_EXCLUDED__")
    const awsPreview = plan.files.find((entry) => entry.bundlePath.endsWith("/aws.txt"))
    expect(awsPreview?.incomingPreview).toContain("__FLAPSTACK_SECRET_EXCLUDED__")
    expect(JSON.stringify(plan)).not.toContain(awsSecret)
    expect(JSON.stringify(plan)).not.toContain("sk-live-never-export-this-value")
    expect(await readFile(targetPath)).toEqual(before)
    await expect(
      readFile(join(root, "state", "plans", `${plan.id}.json`), "utf8"),
    ).resolves.toContain(plan.bundleFingerprint)
  })

  it("stops for an unsupported future scope version before live mutation", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath)
    const bundlePath = join(root, "future.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "projects" }],
    })
    const manifestPath = join(bundlePath, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      scopes: Array<{ schemaVersion: number }>
    }
    manifest.scopes[0]!.schemaVersion = 999
    await writeFile(manifestPath, JSON.stringify(manifest))
    await expect(verifyPortableBundle(bundlePath)).rejects.toThrow(/newer|version/i)
  })

  it("reports identity collision as conflict and never schedules deletes", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath, "Incoming")
    const bundlePath = join(root, "collision.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "projects" }],
    })
    const targetPath = join(root, "target.db")
    createTestDatabase(targetPath, "Local")
    const database = new Database(targetPath)
    database
      .prepare("INSERT INTO projects VALUES (?, ?, ?, ?)")
      .run("local-only", "Keep", "/tmp/keep", 1)
    database.close()
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
      stateRoot: join(root, "state"),
      targetRoots: {},
    })
    expect(plan.database.find((entry) => entry.identity.id === "p1")?.kind).toBe("conflict")
    expect(JSON.stringify(plan)).not.toContain('"delete"')
    const verify = new Database(targetPath, { readonly: true })
    expect(verify.prepare("SELECT name FROM projects WHERE id = ?").pluck().get("local-only")).toBe(
      "Keep",
    )
    verify.close()
  })

  it("rejects canonical cross-kind project and vault destination mappings", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createRelationalTestDatabase(sourcePath)
    const bundlePath = join(root, "ambiguous.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "project-vaults" }],
    })
    const targetPath = join(root, "target.db")
    createRelationalTestDatabase(targetPath, false)
    const sharedProject = join(root, "projects", "shared")
    await mkdir(sharedProject, { recursive: true })
    await expect(
      createPortableImportPlan({
        bundlePath,
        databasePath: targetPath,
        stateRoot: join(root, "state"),
        targetRoots: {
          projects: { p1: sharedProject },
          projectVaults: { p1: `${sharedProject}/` },
        },
      }),
    ).rejects.toThrow(/target mappings are ambiguous/i)
  })

  it("rejects unrelated mappings and destinations owned by another project", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createRelationalTestDatabase(sourcePath)
    const bundlePath = join(root, "owned.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "project-vaults" }],
    })
    const targetPath = join(root, "target.db")
    createRelationalTestDatabase(targetPath, false)
    const ownedRoot = join(root, "owned-project")
    const ownedVault = join(root, "owned-vault")
    await mkdir(ownedRoot)
    await mkdir(ownedVault)
    const target = new Database(targetPath)
    target.prepare("INSERT INTO projects VALUES (?, ?, ?, ?)").run("owned", "Owned", ownedRoot, 1)
    target.prepare("INSERT INTO project_vaults VALUES (?, ?, ?)").run("owned", ownedVault, 1)
    target.close()

    await expect(
      createPortableImportPlan({
        bundlePath,
        databasePath: targetPath,
        stateRoot: join(root, "unrelated-state"),
        targetRoots: { projects: { unrelated: ownedRoot } },
      }),
    ).rejects.toThrow(/unrelated project/i)
    await expect(
      createPortableImportPlan({
        bundlePath,
        databasePath: targetPath,
        stateRoot: join(root, "owned-state"),
        targetRoots: { projectVaults: { p1: ownedVault } },
      }),
    ).rejects.toThrow(/belongs to unrelated project owned/i)
  })

  it("rejects a portable path marker bound to a different project identity", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath)
    const bundlePath = join(root, "marker-mismatch.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "projects" }],
    })
    const portableDatabasePath = join(bundlePath, "database/flapstack.sqlite3")
    const portable = new Database(portableDatabasePath)
    const row = portable
      .prepare("SELECT row_json FROM portable_records WHERE table_name = 'projects'")
      .get() as { row_json: string }
    const value = JSON.parse(row.row_json) as Record<string, unknown>
    value.path = "__FLAPSTACK_LOCAL_PATH__/projects/p2"
    portable
      .prepare("UPDATE portable_records SET row_json = ? WHERE table_name = 'projects'")
      .run(stableJson(value).trim())
    portable.close()
    const checksumsPath = join(bundlePath, "checksums.json")
    const checksums = JSON.parse(await readFile(checksumsPath, "utf8")) as {
      entries: Array<{ path: string; sha256: string; bytes: number }>
    }
    Object.assign(
      checksums.entries.find((entry) => entry.path === "database/flapstack.sqlite3")!,
      await sha256File(portableDatabasePath),
    )
    await writeFile(checksumsPath, stableJson(checksums))
    const targetPath = join(root, "target.db")
    createTestDatabase(targetPath)
    await expect(
      createPortableImportPlan({
        bundlePath,
        databasePath: targetPath,
        stateRoot: join(root, "state"),
        targetRoots: { projects: { p1: root } },
      }),
    ).rejects.toThrow(/mapping identity is ambiguous/i)
  })

  it("rejects two reviewed bundle files that resolve to one live destination", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath)
    const left = join(root, "left")
    const right = join(root, "right")
    await mkdir(left)
    await mkdir(right)
    await writeFile(join(left, "same.json"), '{"source":"left"}')
    await writeFile(join(right, "same.json"), '{"source":"right"}')
    const bundlePath = join(root, "target-collision.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "settings" }],
      fileSources: [
        { scopeId: "settings", root: left, target: { kind: "config" } },
        { scopeId: "settings", root: right, target: { kind: "config" } },
      ],
    })
    const targetPath = join(root, "target.db")
    createTestDatabase(targetPath)
    const targetConfig = join(root, "target-config")
    await mkdir(targetConfig)
    await expect(
      createPortableImportPlan({
        bundlePath,
        databasePath: targetPath,
        stateRoot: join(root, "state"),
        targetRoots: { config: targetConfig },
      }),
    ).rejects.toThrow(/multiple files to the same destination/i)
  })

  it("migrates a supported prior settings scope before diff", async () => {
    const root = await tempRoot()
    const sourcePath = join(root, "source.db")
    createTestDatabase(sourcePath)
    const bundlePath = join(root, "prior.flapstack-export")
    await createPortableExport({
      outputPath: bundlePath,
      databasePath: sourcePath,
      appVersion: "1",
      selection: [{ id: "settings" }],
    })
    const manifestPath = join(bundlePath, "manifest.json")
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      scopes: Array<{ id: string; schemaVersion: number }>
    }
    manifest.scopes.find((scope) => scope.id === "settings")!.schemaVersion = 1
    await writeFile(manifestPath, stableJson(manifest))
    const checksumsPath = join(bundlePath, "checksums.json")
    const checksums = JSON.parse(await readFile(checksumsPath, "utf8")) as {
      entries: Array<{ path: string; sha256: string; bytes: number }>
    }
    Object.assign(
      checksums.entries.find((entry) => entry.path === "manifest.json")!,
      await sha256File(manifestPath),
    )
    await writeFile(checksumsPath, stableJson(checksums))
    const targetPath = join(root, "target.db")
    createTestDatabase(targetPath)
    const plan = await createPortableImportPlan({
      bundlePath,
      databasePath: targetPath,
      stateRoot: join(root, "state"),
      targetRoots: {},
    })
    expect(plan.migrations).toEqual([{ scopeId: "settings", fromVersion: 1, toVersion: 2 }])
  })
})
