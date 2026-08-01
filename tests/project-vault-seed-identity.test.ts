import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { projects } from "../src/main/lib/db/schema"
import {
  ProjectVaultGraphIndex,
  currentProjectVaultGraph,
} from "../src/main/lib/project-vaults/graph-index"
import { projectVaultSectionIds } from "../src/main/lib/project-vaults/registry"
import {
  migrateProjectVaultSeedIdentities,
  type ProjectVaultSeedMigrationHooks,
} from "../src/main/lib/project-vaults/seed-identity"
import { scaffoldProjectVault } from "../src/main/lib/project-vaults/storage"

describe("project vault seed identity migration", () => {
  let directory: string
  let appDataRoot: string
  let sqlite: Database.Database
  let database: ReturnType<typeof drizzle<typeof schema>>

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "flapstack-seed-identity-"))
    appDataRoot = join(directory, "app-data")
    mkdirSync(appDataRoot)
    sqlite = new Database(join(directory, "agents.db"))
    sqlite.pragma("foreign_keys = ON")
    database = drizzle(sqlite, { schema })
    migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })
    database
      .insert(projects)
      .values({
        id: "project-1",
        name: "Project",
        path: directory,
        vaultContextSections: JSON.stringify(["handoff", "decisions"]),
      })
      .run()
  })

  afterEach(() => {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it("adds portable reserved frontmatter while preserving Stage 4 versions in backups", async () => {
    const { vault, sections } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: projectVaultSectionIds,
    })
    const original = new Map(sections.map((section) => [section.sectionId, section]))
    const originalContent = new Map(
      sections.map((section) => [
        section.sectionId,
        readFileSync(join(vault.rootPath, section.relativePath), "utf8"),
      ]),
    )

    await migrateProjectVaultSeedIdentities(sqlite, "project-1")

    const migratedVault = sqlite
      .prepare("SELECT schema_version schemaVersion FROM project_vaults WHERE project_id = ?")
      .get("project-1") as { schemaVersion: number }
    expect(migratedVault.schemaVersion).toBe(2)
    for (const section of sections) {
      const source = readFileSync(join(vault.rootPath, section.relativePath), "utf8")
      expect(source).toContain(`flapstack-id: seed:${section.sectionId}`)
      expect(source).toContain("flapstack-kind: seed")
      expect(source).toContain(`flapstack-section: ${section.sectionId}`)
      expect(source.endsWith(originalContent.get(section.sectionId)!)).toBe(true)

      const row = sqlite
        .prepare(
          `SELECT version, content_hash contentHash
           FROM project_vault_sections WHERE project_id = ? AND section_id = ?`,
        )
        .get("project-1", section.sectionId) as { version: number; contentHash: string }
      expect(row.version).toBe(original.get(section.sectionId)!.version + 1)
      const backup = sqlite
        .prepare(
          `SELECT version, content_hash contentHash, relative_path relativePath
           FROM project_vault_backups WHERE project_id = ? AND section_id = ?`,
        )
        .get("project-1", section.sectionId) as {
        version: number
        contentHash: string
        relativePath: string
      }
      expect(backup).toMatchObject({
        version: original.get(section.sectionId)!.version,
        contentHash: original.get(section.sectionId)!.contentHash,
      })
      expect(readFileSync(join(vault.rootPath, backup.relativePath), "utf8")).toBe(
        originalContent.get(section.sectionId),
      )
    }
    expect(
      (
        sqlite
          .prepare("SELECT vault_context_sections selection FROM projects WHERE id = ?")
          .get("project-1") as { selection: string }
      ).selection,
    ).toBe(JSON.stringify(["handoff", "decisions"]))
  })

  it("resumes an interrupted migration idempotently from its hidden journal", async () => {
    const { vault } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index", "handoff"],
    })
    let writes = 0
    const hooks: ProjectVaultSeedMigrationHooks = {
      afterSeedWrite: () => {
        writes += 1
        if (writes === 1) throw new Error("simulated interruption")
      },
    }

    await expect(migrateProjectVaultSeedIdentities(sqlite, "project-1", hooks)).rejects.toThrow(
      "simulated interruption",
    )
    expect(
      ["index.md", "current-handoff.md"].some((fileName) =>
        readFileSync(join(vault.rootPath, fileName), "utf8").startsWith("---\nflapstack-id:"),
      ),
    ).toBe(true)
    expect(
      (
        sqlite
          .prepare("SELECT schema_version schemaVersion FROM project_vaults WHERE project_id = ?")
          .get("project-1") as { schemaVersion: number }
      ).schemaVersion,
    ).toBe(1)

    await expect(migrateProjectVaultSeedIdentities(sqlite, "project-1")).resolves.toMatchObject({
      migrated: true,
      resumed: true,
    })
    expect(
      sqlite
        .prepare(
          "SELECT version FROM project_vault_sections WHERE project_id = ? ORDER BY section_id",
        )
        .all("project-1"),
    ).toEqual([{ version: 2 }, { version: 2 }])
    await expect(migrateProjectVaultSeedIdentities(sqlite, "project-1")).resolves.toMatchObject({
      migrated: false,
    })
  })

  it("rolls back its partial writes without overwriting a concurrent external edit", async () => {
    const { vault } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index", "handoff"],
    })
    let interrupted = false
    await expect(
      migrateProjectVaultSeedIdentities(sqlite, "project-1", {
        afterSeedWrite: () => {
          if (!interrupted) {
            interrupted = true
            throw new Error("simulated interruption")
          }
        },
      }),
    ).rejects.toThrow("simulated interruption")
    writeFileSync(join(vault.rootPath, "current-handoff.md"), "external edit\n")

    await expect(migrateProjectVaultSeedIdentities(sqlite, "project-1")).rejects.toThrow(
      /changed outside Flapstack/,
    )
    expect(readFileSync(join(vault.rootPath, "index.md"), "utf8")).toBe("# Project Knowledge\n\n")
    expect(readFileSync(join(vault.rootPath, "current-handoff.md"), "utf8")).toBe("external edit\n")
    expect(
      sqlite
        .prepare(
          "SELECT version FROM project_vault_sections WHERE project_id = ? ORDER BY section_id",
        )
        .all("project-1"),
    ).toEqual([{ version: 1 }, { version: 1 }])
  })

  it("keeps seed identity after an external rename and rebuilds from Markdown", async () => {
    const { vault } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index"],
    })
    await migrateProjectVaultSeedIdentities(sqlite, "project-1")
    renameSync(join(vault.rootPath, "index.md"), join(vault.rootPath, "Renamed Index.md"))

    await new ProjectVaultGraphIndex(sqlite).rebuild("project-1")
    const [node] = currentProjectVaultGraph(sqlite, "project-1").nodes
    expect(node).toMatchObject({
      nodeId: "seed:index",
      stableId: "seed:index",
      relativePath: "Renamed Index.md",
      noteType: "seed",
    })
  })
})
