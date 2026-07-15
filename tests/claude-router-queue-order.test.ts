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
  responses: [] as string[],
}))

vi.mock("electron", () => ({
  app: {
    getPath: () => process.env.FLAPSTACK_TEST_USER_DATA || "/tmp/flapstack-claude-order",
    getAppPath: () => process.cwd(),
    isPackaged: false,
    isReady: () => false,
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
  createTransformer: () =>
    function* transform(message: any) {
      if (message.type === "assistant") {
        const text = message.message?.content?.[0]?.text ?? ""
        yield { type: "text-delta", delta: text }
        yield { type: "text-end" }
      }
      if (message.type === "result") {
        yield { type: "finish", finishReason: "stop", messageMetadata: {} }
      }
    },
  getBundledClaudeBinaryPath: () => "/tmp/claude",
  logClaudeEnv: () => undefined,
  logRawClaudeMessage: () => undefined,
}))

vi.mock("../src/main/lib/checkpoints", () => ({
  captureCheckpoint: vi.fn(async (runId: string, _cwd: string | null, phase: string) => ({
    id: `${runId}-${phase}`,
  })),
  captureNoChangeManifest: vi.fn(async () => undefined),
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

vi.mock("../src/main/lib/harness/launch-context", () => ({
  buildHarnessContextBundle: vi.fn(async () => ({
    context: "",
    metadata: { sourceFingerprint: "test" },
  })),
  getLastHarnessContextFingerprint: () => undefined,
  prependStartupContext: (prompt: string) => prompt,
}))

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () =>
    (async function* () {
      const response = mocks.responses.shift() ?? "missing-response"
      yield {
        type: "assistant",
        uuid: `uuid-${response}`,
        session_id: `session-${response}`,
        message: {
          model: "claude-test",
          content: [{ type: "text", text: response }],
        },
      }
      yield { type: "result", subtype: "success", session_id: `session-${response}` }
    })(),
}))

import { closeDatabase } from "../src/main/lib/db"
import { recoverLegacyQueuedRunPrompts } from "../src/main/lib/db/migrate"
import { drainPendingMcpRuns, type QueuedAgentRun } from "../src/main/lib/run-launch-service"
import { claudeRouter } from "../src/main/lib/trpc/routers/claude"

let directory = ""
let databasePath = ""

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-claude-order-"))
  databasePath = join(directory, "agents.db")
  process.env.FLAPSTACK_DB_PATH = databasePath
  process.env.FLAPSTACK_TEST_USER_DATA = directory
  const sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  seedLegacyQueue(sqlite)
  expect(recoverLegacyQueuedRunPrompts(sqlite)).toBe(2)
  sqlite.close()
  mocks.responses.splice(0, mocks.responses.length, "A-response", "B-response")
  mocks.checkOfflineFallback.mockReset().mockResolvedValue({
    config: undefined,
    isUsingOllama: false,
  })
})

afterEach(() => {
  closeDatabase()
  delete process.env.FLAPSTACK_DB_PATH
  delete process.env.FLAPSTACK_TEST_USER_DATA
  rmSync(directory, { recursive: true, force: true })
})

describe("Claude legacy queue routing", () => {
  it("persists A/response/B/response through the real router", async () => {
    await drainPendingMcpRuns(databasePath, launchThroughClaudeRouter, {
      waitForCompletion: true,
    })
    await drainPendingMcpRuns(databasePath, launchThroughClaudeRouter, {
      waitForCompletion: true,
    })

    expect(readVisibleTranscript()).toEqual(["A", "A-response", "B", "B-response"])
  })
})

async function launchThroughClaudeRouter(run: QueuedAgentRun): Promise<void> {
  const stream = await claudeRouter.createCaller({ getWindow: () => null }).chat({
    runId: run.runId,
    chatId: run.chatId,
    subChatId: run.subChatId,
    prompt: run.prompt,
    cwd: run.worktreePath!,
    mode: "agent",
    historyEnabled: false,
    enableTasks: false,
  })
  if (stream?.[Symbol.asyncIterator]) {
    for await (const _chunk of stream) {
      // Drain the real router stream.
    }
    return
  }
  await new Promise<void>((resolvePromise, rejectPromise) => {
    stream.subscribe({
      next: () => undefined,
      error: rejectPromise,
      complete: resolvePromise,
    })
  })
}

function seedLegacyQueue(sqlite: Database.Database): void {
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, scope, harness, permission_mode, worktree_path) VALUES ('chat-order', 'Claude order', 'global', 'claude-code', 'full-access', ?)",
    )
    .run(directory)
  sqlite
    .prepare(
      "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, worktree_path, run_status, messages) VALUES ('sub-order', 'chat-order', 'claude-code', 'full-access', ?, 'pending', ?)",
    )
    .run(
      directory,
      JSON.stringify([
        { id: "mcp-order-a", role: "user", parts: [{ type: "text", text: "A" }] },
        { id: "mcp-order-b", role: "user", parts: [{ type: "text", text: "B" }] },
      ]),
    )
  const insert = sqlite.prepare(
    `INSERT INTO agent_runs (
      id, chat_id, sub_chat_id, harness, permission_mode, worktree_path,
      prompt_message_id, status, started_at,
      runtime_snapshot_version, runtime_preference, runtime_preference_source,
      resolved_runtime, runtime_adapter_version, runtime_protocol_version,
      runtime_capability_snapshot, runtime_control_snapshot
    ) VALUES (?, 'chat-order', 'sub-order', 'claude-code', 'full-access', ?, ?, 'pending', ?,
      ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run("run-a", directory, "mcp-order-a", 1, ...testRuntimeSnapshotSqlValues("claude-code"))
  insert.run("run-b", directory, "mcp-order-b", 2, ...testRuntimeSnapshotSqlValues("claude-code"))
}

function readVisibleTranscript(): string[] {
  const sqlite = new Database(databasePath)
  const row = sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'sub-order'").get() as {
    messages: string
  }
  sqlite.close()
  return JSON.parse(row.messages).flatMap((message: any) =>
    message.parts.filter((part: any) => part.type === "text").map((part: any) => part.text),
  )
}
