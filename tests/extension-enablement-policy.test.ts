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
  applyCodexExtensionPolicyConfig,
  buildExtensionRunContext,
  clearExtensionEnablementPolicy,
  ExtensionPolicyRunBlockedError,
  extensionPolicyTargetFromManifest,
  filterClaudeExtensionMcpServers,
  filterCodexExtensionMcpServers,
  getClaudeExtensionSdkOptions,
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
    expect(runContext.context).toContain("applied native discovery controls before provider launch")
    expect(runContext.context).toContain(`${alpha!.id} | policy=task`)
    if (fixture.harness === "claude-code") {
      expect(getClaudeExtensionSdkOptions(runContext.launchPolicy)).toEqual({ skills: ["beta"] })
    } else {
      expect(applyCodexExtensionPolicyConfig({}, runContext.launchPolicy)).toMatchObject({
        skills: { config: [{ path: alpha!.sourceId, enabled: false }] },
      })
    }
  })

  it("blocks Cursor command disablement before its unsupported native discovery can launch", async () => {
    writeExtension(join(projectRoot, ".cursor", "commands"), "alpha.md")
    const alpha = (await discoverProviderExtensions({ cwd: projectRoot, homeDir })).find(
      (extension) => extension.provider === "cursor" && extension.name === "alpha",
    )
    expect(alpha).toBeDefined()
    const resolved = setExtensionEnablementPolicy(database, {
      target: extensionPolicyTargetFromManifest(alpha!),
      location: { type: "task", projectId: "project-1", taskId: "task-1" },
      enabled: false,
    })
    expect(resolved.runtimeEnforcement).toMatchObject({ support: "unsupported" })

    await expect(
      buildExtensionRunContext(database, {
        chatId: "chat-1",
        harness: "cursor-agent",
        cwd: projectRoot,
        homeDir,
      }),
    ).rejects.toThrow(ExtensionPolicyRunBlockedError)
  })

  it("blocks Claude commands because its SDK has no per-command discovery filter", async () => {
    writeExtension(join(homeDir, ".claude", "commands"), "alpha.md")
    const alpha = (await discoverProviderExtensions({ cwd: projectRoot, homeDir })).find(
      (extension) =>
        extension.provider === "claude" &&
        extension.kind === "command" &&
        extension.name === "alpha",
    )
    expect(alpha).toBeDefined()
    setExtensionEnablementPolicy(database, {
      target: extensionPolicyTargetFromManifest(alpha!),
      location: { type: "task", projectId: "project-1", taskId: "task-1" },
      enabled: false,
    })

    await expect(
      buildExtensionRunContext(database, {
        chatId: "chat-1",
        harness: "claude-code",
        cwd: projectRoot,
        homeDir,
      }),
    ).rejects.toThrow("no supported per-command native discovery filter")
  })

  it("blocks ambiguous Claude skill names instead of exposing a disabled duplicate", async () => {
    writeExtension(join(homeDir, ".claude", "skills"), "alpha/SKILL.md")
    writeExtension(join(projectRoot, ".claude", "skills"), "alpha/SKILL.md")
    const alphas = (await discoverProviderExtensions({ cwd: projectRoot, homeDir })).filter(
      (extension) =>
        extension.provider === "claude" && extension.kind === "skill" && extension.name === "alpha",
    )
    expect(alphas).toHaveLength(2)
    const projectAlpha = alphas.find((extension) => extension.source === "project")!
    setExtensionEnablementPolicy(database, {
      target: extensionPolicyTargetFromManifest(projectAlpha),
      location: { type: "task", projectId: "project-1", taskId: "task-1" },
      enabled: false,
    })

    await expect(
      buildExtensionRunContext(database, {
        chatId: "chat-1",
        harness: "claude-code",
        cwd: projectRoot,
        homeDir,
      }),
    ).rejects.toThrow("conflicting enabled and disabled native entries")
  })

  it.each(["claude-code", "codex"] as const)(
    "removes disabled MCP servers from %s launch input and enables native config suppression",
    async (harness) => {
      if (harness === "claude-code") {
        writeFileSync(
          join(homeDir, ".claude.json"),
          JSON.stringify({
            mcpServers: { alpha: { command: "alpha" }, beta: { command: "beta" } },
          }),
        )
      } else {
        const codexDir = join(homeDir, ".codex")
        mkdirSync(codexDir, { recursive: true })
        writeFileSync(
          join(codexDir, "config.toml"),
          '[mcp_servers.alpha]\ncommand = "alpha"\n\n[mcp_servers.beta]\ncommand = "beta"\n',
        )
      }
      const inventory = await discoverProviderExtensions({ cwd: projectRoot, homeDir })
      const alpha = inventory.find(
        (extension) =>
          extension.name === "alpha" &&
          extension.kind === "mcp" &&
          extensionPolicyTargetFromManifest(extension).harness === harness,
      )
      expect(alpha).toBeDefined()
      setExtensionEnablementPolicy(database, {
        target: extensionPolicyTargetFromManifest(alpha!),
        location: { type: "task", projectId: "project-1", taskId: "task-1" },
        enabled: false,
      })
      const runContext = await buildExtensionRunContext(database, {
        chatId: "chat-1",
        harness,
        cwd: projectRoot,
        homeDir,
      })

      if (harness === "claude-code") {
        expect(getClaudeExtensionSdkOptions(runContext.launchPolicy)).toEqual({
          strictMcpConfig: true,
        })
        expect(
          filterClaudeExtensionMcpServers(
            { alpha: { command: "alpha" }, beta: { command: "beta" } },
            runContext.launchPolicy,
          ),
        ).toEqual({ beta: { command: "beta" } })
      } else {
        expect(
          filterCodexExtensionMcpServers(
            [
              { name: "alpha", command: "alpha" },
              { name: "beta", command: "beta" },
            ],
            runContext.launchPolicy,
          ),
        ).toEqual([{ name: "beta", command: "beta" }])
        expect(applyCodexExtensionPolicyConfig({}, runContext.launchPolicy)).toMatchObject({
          mcp_servers: { alpha: { enabled: false } },
        })
      }
    },
  )

  it("keeps 0030 serialized after 0029 and before mobile pairing 0031", () => {
    const journal = JSON.parse(readFileSync(join(migrations, "meta", "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>
    }
    expect(journal.entries.slice(29, 32)).toEqual([
      expect.objectContaining({ idx: 29, tag: "0029_advanced_usage_contracts" }),
      expect.objectContaining({ idx: 30, tag: "0030_extension_enablement_policy" }),
      expect.objectContaining({ idx: 31, tag: "0031_mobile_pairing_identity" }),
    ])
  })

  it("wires every supported native harness router to the policy run context", () => {
    for (const router of ["claude", "codex", "cursor"]) {
      const source = readFileSync(`src/main/lib/trpc/routers/${router}.ts`, "utf8")
      expect(source).toContain("buildExtensionRunContext")
      expect(source).toContain("extensionContext.context")
      expect(source).toContain("extensionPolicy")
    }
    const claudeSource = readFileSync("src/main/lib/trpc/routers/claude.ts", "utf8")
    expect(claudeSource).toContain("getClaudeExtensionSdkOptions")
    expect(claudeSource).toContain("filterClaudeExtensionMcpServers")
    expect(
      claudeSource.indexOf("const extensionContext = await buildExtensionRunContext"),
    ).toBeLessThan(claudeSource.indexOf("claudeQuery(queryOptions"))

    const codexSource = readFileSync("src/main/lib/trpc/routers/codex.ts", "utf8")
    expect(codexSource).toContain("applyCodexExtensionPolicyConfig")
    expect(codexSource).toContain("filterCodexExtensionMcpServers")
    expect(
      codexSource.indexOf("const extensionContext = await buildExtensionRunContext"),
    ).toBeLessThan(codexSource.indexOf("getOrCreateProvider({"))

    const cursorSource = readFileSync("src/main/lib/trpc/routers/cursor.ts", "utf8")
    expect(
      cursorSource.indexOf("const extensionContext = await buildExtensionRunContext"),
    ).toBeLessThan(cursorSource.indexOf("child = spawn(binary, args"))
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
