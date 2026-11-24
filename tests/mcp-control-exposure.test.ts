import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  isOwnerRegistration,
  childHarnessEnvironment,
} from "../src/main/lib/mcp-control/child-registration"
import { closeDatabase } from "../src/main/lib/db"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import * as schema from "../src/main/lib/db/schema"
import {
  getChatMcpExposureStatus,
  registerActiveProductMcpSession,
  resetActiveProductMcpSessionsForTests,
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
  it("keeps owner registrations and ambient owner credentials out of child launches", () => {
    expect(isOwnerRegistration("flapstack-app-control", {})).toBe(true)
    expect(
      isOwnerRegistration("alias", { args: ["C:\\App\\mcp-control-stdio.js", "--external"] }),
    ).toBe(true)
    expect(isOwnerRegistration("alias", { env: { FLAPSTACK_MCP_OWNER_TOKEN: "fixture" } })).toBe(
      true,
    )
    expect(isOwnerRegistration("other", { args: ["other.js", "--external"] })).toBe(false)
    expect(isOwnerRegistration("flapstack", { env: { FLAPSTACK_MCP_RUN_ID: "child" } })).toBe(false)
    const parent = {
      FLAPSTACK_MCP_OWNER_TOKEN: "fixture",
      FLAPSTACK_MCP_CALLER_MODE: "external",
      PATH: "bin",
    }
    const desktopAndShell = {
      ...parent,
      FLAPSTACK_PROJECT_RECORDS_TOKEN: "public-fixture",
      PROJECT_RECORDS_TOKEN: "public-fixture",
      PROJECT_RECORDS_TOKEN_FILE: "public-path",
      flapstack_project_records_token_file: "public-path",
      FLAPSTACK_MCP_OWNER_TOKEN_FILE: "public-path",
      CODEX_API_KEY: "provider-fixture",
    }
    expect(childHarnessEnvironment(desktopAndShell)).toEqual({
      PATH: "bin",
      CODEX_API_KEY: "provider-fixture",
    })
    expect(childHarnessEnvironment(parent)).toEqual({ PATH: "bin" })
    expect(parent.FLAPSTACK_MCP_OWNER_TOKEN).toBe("fixture")
  })

  it("preserves existing exposure choices during the default-on migration", () => {
    const originalProviders = readFileSync(
      resolve(process.cwd(), "drizzle/0024_mcp_exposure_default_on.sql"),
      "utf8",
    )
    const additionalProviders = readFileSync(
      resolve(process.cwd(), "drizzle/0025_all_provider_mcp_default_on.sql"),
      "utf8",
    )
    expect(originalProviders).not.toContain("UPDATE `chats`")
    expect(additionalProviders).not.toContain("UPDATE `chats`")
    expect(originalProviders).toContain("SELECT 1")
    expect(additionalProviders).toContain("SELECT 1")
    expect(`${originalProviders}\n${additionalProviders}`).not.toContain("DROP TABLE")
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
    const insertRun = sqlite.prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, permission_mode, status,
        runtime_snapshot_version, runtime_preference, runtime_preference_source,
        resolved_runtime, runtime_adapter_version, runtime_protocol_version,
        runtime_capability_snapshot, runtime_control_snapshot
      ) VALUES (?, 'chat-1', 'sub-1', 'codex', 'read-only', 'running',
        ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insertRun.run("run-old", ...testRuntimeSnapshotSqlValues())
    insertRun.run("run-normal", ...testRuntimeSnapshotSqlValues())
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
        `INSERT INTO agent_runs (
          id, chat_id, harness, permission_mode, status,
          runtime_snapshot_version, runtime_preference, runtime_preference_source,
          resolved_runtime, runtime_adapter_version, runtime_protocol_version,
          runtime_capability_snapshot, runtime_control_snapshot
        ) VALUES ('run-new', 'chat-1', 'codex', 'read-only', 'running',
          ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...testRuntimeSnapshotSqlValues())
    reloaded.close()
    expect(
      resolveTrustedMcpCaller(
        { chatId: "chat-1", runId: "run-new" },
        createSqliteMcpCallerStore(databasePath),
      ),
    ).toMatchObject({ chatId: "chat-1", runId: "run-new" })
  })
})
