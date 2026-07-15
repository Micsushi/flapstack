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

let directory = ""
let path = ""
let sqlite: Database.Database

beforeEach(() => {
  resetMainRuntimeLaunchServicesForTests()
  directory = mkdtempSync(join(tmpdir(), "flapstack-runtime-main-service-"))
  path = join(directory, "agents.db")
  sqlite = new Database(path)
  migrateDatabase(drizzle(sqlite, { schema }), sqlite, resolve(process.cwd(), "drizzle"))
})

afterEach(() => {
  resetMainRuntimeLaunchServicesForTests()
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("process-wide Runtime launch service", () => {
  it("owns one registry/coordinator and keeps real disabled factories recoverable", () => {
    const first = getMainRuntimeLaunchService(path)
    const second = getMainRuntimeLaunchService(path)

    expect(second).toBe(first)
    expect(first.diagnostics().registry).toEqual([
      expect.objectContaining({ runtime: "codex", enabled: false }),
      expect.objectContaining({ runtime: "claude-code", enabled: false }),
      expect.objectContaining({ runtime: "flapstack-native", enabled: true }),
    ])
    expect(() => first.registry.get("codex")).not.toThrow()
    expect(() => first.registry.get("claude-code")).not.toThrow()
  })

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
    ).toEqual({ session_id: "session-durable" })
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

  it("stores each Codex-shaped yielded event once with one authoritative orchestration link", async () => {
    seedDirectRun("codex-single-authority")
    seedOrchestrationAgent("codex-single-authority")
    const value = directAdapter()
    value.streamActivity = async function* (context) {
      const events: AgentActivityAppend[] = [
        {
          provider: "openai",
          kind: "agent-text",
          phase: "delta",
          displayClass: "summary",
          privacyClass: "public",
          providerThreadId: "thread-codex-single-authority",
          providerTurnId: "turn-codex-single-authority",
          payload: { text: "first" },
        },
        {
          provider: "openai",
          kind: "status",
          phase: "updated",
          displayClass: "status",
          privacyClass: "public",
          providerThreadId: "thread-codex-single-authority",
          providerTurnId: "turn-codex-single-authority",
          payload: { message: "second", code: null },
        },
      ]
      createAgentActivityStore(sqlite).appendBatch(
        context.runId,
        events.map((event) => ({
          ...event,
          orchestrationAgentId: "agent-codex-single-authority",
        })),
      )
      yield* events
    }
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })

    await service.launch(queued("codex-single-authority"))

    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) count, COUNT(DISTINCT sequence) sequences,
             COUNT(DISTINCT orchestration_agent_id) links
           FROM agent_activity_events
           WHERE run_id = 'codex-single-authority' AND provider = 'openai'`,
        )
        .get(),
    ).toEqual({ count: 2, sequences: 2, links: 1 })
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) count FROM agent_activity_events
           WHERE run_id = 'codex-single-authority'
             AND provider = 'openai'
             AND orchestration_agent_id = 'agent-codex-single-authority'`,
        )
        .get(),
    ).toEqual({ count: 2 })
  })

  it("does not call the provider when durable intent activity cannot commit", async () => {
    seedDirectRun("intent-failure")
    sqlite.exec("DROP TABLE agent_activity_events")
    const value = directAdapter()
    value.startSession = vi.fn(value.startSession)
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })

    await expect(service.launch(queued("intent-failure"))).rejects.toThrow()
    expect(value.startSession).not.toHaveBeenCalled()
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

  it("exposes provider-neutral reconciliation by persisted run identity", async () => {
    seedDirectRun("reconcile-by-id")
    createAgentActivityStore(sqlite).append("reconcile-by-id", {
      provider: "openai",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-reconcile-by-id",
      providerThreadId: "thread-reconcile-by-id",
      providerTurnId: "turn-reconcile-by-id",
      payload: { state: "turn-started", detail: null },
      dedupKey: "reconcile-by-id-identity",
    })
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "completed")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(service.reconcileRun("reconcile-by-id")).resolves.toBe("completed")
    expect(value.reconcile).toHaveBeenCalledTimes(1)
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'reconcile-by-id'").get(),
    ).toEqual({ status: "success" })
  })

  it("reconciles an active stream from coordinator state without a second provider authority", async () => {
    seedDirectRun("active-reconcile")
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
    value.reconcile = vi.fn(async () => "completed")
    value.cancel = vi.fn(async () => release())
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })
    const running = service.launch(queued("active-reconcile"))
    await streamStarted

    await expect(service.reconcileRun("active-reconcile")).resolves.toBe("running")
    expect(value.reconcile).not.toHaveBeenCalled()
    await expect(service.cancel("active-reconcile", "operator")).resolves.toBe(true)
    await expect(running).rejects.toMatchObject({ name: "RuntimeLaunchCancelledError" })
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'active-reconcile'").get(),
    ).toEqual({ status: "cancelled" })
  })

  it("fails a restarted direct run with missing identity instead of replaying it", async () => {
    seedDirectRun("missing")
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "running")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(recoverInterruptedMcpRuns(path, service)).resolves.toBe(0)
    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'missing'").get()).toEqual({
      status: "failure",
    })
    expect(value.reconcile).not.toHaveBeenCalled()
  })

  it("cancels a restarted direct run through persisted identity exactly once", async () => {
    seedDirectRun("restart-cancel")
    createAgentActivityStore(sqlite).append("restart-cancel", {
      provider: "openai",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-restart-cancel",
      providerThreadId: "thread-restart-cancel",
      providerTurnId: "turn-restart-cancel",
      payload: { state: "turn-started", detail: null },
      dedupKey: "restart-cancel-identity",
    })
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "running")
    value.cancel = vi.fn(async () => undefined)
    value.cleanup = vi.fn(async () => undefined)
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(
      Promise.all([
        service.cancel("restart-cancel", "operator"),
        service.cancel("restart-cancel", "operator"),
      ]),
    ).resolves.toEqual([true, true])
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'restart-cancel'").get(),
    ).toEqual({ status: "cancelled" })
    expect(value.reconcile).toHaveBeenCalledTimes(1)
    expect(value.cancel).toHaveBeenCalledTimes(1)
    expect(value.cleanup).toHaveBeenCalledTimes(1)
    await expect(service.cancel("restart-cancel", "again")).resolves.toBe(false)
  })

  it("serializes concurrent persisted reconcile and cancel into one control sequence", async () => {
    seedDirectRun("persisted-operation-race")
    createAgentActivityStore(sqlite).append("persisted-operation-race", {
      provider: "openai",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-persisted-operation-race",
      providerThreadId: "thread-persisted-operation-race",
      providerTurnId: "turn-persisted-operation-race",
      payload: { state: "turn-started", detail: null },
      dedupKey: "persisted-operation-race-identity",
    })
    let reconcileStarted!: () => void
    let releaseReconcile!: () => void
    const started = new Promise<void>((resolve) => {
      reconcileStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      releaseReconcile = resolve
    })
    const value = directAdapter()
    value.reconcile = vi.fn(async () => {
      reconcileStarted()
      await gate
      return "running"
    })
    value.cancel = vi.fn(async () => undefined)
    value.cleanup = vi.fn(async () => undefined)
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    const cancellation = service.cancel("persisted-operation-race", "operator")
    await started
    const reconciliation = service.reconcileRun("persisted-operation-race")
    releaseReconcile()

    await expect(cancellation).resolves.toBe(true)
    await expect(reconciliation).resolves.toBe("cancelled")
    expect(value.reconcile).toHaveBeenCalledTimes(1)
    expect(value.cancel).toHaveBeenCalledTimes(1)
    expect(value.cleanup).toHaveBeenCalledTimes(1)
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'persisted-operation-race'").get(),
    ).toEqual({ status: "cancelled" })
    expect(
      sqlite
        .prepare("SELECT run_status FROM sub_chats WHERE id = 'sub-persisted-operation-race'")
        .get(),
    ).toEqual({ run_status: "cancelled" })
  })

  it("keeps an unhandled restarted cancellation unacknowledged and uncertain", async () => {
    seedDirectRun("restart-uncertain")
    createAgentActivityStore(sqlite).append("restart-uncertain", {
      provider: "anthropic",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-restart-uncertain",
      providerThreadId: null,
      providerTurnId: "turn-restart-uncertain",
      payload: { state: "turn-started", detail: null },
      dedupKey: "restart-uncertain-identity",
    })
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "uncertain")
    value.cancel = vi.fn(async () => undefined)
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(service.cancel("restart-uncertain", "operator")).resolves.toBe(false)
    expect(value.cancel).not.toHaveBeenCalled()
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'restart-uncertain'").get(),
    ).toEqual({ status: "failure" })
  })

  it("does not acknowledge persisted cancellation when adapter cleanup fails", async () => {
    seedDirectRun("restart-cleanup-failure")
    createAgentActivityStore(sqlite).append("restart-cleanup-failure", {
      provider: "openai",
      kind: "lifecycle",
      phase: "started",
      displayClass: "status",
      privacyClass: "public",
      providerSessionId: "session-restart-cleanup-failure",
      providerThreadId: "thread-restart-cleanup-failure",
      providerTurnId: "turn-restart-cleanup-failure",
      payload: { state: "turn-started", detail: null },
      dedupKey: "restart-cleanup-failure-identity",
    })
    const value = directAdapter()
    value.reconcile = vi.fn(async () => "running")
    value.cancel = vi.fn(async () => undefined)
    value.cleanup = vi.fn(async () => {
      throw new Error("cleanup failed at /Users/alice/private API_KEY=abcd")
    })
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: false,
    })

    await expect(service.cancel("restart-cleanup-failure", "operator")).resolves.toBe(false)
    expect(
      sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'restart-cleanup-failure'").get(),
    ).toEqual({ status: "failure" })
    const stored = JSON.stringify(
      sqlite
        .prepare(
          "SELECT payload_json FROM agent_activity_events WHERE run_id = 'restart-cleanup-failure'",
        )
        .all(),
    )
    expect(stored).not.toContain("/Users/alice")
    expect(stored).not.toContain("abcd")
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

  it("rejects stale contradictory terminal lifecycle callbacks atomically", async () => {
    seedDirectRun("stale-after-cancel")
    seedDirectRun("stale-after-success")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => directAdapter(),
      enableCodex: true,
    })
    const writeLifecycle = (
      service as unknown as {
        persistLifecycle(runId: string, lifecycle: string, detail?: string | null): Promise<void>
      }
    ).persistLifecycle.bind(service)

    await writeLifecycle("stale-after-cancel", "cancelled", "winner")
    await Promise.all([
      writeLifecycle("stale-after-cancel", "completed", "stale-complete"),
      writeLifecycle("stale-after-cancel", "failed", "stale-failure"),
      writeLifecycle("stale-after-cancel", "uncertain", "stale-uncertain"),
    ])
    await writeLifecycle("stale-after-success", "completed", "winner")
    await Promise.all([
      writeLifecycle("stale-after-success", "failed", "stale-failure"),
      writeLifecycle("stale-after-success", "cancelled", "stale-cancel"),
    ])

    expect(
      sqlite
        .prepare(
          `SELECT r.status, s.run_status FROM agent_runs r
           JOIN sub_chats s ON s.id = r.sub_chat_id WHERE r.id = 'stale-after-cancel'`,
        )
        .get(),
    ).toEqual({ status: "cancelled", run_status: "cancelled" })
    expect(
      sqlite
        .prepare(
          `SELECT r.status, s.run_status FROM agent_runs r
           JOIN sub_chats s ON s.id = r.sub_chat_id WHERE r.id = 'stale-after-success'`,
        )
        .get(),
    ).toEqual({ status: "success", run_status: "success" })
    expect(
      sqlite
        .prepare(
          `SELECT phase, json_extract(payload_json, '$.state') state
           FROM agent_activity_events WHERE run_id = 'stale-after-cancel' AND kind = 'lifecycle'`,
        )
        .all(),
    ).toEqual([{ phase: "cancelled", state: "cancelled" }])
    expect(
      sqlite
        .prepare(
          `SELECT phase, json_extract(payload_json, '$.state') state
           FROM agent_activity_events WHERE run_id = 'stale-after-success' AND kind = 'lifecycle'`,
        )
        .all(),
    ).toEqual([{ phase: "completed", state: "completed" }])
  })

  it("does not let active reconcile overwrite cancellation terminal truth", async () => {
    seedDirectRun("active-reconcile-cancel-race")
    let streamStarted!: () => void
    let cancelStarted!: () => void
    let finishCancel!: () => void
    let finishStream!: () => void
    const streaming = new Promise<void>((resolve) => {
      streamStarted = resolve
    })
    const cancelling = new Promise<void>((resolve) => {
      cancelStarted = resolve
    })
    const cancelGate = new Promise<void>((resolve) => {
      finishCancel = resolve
    })
    const streamGate = new Promise<void>((resolve) => {
      finishStream = resolve
    })
    const value = directAdapter()
    value.streamActivity = async function* () {
      streamStarted()
      await streamGate
    }
    value.cancel = vi.fn(async () => {
      cancelStarted()
      await cancelGate
      finishStream()
    })
    value.reconcile = vi.fn(async () => "completed")
    const service = getMainRuntimeLaunchService(path, {
      codexFactory: () => value,
      enableCodex: true,
    })
    const running = service.launch(queued("active-reconcile-cancel-race"))
    await streaming
    const cancellation = service.cancel("active-reconcile-cancel-race", "operator")
    await cancelling
    const reconciliation = service.reconcileRun("active-reconcile-cancel-race")
    finishCancel()

    await expect(cancellation).resolves.toBe(true)
    await expect(reconciliation).resolves.toBe("uncertain")
    await expect(running).rejects.toMatchObject({ name: "RuntimeLaunchCancelledError" })
    expect(value.reconcile).not.toHaveBeenCalled()
    expect(
      sqlite
        .prepare("SELECT status FROM agent_runs WHERE id = 'active-reconcile-cancel-race'")
        .get(),
    ).toEqual({ status: "cancelled" })
    expect(
      sqlite
        .prepare("SELECT run_status FROM sub_chats WHERE id = 'sub-active-reconcile-cancel-race'")
        .get(),
    ).toEqual({ run_status: "cancelled" })
    expect(
      sqlite
        .prepare(
          `SELECT COUNT(*) count FROM agent_activity_events
           WHERE run_id = 'active-reconcile-cancel-race' AND phase = 'completed'`,
        )
        .get(),
    ).toEqual({ count: 0 })
  })
})

function seedDirectRun(runId: string): void {
  sqlite
    .prepare(
      "INSERT OR IGNORE INTO projects (id, name, path, created_at) VALUES ('project', 'Project', '/tmp/project', 1)",
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats
       (id, project_id, name, scope, permission_mode, harness, model, worktree_path, runtime_preference)
       VALUES (?, 'project', 'Chat', 'global', 'read-only', 'codex', 'model', '/tmp/project', 'codex')`,
    )
    .run(`chat-${runId}`)
  sqlite
    .prepare(
      `INSERT INTO sub_chats
       (id, chat_id, harness, permission_mode, worktree_path, run_status, messages)
       VALUES (?, ?, 'codex', 'read-only', '/tmp/project', 'running', '[]')`,
    )
    .run(`sub-${runId}`, `chat-${runId}`)
  sqlite
    .prepare(
      `INSERT INTO agent_runs (
        id, chat_id, sub_chat_id, harness, model, permission_mode, worktree_path,
        prompt_message_id, initial_prompt, status, started_at,
        runtime_snapshot_version, runtime_preference, runtime_preference_source,
        resolved_runtime, runtime_adapter_version, runtime_protocol_version,
        runtime_capability_snapshot, runtime_control_snapshot
      ) VALUES (?, ?, ?, 'codex', 'model', 'read-only', '/tmp/project', ?, 'Prompt', 'running', 1,
        ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      runId,
      `chat-${runId}`,
      `sub-${runId}`,
      `mcp-${runId}`,
      ...testRuntimeSnapshotSqlValues("codex", "codex"),
    )
}

function seedOrchestrationAgent(runId: string): void {
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name) VALUES (?, 'project', ?)")
    .run(`task-${runId}`, `Task ${runId}`)
  sqlite
    .prepare(
      `INSERT INTO task_orchestrations (task_id, initiating_chat_id, status)
       VALUES (?, ?, 'running')`,
    )
    .run(`task-${runId}`, `chat-${runId}`)
  sqlite
    .prepare(
      `INSERT INTO orchestration_agents (id, task_id, chat_id, run_id, definition, status)
       VALUES (?, ?, ?, ?, '{}', 'active')`,
    )
    .run(`agent-${runId}`, `task-${runId}`, `chat-${runId}`, runId)
}

function queued(runId: string): QueuedAgentRun {
  return {
    runId,
    chatId: `chat-${runId}`,
    subChatId: `sub-${runId}`,
    harness: "codex",
    prompt: "Prompt",
    model: "model",
    reasoningEffort: "high",
    permissionMode: "read-only",
    customPermissions: null,
    worktreePath: "/tmp/project",
    projectPath: "/tmp/project",
    runtimeLaunch: {
      schemaVersion: 1,
      harness: "codex",
      model: "model",
      requestedPreference: "codex",
      preferenceSource: "chat",
      resolvedRuntime: "codex",
      compatibility: { compatible: true, harness: "codex", runtime: "codex", reason: null },
      versions: {
        adapterVersion: "codex-test-adapter",
        protocolVersion: "codex-test-protocol",
      },
      capabilities: availableProbe().capabilities,
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

function directAdapter(): HarnessAdapter {
  return {
    runtime: "codex",
    probe: async () => availableProbe(),
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

function availableProbe() {
  return {
    runtime: "codex" as const,
    harness: "codex",
    available: true,
    versions: {
      adapterVersion: "codex-test-adapter",
      protocolVersion: "codex-test-protocol",
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
      limitations: [],
      unavailableReason: null,
    },
    reason: null,
  }
}
