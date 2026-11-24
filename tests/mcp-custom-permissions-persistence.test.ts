import Database from "better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import { closeDatabase } from "../src/main/lib/db"
import { evaluateMcpToolGate } from "../src/main/lib/mcp-control/gate"
import {
  createSqliteMcpCallerStore,
  resolveTrustedMcpCaller,
} from "../src/main/lib/mcp-control/identity"
import { getMcpControlTool } from "../src/main/lib/mcp-control/registry"
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

  it("uses the immutable run capability snapshot after the chat changes", () => {
    const { path, sqlite } = createDatabase()
    const runPermissions = { ...toggles, productMcpRead: true }
    sqlite
      .prepare(
        `INSERT INTO agent_runs
          (id, chat_id, harness, permission_mode, custom_permissions, status,
           runtime_snapshot_version, runtime_preference, runtime_preference_source,
           resolved_runtime, runtime_adapter_version, runtime_protocol_version,
           runtime_capability_snapshot, runtime_control_snapshot)
         VALUES ('run-1', 'chat-1', 'codex', 'custom', ?, 'running',
           ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(JSON.stringify(runPermissions), ...testRuntimeSnapshotSqlValues())
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
