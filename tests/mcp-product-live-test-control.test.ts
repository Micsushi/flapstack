import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startProductMcpRuntime } from "../src/main/lib/mcp-control/desktop-invocation"
import { childLiveKey, CHILD_LIVE_KEY } from "../src/main/lib/mcp-control/child-live-key"
import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import {
  cancelProductMcpChildRun,
  cleanupProductMcpCaller,
  getProductMcpState,
  getProductMcpTestCall,
  prepareProductMcpCaller,
  replyProductMcpApproval,
  resetProductMcpTestCallsForTests,
  setProductMcpTestExposure,
  startProductMcpTestCall,
} from "../src/main/lib/mcp-test-control/service"

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
    getName: () => "Flapstack",
    getPath: () => process.cwd(),
    isPackaged: false,
  },
  BrowserWindow: { getAllWindows: () => [] },
}))

let directory = ""
let databasePath = ""
let runtime: Awaited<ReturnType<typeof startProductMcpRuntime>>

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-product-mcp-live-control-"))
  databasePath = join(directory, "agents.db")
  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite.close()
  process.env.FLAPSTACK_DB_PATH = databasePath
  vi.stubEnv("FLAPSTACK_CONFIG_DIR", directory)
  runtime = await startProductMcpRuntime(databasePath, () => {})
})

afterEach(async () => {
  await resetProductMcpTestCallsForTests()
  await runtime.stop()
  closeDatabase()
  vi.unstubAllEnvs()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

describe("authenticated dev control for live product MCP", () => {
  it("refuses product-MCP test actions against ordinary user chats", async () => {
    const sqlite = new Database(databasePath)
    sqlite
      .prepare(
        "INSERT INTO chats (id, name, harness, scope, permission_mode) VALUES ('ordinary', 'Ordinary', 'codex', 'global', 'full-access')",
      )
      .run()
    sqlite.close()

    expect(() => setProductMcpTestExposure({ chatId: "ordinary", enabled: true })).toThrow(
      /non-test caller/,
    )
    expect(() => getProductMcpState({ chatId: "ordinary" })).toThrow(/non-test caller/)
    await expect(
      cancelProductMcpChildRun({ chatId: "ordinary", childChatId: "child", runId: "run" }),
    ).rejects.toThrow(/non-test caller/)
  })

  it("approves a guarded Codex caller creating a Claude thread with durable lineage", async () => {
    const sourceHarness = "codex"
    const targetHarness = "claude-code"
    const caller = prepareProductMcpCaller({
      harness: sourceHarness,
      permissionMode: "ask-before-edits",
    })
    setProductMcpTestExposure({ chatId: caller.chatId, enabled: true })
    const started = startProductMcpTestCall(
      {
        chatId: caller.chatId,
        runId: caller.runId,
        toolName: "spawn_thread",
        arguments: spawnArguments(targetHarness),
      },
      { registration: sourceRegistration(caller.chatId, caller.runId, "ask-before-edits") },
    )
    const approval = await waitForApproval(caller.chatId)
    expect(replyProductMcpApproval({ approvalId: approval.id, decision: "approve" })).toEqual({
      resolved: true,
    })
    expect(await waitForCall(started.id)).toMatchObject({ status: "completed" })

    const state = getProductMcpState({ chatId: caller.chatId, toolName: "spawn_thread" })
    expect(state.children).toHaveLength(1)
    expect(state.children[0]).toMatchObject({
      harness: targetHarness,
      parentChatId: caller.chatId,
      initiatorChatId: caller.chatId,
      parentRunId: caller.runId,
    })
    expect(state.children[0]!.runs[0]?.startedAt).toMatch(/^20\d\d-/)
    expect(JSON.parse(state.children[0]!.ancestorChatIds ?? "[]")).toEqual([caller.chatId])
    expect(state.audit.entries.map((entry) => entry.decision)).toEqual(
      expect.arrayContaining(["approval-required", "allowed", "completed"]),
    )
    cleanupProductMcpCaller({ chatId: caller.chatId })
  }, 45_000)

  it("rejects a child permission upgrade even after approval of the spawn", async () => {
    const caller = prepareProductMcpCaller({ harness: "codex", permissionMode: "ask-before-edits" })
    setProductMcpTestExposure({ chatId: caller.chatId, enabled: true })
    const started = startProductMcpTestCall(
      {
        chatId: caller.chatId,
        runId: caller.runId,
        toolName: "spawn_thread",
        arguments: { ...spawnArguments("claude-code"), permission: { mode: "full-access" } },
      },
      { registration: sourceRegistration(caller.chatId, caller.runId, "ask-before-edits") },
    )
    const approval = await waitForApproval(caller.chatId)
    replyProductMcpApproval({ approvalId: approval.id, decision: "approve" })
    expect(await waitForCall(started.id)).toMatchObject({
      status: "failed",
      response: { ok: false, error: { code: "permission-denied" } },
    })
    expect(getProductMcpState({ chatId: caller.chatId }).children).toEqual([])
    cleanupProductMcpCaller({ chatId: caller.chatId })
  }, 45_000)
})

function sourceRegistration(chatId: string, runId: string, permissionMode = "full-access") {
  const entry = fileURLToPath(new URL("../src/main/mcp-control-stdio.ts", import.meta.url))
  return {
    command: process.execPath,
    args: ["--import", "tsx", entry],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      [CHILD_LIVE_KEY]: childLiveKey(chatId, runId),
      FLAPSTACK_CONFIG_DIR: directory,
      FLAPSTACK_MCP_CHAT_ID: chatId,
      FLAPSTACK_MCP_RUN_ID: runId,
      FLAPSTACK_MCP_PERMISSION_MODE: permissionMode,
      FLAPSTACK_MCP_TOOL_EXPOSURE: "direct",
      FLAPSTACK_DB_PATH: databasePath,
    },
  }
}

function spawnArguments(targetHarness: "codex" | "claude-code") {
  return {
    targetHarness,
    scope: { kind: "global" },
    permission: { mode: "read-only" },
    worktree: { strategy: "none" },
    launch: { initialPrompt: "Test launch without provider execution." },
  }
}

async function waitForCall(callId: string) {
  let call = getProductMcpTestCall({ callId })
  await vi.waitFor(
    () => {
      call = getProductMcpTestCall({ callId })
      expect(call.status).not.toBe("running")
    },
    { timeout: 25_000, interval: 25 },
  )
  return call
}

async function waitForApproval(chatId: string) {
  let approval = getProductMcpState({ chatId }).pendingApprovals[0]
  await vi.waitFor(
    () => {
      approval = getProductMcpState({ chatId }).pendingApprovals[0]
      expect(approval).toBeDefined()
    },
    { timeout: 25_000, interval: 25 },
  )
  return approval!
}
