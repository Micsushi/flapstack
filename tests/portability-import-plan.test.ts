import Database from "better-sqlite3"
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { createPortableExport } from "../src/main/lib/portability/exporter"
import {
  createPortableImportPlan,
  verifyPortableBundle,
} from "../src/main/lib/portability/importer"
import { sha256File, stableJson } from "../src/main/lib/portability/io"
import { createConfigRoot, createTestDatabase, tempRoot } from "./portability-test-helpers"

describe("portability-import-plan", () => {
  it("rejects a symlinked bundle metadata JSON file", async () => {
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

  it("rejects an existing target leaf symlink without reading outside content", async () => {
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
  })

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
