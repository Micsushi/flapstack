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
import { createAgentOrchestrationService } from "../src/main/lib/agent-orchestration/service"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import { testCoordinationEngineSnapshotSqlValues } from "./coordination-engine-test-db"

const harnessMocks = vi.hoisted(() => ({
  codex: vi.fn(),
  claude: vi.fn(),
  cursor: vi.fn(),
  opencode: vi.fn(),
  localCatalog: vi.fn(),
  localChat: vi.fn(),
  localCancel: vi.fn(),
}))

vi.mock("../src/main/lib/trpc/routers", () => ({
  createAppRouter: () => ({
    createCaller: () => ({
      codex: { chat: harnessMocks.codex },
      claude: { chat: harnessMocks.claude },
      cursor: { chat: harnessMocks.cursor },
      opencode: { chat: harnessMocks.opencode },
      localModels: {
        catalog: harnessMocks.localCatalog,
        chat: harnessMocks.localChat,
        cancel: harnessMocks.localCancel,
      },
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
  harnessMocks.localCatalog.mockReset().mockResolvedValue(localCatalog(true))
  harnessMocks.localChat.mockReset().mockResolvedValue(emptyStream())
  harnessMocks.localCancel.mockReset().mockResolvedValue({ cancelled: true })
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("MCP main run launcher", () => {
  it("reuses the queued run identity for Codex and Claude launches", async () => {
    const launch = createMainRunLauncher({ databasePath: path })
    await launch(queuedRun("queued-codex", "codex"))
    await launch(queuedRun("queued-claude", "claude-code"))

    expect(harnessMocks.codex).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "queued-codex", chatId: "chat", subChatId: "sub-chat" }),
    )
    expect(harnessMocks.claude).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "queued-claude", chatId: "chat", subChatId: "sub-chat" }),
    )
  })

  it("launches eligible local workers and fails tool mismatch before provider work", async () => {
    const launch = createMainRunLauncher({ databasePath: path })
    await launch({
      ...queuedRun("queued-local", "local"),
      model: "local-tools",
      localEndpoint: "http://127.0.0.1:22434",
      requiredLocalToolTiers: ["read"],
    })

    expect(harnessMocks.localChat).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "queued-local",
        model: "local-tools",
        endpoint: "http://127.0.0.1:22434",
      }),
    )
    expect(harnessMocks.localCatalog).toHaveBeenCalledWith({
      endpoint: "http://127.0.0.1:22434",
    })

    harnessMocks.localCatalog.mockResolvedValue(localCatalog(false))
    await expect(
      launch({
        ...queuedRun("mismatch-local", "local"),
        model: "local-tools",
        requiredLocalToolTiers: ["read"],
      }),
    ).rejects.toThrow(/preflight failed for read.*no cloud fallback/i)
    expect(harnessMocks.localChat).toHaveBeenCalledTimes(1)
  })

  it("passes durable per-worker reasoning effort to supported harness launches", async () => {
    const launch = createMainRunLauncher({ databasePath: path })
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
    const launch = createMainRunLauncher({ databasePath: path })
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
    const launch = createMainRunLauncher({ databasePath: path })
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
    const launch = createMainRunLauncher({ databasePath: path })
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

    expect(await recoverInterruptedMcpRuns(path)).toBe(1)
    expect(await recoverInterruptedMcpRuns(path)).toBe(0)
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

  it("fails interrupted local streams without replaying MCP-origin runs", async () => {
    seedRun("local-interrupted", "running", "mcp-local-interrupted", "local")
    sqlite
      .prepare(
        "UPDATE sub_chats SET stream_id = 'local-stream', session_id = 'local-session', messages = ? WHERE id = 'sub-local-interrupted'",
      )
      .run(
        JSON.stringify([
          {
            id: "local-assistant",
            role: "assistant",
            parts: [{ type: "text", text: "durable partial" }],
            metadata: { runId: "local-interrupted", streamState: "running" },
          },
        ]),
      )

    expect(await recoverInterruptedMcpRuns(path)).toBe(0)
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'local-interrupted'").get(),
    ).toEqual({ status: "failure" })
    const recovered = sqlite
      .prepare(
        "SELECT run_status, stream_id, session_id, messages FROM sub_chats WHERE id = 'sub-local-interrupted'",
      )
      .get() as {
      run_status: string
      stream_id: string | null
      session_id: string | null
      messages: string
    }
    expect(recovered).toMatchObject({
      run_status: "failure",
      stream_id: null,
      session_id: null,
    })
    expect(JSON.parse(recovered.messages)).toEqual([
      expect.objectContaining({
        parts: [{ type: "text", text: "durable partial" }],
        metadata: expect.objectContaining({
          runId: "local-interrupted",
          streamState: "failure",
          errorCode: "abandoned-stream",
        }),
      }),
    ])
    expect(await drainPendingMcpRuns(path, async () => undefined)).toBe(0)
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

  it("fails one corrupt snapshot before claim and continues draining other runs", async () => {
    seedRun("corrupt", "pending", "mcp-corrupt", "codex")
    seedRun("healthy", "pending", "mcp-healthy", "claude-code")
    sqlite.exec("DROP TRIGGER agent_runs_runtime_snapshot_immutable")
    sqlite
      .prepare("UPDATE agent_runs SET runtime_capability_snapshot = '{' WHERE id = 'corrupt'")
      .run()
    sqlite.exec(`CREATE TRIGGER reject_corrupt_claim BEFORE UPDATE OF status ON agent_runs
      WHEN OLD.id = 'corrupt' AND OLD.status = 'pending' AND NEW.status = 'running'
      BEGIN SELECT RAISE(ABORT, 'corrupt run was claimed'); END;`)
    const launched: string[] = []

    await expect(
      drainPendingMcpRuns(
        path,
        async (run) => {
          launched.push(run.runId)
        },
        { waitForCompletion: true },
      ),
    ).resolves.toBe(1)
    expect(launched).toEqual(["healthy"])
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'corrupt'").get()).toEqual({
      status: "failure",
    })
  })

  it("preserves absent or null durable local tool requirements as no requirements", async () => {
    seedLocalOrchestrationRun("local-absent", "local-absent-task")
    seedLocalOrchestrationRun("local-null", "local-null-task")
    const nullDefinition = orchestrationDefinition("local-null")
    sqlite
      .prepare("UPDATE orchestration_agents SET definition = ? WHERE run_id = 'local-null'")
      .run(JSON.stringify({ ...nullDefinition, requiredLocalToolTiers: null }))
    const launched = vi.fn(async (_run: QueuedAgentRun) => undefined)

    await expect(drainPendingMcpRuns(path, launched, { waitForCompletion: true })).resolves.toBe(2)
    expect(launched).toHaveBeenCalledTimes(2)
    for (const [run] of launched.mock.calls) {
      expect(run.requiredLocalToolTiers).toEqual([])
    }
  })

  it("rejects corrupt durable local orchestration authority before claim or launch", async () => {
    const corruptions: Array<{
      name: string
      definition: (value: Record<string, unknown>) => string
      mutateRun?: (runId: string) => void
    }> = [
      { name: "malformed-json", definition: () => "{" },
      {
        name: "non-array-tiers",
        definition: (value) => JSON.stringify({ ...value, requiredLocalToolTiers: "read" }),
      },
      {
        name: "non-string-tier",
        definition: (value) => JSON.stringify({ ...value, requiredLocalToolTiers: [1] }),
      },
      {
        name: "unknown-tier",
        definition: (value) =>
          JSON.stringify({ ...value, requiredLocalToolTiers: ["read", "admin"] }),
      },
      {
        name: "duplicate-tier",
        definition: (value) =>
          JSON.stringify({ ...value, requiredLocalToolTiers: ["read", "read"] }),
      },
      {
        name: "invalid-endpoint",
        definition: (value) =>
          JSON.stringify({ ...value, localEndpoint: "https://ollama.example.com" }),
      },
      {
        name: "invalid-provider",
        definition: (value) => JSON.stringify({ ...value, provider: "openai" }),
      },
      {
        name: "invalid-model",
        definition: (value) => JSON.stringify({ ...value, model: " " }),
      },
      {
        name: "invalid-permission",
        definition: (value) => JSON.stringify({ ...value, permissionMode: "root" }),
      },
      {
        name: "row-model-mismatch",
        definition: (value) => JSON.stringify(value),
        mutateRun: (runId) =>
          void sqlite
            .prepare("UPDATE agent_runs SET model = 'other-local' WHERE id = ?")
            .run(runId),
      },
      {
        name: "row-permission-mismatch",
        definition: (value) => JSON.stringify(value),
        mutateRun: (runId) =>
          void sqlite
            .prepare("UPDATE agent_runs SET permission_mode = 'read-only' WHERE id = ?")
            .run(runId),
      },
    ]

    for (const [index, corruption] of corruptions.entries()) {
      const runId = `corrupt-local-${index}`
      const taskId = `corrupt-local-task-${index}`
      seedLocalOrchestrationRun(runId, taskId)
      const definition = orchestrationDefinition(runId)
      sqlite
        .prepare("UPDATE orchestration_agents SET definition = ? WHERE run_id = ?")
        .run(corruption.definition(definition), runId)
      corruption.mutateRun?.(runId)
      appendMcpAuditRecord(drizzle(sqlite, { schema }), {
        id: `corrupt-source-${index}`,
        invocationId: `corrupt-invocation-${index}`,
        status: "completed",
        caller: { chatId: `chat-${runId}` },
        toolName: "orchestrate_task",
        tier: 3,
        input: { task: { mode: "create", name: corruption.name } },
        result: { ok: true, data: { orchestration: { taskId } } },
        createdAt: new Date(index + 1),
      })
      sqlite.exec(`CREATE TRIGGER reject_corrupt_local_claim_${index}
        BEFORE UPDATE OF status ON agent_runs
        WHEN OLD.id = '${runId}' AND OLD.status = 'pending' AND NEW.status = 'running'
        BEGIN SELECT RAISE(ABORT, 'corrupt local run was claimed'); END;`)
    }
    const launch = vi.fn(async (_run: QueuedAgentRun) => undefined)

    await expect(drainPendingMcpRuns(path, launch, { waitForCompletion: true })).resolves.toBe(0)
    expect(launch).not.toHaveBeenCalled()
    expect(harnessMocks.localCatalog).not.toHaveBeenCalled()
    expect(harnessMocks.localChat).not.toHaveBeenCalled()
    expect(harnessMocks.codex).not.toHaveBeenCalled()
    expect(harnessMocks.claude).not.toHaveBeenCalled()
    expect(
      sqlite
        .prepare(
          `SELECT r.status, s.run_status FROM agent_runs r
           JOIN sub_chats s ON s.id = r.sub_chat_id
           WHERE r.id LIKE 'corrupt-local-%' ORDER BY r.id`,
        )
        .all(),
    ).toEqual(corruptions.map(() => ({ status: "failure", run_status: "failure" })))
    for (const index of corruptions.keys()) {
      expect(
        sqlite
          .prepare(
            "SELECT status FROM mcp_audit_records WHERE invocation_id = ? ORDER BY created_at, id",
          )
          .all(`corrupt-invocation-${index}`),
      ).toEqual([{ status: "completed" }, { status: "failed" }])
    }
  })

  it("fails a corrupt durable local definition during restart recovery without replay", async () => {
    seedLocalOrchestrationRun("local-corrupt-restart", "local-corrupt-restart-task")
    sqlite
      .prepare("UPDATE agent_runs SET status = 'running' WHERE id = 'local-corrupt-restart'")
      .run()
    sqlite
      .prepare("UPDATE sub_chats SET run_status = 'running' WHERE id = 'sub-local-corrupt-restart'")
      .run()
    sqlite
      .prepare("UPDATE orchestration_agents SET definition = '{' WHERE run_id = ?")
      .run("local-corrupt-restart")

    await expect(recoverInterruptedMcpRuns(path)).resolves.toBe(0)
    expect(
      sqlite
        .prepare(
          `SELECT r.status, s.run_status FROM agent_runs r
           JOIN sub_chats s ON s.id = r.sub_chat_id WHERE r.id = 'local-corrupt-restart'`,
        )
        .get(),
    ).toEqual({ status: "failure", run_status: "failure" })
    await expect(
      drainPendingMcpRuns(path, createMainRunLauncher({ databasePath: path }), {
        waitForCompletion: true,
      }),
    ).resolves.toBe(0)
    expect(harnessMocks.localCatalog).not.toHaveBeenCalled()
    expect(harnessMocks.localChat).not.toHaveBeenCalled()
  })

  it("keeps a newer queued run authoritative during interrupted-run recovery", async () => {
    seedSharedConversationRuns()
    sqlite
      .prepare(
        `UPDATE agent_runs
         SET status = 'running', prompt_message_id = 'ordinary-interrupted'
         WHERE id = 'shared-first'`,
      )
      .run()
    sqlite.prepare("UPDATE sub_chats SET run_status = 'running' WHERE id = 'shared-sub'").run()

    expect(await recoverInterruptedMcpRuns(path)).toBe(0)

    expect(sqlite.prepare("SELECT id, status FROM agent_runs ORDER BY started_at").all()).toEqual([
      { id: "shared-first", status: "cancelled" },
      { id: "shared-second", status: "pending" },
    ])
    expect(
      sqlite.prepare("SELECT run_status FROM sub_chats WHERE id = 'shared-sub'").get(),
    ).toEqual({ run_status: "pending" })
  })

  it.each([
    { reconciled: "completed", terminal: "success" },
    { reconciled: "cancelled", terminal: "cancelled" },
    { reconciled: "failed", terminal: "failure" },
  ] as const)(
    "projects recovered $reconciled atomically without overwriting a claimed successor",
    async ({ reconciled, terminal }) => {
      seedSharedConversationRuns("codex")
      sqlite.prepare("UPDATE agent_runs SET status = 'running' WHERE id = 'shared-first'").run()
      sqlite.prepare("UPDATE sub_chats SET run_status = 'running' WHERE id = 'shared-sub'").run()

      await expect(
        recoverInterruptedMcpRuns(path, {
          reconcile: async () => {
            sqlite
              .prepare("UPDATE agent_runs SET status = 'running' WHERE id = 'shared-second'")
              .run()
            sqlite
              .prepare("UPDATE sub_chats SET run_status = 'running' WHERE id = 'shared-sub'")
              .run()
            return reconciled
          },
        }),
      ).resolves.toBe(0)

      expect(sqlite.prepare("SELECT id, status FROM agent_runs ORDER BY started_at").all()).toEqual(
        [
          { id: "shared-first", status: terminal },
          { id: "shared-second", status: "running" },
        ],
      )
      expect(
        sqlite.prepare("SELECT run_status FROM sub_chats WHERE id = 'shared-sub'").get(),
      ).toEqual({ run_status: "running" })
    },
  )

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
      const launch = createMainRunLauncher({ databasePath: path })

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

    await drainPendingMcpRuns(path, createMainRunLauncher({ databasePath: path }), {
      waitForCompletion: true,
    })

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

    await drainPendingMcpRuns(path, createMainRunLauncher({ databasePath: path }), {
      waitForCompletion: true,
    })

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

  it("keeps omitted local token fields unknown during orchestration aggregation", () => {
    seedOrchestrationRun("partial-local", "partial-local-task", "local")
    sqlite
      .prepare(
        "UPDATE agent_runs SET model = 'local-tools', status = 'success', completed_at = 2 WHERE id = 'partial-local'",
      )
      .run()
    sqlite.prepare("UPDATE sub_chats SET run_status = 'success', messages = ? WHERE id = ?").run(
      JSON.stringify([
        {
          id: "partial-local-assistant",
          role: "assistant",
          parts: [{ type: "text", text: "done" }],
          metadata: { runId: "partial-local", outputTokens: 3 },
        },
      ]),
      "sub-partial-local",
    )

    createAgentOrchestrationService(path).getOverview("partial-local-task")

    expect(
      sqlite
        .prepare(
          "SELECT provider_id, input_tokens, output_tokens, reasoning_tokens, total_tokens, cost_usd_micros FROM usage_samples WHERE run_id = 'partial-local'",
        )
        .get(),
    ).toEqual({
      provider_id: "local",
      input_tokens: null,
      output_tokens: 3,
      reasoning_tokens: null,
      total_tokens: null,
      cost_usd_micros: 0,
    })
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
            prompt_message_id, initial_prompt, status, started_at,
            runtime_snapshot_version, runtime_preference, runtime_preference_source,
            resolved_runtime, runtime_adapter_version, runtime_protocol_version,
            runtime_capability_snapshot, runtime_control_snapshot
          ) VALUES ('raced-pending', 'shared-chat', 'shared-sub', 'codex', 'full-access',
            '/tmp/worktree', 'mcp-raced', 'Raced', 'pending', 3, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...testRuntimeSnapshotSqlValues())

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
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO chats
       (id, name, scope, permission_mode, harness, worktree_path)
       VALUES ('chat', 'Direct', 'global', 'full-access', ?, '/tmp/worktree')`,
    )
    .run(harness)
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO sub_chats
       (id, chat_id, harness, permission_mode, worktree_path, run_status, messages)
       VALUES ('sub-chat', 'chat', ?, 'full-access', '/tmp/worktree', 'running', '[]')`,
    )
    .run(harness)
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO agent_runs (
        id, chat_id, sub_chat_id, harness, permission_mode, worktree_path,
        prompt_message_id, initial_prompt, status, started_at,
        runtime_snapshot_version, runtime_preference, runtime_preference_source,
        resolved_runtime, runtime_adapter_version, runtime_protocol_version,
        runtime_capability_snapshot, runtime_control_snapshot
      ) VALUES (?, 'chat', 'sub-chat', ?, 'full-access', '/tmp/worktree', ?,
        'Continue queued work.', 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      harness,
      `mcp-${runId}`,
      Date.now(),
      ...testRuntimeSnapshotSqlValues(
        harness === "claude-code" ? "claude-code" : harness === "local" ? "local" : "codex",
      ),
    )
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

function localCatalog(tools: boolean) {
  const capability = (state: "supported" | "unsupported") => ({
    state,
    source: "declared" as const,
    detail: null,
  })
  return {
    contractVersion: 1,
    cacheVersion: 1,
    provider: "ollama" as const,
    endpoint: "http://127.0.0.1:11434",
    state: "ready" as const,
    providerVersion: "test",
    fetchedAt: "2026-07-14T00:00:00.000Z",
    expiresAt: "2026-07-14T00:05:00.000Z",
    models: [
      {
        identity: { modelId: "local-tools", digest: "sha256:test" },
        contextWindow: null,
        capabilities: {
          chat: capability("supported"),
          streaming: capability("supported"),
          tools: capability(tools ? "supported" : "unsupported"),
          vision: capability("unsupported"),
        },
        limitations: tools
          ? []
          : [
              {
                code: "tools-unsupported" as const,
                message: "The provider did not declare tool support for this model.",
                modelId: "local-tools",
              },
            ],
      },
    ],
    limitations: [],
    error: null,
    stale: false,
  }
}

function seedSharedConversationRuns(
  runtime: "flapstack-native" | "codex" = "flapstack-native",
): void {
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
      prompt_message_id, status, started_at,
      runtime_snapshot_version, runtime_preference, runtime_preference_source,
      resolved_runtime, runtime_adapter_version, runtime_protocol_version,
      runtime_capability_snapshot, runtime_control_snapshot
    ) VALUES (?, 'shared-chat', 'shared-sub', 'codex', 'full-access', '/tmp/worktree', ?, 'pending', ?,
      ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run("shared-first", "mcp-first", 1, ...testRuntimeSnapshotSqlValues("codex", runtime))
  insert.run("shared-second", "mcp-second", 2, ...testRuntimeSnapshotSqlValues("codex", runtime))
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
      prompt_message_id, status, started_at,
      runtime_snapshot_version, runtime_preference, runtime_preference_source,
      resolved_runtime, runtime_adapter_version, runtime_protocol_version,
      runtime_capability_snapshot, runtime_control_snapshot
    ) VALUES (?, 'ordered-chat', 'ordered-sub', ?, 'full-access', '/tmp/worktree', ?, 'pending', ?,
      ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  insert.run(
    "ordered-first",
    harness,
    "mcp-ordered-first",
    1,
    ...testRuntimeSnapshotSqlValues(harness),
  )
  insert.run(
    "ordered-second",
    harness,
    "mcp-ordered-second",
    2,
    ...testRuntimeSnapshotSqlValues(harness),
  )
}

function seedRun(
  runId: string,
  status: "running" | "pending",
  promptMessageId: string,
  harness: "codex" | "claude-code" | "local",
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
        prompt_message_id, status, started_at,
        runtime_snapshot_version, runtime_preference, runtime_preference_source,
        resolved_runtime, runtime_adapter_version, runtime_protocol_version,
        runtime_capability_snapshot, runtime_control_snapshot
      ) VALUES (?, ?, ?, ?, 'full-access', '/tmp/worktree', ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      chatId,
      subChatId,
      harness,
      promptMessageId,
      status,
      Date.now(),
      ...testRuntimeSnapshotSqlValues(harness),
    )
}

function seedOrchestrationRun(
  runId: string,
  taskId: string,
  harness: "codex" | "claude-code" | "local" = "codex",
): void {
  seedRun(runId, "pending", `mcp-${runId}`, harness)
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)")
    .run(`project-${taskId}`, taskId, `/tmp/${taskId}`)
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES (?, ?, ?)")
    .run(taskId, `project-${taskId}`, taskId)
  sqlite
    .prepare(
      `INSERT INTO task_orchestrations (
        task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions,
        engine_snapshot_version, coordination_engine, coordination_engine_version,
        coordination_engine_source, coordination_engine_capability_snapshot,
        coordination_engine_provider_identity
      ) VALUES (?, ?, 'running', 1, 4, '{}', ?, ?, ?, ?, ?, ?)`,
    )
    .run(taskId, `chat-${runId}`, ...testCoordinationEngineSnapshotSqlValues())
  sqlite
    .prepare(
      `INSERT INTO orchestration_agents (
        id, task_id, run_id, definition, dependency_agent_ids, status
      ) VALUES (?, ?, ?, ?, '[]', 'active')`,
    )
    .run(
      `agent-${runId}`,
      taskId,
      runId,
      JSON.stringify({
        role: "Worker",
        prompt: "Complete the task.",
        harness,
        ...(harness === "local" ? { model: "local-tools" } : {}),
        permissionMode: "full-access",
        worktreeStrategy: "inherit",
        dependencyAgentIds: [],
        completionCriteria: "Return a result.",
      }),
    )
}

function seedLocalOrchestrationRun(runId: string, taskId: string): void {
  seedOrchestrationRun(runId, taskId, "local")
  sqlite.prepare("UPDATE chats SET model = 'local-tools' WHERE id = ?").run(`chat-${runId}`)
  sqlite.prepare("UPDATE sub_chats SET model = 'local-tools' WHERE id = ?").run(`sub-${runId}`)
  sqlite.prepare("UPDATE agent_runs SET model = 'local-tools' WHERE id = ?").run(runId)
}

function orchestrationDefinition(runId: string): Record<string, unknown> {
  const row = sqlite
    .prepare("SELECT definition FROM orchestration_agents WHERE run_id = ?")
    .get(runId) as { definition: string }
  return JSON.parse(row.definition) as Record<string, unknown>
}

async function* emptyStream(): AsyncGenerator<never> {
  return
}

async function* authErrorStream() {
  yield { type: "auth-error", errorText: "Authentication required." }
  yield { type: "finish" }
}
