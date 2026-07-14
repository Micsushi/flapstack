import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { afterEach, describe, expect, it } from "vitest"
import { readMcpCallerIdentity } from "../src/main/lib/mcp-control/identity"
import * as schema from "../src/main/lib/db/schema"

const transports: StdioClientTransport[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()))
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe("Flapstack MCP stdio transport", () => {
  it("rejects startup without launcher-owned caller identity", () => {
    expect(() => readMcpCallerIdentity({})).toThrow(/launcher-provided caller identity/)
    expect(() => readMcpCallerIdentity({ FLAPSTACK_MCP_CHAT_ID: "chat-without-run" })).toThrow(
      /launcher-provided caller identity/,
    )
  })

  it("lists and calls ping and describe through a real stdio child", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-stdio-"))
    directories.push(directory)
    const databasePath = join(directory, "agents.db")
    const database = new Database(databasePath)
    migrate(drizzle(database, { schema }), {
      migrationsFolder: resolve(process.cwd(), "drizzle"),
    })
    database
      .prepare(
        "INSERT INTO chats (id, scope, permission_mode, mcp_exposure_enabled) VALUES ('chat-transport-test', 'global', 'read-only', 1)",
      )
      .run()
    database
      .prepare(
        "INSERT INTO agent_runs (id, chat_id, harness, permission_mode, status, started_at) VALUES ('run-transport-test', 'chat-transport-test', 'codex', 'read-only', 'running', 0)",
      )
      .run()
    database.close()
    const entry = fileURLToPath(new URL("../src/main/mcp-control-stdio.ts", import.meta.url))
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", entry],
      env: {
        PATH: process.env.PATH ?? "",
        FLAPSTACK_MCP_CHAT_ID: "chat-transport-test",
        FLAPSTACK_MCP_RUN_ID: "run-transport-test",
        FLAPSTACK_MCP_PERMISSION_MODE: "read-only",
        FLAPSTACK_DB_PATH: databasePath,
      },
      stderr: "pipe",
    })
    transports.push(transport)
    const client = new Client({ name: "flapstack-test-client", version: "1.0.0" })
    await client.connect(transport)

    const listed = await client.listTools()
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "ping",
      "describe",
      "list_projects",
      "list_tasks",
      "list_chats",
      "list_runs",
      "list_worktrees",
      "list_artifacts",
      "search",
      "list_vault_sections",
      "read_vault_section",
      "create_vault_section",
      "update_vault_section",
      "update_vault_handoff",
      "record_vault_decision",
      "create_chat",
      "spawn_thread",
      "orchestrate_task",
      "create_task",
      "rename_item",
      "archive_item",
      "move_chat",
      "pin_item",
      "restore_item",
      "add_attachment",
      "write_attachment_to_worktree",
      "launch_run",
      "create_automation_draft",
    ])

    const ping = await client.callTool({ name: "ping", arguments: {} })
    expect(ping.structuredContent).toMatchObject({
      ok: true,
      data: { status: "ok", caller: { chatId: "chat-transport-test" } },
    })

    const describe = await client.callTool({ name: "describe", arguments: {} })
    expect(describe.structuredContent).toMatchObject({
      ok: true,
      data: { transport: "stdio" },
    })
    const projects = await client.callTool({ name: "list_projects", arguments: {} })
    expect(projects.structuredContent).toEqual({ ok: true, data: { items: [], nextCursor: null } })
    await client.close()

    const audited = new Database(databasePath, { readonly: true })
    expect(
      audited
        .prepare(
          "SELECT count(DISTINCT invocation_id) count FROM mcp_audit_records WHERE status = 'completed' AND tool_name IN ('ping', 'describe', 'list_projects')",
        )
        .get(),
    ).toEqual({ count: 3 })
    audited.close()
  })
})
