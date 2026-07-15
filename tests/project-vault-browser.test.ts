import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { and, eq } from "drizzle-orm"
import { createHash } from "node:crypto"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import * as schema from "../src/main/lib/db/schema"
import { projects } from "../src/main/lib/db/schema"
import {
  readProjectVaultSectionForPreview,
  searchProjectVault,
} from "../src/main/lib/project-vaults/browser"
import {
  adoptExternalProjectVaultSectionChange,
  listProjectVaultSectionBackups,
  readProjectVaultSection,
  readProjectVaultSectionBackup,
  restoreProjectVaultSectionBackup,
  scaffoldProjectVault,
  writeProjectVaultSection,
} from "../src/main/lib/project-vaults/storage"

type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

describe("project vault browser services", () => {
  let directory: string
  let appDataRoot: string
  let sqlite: Database.Database
  let database: AppDatabase

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "flapstack-vault-browser-"))
    appDataRoot = join(directory, "app-data")
    mkdirSync(appDataRoot)
    const firstRoot = join(directory, "first")
    const secondRoot = join(directory, "second")
    mkdirSync(firstRoot)
    mkdirSync(secondRoot)
    sqlite = new Database(join(directory, "agents.db"))
    sqlite.pragma("foreign_keys = ON")
    database = drizzle(sqlite, { schema })
    migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })
    database
      .insert(projects)
      .values([
        { id: "project-1", name: "First", path: firstRoot },
        { id: "project-2", name: "Second", path: secondRoot },
      ])
      .run()
    await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index", "handoff"],
    })
    await scaffoldProjectVault(database, {
      projectId: "project-2",
      appDataRoot,
      sections: ["index"],
    })
  })

  afterEach(() => {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it("searches only the selected project and redacts secret-like snippets", async () => {
    const secret = "sk-abcdefghijklmnopqrstuvwxyz123456"
    const vault = database
      .select()
      .from(schema.projectVaults)
      .where(eq(schema.projectVaults.projectId, "project-1"))
      .get()!
    writeFileSync(
      join(vault.rootPath, "current-handoff.md"),
      `Deploy needle\nOPENAI_API_KEY=${secret}\nKeep needle private`,
    )
    await writeProjectVaultSection(database, {
      projectId: "project-2",
      sectionId: "index",
      expectedVersion: 1,
      content: "needle from another project",
    })

    const results = await searchProjectVault(database, {
      projectId: "project-1",
      query: "needle",
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ projectId: "project-1", sectionId: "handoff" })
    expect(results[0]!.snippet).toContain("[REDACTED]")
    expect(results[0]!.snippet).not.toContain(secret)
    await expect(
      searchProjectVault(database, { projectId: "project-1", query: secret }),
    ).resolves.toEqual([])
  })

  it("fails malformed secret redaction closed instead of returning a snippet", async () => {
    const vault = database
      .select()
      .from(schema.projectVaults)
      .where(eq(schema.projectVaults.projectId, "project-1"))
      .get()!
    writeFileSync(
      join(vault.rootPath, "current-handoff.md"),
      "-----BEGIN PRIVATE KEY-----\nunclosed secret material\nneedle",
    )

    await expect(
      searchProjectVault(database, { projectId: "project-1", query: "needle" }),
    ).resolves.toEqual([])
  })

  it("refuses to expose externally introduced secrets in renderer previews", async () => {
    const vault = database
      .select()
      .from(schema.projectVaults)
      .where(eq(schema.projectVaults.projectId, "project-1"))
      .get()!
    writeFileSync(
      join(vault.rootPath, "index.md"),
      "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
    )

    await expect(
      readProjectVaultSectionForPreview(database, {
        projectId: "project-1",
        sectionId: "index",
      }),
    ).rejects.toThrow("detected secret")
  })

  it("previews and restores a backup as a new optimistic version", async () => {
    await writeProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
      expectedVersion: 1,
      content: "version two",
    })
    await writeProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
      expectedVersion: 2,
      content: "version three",
    })
    const backups = listProjectVaultSectionBackups(database, {
      projectId: "project-1",
      sectionId: "index",
    })
    expect(backups.map((backup) => backup.version)).toEqual([2, 1])

    const restored = await restoreProjectVaultSectionBackup(database, {
      projectId: "project-1",
      sectionId: "index",
      backupId: backups[1]!.id,
      expectedVersion: 3,
    })
    expect(restored.version).toBe(4)
    await expect(
      readProjectVaultSection(database, { projectId: "project-1", sectionId: "index" }),
    ).resolves.toMatchObject({ content: "# Project Knowledge\n\n", version: 4 })
    expect(
      listProjectVaultSectionBackups(database, {
        projectId: "project-1",
        sectionId: "index",
      }).map((backup) => backup.version),
    ).toEqual([3, 2, 1])
  })

  it("recovers a missing section file from a verified backup without recreating the vault", async () => {
    await writeProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
      expectedVersion: 1,
      content: "version two",
    })
    const [backup] = listProjectVaultSectionBackups(database, {
      projectId: "project-1",
      sectionId: "index",
    })
    const vault = database
      .select()
      .from(schema.projectVaults)
      .where(eq(schema.projectVaults.projectId, "project-1"))
      .get()!
    rmSync(join(vault.rootPath, "index.md"))

    const restored = await restoreProjectVaultSectionBackup(database, {
      projectId: "project-1",
      sectionId: "index",
      backupId: backup!.id,
      expectedVersion: 2,
    })

    expect(restored.version).toBe(3)
    await expect(
      readProjectVaultSection(database, { projectId: "project-1", sectionId: "index" }),
    ).resolves.toMatchObject({
      content: "# Project Knowledge\n\n",
      version: 3,
      externallyModified: false,
    })
  })

  it("preserves an external replacement when missing-file recovery loses its metadata CAS", async () => {
    await writeProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
      expectedVersion: 1,
      content: "version two",
    })
    const [backup] = listProjectVaultSectionBackups(database, {
      projectId: "project-1",
      sectionId: "index",
    })
    const vault = database
      .select()
      .from(schema.projectVaults)
      .where(eq(schema.projectVaults.projectId, "project-1"))
      .get()!
    const target = join(vault.rootPath, "index.md")
    rmSync(target)
    const externalContent = "external replacement during recovery"
    const externalHash = createHash("sha256").update(externalContent).digest("hex")

    await expect(
      restoreProjectVaultSectionBackup(
        database,
        {
          projectId: "project-1",
          sectionId: "index",
          backupId: backup!.id,
          expectedVersion: 2,
        },
        {
          afterMissingContentWrite: () => {
            const replacement = join(vault.rootPath, "replacement.md")
            writeFileSync(replacement, externalContent)
            renameSync(replacement, target)
            database
              .update(schema.projectVaultSections)
              .set({
                version: 3,
                contentHash: externalHash,
                byteLength: Buffer.byteLength(externalContent),
              })
              .where(
                and(
                  eq(schema.projectVaultSections.projectId, "project-1"),
                  eq(schema.projectVaultSections.sectionId, "index"),
                ),
              )
              .run()
          },
        },
      ),
    ).rejects.toThrow("version is stale")

    await expect(
      readProjectVaultSection(database, { projectId: "project-1", sectionId: "index" }),
    ).resolves.toMatchObject({
      content: externalContent,
      version: 3,
      externallyModified: false,
    })
  })

  it("fails search closed on escaped metadata and symlinked section files", async () => {
    database
      .update(schema.projectVaultSections)
      .set({ relativePath: "../outside.md" })
      .where(
        and(
          eq(schema.projectVaultSections.projectId, "project-1"),
          eq(schema.projectVaultSections.sectionId, "index"),
        ),
      )
      .run()
    await expect(
      searchProjectVault(database, { projectId: "project-1", query: "knowledge" }),
    ).rejects.toThrow("escapes root")

    database
      .update(schema.projectVaultSections)
      .set({ relativePath: "index.md" })
      .where(
        and(
          eq(schema.projectVaultSections.projectId, "project-1"),
          eq(schema.projectVaultSections.sectionId, "index"),
        ),
      )
      .run()
    const vault = database
      .select()
      .from(schema.projectVaults)
      .where(eq(schema.projectVaults.projectId, "project-1"))
      .get()!
    const outside = join(directory, "outside.md")
    writeFileSync(outside, "knowledge outside the registered root")
    rmSync(join(vault.rootPath, "index.md"))
    symlinkSync(outside, join(vault.rootPath, "index.md"))

    await expect(
      searchProjectVault(database, { projectId: "project-1", query: "knowledge" }),
    ).rejects.toThrow(/real file|symbolic link/i)
  })

  it.skipIf(process.platform === "win32")(
    "keeps content and metadata intact when the vault root becomes read-only",
    async () => {
      const vault = database
        .select()
        .from(schema.projectVaults)
        .where(eq(schema.projectVaults.projectId, "project-1"))
        .get()!
      chmodSync(vault.rootPath, 0o500)
      try {
        await expect(
          writeProjectVaultSection(database, {
            projectId: "project-1",
            sectionId: "index",
            expectedVersion: 1,
            content: "must not land",
          }),
        ).rejects.toThrow()
      } finally {
        chmodSync(vault.rootPath, 0o700)
      }

      await expect(
        readProjectVaultSection(database, { projectId: "project-1", sectionId: "index" }),
      ).resolves.toMatchObject({ content: "# Project Knowledge\n\n", version: 1 })
    },
  )

  it("adopts an exactly reviewed outside change and rejects stale reconciliation", async () => {
    const current = await readProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
    })
    const vault = database
      .select()
      .from(schema.projectVaults)
      .where(eq(schema.projectVaults.projectId, "project-1"))
      .get()!
    writeFileSync(join(vault.rootPath, "index.md"), "outside content")
    const outside = await readProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
    })
    expect(outside.externallyModified).toBe(true)

    const adopted = await adoptExternalProjectVaultSectionChange(database, {
      projectId: "project-1",
      sectionId: "index",
      expectedVersion: current.version,
      expectedCurrentContentHash: outside.currentContentHash,
    })
    expect(adopted.version).toBe(2)
    await expect(
      readProjectVaultSection(database, { projectId: "project-1", sectionId: "index" }),
    ).resolves.toMatchObject({ content: "outside content", externallyModified: false })
    await expect(
      adoptExternalProjectVaultSectionChange(database, {
        projectId: "project-1",
        sectionId: "index",
        expectedVersion: 1,
        expectedCurrentContentHash: outside.currentContentHash,
      }),
    ).rejects.toThrow("version is stale")
  })

  it("rejects adopting an outside change that contains a detected secret", async () => {
    const vault = database
      .select()
      .from(schema.projectVaults)
      .where(eq(schema.projectVaults.projectId, "project-1"))
      .get()!
    writeFileSync(
      join(vault.rootPath, "index.md"),
      "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
    )
    const outside = await readProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
    })

    await expect(
      adoptExternalProjectVaultSectionChange(database, {
        projectId: "project-1",
        sectionId: "index",
        expectedVersion: 1,
        expectedCurrentContentHash: outside.currentContentHash,
      }),
    ).rejects.toThrow("detected secret")
  })

  it("preserves reviewed outside content before saving the local draft", async () => {
    const vault = database
      .select()
      .from(schema.projectVaults)
      .where(eq(schema.projectVaults.projectId, "project-1"))
      .get()!
    writeFileSync(join(vault.rootPath, "index.md"), "outside version")
    const outside = await readProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
    })

    const saved = await writeProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
      expectedVersion: 1,
      expectedCurrentContentHash: outside.currentContentHash,
      content: "local draft",
    })
    expect(saved.version).toBe(2)
    const [backup] = listProjectVaultSectionBackups(database, {
      projectId: "project-1",
      sectionId: "index",
    })
    await expect(
      readProjectVaultSectionBackup(database, {
        projectId: "project-1",
        sectionId: "index",
        backupId: backup!.id,
      }),
    ).resolves.toMatchObject({ content: "outside version" })
    await expect(
      readProjectVaultSection(database, { projectId: "project-1", sectionId: "index" }),
    ).resolves.toMatchObject({ content: "local draft", externallyModified: false })
  })
})
