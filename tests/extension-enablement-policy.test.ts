import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { eq } from "drizzle-orm"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { chats, extensionEnablementPolicies, projects, tasks } from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import {
  buildExtensionRunContext,
  clearExtensionEnablementPolicy,
  extensionPolicyTargetFromManifest,
  resolveExtensionEnablement,
  setExtensionEnablementPolicy,
  UnsupportedExtensionPolicyScopeError,
  type ExtensionPolicyTarget,
} from "../src/main/lib/extension-management"
import { discoverProviderExtensions } from "../src/main/lib/provider-extensions"

type AppDatabase = ReturnType<typeof drizzle<typeof schema>>

const migrations = resolve(process.cwd(), "drizzle")

describe("extension enablement policy", () => {
  let directory: string
  let databasePath: string
  let projectRoot: string
  let homeDir: string
  let sqlite: Database.Database
  let database: AppDatabase

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "flapstack-extension-policy-"))
    databasePath = join(directory, "agents.db")
    projectRoot = join(directory, "project")
    homeDir = join(directory, "home")
    mkdirSync(projectRoot)
    mkdirSync(homeDir)
    ;({ sqlite, database } = openDatabase(databasePath))
    database.insert(projects).values({ id: "project-1", name: "Project", path: projectRoot }).run()
    database.insert(tasks).values({ id: "task-1", projectId: "project-1", name: "Task" }).run()
    database
      .insert(chats)
      .values({
        id: "chat-1",
        name: "Task chat",
        scope: "task",
        projectId: "project-1",
        taskId: "task-1",
      })
      .run()
  })

  afterEach(() => {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it("resolves task over project over user over the enabled fixed default", () => {
    const target = targetFixture("claude-code", "skill", "user")
    expect(resolveExtensionEnablement(database, { target })).toMatchObject({
      support: "supported",
      enabled: true,
      source: "fixed-default",
    })

    setExtensionEnablementPolicy(database, {
      target,
      location: { type: "user" },
      enabled: false,
    })
    setExtensionEnablementPolicy(database, {
      target,
      location: { type: "project", projectId: "project-1" },
      enabled: true,
    })
    setExtensionEnablementPolicy(database, {
      target,
      location: { type: "task", projectId: "project-1", taskId: "task-1" },
      enabled: false,
    })

    expect(
      resolveExtensionEnablement(database, {
        target,
        projectId: "project-1",
        taskId: "task-1",
      }),
    ).toMatchObject({ enabled: false, source: "task" })

    clearExtensionEnablementPolicy(database, {
      target,
      location: { type: "task", projectId: "project-1", taskId: "task-1" },
    })
    expect(
      resolveExtensionEnablement(database, {
        target,
        projectId: "project-1",
        taskId: "task-1",
      }),
    ).toMatchObject({ enabled: true, source: "project" })

    clearExtensionEnablementPolicy(database, {
      target,
      location: { type: "project", projectId: "project-1" },
    })
    expect(
      resolveExtensionEnablement(database, {
        target,
        projectId: "project-1",
        taskId: "task-1",
      }),
    ).toMatchObject({ enabled: false, source: "user" })
  })

  it("rejects unsupported capabilities and mismatched task scopes before writing", () => {
    const disabledHook = targetFixture("claude-code", "hook", "user")
    expect(() =>
      setExtensionEnablementPolicy(database, {
        target: disabledHook,
        location: { type: "task", projectId: "project-1", taskId: "task-1" },
        enabled: true,
      }),
    ).toThrow(UnsupportedExtensionPolicyScopeError)

    database
      .insert(projects)
      .values({ id: "project-2", name: "Other", path: join(directory, "other") })
      .run()
    expect(() =>
      setExtensionEnablementPolicy(database, {
        target: targetFixture("codex", "skill", "user"),
        location: { type: "task", projectId: "project-2", taskId: "task-1" },
        enabled: false,
      }),
    ).toThrow("Task does not belong to the requested project")

    expect(database.select().from(extensionEnablementPolicies).all()).toEqual([])
  })

  it("persists decisions across a migration-safe restart", () => {
    const target = targetFixture("codex", "skill", "user")
    setExtensionEnablementPolicy(database, {
      target,
      location: { type: "task", projectId: "project-1", taskId: "task-1" },
      enabled: false,
    })
    sqlite.close()

    ;({ sqlite, database } = openDatabase(databasePath))
    expect(
      resolveExtensionEnablement(database, {
        target,
        projectId: "project-1",
        taskId: "task-1",
      }),
    ).toMatchObject({ support: "supported", enabled: false, source: "task" })
    expect(
      database
        .select({ enabled: extensionEnablementPolicies.enabled })
        .from(extensionEnablementPolicies)
        .where(eq(extensionEnablementPolicies.extensionId, target.extensionId))
        .get(),
    ).toEqual({ enabled: false })
  })

  it("upgrades an existing 0029 profile additively and idempotently", () => {
    const legacyMigrations = join(directory, "migrations-through-0029")
    cpSync(migrations, legacyMigrations, { recursive: true })
    const journalPath = join(legacyMigrations, "meta", "_journal.json")
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      version: string
      dialect: string
      entries: Array<{ idx: number; tag: string }>
    }
    writeFileSync(
      journalPath,
      `${JSON.stringify({ ...journal, entries: journal.entries.filter((entry) => entry.idx <= 29) }, null, 2)}\n`,
    )

    const upgradePath = join(directory, "upgrade.db")
    const upgradeSqlite = new Database(upgradePath)
    upgradeSqlite.pragma("foreign_keys = ON")
    const upgradeDatabase = drizzle(upgradeSqlite, { schema })
    migrateDatabase(upgradeDatabase, upgradeSqlite, legacyMigrations)
    expect(
      upgradeSqlite
        .prepare(
          "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'extension_enablement_policies'",
        )
        .get(),
    ).toBeUndefined()
    upgradeSqlite
      .prepare("INSERT INTO projects (id, name, path) VALUES ('upgrade-project', 'Old', '/old')")
      .run()

    migrateDatabase(upgradeDatabase, upgradeSqlite, migrations)
    migrateDatabase(upgradeDatabase, upgradeSqlite, migrations)
    expect(
      upgradeSqlite
        .prepare(
          "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'extension_enablement_policies'",
        )
        .get(),
    ).toEqual({ present: 1 })
    expect(
      upgradeSqlite.prepare("SELECT name, path FROM projects WHERE id = 'upgrade-project'").get(),
    ).toEqual({ name: "Old", path: "/old" })
    upgradeSqlite.close()
  })

  it.each([
    {
      harness: "claude-code" as const,
      root: () => join(homeDir, ".claude", "skills"),
      files: ["alpha/SKILL.md", "beta/SKILL.md"],
    },
    {
      harness: "codex" as const,
      root: () => join(homeDir, ".agents", "skills"),
      files: ["alpha/SKILL.md", "beta/SKILL.md"],
    },
    {
      harness: "cursor-agent" as const,
      root: () => join(projectRoot, ".cursor", "commands"),
      files: ["alpha.md", "beta.md"],
    },
  ])("injects the resolved enabled set into $harness run context", async (fixture) => {
    for (const file of fixture.files) writeExtension(fixture.root(), file)
    const inventory = await discoverProviderExtensions({ cwd: projectRoot, homeDir })
    const harnessInventory = inventory.filter(
      (extension) => extensionPolicyTargetFromManifest(extension).harness === fixture.harness,
    )
    const alpha = harnessInventory.find((extension) => extension.name === "alpha")
    const beta = harnessInventory.find((extension) => extension.name === "beta")
    expect(alpha).toBeDefined()
    expect(beta).toBeDefined()

    setExtensionEnablementPolicy(database, {
      target: extensionPolicyTargetFromManifest(alpha!),
      location: { type: "task", projectId: "project-1", taskId: "task-1" },
      enabled: false,
    })
    const runContext = await buildExtensionRunContext(database, {
      chatId: "chat-1",
      harness: fixture.harness,
      cwd: projectRoot,
      homeDir,
    })
    expect(runContext.manifest.disabledExtensionIds).toContain(alpha!.id)
    expect(runContext.manifest.enabledExtensionIds).not.toContain(alpha!.id)
    expect(runContext.manifest.enabledExtensionIds).toContain(beta!.id)
    expect(runContext.context).toContain("Only extensions listed under Enabled are available")
    expect(runContext.context).toContain(`${alpha!.id} | policy=task`)
  })

  it("keeps the migration serialized as 0030 immediately after 0029", () => {
    const journal = JSON.parse(readFileSync(join(migrations, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>
    }
    expect(journal.entries.slice(-2)).toEqual([
      expect.objectContaining({ idx: 29, tag: "0029_advanced_usage_contracts" }),
      expect.objectContaining({ idx: 30, tag: "0030_extension_enablement_policy" }),
    ])
    expect(journal.entries.some((entry) => entry.idx === 31 || entry.tag.startsWith("0031_"))).toBe(
      false,
    )
  })

  it("wires every supported native harness router to the policy run context", () => {
    for (const router of ["claude", "codex", "cursor"]) {
      const source = readFileSync(`src/main/lib/trpc/routers/${router}.ts`, "utf8")
      expect(source).toContain("buildExtensionRunContext")
      expect(source).toContain("extensionContext.context")
      expect(source).toContain("extensionPolicy")
    }
  })
})

function openDatabase(path: string): { sqlite: Database.Database; database: AppDatabase } {
  const sqlite = new Database(path)
  sqlite.pragma("foreign_keys = ON")
  const database = drizzle(sqlite, { schema })
  migrateDatabase(database, sqlite, migrations)
  return { sqlite, database }
}

function targetFixture(
  harness: ExtensionPolicyTarget["harness"],
  kind: ExtensionPolicyTarget["kind"],
  nativeScope: ExtensionPolicyTarget["nativeScope"],
): ExtensionPolicyTarget {
  return { extensionId: `${harness}:${kind}:fixture`, harness, kind, nativeScope }
}

function writeExtension(root: string, relativePath: string): void {
  const target = join(root, relativePath)
  mkdirSync(resolve(target, ".."), { recursive: true })
  const name = relativePath.includes("alpha") ? "alpha" : "beta"
  writeFileSync(target, `---\nname: ${name}\ndescription: ${name}\n---\n${name} body\n`)
}
