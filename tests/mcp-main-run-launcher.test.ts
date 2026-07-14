import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { migrateDatabase, recoverLegacyQueuedRunPrompts } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import {
  drainPendingMcpRuns,
  recoverInterruptedMcpRuns,
  type QueuedAgentRun,
} from "../src/main/lib/run-launch-service"
import { appendMcpAuditRecord } from "../src/main/lib/mcp-control/audit-storage"
import { updateSubChatRunStatusIfAuthoritative } from "../src/main/lib/run-status-authority"

const harnessMocks = vi.hoisted(() => ({
  codex: vi.fn(),
  claude: vi.fn(),
  cursor: vi.fn(),
  opencode: vi.fn(),
}))

vi.mock("../src/main/lib/trpc/routers", () => ({
  createAppRouter: () => ({
    createCaller: () => ({
      codex: { chat: harnessMocks.codex },
      claude: { chat: harnessMocks.claude },
      cursor: { chat: harnessMocks.cursor },
      opencode: { chat: harnessMocks.opencode },
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
  harnessMocks.cursor.mockReset().mockResolvedValue(emptyStream())
  harnessMocks.opencode.mockReset().mockResolvedValue(emptyStream())
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

  it("passes durable per-worker reasoning effort to supported harness launches", async () => {
    const launch = createMainRunLauncher()
    await launch({
      ...queuedRun("effort-codex", "codex"),
      model: "gpt-5.3-codex-spark",
      reasoningEffort: "high",
    })
    await launch({ ...queuedRun("effort-claude", "claude-code"), reasoningEffort: "minimal" })

    expect(harnessMocks.codex).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.3-codex-spark/high",
        reasoningEnabled: true,
        reasoningEffort: "high",
      }),
    )
    expect(harnessMocks.claude).toHaveBeenCalledWith(
      expect.objectContaining({ reasoningEnabled: false }),
    )
    expect(harnessMocks.claude.mock.calls.at(-1)?.[0]).not.toHaveProperty("effort")
  })

  it("uses the normal Cursor and OpenCode-backed launch paths", async () => {
    const launch = createMainRunLauncher()
    await launch({ ...queuedRun("queued-cursor", "cursor-agent"), model: "cursor-model" })
    await launch({ ...queuedRun("queued-openrouter", "openrouter"), model: "openai/gpt-5" })

    expect(harnessMocks.cursor).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "queued-cursor",
        model: "cursor-model",
        reasoningEnabled: true,
      }),
    )
    expect(harnessMocks.opencode).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "queued-openrouter",
        provider: "openrouter",
        model: "openai/gpt-5",
        reasoningEffort: "high",
      }),
    )
  })

  it("maps disabled Codex reasoning to the lowest provider-supported model variant", async () => {
    const launch = createMainRunLauncher()
    await launch({
      ...queuedRun("minimal-codex", "codex"),
      model: "gpt-5.3-codex-spark",
      reasoningEffort: "minimal",
    })

    expect(harnessMocks.codex).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.3-codex-spark/low",
        reasoningEnabled: false,
        reasoningEffort: "minimal",
      }),
    )
  })

  it("replaces stale Codex model effort suffixes with the durable run effort", async () => {
    const launch = createMainRunLauncher()
    await launch({
      ...queuedRun("stale-slash-effort", "codex"),
      model: "gpt-5.3-codex-spark/low",
      reasoningEffort: "high",
    })
    await launch({
      ...queuedRun("stale-bracket-effort", "codex"),
      model: "gpt-5.3-codex-spark[high]",
      reasoningEffort: "minimal",
    })

    expect(harnessMocks.codex.mock.calls.at(-2)?.[0]).toEqual(
      expect.objectContaining({ model: "gpt-5.3-codex-spark/high" }),
    )
    expect(harnessMocks.codex.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ model: "gpt-5.3-codex-spark/low" }),
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

  it("keeps a newer queued run authoritative during interrupted-run recovery", () => {
    seedSharedConversationRuns()
    sqlite
      .prepare(
        `UPDATE agent_runs
         SET status = 'running', prompt_message_id = 'ordinary-interrupted'
         WHERE id = 'shared-first'`,
      )
      .run()
    sqlite.prepare("UPDATE sub_chats SET run_status = 'running' WHERE id = 'shared-sub'").run()

    expect(recoverInterruptedMcpRuns(path)).toBe(0)

    expect(sqlite.prepare("SELECT id, status FROM agent_runs ORDER BY started_at").all()).toEqual([
      { id: "shared-first", status: "cancelled" },
      { id: "shared-second", status: "pending" },
    ])
    expect(
      sqlite.prepare("SELECT run_status FROM sub_chats WHERE id = 'shared-sub'").get(),
    ).toEqual({ run_status: "pending" })
  })

  it.each(["codex", "claude-code"] as const)(
    "recovers two legacy queued %s turns before routing them in exact transcript order",
    async (harness) => {
      seedQueuedTurns(harness)
      expect(recoverLegacyQueuedRunPrompts(sqlite)).toBe(2)
      expect(recoverLegacyQueuedRunPrompts(sqlite)).toBe(0)
      expect(
        sqlite.prepare("SELECT id, initial_prompt FROM agent_runs ORDER BY started_at, id").all(),
      ).toEqual([
        { id: "ordered-first", initial_prompt: "A" },
        { id: "ordered-second", initial_prompt: "B" },
      ])
      expect(
        sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'ordered-sub'").get(),
      ).toEqual({ messages: "[]" })

      const route = async (input: { runId: string; subChatId: string; prompt: string }) => {
        const row = sqlite
          .prepare("SELECT messages FROM sub_chats WHERE id = ?")
          .get(input.subChatId) as { messages: string }
        const messages = JSON.parse(row.messages)
        messages.push(
          {
            id: `mcp-${input.runId}`,
            role: "user",
            parts: [{ type: "text", text: input.prompt }],
          },
          {
            id: `response-${input.runId}`,
            role: "assistant",
            parts: [{ type: "text", text: `${input.prompt}-response` }],
          },
        )
        sqlite
          .prepare("UPDATE sub_chats SET messages = ? WHERE id = ?")
          .run(JSON.stringify(messages), input.subChatId)
        sqlite
          .prepare("UPDATE agent_runs SET status = 'success', completed_at = ? WHERE id = ?")
          .run(Date.now(), input.runId)
        return emptyStream()
      }
      const routed = harness === "codex" ? harnessMocks.codex : harnessMocks.claude
      routed.mockImplementation(route)
      const launch = createMainRunLauncher()

      expect(await drainPendingMcpRuns(path, launch, { waitForCompletion: true })).toBe(1)
      expect(await drainPendingMcpRuns(path, launch, { waitForCompletion: true })).toBe(1)
      expect(routed.mock.calls.map(([input]) => input.prompt)).toEqual(["A", "B"])
      const row = sqlite
        .prepare("SELECT messages FROM sub_chats WHERE id = 'ordered-sub'")
        .get() as {
        messages: string
      }
      const visible = JSON.parse(row.messages).map((message: any) => message.parts[0].text)
      expect(visible).toEqual(["A", "A-response", "B", "B-response"])
      expect(visible.filter((text: string) => text === "A")).toHaveLength(1)
      expect(visible.filter((text: string) => text === "B")).toHaveLength(1)
    },
  )

  it("marks Codex auth-error runs and launch audits failed", async () => {
    seedRun("auth-failure", "pending", "mcp-auth-prompt", "codex")
    sqlite
      .prepare(
        `INSERT INTO mcp_audit_records (
          id, invocation_id, status, caller_chat_id, tool_name, tier, caller_snapshot,
          chat_snapshot, run_snapshot, input_summary, result_summary, duration_ms, created_at
        ) VALUES ('auth-source', 'auth-invocation', 'completed', 'chat-auth-failure',
          'launch_run', 3, '{}', '{}', '{}', '{}', ?, 0, 1)`,
      )
      .run(JSON.stringify({ runId: "auth-failure" }))
    harnessMocks.codex.mockResolvedValue(authErrorStream())

    await drainPendingMcpRuns(path, createMainRunLauncher(), { waitForCompletion: true })

    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'auth-failure'").get()).toEqual(
      { status: "failure" },
    )
    expect(
      sqlite.prepare("SELECT run_status FROM sub_chats WHERE id = 'sub-auth-failure'").get(),
    ).toEqual({ run_status: "failure" })
    const statuses = sqlite
      .prepare(
        "SELECT status FROM mcp_audit_records WHERE invocation_id = 'auth-invocation' ORDER BY created_at, id",
      )
      .all() as Array<{ status: string }>
    expect(statuses.map((row) => row.status).sort()).toEqual(["completed", "failed"])
  })

  it("correlates every orchestration launch audit by durable task context", async () => {
    seedOrchestrationRun("orchestrated-run", "orchestration-task")
    appendMcpAuditRecord(drizzle(sqlite, { schema }), {
      id: "orchestration-source",
      invocationId: "orchestration-invocation",
      status: "completed",
      caller: { chatId: "chat-orchestrated-run" },
      toolName: "orchestrate_task",
      tier: 3,
      input: { task: { mode: "create", name: "Orchestration" } },
      result: {
        ok: true,
        data: { orchestration: { taskId: "orchestration-task" }, aggregate: { active: 1 } },
      },
      createdAt: new Date(1),
    })
    sqlite
      .prepare(
        `INSERT INTO mcp_audit_records (
          id, invocation_id, status, caller_chat_id, tool_name, tier, caller_snapshot,
          chat_snapshot, run_snapshot, input_summary, result_summary, duration_ms, created_at
        ) VALUES ('redacted-result-decoy', 'wrong-invocation', 'completed', 'other-chat',
          'orchestrate_task', 3, '{}', '{}', '{}', '{}', ?, 0, 2)`,
      )
      .run(JSON.stringify({ runId: "orchestrated-run" }))

    await drainPendingMcpRuns(path, createMainRunLauncher(), { waitForCompletion: true })

    const correlated = sqlite
      .prepare(
        `SELECT status, run_snapshot, result_summary FROM mcp_audit_records
         WHERE invocation_id = 'orchestration-invocation' ORDER BY created_at, id`,
      )
      .all() as Array<{ status: string; run_snapshot: string; result_summary: string }>
    expect(correlated.map((row) => row.status)).toEqual(["completed", "completed"])
    expect(correlated.some((row) => row.run_snapshot.includes("contextHash"))).toBe(true)
    expect(correlated.some((row) => row.result_summary.includes("outcome"))).toBe(true)
    expect(
      sqlite
        .prepare(
          "SELECT count(*) count FROM mcp_audit_records WHERE invocation_id = 'wrong-invocation'",
        )
        .get(),
    ).toEqual({ count: 1 })
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

  it("observes a pending owner inserted through a second SQLite connection", () => {
    seedSharedConversationRuns()
    const second = new Database(path)
    second.pragma("journal_mode = WAL")
    second.pragma("busy_timeout = 5000")
    try {
      sqlite
        .prepare(
          "UPDATE agent_runs SET status = 'failure' WHERE id IN ('shared-first', 'shared-second')",
        )
        .run()
      expect(
        sqlite
          .prepare(
            "SELECT id FROM agent_runs WHERE sub_chat_id = 'shared-sub' AND status IN ('pending', 'running')",
          )
          .get(),
      ).toBeUndefined()
      second
        .prepare(
          `INSERT INTO agent_runs (
            id, chat_id, sub_chat_id, harness, permission_mode, worktree_path,
            prompt_message_id, initial_prompt, status, started_at
          ) VALUES ('raced-pending', 'shared-chat', 'shared-sub', 'codex', 'full-access',
            '/tmp/worktree', 'mcp-raced', 'Raced', 'pending', 3)`,
        )
        .run()

      expect(
        updateSubChatRunStatusIfAuthoritative(drizzle(sqlite, { schema }), {
          runId: "shared-first",
          subChatId: "shared-sub",
          status: "failure",
        }),
      ).toBe(false)
      expect(
        sqlite.prepare("SELECT run_status FROM sub_chats WHERE id = 'shared-sub'").get(),
      ).toEqual({ run_status: "pending" })
    } finally {
      second.close()
    }
  })
})

function queuedRun(runId: string, harness: QueuedAgentRun["harness"]): QueuedAgentRun {
  return {
    runId,
    chatId: "chat",
    subChatId: "sub-chat",
    harness,
    prompt: "Continue queued work.",
    model: null,
    reasoningEffort: null,
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

function seedQueuedTurns(harness: "codex" | "claude-code"): void {
  sqlite
    .prepare(
      `INSERT INTO chats (id, name, scope, permission_mode, harness, worktree_path)
       VALUES ('ordered-chat', 'Ordered', 'global', 'full-access', ?, '/tmp/worktree')`,
    )
    .run(harness)
  sqlite
    .prepare(
      `INSERT INTO sub_chats (id, chat_id, harness, permission_mode, worktree_path, run_status, messages)
       VALUES ('ordered-sub', 'ordered-chat', ?, 'full-access', '/tmp/worktree', 'pending', ?)`,
    )
    .run(
      harness,
      JSON.stringify([
        { id: "mcp-ordered-first", role: "user", parts: [{ type: "text", text: "A" }] },
        { id: "mcp-ordered-second", role: "user", parts: [{ type: "text", text: "B" }] },
      ]),
    )
  const insert = sqlite.prepare(
    `INSERT INTO agent_runs (
      id, chat_id, sub_chat_id, harness, permission_mode, worktree_path,
      prompt_message_id, status, started_at
    ) VALUES (?, 'ordered-chat', 'ordered-sub', ?, 'full-access', '/tmp/worktree', ?, 'pending', ?)`,
  )
  insert.run("ordered-first", harness, "mcp-ordered-first", 1)
  insert.run("ordered-second", harness, "mcp-ordered-second", 2)
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

function seedOrchestrationRun(runId: string, taskId: string): void {
  seedRun(runId, "pending", `mcp-${runId}`, "codex")
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run(`project-${taskId}`, taskId, `/tmp/${taskId}`)
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES (?, ?, ?)")
    .run(taskId, `project-${taskId}`, taskId)
  sqlite
    .prepare(
      `INSERT INTO task_orchestrations (
        task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions
      ) VALUES (?, ?, 'running', 1, 4, '{}')`,
    )
    .run(taskId, `chat-${runId}`)
  sqlite
    .prepare(
      `INSERT INTO orchestration_agents (
        id, task_id, run_id, definition, dependency_agent_ids, status
      ) VALUES (?, ?, ?, '{}', '[]', 'active')`,
    )
    .run(`agent-${runId}`, taskId, runId)
}

async function* emptyStream(): AsyncGenerator<never> {
  return
}

async function* authErrorStream() {
  yield { type: "auth-error", errorText: "Authentication required." }
  yield { type: "finish" }
}
