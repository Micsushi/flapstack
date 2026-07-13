import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import {
  drainPendingMcpRuns,
  recoverInterruptedMcpRuns,
  type QueuedAgentRun,
} from "../src/main/lib/run-launch-service"
import { updateSubChatRunStatusIfAuthoritative } from "../src/main/lib/run-status-authority"

const harnessMocks = vi.hoisted(() => ({
  codex: vi.fn(),
  claude: vi.fn(),
}))

vi.mock("../src/main/lib/trpc/routers", () => ({
  createAppRouter: () => ({
    createCaller: () => ({
      codex: { chat: harnessMocks.codex },
      claude: { chat: harnessMocks.claude },
    }),
  }),
}))

import { createMainRunLauncher } from "../src/main/lib/main-run-launcher"

let directory = ""
let path = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-mcp-main-launcher-"))
  path = join(directory, "agents.db")
  sqlite = new Database(path)
  migrateDatabase(drizzle(sqlite, { schema }), sqlite, resolve(process.cwd(), "drizzle"))
  harnessMocks.codex.mockReset().mockResolvedValue(emptyStream())
  harnessMocks.claude.mockReset().mockResolvedValue(emptyStream())
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("MCP main run launcher", () => {
  it("reuses the queued run identity for Codex and Claude launches", async () => {
    const launch = createMainRunLauncher()
    await launch(queuedRun("queued-codex", "codex"))
    await launch(queuedRun("queued-claude", "claude-code"))

    expect(harnessMocks.codex).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "queued-codex", chatId: "chat", subChatId: "sub-chat" }),
    )
    expect(harnessMocks.claude).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "queued-claude", chatId: "chat", subChatId: "sub-chat" }),
    )
  })

  it("has one idempotent startup owner and drains only MCP-origin pending runs", async () => {
    seedRun("mcp-interrupted", "running", "mcp-interrupted-prompt", "codex")
    seedRun("ordinary-interrupted", "running", "ordinary-prompt", "claude-code")
    seedRun("mcp-queued", "pending", "mcp-queued-prompt", "claude-code")
    seedRun("ordinary-queued", "pending", "ordinary-queued-prompt", "codex")

    expect(recoverInterruptedMcpRuns(path)).toBe(1)
    expect(recoverInterruptedMcpRuns(path)).toBe(0)
    expect(sqlite.prepare("SELECT id, status FROM agent_runs ORDER BY id").all()).toEqual([
      { id: "mcp-interrupted", status: "pending" },
      { id: "mcp-queued", status: "pending" },
      { id: "ordinary-interrupted", status: "cancelled" },
      { id: "ordinary-queued", status: "pending" },
    ])

    const launched: QueuedAgentRun[] = []
    expect(
      await drainPendingMcpRuns(path, async (run) => {
        launched.push(run)
      }),
    ).toBe(2)
    expect(launched.map((run) => run.runId).sort()).toEqual(["mcp-interrupted", "mcp-queued"])
    expect(await drainPendingMcpRuns(path, async () => undefined)).toBe(0)
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'ordinary-queued'").get(),
    ).toEqual({ status: "pending" })
  })

  it("serializes distinct MCP launches for one sub-chat and drains them in order", async () => {
    seedSharedConversationRuns()
    let rejectFirst!: (error: Error) => void
    const firstPending = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    const order: string[] = []

    expect(
      await drainPendingMcpRuns(path, async (run) => {
        order.push(run.runId)
        return firstPending
      }),
    ).toBe(1)
    expect(await drainPendingMcpRuns(path, async () => undefined)).toBe(0)
    rejectFirst(new Error("cancelled first launch"))
    await vi.waitFor(() => {
      expect(
        sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'shared-first'").get(),
      ).toEqual({
        status: "failure",
      })
    })
    expect(
      sqlite.prepare("SELECT run_status FROM sub_chats WHERE id = 'shared-sub'").get(),
    ).toEqual({
      run_status: "pending",
    })

    expect(
      await drainPendingMcpRuns(
        path,
        async (run) => {
          order.push(run.runId)
          sqlite
            .prepare("UPDATE agent_runs SET status = 'success', completed_at = ? WHERE id = ?")
            .run(Date.now(), run.runId)
          sqlite
            .prepare("UPDATE sub_chats SET run_status = 'success' WHERE id = ?")
            .run(run.subChatId)
        },
        { waitForCompletion: true },
      ),
    ).toBe(1)
    expect(order).toEqual(["shared-first", "shared-second"])
  })

  it("keeps a newer queued or running run authoritative over stale completion", () => {
    seedSharedConversationRuns()
    const database = drizzle(sqlite, { schema })
    sqlite.prepare("UPDATE agent_runs SET status = 'failure' WHERE id = 'shared-first'").run()

    expect(
      updateSubChatRunStatusIfAuthoritative(database, {
        runId: "shared-first",
        subChatId: "shared-sub",
        status: "failure",
      }),
    ).toBe(false)
    expect(
      sqlite.prepare("SELECT run_status FROM sub_chats WHERE id = 'shared-sub'").get(),
    ).toEqual({
      run_status: "pending",
    })

    sqlite.prepare("UPDATE agent_runs SET status = 'running' WHERE id = 'shared-second'").run()
    updateSubChatRunStatusIfAuthoritative(database, {
      runId: "shared-first",
      subChatId: "shared-sub",
      status: "cancelled",
    })
    expect(
      sqlite.prepare("SELECT run_status FROM sub_chats WHERE id = 'shared-sub'").get(),
    ).toEqual({
      run_status: "running",
    })
  })
})

function queuedRun(runId: string, harness: "codex" | "claude-code"): QueuedAgentRun {
  return {
    runId,
    chatId: "chat",
    subChatId: "sub-chat",
    harness,
    prompt: "Continue queued work.",
    model: null,
    permissionMode: "full-access",
    customPermissions: null,
    worktreePath: "/tmp/worktree",
    projectPath: "/tmp/project",
  }
}

function seedSharedConversationRuns(): void {
  sqlite
    .prepare(
      `INSERT INTO chats (id, name, scope, permission_mode, harness, worktree_path)
       VALUES ('shared-chat', 'Shared', 'global', 'full-access', 'codex', '/tmp/worktree')`,
    )
    .run()
  const messages = [
    { id: "mcp-first", role: "user", parts: [{ type: "text", text: "First" }] },
    { id: "mcp-second", role: "user", parts: [{ type: "text", text: "Second" }] },
  ]
  sqlite
    .prepare(
      `INSERT INTO sub_chats (id, chat_id, harness, permission_mode, worktree_path, run_status, messages)
       VALUES ('shared-sub', 'shared-chat', 'codex', 'full-access', '/tmp/worktree', 'pending', ?)`,
    )
    .run(JSON.stringify(messages))
  const insert = sqlite.prepare(
    `INSERT INTO agent_runs (
      id, chat_id, sub_chat_id, harness, permission_mode, worktree_path,
      prompt_message_id, status, started_at
    ) VALUES (?, 'shared-chat', 'shared-sub', 'codex', 'full-access', '/tmp/worktree', ?, 'pending', ?)`,
  )
  insert.run("shared-first", "mcp-first", 1)
  insert.run("shared-second", "mcp-second", 2)
}

function seedRun(
  runId: string,
  status: "running" | "pending",
  promptMessageId: string,
  harness: "codex" | "claude-code",
): void {
  const chatId = `chat-${runId}`
  const subChatId = `sub-${runId}`
  sqlite
    .prepare(
      `INSERT INTO chats (id, name, scope, permission_mode, harness, worktree_path)
       VALUES (?, ?, 'global', 'full-access', ?, '/tmp/worktree')`,
    )
    .run(chatId, runId, harness)
  sqlite
    .prepare(
      `INSERT INTO sub_chats (id, chat_id, harness, permission_mode, worktree_path, run_status, messages)
       VALUES (?, ?, ?, 'full-access', '/tmp/worktree', ?, ?)`,
    )
    .run(
      subChatId,
      chatId,
      harness,
      status,
      JSON.stringify([
        {
          id: promptMessageId,
          role: "user",
          parts: [{ type: "text", text: `Prompt for ${runId}` }],
        },
      ]),
    )
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, permission_mode, worktree_path,
        prompt_message_id, status, started_at
      ) VALUES (?, ?, ?, ?, 'full-access', '/tmp/worktree', ?, ?, ?)`,
    )
    .run(runId, chatId, subChatId, harness, promptMessageId, status, Date.now())
}

async function* emptyStream(): AsyncGenerator<never> {
  return
}
