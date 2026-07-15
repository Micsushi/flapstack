import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import Database from "better-sqlite3"
import { createPortableExport } from "../src/main/lib/portability/exporter"
import { readPortableDatabase } from "../src/main/lib/portability/database"
import { listFiles, sha256File } from "../src/main/lib/portability/io"
import { verifyPortableBundle } from "../src/main/lib/portability/importer"
import {
  createConfigRoot,
  createRelationalTestDatabase,
  createTestDatabase,
  tempRoot,
} from "./portability-test-helpers"

describe("portability-export", () => {
  it("creates a selected, integrity-checked bundle without WAL, SHM, or secrets", async () => {
    const root = await tempRoot()
    const databasePath = join(root, "source.db")
    createTestDatabase(databasePath)
    const configRoot = await createConfigRoot(root)
    const awsAccessKey = "AKIAIOSFODNN7EXAMPLE"
    const awsSecretKey = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    const googleApiKey = `AIza${"A".repeat(35)}`
    await writeFile(
      join(configRoot, "usage-settings.json"),
      JSON.stringify({
        apiKey: "sk-live-never-export-this-value",
        AWS_ACCESS_KEY_ID: awsAccessKey,
        AWS_SECRET_ACCESS_KEY: awsSecretKey,
        note: googleApiKey,
      }),
    )
    await writeFile(
      join(configRoot, "aws.txt"),
      `export AWS_SECRET_ACCESS_KEY="${awsSecretKey}"\nAWS_ACCESS_KEY_ID=${awsAccessKey}\n`,
    )
    const outputPath = join(root, "backup.flapstack-export")
    const result = await createPortableExport({
      outputPath,
      databasePath,
      appVersion: "1.2.3",
      selection: [{ id: "settings" }, { id: "usage", projectIds: ["p1"] }],
      fileSources: [
        {
          scopeId: "settings",
          root: configRoot,
          include: ["usage-settings.json", "aws.txt"],
          target: { kind: "config" },
        },
      ],
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    })
    expect(result.databaseRecords).toBe(2)
    expect(result.exclusions.some((entry) => entry.category === "token")).toBe(true)
    await expect(verifyPortableBundle(outputPath)).resolves.toMatchObject({
      manifest: { bundleVersion: 1 },
    })
    const paths = await listFiles(outputPath)
    expect(paths.some((path) => path.endsWith("-wal") || path.endsWith("-shm"))).toBe(false)
    const content = await Promise.all(paths.map((path) => readFile(join(outputPath, path))))
    expect(Buffer.concat(content).toString("utf8")).not.toContain("sk-live-never-export-this-value")
    expect(Buffer.concat(content).toString("utf8")).not.toContain(awsAccessKey)
    expect(Buffer.concat(content).toString("utf8")).not.toContain(awsSecretKey)
    expect(Buffer.concat(content).toString("utf8")).not.toContain(googleApiKey)
  })

  it("is byte-deterministic for the same state, name, and clock", async () => {
    const root = await tempRoot()
    const databasePath = join(root, "source.db")
    createTestDatabase(databasePath)
    const leftParent = join(root, "left")
    const rightParent = join(root, "right")
    await mkdir(leftParent)
    await mkdir(rightParent)
    const common = {
      databasePath,
      appVersion: "1.2.3",
      selection: [{ id: "projects" as const }],
      now: () => new Date("2026-07-14T12:00:00.000Z"),
    }
    const left = join(leftParent, "same.flapstack-export")
    const right = join(rightParent, "same.flapstack-export")
    await createPortableExport({ ...common, outputPath: left })
    await createPortableExport({ ...common, outputPath: right })
    const paths = await listFiles(left)
    expect(paths).toEqual(await listFiles(right))
    expect(await Promise.all(paths.map((path) => sha256File(join(left, path))))).toEqual(
      await Promise.all(paths.map((path) => sha256File(join(right, path)))),
    )
  })

  it("removes partial output when cancelled", async () => {
    const root = await tempRoot()
    const databasePath = join(root, "source.db")
    createTestDatabase(databasePath)
    const controller = new AbortController()
    controller.abort()
    const outputPath = join(root, "cancelled.flapstack-export")
    await expect(
      createPortableExport({
        outputPath,
        databasePath,
        appVersion: "1",
        selection: [{ id: "projects" }],
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancel/i)
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("detects tampering", async () => {
    const root = await tempRoot()
    const databasePath = join(root, "source.db")
    createTestDatabase(databasePath)
    const outputPath = join(root, "tampered.flapstack-export")
    await createPortableExport({
      outputPath,
      databasePath,
      appVersion: "1",
      selection: [{ id: "projects" }],
    })
    await writeFile(join(outputPath, "manifest.json"), "{}")
    await expect(verifyPortableBundle(outputPath)).rejects.toThrow()
  })

  it("exports one consistent snapshot during concurrent writes with large history", async () => {
    const root = await tempRoot()
    const databasePath = join(root, "source.db")
    createTestDatabase(databasePath)
    const database = new Database(databasePath)
    database.exec(
      "CREATE TABLE chats (id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL, title TEXT NOT NULL)",
    )
    const insert = database.prepare("INSERT INTO chats VALUES (?, 'p1', ?)")
    const seed = database.transaction(() => {
      for (let index = 0; index < 2_000; index += 1) insert.run(`chat-${index}`, `History ${index}`)
    })
    seed()
    let next = 2_000
    const writer = setInterval(() => {
      try {
        insert.run(`chat-${next}`, `History ${next}`)
        next += 1
      } catch {
        // Backup may briefly hold a read lock; the next tick retries with a new ID.
      }
    }, 1)
    const outputPath = join(root, "history.flapstack-export")
    try {
      await createPortableExport({
        outputPath,
        databasePath,
        appVersion: "1",
        selection: [{ id: "history", projectIds: ["p1"] }],
      })
    } finally {
      clearInterval(writer)
      database.close()
    }
    const records = readPortableDatabase(join(outputPath, "database/flapstack.sqlite3"))
    const chatRecords = records.filter((record) => record.tableName === "chats")
    expect(chatRecords.length).toBeGreaterThanOrEqual(2_000)
    expect(new Set(chatRecords.map((record) => String(record.identity.id))).size).toBe(
      chatRecords.length,
    )
  })

  it("fails cleanly when a selected file source is missing", async () => {
    const root = await tempRoot()
    const databasePath = join(root, "source.db")
    createTestDatabase(databasePath)
    const outputPath = join(root, "missing.flapstack-export")
    await expect(
      createPortableExport({
        outputPath,
        databasePath,
        appVersion: "1",
        selection: [{ id: "settings" }],
        fileSources: [
          { scopeId: "settings", root: join(root, "missing-root"), target: { kind: "config" } },
        ],
      }),
    ).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it.each(["moved", "removed"] as const)(
    "fails cleanly when a selected export source is %s after discovery",
    async (mode) => {
      const root = await tempRoot()
      const databasePath = join(root, "source.db")
      createTestDatabase(databasePath)
      const sourceRoot = join(root, "settings")
      await mkdir(sourceRoot)
      const sourcePath = join(sourceRoot, "settings.json")
      await writeFile(sourcePath, "safe")
      const outputPath = join(root, `${mode}.flapstack-export`)
      await expect(
        createPortableExport({
          outputPath,
          databasePath,
          appVersion: "1",
          selection: [{ id: "settings" }],
          fileSources: [{ scopeId: "settings", root: sourceRoot, target: { kind: "config" } }],
          testHooks: {
            beforeSourceSnapshot: async (path) => {
              if (mode === "moved") await rename(path, `${path}.moved`)
              else await rm(path)
            },
          },
        }),
      ).rejects.toMatchObject({ code: "ENOENT" })
      await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" })
    },
  )

  it("filters parent and dependent rows relationally and removes machine-local paths", async () => {
    const root = await tempRoot()
    const databasePath = join(root, "relational.db")
    createRelationalTestDatabase(databasePath)
    const outputPath = join(root, "one-project.flapstack-export")
    const result = await createPortableExport({
      outputPath,
      databasePath,
      appVersion: "1",
      selection: [
        { id: "project-vaults", projectIds: ["p1"] },
        { id: "history", projectIds: ["p1"] },
      ],
    })
    const records = readPortableDatabase(join(outputPath, "database/flapstack.sqlite3"))
    expect(new Set(records.map((record) => record.tableName))).toEqual(
      new Set(["projects", "tasks", "project_vaults", "chats", "attachments", "voice_artifacts"]),
    )
    expect(JSON.stringify(records)).not.toContain("p2")
    expect(JSON.stringify(records)).not.toContain("/source/")
    expect(records.find((record) => record.tableName === "projects")?.row.path).toBe(
      "__FLAPSTACK_LOCAL_PATH__/projects/p1",
    )
    expect(records.find((record) => record.tableName === "attachments")?.row.stored_path).toBeNull()
    expect(
      records.find((record) => record.tableName === "voice_artifacts")?.row.audio_path,
    ).toBeNull()
    expect(
      result.exclusions.filter((entry) => entry.category === "local-path").length,
    ).toBeGreaterThan(5)
    const bundleText = Buffer.concat(
      await Promise.all(
        (await listFiles(outputPath)).map((path) => readFile(join(outputPath, path))),
      ),
    ).toString("utf8")
    expect(bundleText).not.toContain("/source/")
  })
})
