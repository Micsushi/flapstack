import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { afterEach, describe, expect, it } from "vitest"
import { readMcpCallerIdentity } from "../src/main/lib/mcp-control/identity"

const transports: StdioClientTransport[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()))
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe("Flapstack MCP stdio transport", () => {
  it("rejects startup without launcher-owned caller identity", () => {
    expect(() => readMcpCallerIdentity({})).toThrow(/launcher-provided caller identity/)
  })

  it("lists and calls ping and describe through a real stdio child", async () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-stdio-"))
    directories.push(directory)
    const databasePath = join(directory, "agents.db")
    const database = new Database(databasePath)
    database.exec(
      "CREATE TABLE chats (id TEXT PRIMARY KEY, scope TEXT, task_id TEXT, project_id TEXT); CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, archived_at INTEGER, updated_at INTEGER); INSERT INTO chats VALUES ('chat-transport-test', 'global', NULL, NULL)",
    )
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
  })
})
