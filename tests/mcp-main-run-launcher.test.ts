import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
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
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"

const harnessMocks = vi.hoisted(() => ({
  codex: vi.fn(),
  claude: vi.fn(),
  cursor: vi.fn(),
  opencode: vi.fn(),
  localCatalog: vi.fn(),
  localChat: vi.fn(),
  localCancel: vi.fn(),
}))

vi.mock("electron", () => ({
  app: { getPath: () => directory },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock("../src/main/lib/trpc/routers", () => ({
  createAppRouter: () => ({
    createCaller: () => ({
      codex: { chat: harnessMocks.codex },
      claude: { compatibilityChat: harnessMocks.claude },
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

import { createMainRunLauncher, MainRuntimeLaunchService } from "../src/main/lib/main-run-launcher"

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

function testLauncher() {
  return createMainRunLauncher({
    databasePath: path,
    flapstackNativeProbe: () => ({ available: true }),
  })
}

describe("MCP main run launcher", () => {
  it("cancels a claimed run that starts during persisted cancellation serialization", async () => {
    const run = queuedRun("cancel-claim-race", "codex")
    const service = new MainRuntimeLaunchService({ databasePath: path })

    const cancellation = service.cancel(run.runId, "cancel-before-provider-start")
    const launch = service.launch(run)

    await expect(cancellation).resolves.toBe(true)
    await expect(launch).rejects.toMatchObject({ name: "RuntimeLaunchCancelledError" })
    expect(harnessMocks.codex).not.toHaveBeenCalled()
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = ?").get(run.runId)).toEqual({
      status: "cancelled",
    })
  })

  it("passes durable per-worker reasoning effort to supported harness launches", async () => {
    const launch = testLauncher()
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

  it("recovers legacy queued Codex turns in transcript order", async () => {
    seedQueuedTurns("codex")
    expect(recoverLegacyQueuedRunPrompts(sqlite)).toBe(2)
    expect(recoverLegacyQueuedRunPrompts(sqlite)).toBe(0)
    expect(
      sqlite.prepare("SELECT id, initial_prompt FROM agent_runs ORDER BY started_at, id").all(),
    ).toEqual([
      { id: "ordered-first", initial_prompt: "A" },
      { id: "ordered-second", initial_prompt: "B" },
    ])
    expect(sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'ordered-sub'").get()).toEqual(
      { messages: "[]" },
    )

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
    const routed = harnessMocks.codex
    routed.mockImplementation(route)
    const launch = testLauncher()

    expect(await drainPendingMcpRuns(path, launch, { waitForCompletion: true })).toBe(1)
    expect(await drainPendingMcpRuns(path, launch, { waitForCompletion: true })).toBe(1)
    expect(routed.mock.calls.map(([input]) => input.prompt)).toEqual(["A", "B"])
    const row = sqlite.prepare("SELECT messages FROM sub_chats WHERE id = 'ordered-sub'").get() as {
      messages: string
    }
    const visible = JSON.parse(row.messages).map((message: any) => message.parts[0].text)
    expect(visible).toEqual(["A", "A-response", "B", "B-response"])
    expect(visible.filter((text: string) => text === "A")).toHaveLength(1)
    expect(visible.filter((text: string) => text === "B")).toHaveLength(1)
  })
})

function queuedRun(
  runId: string,
  harness: QueuedAgentRun["harness"],
  runtimeLaunch?: QueuedAgentRun["runtimeLaunch"],
): QueuedAgentRun {
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
      ...(runtimeLaunch
        ? [
            1,
            runtimeLaunch.requestedPreference,
            runtimeLaunch.preferenceSource,
            runtimeLaunch.resolvedRuntime,
            runtimeLaunch.versions.adapterVersion,
            runtimeLaunch.versions.protocolVersion,
            JSON.stringify(runtimeLaunch.capabilities),
            JSON.stringify(runtimeLaunch.controls),
          ]
        : testRuntimeSnapshotSqlValues(
            harness === "claude-code" ? "claude-code" : harness === "local" ? "local" : "codex",
          )),
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
  runtime: "codex" | "flapstack-native" = "flapstack-native",
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
      ...testRuntimeSnapshotSqlValues(harness, runtime),
    )
}

async function* emptyStream(): AsyncGenerator<never> {
  return
}

describe("scheduled native assistant persistence", () => {
  function scheduledFixture() {
    const runId = "scheduled-result"
    seedRun(runId, "running", "automation-occurrence-1", "codex", "codex")
    sqlite.prepare("UPDATE agent_runs SET status = 'running' WHERE id = ?").run(runId)
    sqlite
      .prepare(
        `INSERT INTO automations
      (id, name, scope_type, chat_id, project_id, action_type, prompt, harness, permission_mode)
      VALUES ('scheduled', 'Scheduled result', 'chat', ?, NULL, 'run-chat', 'Prompt', 'codex', 'read-only')`,
      )
      .run(`chat-${runId}`)
    sqlite.exec(`INSERT INTO automation_triggers (id, automation_id, type, cron, timezone, catch_up)
      VALUES ('trigger', 'scheduled', 'schedule', '* * * * *', 'UTC', 'none');
      INSERT INTO automation_occurrences (id, automation_id, trigger_id, dedupe_key, state, scheduled_for)
      VALUES ('occurrence', 'scheduled', 'trigger', 'once', 'running', 1);
      INSERT INTO automation_executions
      (id, occurrence_id, attempt, state, run_id, authority_snapshot, budget_snapshot, started_at)
      VALUES ('execution', 'occurrence', 1, 'running', 'scheduled-result', '{}', '{}', 1);`)
    sqlite
      .prepare("UPDATE automation_executions SET authority_snapshot = ? WHERE id = 'execution'")
      .run(JSON.stringify({ target: { chatId: `chat-${runId}` } }))
    createAgentActivityStore(sqlite).appendBatch(runId, [
      {
        provider: "openai",
        kind: "agent-text",
        phase: "completed",
        displayClass: "summary",
        privacyClass: "public",
        payload: { text: "SCHEDULED_REPLY" },
      },
    ])
    const service = new MainRuntimeLaunchService({ databasePath: path })
    return { runId, service, finish: () => (service as any).persistLifecycle(runId, "completed") }
  }

  it("persists a scheduled reply once in its original chat after the owner changes its target", async () => {
    const { runId, finish } = scheduledFixture()
    const subId = `sub-${runId}`
    const row = sqlite.prepare("SELECT messages FROM sub_chats WHERE id = ?").get(subId) as {
      messages: string
    }
    const messages = JSON.parse(row.messages)
    messages.push({
      id: "later-user",
      role: "user",
      parts: [{ type: "text", text: "Next question" }],
    })
    sqlite
      .prepare("UPDATE sub_chats SET messages = ? WHERE id = ?")
      .run(JSON.stringify(messages), subId)
    // Owner edits must not invalidate the already-started execution's frozen target.
    sqlite.exec(
      "INSERT INTO chats (id, name, scope) VALUES ('edited-target', 'New target', 'global')",
    )
    sqlite.exec("UPDATE automations SET chat_id = 'edited-target'")
    await finish()
    await finish()
    const reopened = new Database(path)
    try {
      const saved = reopened.prepare("SELECT messages FROM sub_chats WHERE id = ?").get(subId) as {
        messages: string
      }
      const actual = JSON.parse(saved.messages)
      expect(actual.map((message: any) => message.role)).toEqual(["user", "assistant", "user"])
      expect(actual[1]).toMatchObject({
        parts: [{ type: "text", text: "SCHEDULED_REPLY" }],
        metadata: { runId },
      })
      expect(actual[2].id).toBe("later-user")
      expect(reopened.prepare("SELECT status FROM agent_runs WHERE id = ?").get(runId)).toEqual({
        status: "success",
      })
    } finally {
      reopened.close()
    }
  })
})
