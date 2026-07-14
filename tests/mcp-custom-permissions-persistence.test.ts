import Database from "better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { closeDatabase } from "../src/main/lib/db"
import { evaluateMcpToolGate } from "../src/main/lib/mcp-control/gate"
import {
  createSqliteMcpCallerStore,
  resolveTrustedMcpCaller,
} from "../src/main/lib/mcp-control/identity"
import { getMcpControlTool } from "../src/main/lib/mcp-control/registry"
import { permissionsRouter } from "../src/main/lib/trpc/routers/permissions"
import {
  recoverPendingAllChatPermissionChange,
  stageAllChatPermissionPreferences,
} from "../src/main/lib/permissions"

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/flapstack-mcp-custom-test", isPackaged: false },
}))

const directories: string[] = []
const toggles = {
  schemaVersion: 1 as const,
  projectWrite: false,
  shell: true,
  network: false,
  git: true,
  browser: false,
  secrets: false,
  subagents: false,
  thirdPartyMcp: true,
  productMcpRead: true,
  productMcpWrite: true,
  productMcpTier3: false,
}

afterEach(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  delete process.env.FLAPSTACK_CONFIG_DIR
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function createDatabase(): { path: string; sqlite: Database.Database } {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-custom-"))
  directories.push(directory)
  const path = join(directory, "agents.db")
  const sqlite = new Database(path)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, permission_mode, custom_permissions, mcp_exposure_enabled) VALUES (?, ?, ?, ?, ?, 1)",
    )
    .run("chat-1", "Custom caller", "global", "custom", JSON.stringify(toggles))
  return { path, sqlite }
}

describe("durable MCP custom permissions", () => {
  it("survives a database close and reloads the stored per-chat toggles", () => {
    const { path, sqlite } = createDatabase()
    sqlite.close()

    const untrustedLaunchData = { chatId: "chat-1", permissionMode: "full-access" }
    const caller = resolveTrustedMcpCaller(untrustedLaunchData, createSqliteMcpCallerStore(path))
    expect(caller.permissionMode).toBe("custom")
    expect(caller).toMatchObject({ permissionMode: "custom", customPermissions: toggles })
    expect(
      evaluateMcpToolGate({ tool: getMcpControlTool("list_projects")!, caller }).decision,
    ).toBe("allowed")
  })

  it.each([
    ["missing", null],
    ["malformed", "not-json"],
    ["partial", JSON.stringify({ mcp: true })],
    ["unsupported", JSON.stringify({ ...toggles, futureCapability: true })],
  ])("fails closed for %s stored toggle state", (_name, stored) => {
    const { path, sqlite } = createDatabase()
    sqlite.prepare("UPDATE chats SET custom_permissions = ? WHERE id = 'chat-1'").run(stored)
    sqlite.close()

    expect(() =>
      resolveTrustedMcpCaller({ chatId: "chat-1" }, createSqliteMcpCallerStore(path)),
    ).toThrow(/missing stored capability toggles/)
  })

  it("denies a disabled capability from durable state", () => {
    const { path, sqlite } = createDatabase()
    sqlite.close()

    const caller = resolveTrustedMcpCaller({ chatId: "chat-1" }, createSqliteMcpCallerStore(path))
    expect(
      evaluateMcpToolGate({ tool: getMcpControlTool("write_attachment_to_worktree")!, caller }),
    ).toMatchObject({ decision: "denied", reason: expect.stringContaining("projectWrite") })
  })

  it("keeps Tier 3 approval fresh after durable custom capability checks", () => {
    const { path, sqlite } = createDatabase()
    sqlite
      .prepare("UPDATE chats SET custom_permissions = ? WHERE id = 'chat-1'")
      .run(JSON.stringify({ ...toggles, productMcpTier3: true, subagents: true }))
    sqlite.close()
    const caller = resolveTrustedMcpCaller({ chatId: "chat-1" }, createSqliteMcpCallerStore(path))
    const tool = getMcpControlTool("launch_run")!

    expect(evaluateMcpToolGate({ tool, caller }).decision).toBe("approval-required")
    expect(evaluateMcpToolGate({ tool, caller, approved: true }).decision).toBe("allowed")
  })

  it("uses the immutable run capability snapshot after the chat changes", () => {
    const { path, sqlite } = createDatabase()
    const runPermissions = { ...toggles, productMcpRead: true }
    sqlite
      .prepare(
        `INSERT INTO agent_runs
          (id, chat_id, harness, permission_mode, custom_permissions, status)
         VALUES ('run-1', 'chat-1', 'codex', 'custom', ?, 'running')`,
      )
      .run(JSON.stringify(runPermissions))
    sqlite
      .prepare("UPDATE chats SET custom_permissions = ? WHERE id = 'chat-1'")
      .run(JSON.stringify({ ...toggles, productMcpRead: false }))
    sqlite.close()

    const caller = resolveTrustedMcpCaller(
      { chatId: "chat-1", runId: "run-1" },
      createSqliteMcpCallerStore(path),
    )
    expect(caller.customPermissions).toEqual(runPermissions)
    expect(
      evaluateMcpToolGate({ tool: getMcpControlTool("list_projects")!, caller }).decision,
    ).toBe("allowed")
  })

  it("persists exact custom toggles only for the current chat and clears them on exit", async () => {
    const { path, sqlite } = createDatabase()
    sqlite
      .prepare(
        "INSERT INTO chats (id, name, scope, permission_mode, custom_permissions) VALUES (?, ?, ?, ?, ?)",
      )
      .run("chat-2", "Other caller", "global", "read-only", null)
    sqlite.close()
    process.env.FLAPSTACK_DB_PATH = path
    process.env.FLAPSTACK_CONFIG_DIR = join(path, "..")
    const caller = permissionsRouter.createCaller({ getWindow: () => null })
    const exact = { ...toggles, projectWrite: true, shell: false }

    await caller.setChatMode({
      chatId: "chat-1",
      mode: "custom",
      scope: "current-chat",
      customPermissions: exact,
    })
    closeDatabase()

    let reloaded = new Database(path)
    expect(
      reloaded
        .prepare("SELECT permission_mode, custom_permissions FROM chats WHERE id = 'chat-1'")
        .get(),
    ).toEqual({ permission_mode: "custom", custom_permissions: JSON.stringify(exact) })
    expect(
      reloaded
        .prepare("SELECT permission_mode, custom_permissions FROM chats WHERE id = 'chat-2'")
        .get(),
    ).toEqual({ permission_mode: "read-only", custom_permissions: null })
    reloaded.close()

    await caller.setChatMode({
      chatId: "chat-1",
      mode: "ask-before-edits",
      scope: "current-chat",
    })
    closeDatabase()
    reloaded = new Database(path)
    expect(
      reloaded
        .prepare("SELECT permission_mode, custom_permissions FROM chats WHERE id = 'chat-1'")
        .get(),
    ).toEqual({ permission_mode: "ask-before-edits", custom_permissions: null })
    reloaded.close()
  })

  it.each([
    ["missing", undefined],
    ["partial", { mcp: true }],
    ["extra-key", { ...toggles, futureCapability: true }],
    ["malformed", { ...toggles, shell: "yes" }],
  ])(
    "rejects %s current-chat custom input before persistence",
    async (_name, customPermissions) => {
      const { path, sqlite } = createDatabase()
      sqlite.close()
      process.env.FLAPSTACK_DB_PATH = path
      process.env.FLAPSTACK_CONFIG_DIR = join(path, "..")
      const caller = permissionsRouter.createCaller({ getWindow: () => null })

      await expect(
        caller.setChatMode({
          chatId: "chat-1",
          mode: "custom",
          scope: "current-chat",
          customPermissions: customPermissions as typeof toggles,
        }),
      ).rejects.toThrow()
      closeDatabase()

      const reloaded = new Database(path)
      expect(
        reloaded
          .prepare("SELECT permission_mode, custom_permissions FROM chats WHERE id = 'chat-1'")
          .get(),
      ).toEqual({ permission_mode: "custom", custom_permissions: JSON.stringify(toggles) })
      reloaded.close()
    },
  )

  it("applies all-chat custom atomically and persists the future default", async () => {
    const { path, sqlite } = createDatabase()
    sqlite
      .prepare(
        "INSERT INTO projects (id, name, path, default_permission_mode) VALUES ('project-1', 'Project', '/tmp/project', 'read-only')",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO tasks (id, project_id, name, default_permission_mode) VALUES ('task-1', 'project-1', 'Task', 'read-only')",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO chats (id, name, scope, permission_mode, custom_permissions) VALUES (?, ?, ?, ?, ?)",
      )
      .run("chat-2", "Other caller", "global", "read-only", null)
    sqlite.close()
    process.env.FLAPSTACK_DB_PATH = path
    process.env.FLAPSTACK_CONFIG_DIR = join(path, "..")
    const caller = permissionsRouter.createCaller({ getWindow: () => null })
    await caller.setChatMode({
      chatId: "chat-1",
      mode: "custom",
      scope: "all-chats",
      rememberBehavior: "all-chats",
      customPermissions: toggles,
    })
    expect(await caller.getPreferences()).toEqual({
      globalDefault: "custom",
      changeBehavior: "all-chats",
      globalCustomPermissions: toggles,
    })
    closeDatabase()

    const reloaded = new Database(path)
    expect(
      reloaded
        .prepare("SELECT id, permission_mode, custom_permissions FROM chats ORDER BY id")
        .all(),
    ).toEqual([
      { id: "chat-1", permission_mode: "custom", custom_permissions: JSON.stringify(toggles) },
      { id: "chat-2", permission_mode: "custom", custom_permissions: JSON.stringify(toggles) },
    ])
    expect(
      reloaded
        .prepare(
          "SELECT default_permission_mode, default_custom_permissions FROM projects WHERE id = 'project-1'",
        )
        .get(),
    ).toEqual({
      default_permission_mode: "custom",
      default_custom_permissions: JSON.stringify(toggles),
    })
    expect(
      reloaded
        .prepare(
          "SELECT default_permission_mode, default_custom_permissions FROM tasks WHERE id = 'task-1'",
        )
        .get(),
    ).toEqual({
      default_permission_mode: "custom",
      default_custom_permissions: JSON.stringify(toggles),
    })
    reloaded.close()
  })

  it("recovers an interrupted all-chat promotion from the durable atomic intent", () => {
    const { path, sqlite } = createDatabase()
    sqlite
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, permission_mode, messages) VALUES ('sub-1', 'chat-1', 'read-only', '[]')",
      )
      .run()
    process.env.FLAPSTACK_CONFIG_DIR = join(path, "..")
    stageAllChatPermissionPreferences({
      globalDefault: "custom",
      changeBehavior: "all-chats",
      globalCustomPermissions: toggles,
    })
    const configPath = join(path, "..", "permissions.json")
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toMatchObject({
      globalDefault: "custom",
      pendingAllChatsSync: true,
    })

    expect(recoverPendingAllChatPermissionChange(sqlite)).toBe(true)

    expect(
      sqlite
        .prepare("SELECT permission_mode, custom_permissions FROM chats WHERE id = 'chat-1'")
        .get(),
    ).toEqual({ permission_mode: "custom", custom_permissions: JSON.stringify(toggles) })
    expect(
      sqlite.prepare("SELECT permission_mode FROM sub_chats WHERE id = 'sub-1'").get(),
    ).toEqual({ permission_mode: "custom" })
    expect(JSON.parse(readFileSync(configPath, "utf8"))).not.toHaveProperty("pendingAllChatsSync")
    expect(readdirSync(join(path, "..")).filter((name) => name.endsWith(".tmp"))).toEqual([])
    sqlite.close()
  })
})
