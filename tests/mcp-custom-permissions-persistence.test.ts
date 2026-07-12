import Database from "better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { evaluateMcpToolGate } from "../src/main/lib/mcp-control/gate"
import {
  createSqliteMcpCallerStore,
  resolveTrustedMcpCaller,
} from "../src/main/lib/mcp-control/identity"
import { getMcpControlTool } from "../src/main/lib/mcp-control/registry"

const directories: string[] = []
const toggles = {
  fileWrite: false,
  shell: true,
  network: false,
  git: true,
  browser: false,
  mcp: true,
  secrets: false,
}

afterEach(() => {
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
      "INSERT INTO chats (id, name, scope, permission_mode, custom_permissions) VALUES (?, ?, ?, ?, ?)",
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
    ).toMatchObject({ decision: "denied", reason: expect.stringContaining("fileWrite") })
  })

  it("keeps Tier 3 approval fresh after durable custom capability checks", () => {
    const { path, sqlite } = createDatabase()
    sqlite.close()
    const caller = resolveTrustedMcpCaller({ chatId: "chat-1" }, createSqliteMcpCallerStore(path))
    const tool = getMcpControlTool("launch_run")!

    expect(evaluateMcpToolGate({ tool, caller }).decision).toBe("approval-required")
    expect(evaluateMcpToolGate({ tool, caller, approved: true }).decision).toBe("allowed")
  })
})
