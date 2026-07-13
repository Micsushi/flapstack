import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import {
  buildMcpStdioRegistration,
  renameProductMcpRecordCollisions,
  renameProductMcpServerCollisions,
} from "../src/main/lib/mcp-control/registration"
import {
  getChatMcpExposureStatus,
  registerActiveProductMcpSession,
  resetActiveProductMcpSessionsForTests,
  revokeActiveProductMcpSessions,
  setChatMcpExposure,
} from "../src/main/lib/mcp-control/exposure"
import {
  createSqliteMcpCallerStore,
  resolveTrustedMcpCaller,
} from "../src/main/lib/mcp-control/identity"

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/flapstack-mcp-exposure-test", isPackaged: false },
}))

const directories: string[] = []

afterEach(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  resetActiveProductMcpSessionsForTests()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("Flapstack MCP per-chat exposure", () => {
  it("builds a launcher-owned stdio identity without caller-controlled arguments", () => {
    expect(
      buildMcpStdioRegistration(
        {
          chatId: "chat-1",
          runId: "run-1",
          permissionMode: "ask-before-edits",
        },
        {
          executablePath: "/Flapstack",
          mainDirectory: "/app/out/main",
          databasePath: "/user/data/agents.db",
        },
      ),
    ).toEqual({
      command: "/Flapstack",
      args: ["/app/out/main/mcp-control-stdio.js"],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        FLAPSTACK_MCP_CHAT_ID: "chat-1",
        FLAPSTACK_MCP_RUN_ID: "run-1",
        FLAPSTACK_MCP_PERMISSION_MODE: "ask-before-edits",
        FLAPSTACK_DB_PATH: "/user/data/agents.db",
      },
    })
  })

  it("migrates existing chats to exposure disabled", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "drizzle/0017_third_molecule_man.sql"),
      "utf8",
    )
    expect(migration).toContain("ADD `mcp_exposure_enabled` integer DEFAULT false NOT NULL")
  })

  it("preserves reserved-name third-party servers under explicit collision aliases", () => {
    const record = {
      flapstack: { command: "third-party" },
      Flapstack: { command: "case-variant" },
      FLAPSTACK: { command: "upper-variant" },
      "flapstack-third-party": { command: "existing" },
    }
    expect(renameProductMcpRecordCollisions(record)).toEqual([
      "flapstack-third-party-2",
      "flapstack-third-party-3",
      "flapstack-third-party-4",
    ])
    expect(record).toEqual({
      "flapstack-third-party": { command: "existing" },
      "flapstack-third-party-2": { command: "third-party" },
      "flapstack-third-party-3": { command: "case-variant" },
      "flapstack-third-party-4": { command: "upper-variant" },
    })
    expect(Object.keys(record).some((name) => name.toLowerCase() === "flapstack")).toBe(false)

    const list = [
      { name: "flapstack", command: "first" },
      { name: "FLAPSTACK", command: "second" },
      { name: "flapstack-third-party", command: "existing" },
    ]
    expect(renameProductMcpServerCollisions(list)).toEqual([
      "flapstack-third-party-2",
      "flapstack-third-party-3",
    ])
    expect(list.map((server) => server.name)).toEqual([
      "flapstack-third-party-2",
      "flapstack-third-party-3",
      "flapstack-third-party",
    ])
  })

  it("revokes the exposed run immediately and requires a new identity after re-enable", () => {
    const oldRun = vi.fn()
    const newRun = vi.fn()
    registerActiveProductMcpSession({ chatId: "chat-1", runId: "run-old", revoke: oldRun })

    expect(revokeActiveProductMcpSessions("chat-1")).toBe(1)
    expect(oldRun).toHaveBeenCalledOnce()
    expect(revokeActiveProductMcpSessions("chat-1")).toBe(0)

    registerActiveProductMcpSession({ chatId: "chat-1", runId: "run-new", revoke: newRun })
    expect(revokeActiveProductMcpSessions("chat-1")).toBe(1)
    expect(oldRun).toHaveBeenCalledOnce()
    expect(newRun).toHaveBeenCalledOnce()
  })

  it("durably invalidates the old run when disabled and accepts only a new run after re-enable", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-exposure-"))
    directories.push(directory)
    const databasePath = join(directory, "agents.db")
    const sqlite = new Database(databasePath)
    migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
    sqlite
      .prepare(
        "INSERT INTO chats (id, harness, scope, permission_mode, mcp_exposure_enabled) VALUES ('chat-1', 'codex', 'global', 'read-only', 1)",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, messages, run_status) VALUES ('sub-1', 'chat-1', 'codex', 'read-only', '[]', 'running')",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO agent_runs (id, chat_id, sub_chat_id, harness, permission_mode, status) VALUES ('run-old', 'chat-1', 'sub-1', 'codex', 'read-only', 'running')",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO agent_runs (id, chat_id, sub_chat_id, harness, permission_mode, status) VALUES ('run-normal', 'chat-1', 'sub-1', 'codex', 'read-only', 'running')",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO mcp_approval_requests (id, invocation_id, caller_chat_id, caller_run_id, tool_name, tier, target_summary, input_summary, created_at, expires_at) VALUES ('approval-old', 'invocation-old', 'chat-1', 'run-old', 'spawn_thread', 3, 'test target', '{}', ?, ?)",
      )
      .run(Date.now(), Date.now() + 60_000)
    sqlite.close()
    process.env.FLAPSTACK_DB_PATH = databasePath
    const revoke = vi.fn()
    registerActiveProductMcpSession({ chatId: "chat-1", runId: "run-old", revoke })

    expect(getChatMcpExposureStatus("chat-1")).toMatchObject({
      connection: "connected",
      callerLabel: "Codex / chat-1 / run-old",
      activeRunIds: ["run-old"],
    })

    expect(setChatMcpExposure("chat-1", false)).toBe(false)
    expect(revoke).toHaveBeenCalledOnce()
    const cancelled = new Database(databasePath, { readonly: true })
    expect(cancelled.prepare("SELECT status FROM agent_runs WHERE id = 'run-old'").get()).toEqual({
      status: "cancelled",
    })
    expect(
      cancelled.prepare("SELECT status FROM agent_runs WHERE id = 'run-normal'").get(),
    ).toEqual({ status: "running" })
    expect(cancelled.prepare("SELECT run_status FROM sub_chats WHERE id = 'sub-1'").get()).toEqual({
      run_status: "running",
    })
    expect(
      cancelled
        .prepare("SELECT decision FROM mcp_approval_requests WHERE id = 'approval-old'")
        .get(),
    ).toEqual({ decision: "deny" })
    cancelled.close()
    expect(() =>
      resolveTrustedMcpCaller(
        { chatId: "chat-1", runId: "run-old" },
        createSqliteMcpCallerStore(databasePath),
      ),
    ).toThrow(/exposure is disabled/)

    expect(setChatMcpExposure("chat-1", true)).toBe(true)
    expect(() =>
      resolveTrustedMcpCaller(
        { chatId: "chat-1", runId: "run-old" },
        createSqliteMcpCallerStore(databasePath),
      ),
    ).toThrow(/run is missing or stale/)

    closeDatabase()
    const reloaded = new Database(databasePath)
    reloaded
      .prepare(
        "INSERT INTO agent_runs (id, chat_id, harness, permission_mode, status) VALUES ('run-new', 'chat-1', 'codex', 'read-only', 'running')",
      )
      .run()
    reloaded.close()
    expect(
      resolveTrustedMcpCaller(
        { chatId: "chat-1", runId: "run-new" },
        createSqliteMcpCallerStore(databasePath),
      ),
    ).toMatchObject({ chatId: "chat-1", runId: "run-new" })
  })
})
