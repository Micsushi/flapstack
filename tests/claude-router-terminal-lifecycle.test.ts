import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"

const mocks = vi.hoisted(() => ({
  checkOfflineFallback: vi.fn(),
}))

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.FLAPSTACK_TEST_USER_DATA || "/tmp/flapstack-claude-lifecycle",
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => "",
  },
}))

vi.mock("../src/main/lib/claude", () => ({
  buildClaudeEnv: () => ({}),
  checkOfflineFallback: mocks.checkOfflineFallback,
  createTransformer: () => ({ transform: () => [] }),
  getBundledClaudeBinaryPath: () => "/tmp/claude",
  logClaudeEnv: () => undefined,
  logRawClaudeMessage: () => undefined,
}))

vi.mock("../src/main/lib/checkpoints", () => ({
  captureCheckpoint: vi.fn(async (runId: string, _cwd: string | null, phase: string) => ({
    id: `${runId}-${phase}`,
  })),
  captureRunManifest: vi.fn(async () => undefined),
}))

vi.mock("../src/main/lib/credential-service", () => ({
  getCredentialService: () => ({
    resolve: () => null,
    status: () => ({ available: false, persistence: "none", metadata: null }),
  }),
}))

vi.mock("../src/main/lib/claude-token", () => ({
  getExistingClaudeToken: () => null,
}))

vi.mock("@anthropic-ai/claude-agent-sdk", () => {
  throw new Error("Claude SDK unavailable for lifecycle test")
})

import { closeDatabase } from "../src/main/lib/db"
import { claudeRouter, hasActiveClaudeSessions } from "../src/main/lib/trpc/routers/claude"
import { drainPendingMcpRuns } from "../src/main/lib/run-launch-service"

let directory = ""
let databasePath = ""

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-claude-lifecycle-"))
  databasePath = join(directory, "agents.db")
  process.env.FLAPSTACK_DB_PATH = databasePath
  process.env.FLAPSTACK_TEST_USER_DATA = directory
  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite.close()
  mocks.checkOfflineFallback.mockReset()
})

afterEach(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  delete process.env.FLAPSTACK_TEST_USER_DATA
  rmSync(directory, { recursive: true, force: true })
})

describe("Claude router durable terminal lifecycle", () => {
  it("finalizes an offline preflight failure, clears stream ownership, and unblocks FIFO", async () => {
    seedConversation([
      { id: "run-offline", status: "running", startedAt: 1 },
      { id: "run-next", status: "pending", startedAt: 2 },
    ])
    mocks.checkOfflineFallback.mockResolvedValue({ error: "Offline model unavailable" })

    const chunks = await runClaude("run-offline")

    expect(chunks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "error" }), { type: "finish" }]),
    )
    expect(hasActiveClaudeSessions()).toBe(false)
    expect(readRun("run-offline")).toMatchObject({
      status: "failure",
      completed_at: expect.any(Number),
    })
    expect(readSubChat()).toEqual({ run_status: "pending", stream_id: null })

    const launched: string[] = []
    expect(
      await drainPendingMcpRuns(
        databasePath,
        async (run) => {
          launched.push(run.runId)
          const sqlite = new Database(databasePath)
          sqlite
            .prepare("UPDATE agent_runs SET status = 'success', completed_at = ? WHERE id = ?")
            .run(Date.now(), run.runId)
          sqlite
            .prepare("UPDATE sub_chats SET run_status = 'success' WHERE id = ?")
            .run(run.subChatId)
          sqlite.close()
        },
        { waitForCompletion: true },
      ),
    ).toBe(1)
    expect(launched).toEqual(["run-next"])
  })

  it("finalizes SDK load failure against the durable input run", async () => {
    seedConversation([{ id: "run-sdk", status: "running", startedAt: 1 }])
    mocks.checkOfflineFallback.mockResolvedValue({
      config: undefined,
      isUsingOllama: false,
    })

    await runClaude("run-sdk")

    expect(readRun("run-sdk")).toMatchObject({
      status: "failure",
      completed_at: expect.any(Number),
    })
    expect(readSubChat()).toEqual({ run_status: "failure", stream_id: null })
    expect(hasActiveClaudeSessions()).toBe(false)
  })

  it("cancels a superseded owner without letting it strand the next queued run", async () => {
    seedConversation([
      { id: "run-old", status: "running", startedAt: 1 },
      { id: "run-new", status: "running", startedAt: 2 },
      { id: "run-queued", status: "pending", startedAt: 3 },
    ])
    let resolveOld!: (value: { error: string }) => void
    mocks.checkOfflineFallback
      .mockImplementationOnce(
        () =>
          new Promise((resolvePromise) => {
            resolveOld = resolvePromise
          }),
      )
      .mockResolvedValueOnce({ error: "Second preflight failed" })

    const oldRun = runClaude("run-old", "Old prompt")
    await vi.waitFor(() => expect(mocks.checkOfflineFallback).toHaveBeenCalledTimes(1))
    const newRun = runClaude("run-new", "New prompt")
    await vi.waitFor(() => expect(mocks.checkOfflineFallback).toHaveBeenCalledTimes(2))
    resolveOld({ error: "Old preflight finished late" })
    await Promise.all([oldRun, newRun])

    expect(readRun("run-old")).toMatchObject({
      status: "cancelled",
      completed_at: expect.any(Number),
    })
    expect(readRun("run-new")).toMatchObject({
      status: "failure",
      completed_at: expect.any(Number),
    })
    expect(readSubChat()).toEqual({ run_status: "pending", stream_id: null })
    expect(hasActiveClaudeSessions()).toBe(false)
  })
})

function seedConversation(
  runs: Array<{ id: string; status: "running" | "pending"; startedAt: number }>,
): void {
  const sqlite = new Database(databasePath)
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, harness, permission_mode) VALUES ('chat-1', 'Claude lifecycle', 'global', 'claude-code', 'full-access')",
    )
    .run()
  sqlite
    .prepare(
      "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, run_status, messages) VALUES ('sub-1', 'chat-1', 'claude-code', 'full-access', 'running', '[]')",
    )
    .run()
  const insert = sqlite.prepare(
    `INSERT INTO agent_runs (
      id, chat_id, sub_chat_id, harness, permission_mode, worktree_path,
      prompt_message_id, initial_prompt, status, started_at,
      runtime_snapshot_version, runtime_preference, runtime_preference_source,
      resolved_runtime, runtime_adapter_version, runtime_protocol_version,
      runtime_capability_snapshot, runtime_control_snapshot
    ) VALUES (?, 'chat-1', 'sub-1', 'claude-code', 'full-access', ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const run of runs) {
    insert.run(
      run.id,
      directory,
      `mcp-${run.id}`,
      `Prompt for ${run.id}`,
      run.status,
      run.startedAt,
      ...testRuntimeSnapshotSqlValues("claude-code"),
    )
  }
  sqlite.close()
}

async function runClaude(runId: string, prompt = `Prompt for ${runId}`): Promise<any[]> {
  const caller = claudeRouter.createCaller({ getWindow: () => null })
  const stream = await caller.chat({
    runId,
    chatId: "chat-1",
    subChatId: "sub-1",
    prompt,
    cwd: directory,
    mode: "write",
  })
  return await collectStream(stream)
}

async function collectStream(stream: any): Promise<any[]> {
  const chunks: any[] = []
  if (stream?.[Symbol.asyncIterator]) {
    for await (const chunk of stream) chunks.push(chunk)
    return chunks
  }
  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.subscribe({
      next: (chunk: any) => chunks.push(chunk),
      error: rejectPromise,
      complete: resolvePromise,
    })
  })
  return chunks
}

function readRun(runId: string): Record<string, unknown> {
  const sqlite = new Database(databasePath)
  const row = sqlite
    .prepare("SELECT status, completed_at FROM agent_runs WHERE id = ?")
    .get(runId) as Record<string, unknown>
  sqlite.close()
  return row
}

function readSubChat(): Record<string, unknown> {
  const sqlite = new Database(databasePath)
  const row = sqlite
    .prepare("SELECT run_status, stream_id FROM sub_chats WHERE id = 'sub-1'")
    .get() as Record<string, unknown>
  sqlite.close()
  return row
}
