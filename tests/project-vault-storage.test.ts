import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fileSymlinksSupported } from "./helpers/symlink-capability"
import * as schema from "../src/main/lib/db/schema"
import {
  filesystemRootRegistrations,
  projectVaultBackups,
  projectVaultPolicies,
  projectVaultSections,
  projectVaults,
  projects,
} from "../src/main/lib/db/schema"
import { updateProjectVaultPolicy } from "../src/main/lib/project-vaults/policy"
import {
  deleteProjectVault,
  getProjectVaultDeleteContract,
  ProjectVaultConflictError,
  readProjectVaultSection,
  readProjectVaultSectionBackup,
  scaffoldProjectVault,
  writeProjectVaultSection,
} from "../src/main/lib/project-vaults/storage"

type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

describe("typed project vault storage", () => {
  let directory: string
  let appDataRoot: string
  let projectRoot: string
  let databasePath: string
  let sqlite: Database.Database
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "flapstack-project-vault-"))
    appDataRoot = join(directory, "app-data")
    projectRoot = join(directory, "project")
    databasePath = join(directory, "agents.db")
    mkdirSync(appDataRoot)
    mkdirSync(projectRoot)
    ;({ sqlite, database } = openDatabase(databasePath))
    database.insert(projects).values({ id: "project-1", name: "Project", path: projectRoot }).run()
  })

  afterEach(() => {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it("migrates typed metadata and scaffolds only approved Markdown sections", async () => {
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'project_vault_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
    expect(tables.map((table) => table.name)).toEqual([
      "project_vault_backups",
      "project_vault_custom_notes",
      "project_vault_graph_edges",
      "project_vault_graph_generations",
      "project_vault_graph_nodes",
      "project_vault_graph_state",
      "project_vault_policies",
      "project_vault_sections",
      "project_vaults",
    ])

    const result = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["handoff", "decisions"],
    })
    expect(result.vault.schemaVersion).toBe(1)
    expect(result.sections.map((section) => section.sectionId)).toEqual(["handoff", "decisions"])
    expect(readdirSync(result.vault.rootPath).sort()).toEqual([
      "current-handoff.md",
      "decisions.md",
    ])
    expect(existsSync(join(result.vault.rootPath, "index.md"))).toBe(false)

    sqlite.close()
    ;({ sqlite, database } = openDatabase(databasePath))
    await expect(
      readProjectVaultSection(database, { projectId: "project-1", sectionId: "handoff" }),
    ).resolves.toMatchObject({
      content: "# Current Handoff\n\n",
      version: 1,
      externallyModified: false,
    })
  })

  it("fails closed on traversal-like registry abuse and symlinked scaffold parents", async () => {
    const outside = join(directory, "outside")
    mkdirSync(outside)
    symlinkSync(
      outside,
      join(appDataRoot, "knowledge-vaults"),
      process.platform === "win32" ? "junction" : "dir",
    )

    await expect(
      scaffoldProjectVault(database, {
        projectId: "project-1",
        appDataRoot,
        sections: ["index"],
      }),
    ).rejects.toThrow(/symbolic link/)
    expect(readdirSync(outside)).toEqual([])
    expect(database.select().from(projectVaults).all()).toEqual([])
    expect(database.select().from(projectVaultSections).all()).toEqual([])
  })

  it("scaffolds the stable project-owned path only after policy opt-in", async () => {
    execFileSync("git", ["init", "-q"], { cwd: projectRoot })
    updateProjectVaultPolicy(database, {
      projectId: "project-1",
      appDataRoot,
      locationMode: "project-owned",
      projectOwnedOptIn: true,
      gitTrackingEnabled: false,
    })
    const { vault, sections } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["context"],
    })

    expect(vault.rootPath).toBe(join(projectRoot, ".flapstack", "knowledge"))
    expect(sections.map((section) => section.sectionId)).toEqual(["context"])
    expect(readFileSync(join(vault.rootPath, "context.md"), "utf8")).toBe("# Durable Context\n\n")
  })

  it("uses optimistic versions, durable backups, and detects outside edits", async () => {
    const { vault } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index"],
    })
    const updated = await writeProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
      expectedVersion: 1,
      content: "# Updated\n",
    })
    expect(updated.version).toBe(2)
    const [backup] = database.select().from(projectVaultBackups).all()
    expect(backup).toMatchObject({ projectId: "project-1", sectionId: "index", version: 1 })
    expect(readFileSync(join(vault.rootPath, backup.relativePath), "utf8")).toBe(
      "# Project Knowledge\n\n",
    )

    await expect(
      writeProjectVaultSection(database, {
        projectId: "project-1",
        sectionId: "index",
        expectedVersion: 1,
        content: "stale",
      }),
    ).rejects.toBeInstanceOf(ProjectVaultConflictError)
    expect(readFileSync(join(vault.rootPath, "index.md"), "utf8")).toBe("# Updated\n")

    writeFileSync(join(vault.rootPath, "index.md"), "outside edit")
    await expect(
      writeProjectVaultSection(database, {
        projectId: "project-1",
        sectionId: "index",
        expectedVersion: 2,
        content: "must not overwrite",
      }),
    ).rejects.toThrow("changed outside Flapstack")
    expect(readFileSync(join(vault.rootPath, "index.md"), "utf8")).toBe("outside edit")
  })

  it("quarantines a secret-bearing outside version from backup previews", async () => {
    const { vault } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index"],
    })
    const target = join(vault.rootPath, "index.md")
    writeFileSync(target, "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456")
    const outside = await readProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
    })
    await writeProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
      expectedVersion: 1,
      expectedCurrentContentHash: outside.currentContentHash,
      content: "secret removed",
    })
    const [backup] = database.select().from(projectVaultBackups).all()

    await expect(
      readProjectVaultSectionBackup(database, {
        projectId: "project-1",
        sectionId: "index",
        backupId: backup!.id,
      }),
    ).rejects.toThrow("detected secret")
  })

  it("serializes same-version writers so exactly one update wins", async () => {
    await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index"],
    })
    const writes = await Promise.allSettled([
      writeProjectVaultSection(database, {
        projectId: "project-1",
        sectionId: "index",
        expectedVersion: 1,
        content: "first",
      }),
      writeProjectVaultSection(database, {
        projectId: "project-1",
        sectionId: "index",
        expectedVersion: 1,
        content: "second",
      }),
    ])
    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(writes.filter((result) => result.status === "rejected")).toHaveLength(1)
    const stored = await readProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
    })
    expect(stored.version).toBe(2)
    expect(["first", "second"]).toContain(stored.content)
    expect(database.select().from(projectVaultBackups).all()).toHaveLength(1)
  })

  it("rolls content back when a post-write operation fails", async () => {
    const { vault } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index"],
    })
    await expect(
      writeProjectVaultSection(
        database,
        {
          projectId: "project-1",
          sectionId: "index",
          expectedVersion: 1,
          content: "temporary replacement",
        },
        { afterContentWrite: () => Promise.reject(new Error("forced metadata failure")) },
      ),
    ).rejects.toThrow("forced metadata failure")

    expect(readFileSync(join(vault.rootPath, "index.md"), "utf8")).toBe("# Project Knowledge\n\n")
    expect(database.select().from(projectVaultSections).all()[0].version).toBe(1)
    expect(database.select().from(projectVaultBackups).all()).toEqual([])
    expect(readdirSync(join(vault.rootPath, ".backups", "index"))).toEqual([])
  })

  it("refuses an external edit that lands immediately before atomic replace", async () => {
    const { vault } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index"],
    })
    const target = join(vault.rootPath, "index.md")

    await expect(
      writeProjectVaultSection(
        database,
        {
          projectId: "project-1",
          sectionId: "index",
          expectedVersion: 1,
          content: "local draft",
        },
        { beforeContentCommit: () => writeFileSync(target, "external edit") },
      ),
    ).rejects.toMatchObject({
      name: "ProjectVaultConflictError",
      message: "Project vault section changed outside Flapstack.",
    })

    expect(readFileSync(target, "utf8")).toBe("external edit")
    expect(database.select().from(projectVaultSections).all()[0].version).toBe(1)
    expect(database.select().from(projectVaultBackups).all()).toEqual([])
  })

  it("preserves an external edit when metadata failure rollback loses ownership", async () => {
    const { vault } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index"],
    })
    const target = join(vault.rootPath, "index.md")

    await expect(
      writeProjectVaultSection(
        database,
        {
          projectId: "project-1",
          sectionId: "index",
          expectedVersion: 1,
          content: "temporary replacement",
        },
        {
          afterContentWrite: () => {
            writeFileSync(target, "external replacement")
            throw new Error("forced metadata failure")
          },
        },
      ),
    ).rejects.toThrow("content rollback also failed")

    expect(readFileSync(target, "utf8")).toBe("external replacement")
    expect(database.select().from(projectVaultSections).all()[0].version).toBe(1)
    expect(database.select().from(projectVaultBackups).all()).toEqual([])
  })

  it("rolls a partially created scaffold back when metadata persistence fails", async () => {
    sqlite.exec(`
      CREATE TRIGGER fail_project_vault_insert
      BEFORE INSERT ON project_vaults
      BEGIN SELECT RAISE(ABORT, 'forced vault insert failure'); END;
    `)
    const vaultPath = join(appDataRoot, "knowledge-vaults", "project-1")
    await expect(
      scaffoldProjectVault(database, {
        projectId: "project-1",
        appDataRoot,
        sections: ["index", "handoff"],
      }),
    ).rejects.toThrow("forced vault insert failure")

    expect(existsSync(vaultPath)).toBe(false)
    expect(database.select().from(projectVaults).all()).toEqual([])
    expect(
      database
        .select()
        .from(filesystemRootRegistrations)
        .all()
        .some((registration) => registration.path === vaultPath),
    ).toBe(false)
  })

  it("requires a registered unchanged root for every read", async () => {
    const { vault } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index"],
    })
    sqlite.prepare("DELETE FROM filesystem_root_registrations WHERE path = ?").run(vault.rootPath)

    await expect(
      readProjectVaultSection(database, { projectId: "project-1", sectionId: "index" }),
    ).rejects.toThrow("no durable filesystem identity")
  })

  it("locks location changes and requires an exact current delete contract", async () => {
    const { vault } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index"],
    })
    expect(() =>
      updateProjectVaultPolicy(database, {
        projectId: "project-1",
        appDataRoot,
        locationMode: "project-owned",
        projectOwnedOptIn: true,
        gitTrackingEnabled: false,
      }),
    ).toThrow("Delete the existing project vault")

    const staleContract = getProjectVaultDeleteContract(database, "project-1")
    await expect(
      deleteProjectVault(database, { contract: staleContract, confirmationPhrase: "delete" }),
    ).rejects.toThrow("exact confirmation phrase")
    await writeProjectVaultSection(database, {
      projectId: "project-1",
      sectionId: "index",
      expectedVersion: 1,
      content: "new version",
    })
    await expect(
      deleteProjectVault(database, {
        contract: staleContract,
        confirmationPhrase: staleContract.requiredPhrase,
      }),
    ).rejects.toThrow("changed after deletion confirmation")

    const current = getProjectVaultDeleteContract(database, "project-1")
    await expect(
      deleteProjectVault(database, {
        contract: current,
        confirmationPhrase: current.requiredPhrase,
      }),
    ).resolves.toEqual({ projectId: "project-1", deleted: true })
    expect(existsSync(vault.rootPath)).toBe(false)
    expect(database.select().from(projectVaults).all()).toEqual([])
    expect(database.select().from(projectVaultSections).all()).toEqual([])
    expect(database.select().from(projectVaultBackups).all()).toEqual([])
    expect(database.select().from(projectVaultPolicies).all()).toHaveLength(1)
  })

  it.skipIf(!fileSymlinksSupported)(
    "refuses vault deletion when the tree contains a symlink",
    async () => {
      const { vault } = await scaffoldProjectVault(database, {
        projectId: "project-1",
        appDataRoot,
        sections: ["index"],
      })
      const outside = join(directory, "outside-secret")
      writeFileSync(outside, "keep")
      symlinkSync(outside, join(vault.rootPath, "linked-secret"))
      const contract = getProjectVaultDeleteContract(database, "project-1")

      await expect(
        deleteProjectVault(database, {
          contract,
          confirmationPhrase: contract.requiredPhrase,
        }),
      ).rejects.toThrow("refuses symbolic links")
      expect(readFileSync(outside, "utf8")).toBe("keep")
      expect(database.select().from(projectVaults).all()).toHaveLength(1)
    },
  )

  it("restores the vault path and metadata when recursive removal fails", async () => {
    const { vault } = await scaffoldProjectVault(database, {
      projectId: "project-1",
      appDataRoot,
      sections: ["index"],
    })
    const contract = getProjectVaultDeleteContract(database, "project-1")

    await expect(
      deleteProjectVault(
        database,
        { contract, confirmationPhrase: contract.requiredPhrase },
        {
          removeStagedRoot: () => {
            throw new Error("filesystem busy")
          },
        },
      ),
    ).rejects.toThrow("filesystem busy")

    expect(existsSync(vault.rootPath)).toBe(true)
    expect(database.select().from(projectVaults).all()).toHaveLength(1)
    expect(database.select().from(projectVaultSections).all()).toHaveLength(1)
    expect(
      database
        .select()
        .from(filesystemRootRegistrations)
        .all()
        .some((registration) => registration.path === vault.rootPath),
    ).toBe(true)
  })
})

function openDatabase(path: string): { sqlite: Database.Database; database: AppDatabase } {
  const sqlite = new Database(path)
  sqlite.pragma("foreign_keys = ON")
  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: resolve(process.cwd(), "drizzle") })
  return { sqlite, database }
}
