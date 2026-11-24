import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import {
  getMainRuntimeLaunchService,
  resetMainRuntimeLaunchServicesForTests,
} from "../src/main/lib/main-run-launcher"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import { recoverInterruptedMcpRuns, type QueuedAgentRun } from "../src/main/lib/run-launch-service"
import type {
  HarnessAdapter,
  RuntimeAdapterContext,
  RuntimeAdapterSession,
} from "../src/shared/agent-runtime"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import type { AgentActivityAppend } from "../src/shared/agent-activity"

vi.mock("../src/main/lib/trpc/routers", () => ({
  createAppRouter: () => ({ createCaller: () => ({}) }),
}))
const activityInvalidation = vi.hoisted(() => vi.fn())
vi.mock("../src/main/lib/agent-runtime/activity-service", () => ({
  broadcastAgentActivityInvalidation: activityInvalidation,
}))
const invalidation = vi.hoisted(() => vi.fn())
vi.mock("../src/main/lib/mcp-control/invalidation-bridge", () => ({
  publishLocalProductInvalidation: invalidation,
}))

let directory = ""
let path = ""
let sqlite: Database.Database

beforeEach(() => {
  invalidation.mockReset()
  activityInvalidation.mockReset()
  resetMainRuntimeLaunchServicesForTests()
  directory = mkdtempSync(join(tmpdir(), "flapstack-runtime-main-service-"))
  path = join(directory, "agents.db")
  sqlite = new Database(path)
  migrateDatabase(drizzle(sqlite, { schema }), sqlite, resolve(process.cwd(), "drizzle"))
})

afterEach(() => {
  resetMainRuntimeLaunchServicesForTests()
  vi.unstubAllGlobals()
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("process-wide Runtime launch service", () => {
  it("persists intent, session, turn, activity, and terminal lifecycle", async () => {
    seedDirectRun("durable")
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "uncertain")
    const factory = vi.fn(() => value)
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: factory,
      enableCodex: true,
    })

    await service.launch(queued("durable"))

    expect(factory).toHaveBeenCalledTimes(1)
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'durable'").get()).toEqual({
      status: "success",
    })
    expect(
      sqlite.prepare("SELECT session_id FROM sub_chats WHERE id = 'sub-durable'").get(),
    ).toEqual({ session_id: "thread-durable" })
    const events = sqlite
      .prepare(
        `SELECT kind, phase, provider_session_id, provider_thread_id, provider_turn_id
         FROM agent_activity_events WHERE run_id = 'durable' ORDER BY sequence`,
      )
      .all() as Array<Record<string, unknown>>
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "lifecycle", phase: "started" }),
        expect.objectContaining({ provider_session_id: "session-durable" }),
        expect.objectContaining({ provider_thread_id: "thread-durable" }),
        expect.objectContaining({ provider_turn_id: "turn-durable" }),
        expect.objectContaining({ kind: "status", phase: "updated" }),
        expect.objectContaining({ kind: "lifecycle", phase: "completed" }),
      ]),
    )
    await expect(service.reconcileRun("durable")).resolves.toBe("completed")
    expect(value.reconcile).not.toHaveBeenCalled()
  })

  it("keeps a late first Codex session out of the chat after Stop", async () => {
    const first = "cancel-before-codex-turn"
    const second = "retry-cancelled-codex"
    seedDirectRun(first)
    let release!: () => void
    let creating!: () => void
    const sessionPending = new Promise<void>((resolve) => {
      creating = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const resumed = vi.fn()
    const service = getMainRuntimeLaunchService(path, {
      enableCodex: true,
      codexFactory: () => {
        const adapter = directAdapter()
        const start = adapter.startSession.bind(adapter)
        adapter.startSession = async (context) => {
          if (context.runId === first) {
            creating()
            await gate
          }
          return await start(context)
        }
        adapter.resumeSession = resumed
        return adapter
      },
    })
    const original = service.launch(queued(first))
    await sessionPending
    await service.cancel(first, "user-cancelled")
    release()
    await expect(original).rejects.toMatchObject({ name: "RuntimeLaunchCancelledError" })
    expect(
      sqlite.prepare("SELECT session_id FROM sub_chats WHERE id=?").get(`sub-${first}`),
    ).toEqual({ session_id: null })
    seedFollowupRun(second, first)
    await service.launch({ ...queued(second), chatId: `chat-${first}`, subChatId: `sub-${first}` })
    expect(resumed).not.toHaveBeenCalled()
    expect(
      sqlite.prepare("SELECT session_id FROM sub_chats WHERE id=?").get(`sub-${first}`),
    ).toEqual({ session_id: `thread-${second}` })
  })

  it("resumes a second Codex turn with the durable provider thread identity", async () => {
    seedDirectRun("first-turn")
    const resumed: RuntimeAdapterSession[] = []
    const prompts: string[] = []
    const factory = vi.fn(() => {
      const adapter = directAdapter()
      adapter.resumeSession = async (_context, session) => {
        resumed.push(session)
        return session
      }
      adapter.startTurn = async (_context, _session, prompt) => {
        prompts.push(prompt)
        return { providerTurnId: "turn" }
      }
      return adapter
    })
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: factory,
      enableCodex: true,
    })
    await service.launch(queued("first-turn"))
    seedFollowupRun("second-turn", "first-turn")
    const followup = queued("second-turn")
    followup.chatId = "chat-first-turn"
    followup.subChatId = "sub-first-turn"
    followup.chatMode = "review"
    followup.prompt = "Follow up"

    await service.launch(followup)

    expect(resumed).toContainEqual({
      providerSessionId: null,
      providerThreadId: "thread-first-turn",
    })
    expect(prompts[1]).toContain("Review mode:")
    expect(prompts[1]).toContain("Follow up")
  })

  it("reads durable success after process-style service recreation without provider access", async () => {
    seedDirectRun("recreated-success")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => directAdapter(),
      enableCodex: true,
    })
    await service.launch(queued("recreated-success"))
    resetMainRuntimeLaunchServicesForTests()
    const factory = vi.fn(() => directAdapter())
    const recreated = getMainRuntimeLaunchService(path, {
      codexFactory: factory,
      enableCodex: false,
    })

    await expect(recreated.reconcileRun("recreated-success")).resolves.toBe("completed")
    expect(factory).not.toHaveBeenCalled()
  })

  it("persists the crash window identity and fails without replay", async () => {
    seedDirectRun("crash")
    const value = directAdapter()
    value.streamActivity = async function* () {
      throw new Error(
        "provider stderr Bearer secret-token from /Users/alice/private/project API_KEY=abcd",
      )
    }
    value.reconcile = vi.fn(async () => "uncertain")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })

    await expect(service.launch(queued("crash"))).rejects.toThrow("provider stderr")
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'crash'").get()).toEqual({
      status: "failure",
    })
    const stored = JSON.stringify(
      sqlite
        .prepare(
          "SELECT provider_thread_id, provider_turn_id, payload_json FROM agent_activity_events WHERE run_id = 'crash'",
        )
        .all(),
    )
    expect(stored).toContain("thread-crash")
    expect(stored).toContain("turn-crash")
    expect(stored).not.toContain("secret-token")
    expect(stored).not.toContain("/Users/alice")
    expect(stored).not.toContain("abcd")
    expect(value.reconcile).toHaveBeenCalledTimes(1)
    await expect(service.reconcileRun("crash")).resolves.toBe("failed")
    expect(value.reconcile).toHaveBeenCalledTimes(1)
  })

  it("reconciles a restarted direct run by persisted identity and never requeues it", async () => {
    seedDirectRun("restart")
    createAgentActivityStore(sqlite).append("restart", {
      provider: "openai",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-restart",
      providerThreadId: "thread-restart",
      providerTurnId: "turn-restart",
      payload: { state: "turn-started", detail: null },
      dedupKey: "restart-identity",
    })
    const value = directAdapter()
    value.startSession = vi.fn(value.startSession)
    value.startTurn = vi.fn(value.startTurn)
    value.reconcile = vi.fn(async () => "completed")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(recoverInterruptedMcpRuns(path, service)).resolves.toBe(0)
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'restart'").get()).toEqual({
      status: "success",
    })
    expect(value.reconcile).toHaveBeenCalledTimes(1)
    expect(value.startSession).not.toHaveBeenCalled()
    expect(value.startTurn).not.toHaveBeenCalled()
  })

  it("keeps persisted cancellation terminal under cancel-versus-stream races", async () => {
    seedDirectRun("cancel")
    let started!: () => void
    let release!: () => void
    const streamStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const value = directAdapter()
    value.streamActivity = async function* () {
      started()
      await gate
    }
    value.cancel = vi.fn(async () => release())
    value.complete = vi.fn(async () => undefined)
    value.reconcile = vi.fn(async () => "completed")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })
    const running = service.launch(queued("cancel"))
    await streamStarted

    await expect(
      Promise.all([service.cancel("cancel", "operator"), service.cancel("cancel", "operator")]),
    ).resolves.toEqual([true, true])
    await expect(running).rejects.toMatchObject({ name: "RuntimeLaunchCancelledError" })
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'cancel'").get()).toEqual({
      status: "cancelled",
    })
    expect(value.cancel).toHaveBeenCalledTimes(1)
    expect(value.complete).not.toHaveBeenCalled()
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) count FROM agent_activity_events WHERE run_id = 'cancel' AND phase = 'completed'",
        )
        .get(),
    ).toEqual({ count: 0 })
    await expect(service.reconcileRun("cancel")).resolves.toBe("cancelled")
    expect(value.reconcile).not.toHaveBeenCalled()
  })
})

function seedDirectRun(
  runId: string,
  snapshotValues: readonly unknown[] = testRuntimeSnapshotSqlValues("codex", "codex"),
  chatPreference = "codex",
  harness: "codex" | "claude-code" = "codex",
): void {
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO projects (id, name, path, created_at) VALUES ('project', 'Project', '/tmp/project', 1)",
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats
       (id, project_id, name, scope, permission_mode, harness, model, worktree_path, runtime_preference)
       VALUES (?, 'project', 'Chat', 'global', 'read-only', ?, 'model', '/tmp/project', ?)`,
    )
    .run(`chat-${runId}`, harness, chatPreference)
  sqlite
    .prepare(
      `INSERT INTO sub_chats
       (id, chat_id, harness, permission_mode, worktree_path, run_status, messages)
       VALUES (?, ?, ?, 'read-only', '/tmp/project', 'running', '[]')`,
    )
    .run(`sub-${runId}`, `chat-${runId}`, harness)
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, model, permission_mode, worktree_path,
        prompt_message_id, initial_prompt, status, started_at,
        runtime_snapshot_version, runtime_preference, runtime_preference_source,
        resolved_runtime, runtime_adapter_version, runtime_protocol_version,
        runtime_capability_snapshot, runtime_control_snapshot
      ) VALUES (?, ?, ?, ?, 'model', 'read-only', '/tmp/project', ?, 'Prompt', 'running', 1,
        ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(runId, `chat-${runId}`, `sub-${runId}`, harness, `mcp-${runId}`, ...snapshotValues)
}

function seedFollowupRun(
  runId: string,
  previousRunId: string,
  harness: "codex" | "claude-code" = "codex",
): void {
  sqlite
    .prepare("UPDATE sub_chats SET run_status = 'running' WHERE id = ?")
    .run(`sub-${previousRunId}`)
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, model, permission_mode, worktree_path,
        prompt_message_id, initial_prompt, status, started_at,
        runtime_snapshot_version, runtime_preference, runtime_preference_source,
        resolved_runtime, runtime_adapter_version, runtime_protocol_version,
        runtime_capability_snapshot, runtime_control_snapshot
      ) VALUES (?, ?, ?, ?, 'model', 'read-only', '/tmp/project', ?, 'Follow up', 'running', 2,
        ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      `chat-${previousRunId}`,
      `sub-${previousRunId}`,
      harness,
      `mcp-${runId}`,
      ...testRuntimeSnapshotSqlValues(harness, harness),
    )
}

function queued(runId: string, runtime: "codex" | "claude-code" = "codex"): QueuedAgentRun {
  return {
    runId,
    chatId: `chat-${runId}`,
    subChatId: `sub-${runId}`,
    harness: runtime,
    prompt: "Prompt",
    model: "model",
    reasoningEffort: "high",
    permissionMode: "read-only",
    customPermissions: null,
    worktreePath: "/tmp/project",
    projectPath: "/tmp/project",
    runtimeLaunch: {
      schemaVersion: 1,
      harness: runtime,
      model: "model",
      requestedPreference: runtime,
      preferenceSource: "chat",
      resolvedRuntime: runtime,
      compatibility: { compatible: true, harness: runtime, runtime, reason: null },
      versions: {
        adapterVersion: `${runtime}-test-adapter`,
        protocolVersion: `${runtime}-test-protocol`,
      },
      capabilities: availableProbe(runtime).capabilities,
      controls: {
        schemaVersion: 1,
        modelEffort: "high",
        modelThinking: true,
        reasoningDisplay: true,
        subagentActivity: true,
        hookDiagnostics: false,
      },
      permission: { mode: "read-only", customPermissions: null },
    },
  }
}

function directAdapter(runtime: "codex" | "claude-code" = "codex"): HarnessAdapter {
  return {
    runtime,
    probe: async () => availableProbe(runtime),
    startSession: async (context) => ({
      providerSessionId: `session-${context.runId}`,
      providerThreadId: `thread-${context.runId}`,
    }),
    resumeSession: async (_context: RuntimeAdapterContext, session: RuntimeAdapterSession) =>
      session,
    startTurn: async (context) => ({ providerTurnId: `turn-${context.runId}` }),
    async *streamActivity(context) {
      const event: AgentActivityAppend = {
        provider: "openai",
        kind: "status",
        phase: "updated",
        displayClass: "status",
        privacyClass: "public",
        payload: { message: "working", code: null },
        dedupKey: `status-${context.runId}`,
      }
      createAgentActivityStore(sqlite).append(context.runId, event)
      yield event
    },
    requestPermission: async () => ({ decision: "deny" }),
    requestInput: async () => ({ answers: {} }),
    cancel: async () => undefined,
    complete: async () => undefined,
    reconcile: async () => "completed",
    cleanup: async () => undefined,
  }
}

function availableProbe(runtime: "codex" | "claude-code" = "codex") {
  return {
    runtime,
    harness: runtime,
    available: true,
    versions: {
      adapterVersion: `${runtime}-test-adapter`,
      protocolVersion: `${runtime}-test-protocol`,
    },
    capabilities: {
      schemaVersion: 1 as const,
      status: "available" as const,
      capturedAt: "2026-07-14T00:00:00.000Z",
      controls: {
        modelThinking: { supported: true, reason: null },
        reasoningDisplay: { supported: true, reason: null },
        subagentActivity: { supported: true, reason: null },
        hookDiagnostics: { supported: true, reason: null },
      },
      execution: {
        continuation: { supported: true, reason: null },
        delegation: { supported: true, reason: null },
        structuredOutput: { supported: true, reason: null },
        cancellation: { supported: true, reason: null },
      },
      limitations: [],
      unavailableReason: null,
    },
    reason: null,
  }
}
