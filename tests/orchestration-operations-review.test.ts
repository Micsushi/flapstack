import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createCodexCoordinationAdapter } from "../src/main/lib/agent-orchestration/codex-engines"
import { clearOrchestrationOperationsRuntime } from "../src/main/lib/agent-orchestration/operations-runtime"
import type { CoordinationEngineContext } from "../src/shared/coordination-engine"
import * as schema from "../src/main/lib/db/schema"
import { testCoordinationEngineSnapshotSqlValues } from "./coordination-engine-test-db"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"

let directory = ""
let databasePath = ""

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-orchestration-review-"))
  databasePath = join(directory, "agents.db")
  const db = new Database(databasePath)
  migrate(drizzle(db, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  db.prepare(
    "INSERT INTO projects (id, name, path) VALUES ('project-1','Project','/tmp/project')",
  ).run()
  db.prepare(
    "INSERT INTO chats (id, name, project_id, permission_mode, harness) VALUES ('chat-1','Root','project-1','read-only','codex')",
  ).run()
  db.prepare(
    "INSERT INTO tasks (id, project_id, name, status, board_order, created_at, updated_at) VALUES ('task-1','project-1','Task','planned','a0',1,1)",
  ).run()
  db.prepare("UPDATE chats SET task_id = 'task-1', scope = 'task' WHERE id = 'chat-1'").run()
  db.prepare(
    `INSERT INTO task_orchestrations
     (task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions,
      engine_snapshot_version, coordination_engine, coordination_engine_version,
      coordination_engine_source, coordination_engine_capability_snapshot,
      coordination_engine_provider_identity, created_at, updated_at)
     VALUES ('task-1','chat-1','queued',2,4,'{}',?,?,?,?,?,?,1,1)`,
  ).run(...testCoordinationEngineSnapshotSqlValues())
  db.close()
})

afterEach(() => {
  vi.useRealTimers()
  clearOrchestrationOperationsRuntime()
  rmSync(directory, { recursive: true, force: true })
})

describe("Codex durability review invariants", () => {
  it("reconciles crash uncertainty by intent/key under one lease and commits message atomically", async () => {
    seedAgent("agent-1", "run-1")
    const dispatch = vi.fn(async () => {
      throw new Error("connection lost after provider action")
    })
    const reconcile = vi.fn(
      async (_engine: string, _intentId: string, _idempotencyKey: string) => ({
        state: "completed" as const,
        result: { providerMessageId: "m-1" },
      }),
    )
    const adapter = createCodexCoordinationAdapter(databasePath, "codex-v2", {
      probe: vi.fn(),
      dispatch,
      reconcile,
    })
    await expect(adapter.execute(context(), action("crash"))).resolves.toMatchObject({
      state: "uncertain",
    })
    await Promise.all([adapter.reconcile(context()), adapter.reconcile(context())])
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(reconcile.mock.calls[0]?.[1]).toEqual(expect.any(String))
    expect(reconcile.mock.calls[0]?.[2]).toMatch(/^[a-f0-9]{64}$/)
    const db = new Database(databasePath)
    expect(db.prepare("SELECT state FROM coordination_action_intents").get()).toEqual({
      state: "completed",
    })
    expect(db.prepare("SELECT count(*) count FROM orchestration_messages").get()).toEqual({
      count: 1,
    })
    db.close()
  })
})

function seedRun(runId: string) {
  const db = new Database(databasePath)
  const subChatId = `sub-${runId}`
  db.prepare(
    "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, run_status, messages, created_at, updated_at) VALUES (?, 'chat-1', 'codex', 'read-only', 'running', '[]', 1, 1)",
  ).run(subChatId)
  db.prepare(
    `INSERT INTO agent_runs
     (id, chat_id, sub_chat_id, harness, model, permission_mode, initial_prompt, status, runtime_snapshot_version,
      runtime_preference, runtime_preference_source, resolved_runtime, runtime_adapter_version,
      runtime_protocol_version, runtime_capability_snapshot, runtime_control_snapshot)
     VALUES (?, 'chat-1', ?, 'codex', 'gpt', 'read-only', 'Work', 'running', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(runId, subChatId, ...testRuntimeSnapshotSqlValues("codex", "codex"))
  db.close()
}
function seedAgent(agentId: string, runId: string) {
  seedRun(runId)
  const db = new Database(databasePath)
  db.prepare(
    `INSERT INTO orchestration_agents
     (id, task_id, run_id, depth, definition, dependency_agent_ids, status, queued_at, updated_at)
     VALUES (?, 'task-1', ?, 1, ?, '[]', 'active', 1, 1)`,
  ).run(
    agentId,
    runId,
    JSON.stringify({
      role: "Worker",
      prompt: "Work",
      harness: "codex",
      permissionMode: "read-only",
      worktreeStrategy: "none",
      dependencyAgentIds: [],
      completionCriteria: "Done",
    }),
  )
  db.close()
}
function context(): CoordinationEngineContext {
  return {
    orchestrationId: "task-1",
    signal: new AbortController().signal,
    snapshot: {
      schemaVersion: 1,
      requestedEngine: "codex-v2",
      source: "per-launch",
      engine: "codex-v2",
      engineVersion: "codex-v2-v1",
      capabilities: {
        schemaVersion: 1,
        engine: "codex-v2",
        engineVersion: "codex-v2-v1",
        status: "available",
        capturedAt: new Date().toISOString(),
        capabilities: ["named-task-paths", "queued-messages"],
        limitations: [],
        unavailableReason: null,
      },
      providerIdentity: {
        schemaVersion: 1,
        engine: "codex-v2",
        canonicalTaskPath: "/root/worker",
        taskName: "worker",
        providerTaskId: null,
      },
    },
  }
}
function action(message: string) {
  return {
    schemaVersion: 1 as const,
    kind: "send" as const,
    orchestrationId: "task-1",
    providerIdentity: context().snapshot.providerIdentity!,
    targetAgentId: "agent-1",
    message,
  }
}
