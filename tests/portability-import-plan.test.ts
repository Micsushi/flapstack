import Database from "better-sqlite3"
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { fileSymlinksSupported } from "./helpers/symlink-capability"
import { createPortableExport } from "../src/main/lib/portability/exporter"
import {
  createPortableImportPlan,
  verifyPortableBundle,
} from "../src/main/lib/portability/importer"
import {
  createConfigRoot,
  createRelationalTestDatabase,
  createTestDatabase,
  tempRoot,
} from "./portability-test-helpers"

describe("portability-import-plan", () => {
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
})
