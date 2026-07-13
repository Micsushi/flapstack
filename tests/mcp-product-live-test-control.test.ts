import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { closeDatabase } from "../src/main/lib/db"
import * as schema from "../src/main/lib/db/schema"
import {
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
    getAppPath: () => "/tmp",
    getName: () => "Flapstack",
    getPath: () => "/tmp",
    isPackaged: false,
  },
  BrowserWindow: { getAllWindows: () => [] },
}))

let directory = ""
let databasePath = ""

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-product-mcp-live-control-"))
  databasePath = join(directory, "agents.db")
  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite.close()
  process.env.FLAPSTACK_DB_PATH = databasePath
})

afterEach(async () => {
  await resetProductMcpTestCallsForTests()
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  rmSync(directory, { recursive: true, force: true })
})

describe("authenticated dev control for live product MCP", () => {
  it("refuses product-MCP test actions against ordinary user chats", () => {
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
  })

  it("binds live caller worktree only to the running dev checkout", () => {
    expect(prepareProductMcpCaller({ harness: "codex", repoPath: "/tmp" })).toMatchObject({
      worktreePath: "/private/tmp",
    })
    expect(() => prepareProductMcpCaller({ harness: "codex", repoPath: directory })).toThrow(
      /running dev checkout/,
    )
  })

  it("proves exposure, real stdio ping, audit state, and isolated cleanup", async () => {
    const caller = prepareProductMcpCaller({ harness: "codex" })
    expect(caller.exposure).toMatchObject({ enabled: false, connection: "disabled" })

    expect(setProductMcpTestExposure({ chatId: caller.chatId, enabled: true })).toMatchObject({
      enabled: true,
      connection: "next-run",
    })
    const started = startProductMcpTestCall(
      { chatId: caller.chatId, runId: caller.runId, toolName: "ping" },
      { registration: sourceRegistration(caller.chatId, caller.runId) },
    )
    const completed = await waitForCall(started.id)
    expect(completed).toMatchObject({ status: "completed", response: { ok: true } })

    const state = getProductMcpState({ chatId: caller.chatId, toolName: "ping" })
    expect(state.audit.entries.map((entry) => entry.decision)).toContain("completed")
    expect(state.pendingApprovals).toEqual([])
    expect(cleanupProductMcpCaller({ chatId: caller.chatId })).toMatchObject({ archived: true })
  })

  it.each([
    ["codex", "claude-code"],
    ["claude", "codex"],
  ] as const)(
    "approves a real %s product-MCP child creating a %s thread with durable lineage",
    async (sourceHarness, targetHarness) => {
      const caller = prepareProductMcpCaller({ harness: sourceHarness })
      setProductMcpTestExposure({ chatId: caller.chatId, enabled: true })
      const started = startProductMcpTestCall(
        {
          chatId: caller.chatId,
          runId: caller.runId,
          toolName: "spawn_thread",
          arguments: spawnArguments(targetHarness),
        },
        { registration: sourceRegistration(caller.chatId, caller.runId) },
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
    },
  )

  it("stops an approval-waiting child, cancels its caller, and clears the pending decision", async () => {
    const caller = prepareProductMcpCaller({ harness: "codex" })
    setProductMcpTestExposure({ chatId: caller.chatId, enabled: true })
    const started = startProductMcpTestCall(
      {
        chatId: caller.chatId,
        runId: caller.runId,
        toolName: "spawn_thread",
        arguments: spawnArguments("claude-code"),
      },
      { registration: sourceRegistration(caller.chatId, caller.runId) },
    )
    await waitForApproval(caller.chatId)
    expect(getProductMcpState({ chatId: caller.chatId }).exposure.connection).toBe("connected")

    expect(setProductMcpTestExposure({ chatId: caller.chatId, enabled: false })).toMatchObject({
      enabled: false,
      connection: "disabled",
    })
    await vi.waitFor(() =>
      expect(getProductMcpTestCall({ callId: started.id }).status).toBe("cancelled"),
    )
    const state = getProductMcpState({ chatId: caller.chatId })
    expect(state.pendingApprovals).toEqual([])
    expect(state.runs[0]?.status).toBe("cancelled")
    expect(state.children).toEqual([])
    cleanupProductMcpCaller({ chatId: caller.chatId })
  })
})

function sourceRegistration(chatId: string, runId: string) {
  const entry = fileURLToPath(new URL("../src/main/mcp-control-stdio.ts", import.meta.url))
  return {
    command: process.execPath,
    args: ["--import", "tsx", entry],
    env: {
      FLAPSTACK_MCP_CHAT_ID: chatId,
      FLAPSTACK_MCP_RUN_ID: runId,
      FLAPSTACK_MCP_PERMISSION_MODE: "full-access",
      FLAPSTACK_DB_PATH: databasePath,
    },
  }
}

function spawnArguments(targetHarness: "codex" | "claude-code") {
  return {
    targetHarness,
    scope: { kind: "global" },
    permission: { mode: "full-access" },
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
    { timeout: 10_000, interval: 25 },
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
    { timeout: 10_000, interval: 25 },
  )
  return approval!
}
