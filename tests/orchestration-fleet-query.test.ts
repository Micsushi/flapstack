import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { queryOrchestrationFleet } from "../src/main/lib/agent-orchestration/fleet"
import { createAgentOrchestrationService } from "../src/main/lib/agent-orchestration/service"
import type { OrchestrationFleetQuery } from "../src/shared/agent-orchestration"
import * as schema from "../src/main/lib/db/schema"

let directory = ""
let databasePath = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-orchestration-fleet-"))
  databasePath = join(directory, "agents.db")
  sqlite = new Database(databasePath)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-a','Alpha','/tmp/a')")
    .run()
  sqlite.prepare("INSERT INTO projects (id, name, path) VALUES ('project-b','Beta','/tmp/b')").run()
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("orchestration fleet query", () => {
  it("filters provider/lifecycle/archive state and paginates without scheduling or replay", () => {
    seedOrchestration({
      taskId: "task-a",
      projectId: "project-a",
      status: "running",
      provider: "openai",
      updatedAt: 90,
    })
    seedOrchestration({
      taskId: "task-b",
      projectId: "project-a",
      status: "completed",
      provider: "anthropic",
      updatedAt: 90,
    })
    seedOrchestration({
      taskId: "task-c",
      projectId: "project-b",
      status: "mystery",
      provider: null,
      updatedAt: 10,
      archived: true,
    })
    sqlite
      .prepare(
        "UPDATE orchestration_agents SET cost_quality = 'exact', cost_usd_micros = 1000000 WHERE task_id = 'task-a'",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO orchestration_agents (id, task_id, definition, status, progress_percent, total_tokens, cost_quality, blocker_count, queued_at, updated_at) VALUES ('agent-task-a-unknown', 'task-a', ?, 'queued', 0, 0, 'unknown', 0, 90, 90)",
      )
      .run(
        JSON.stringify({
          role: "Unknown-cost worker",
          prompt: "Work",
          harness: "codex",
          permissionMode: "read-only",
          worktreeStrategy: "none",
          dependencyAgentIds: [],
          completionCriteria: "Done",
        }),
      )
    const before = durableCounts()
    const service = createAgentOrchestrationService(databasePath)

    const first = service.listFleet(query({ limit: 1, archiveScope: "all" }), {
      nowMs: 100_000,
      staleAfterMs: 30_000,
    })
    expect(first.items).toHaveLength(1)
    expect(first.items[0]?.taskId).toBe("task-a")
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = service.listFleet(
      query({ limit: 1, archiveScope: "all", cursor: first.nextCursor! }),
      { nowMs: 100_000, staleAfterMs: 30_000 },
    )
    expect(second.items[0]?.taskId).toBe("task-b")

    expect(
      service.listFleet(query({ providers: ["anthropic"] })).items.map((item) => item.taskId),
    ).toEqual(["task-b"])
    expect(service.listFleet(query({ state: "active" })).items.map((item) => item.taskId)).toEqual([
      "task-a",
    ])
    expect(
      service.listFleet(query({ state: "unknown", archiveScope: "all" })).items[0],
    ).toMatchObject({ taskId: "task-c", freshness: "unknown", projectName: "Beta" })
    expect(
      service.listFleet(query({ projectIds: ["project-a"] }), {
        nowMs: 200_000,
        staleAfterMs: 30_000,
      }).items[0]?.freshness,
    ).toBe("stale")
    expect(service.listFleet(query({ taskIds: ["task-a"] })).items[0]?.aggregate).toMatchObject({
      exactCostUsdMicros: 1_000_000,
      costQuality: "unknown",
    })
    expect(durableCounts()).toEqual(before)

    const restarted = createAgentOrchestrationService(databasePath).listFleet(
      query({ archiveScope: "all" }),
    )
    expect(restarted.total).toBe(3)
    expect(durableCounts()).toEqual(before)
  })

  it("bounds agent reads in chunks and returns stable pages for a large project fleet", () => {
    const insert = sqlite.transaction(() => {
      for (let index = 0; index < 1_205; index += 1) {
        seedOrchestration({
          taskId: `large-${String(index).padStart(4, "0")}`,
          projectId: index < 1_005 ? "project-a" : "project-b",
          status: index % 2 === 0 ? "running" : "completed",
          provider: index % 2 === 0 ? "openai" : "anthropic",
          updatedAt: 100,
        })
      }
    })
    insert.immediate()

    const agentBatchSizes: number[] = []
    const page = queryOrchestrationFleet(
      {
        prepare(sql) {
          const statement = sqlite.prepare(sql)
          return {
            all: (...params: unknown[]) => {
              if (sql.includes("SELECT\n           a.*")) agentBatchSizes.push(params.length)
              return statement.all(...params) as Record<string, unknown>[]
            },
          }
        },
      },
      query({ projectIds: ["project-a"], limit: 25 }),
    )

    expect(page.total).toBe(1_005)
    expect(page.items).toHaveLength(25)
    expect(page.items.every((item) => item.projectId === "project-a")).toBe(true)
    expect(page.items.map((item) => item.taskId)).toEqual(
      [...page.items.map((item) => item.taskId)].sort(),
    )
    expect(page.nextCursor).toEqual(expect.any(String))
    expect(agentBatchSizes).toEqual([25])
    expect(Math.max(...agentBatchSizes)).toBeLessThanOrEqual(500)
  })

  it("rejects cursor values that do not match the selected sort", () => {
    const service = createAgentOrchestrationService(databasePath)
    const cursor = (json: string) => Buffer.from(json).toString("base64url")

    expect(() =>
      service.listFleet(
        query({
          sort: "updated-desc",
          cursor: cursor('{"version":1,"sort":"updated-desc","taskId":"task-a","value":"x"}'),
        }),
      ),
    ).toThrow("Invalid orchestration fleet pagination cursor.")
    expect(() =>
      service.listFleet(
        query({
          sort: "updated-desc",
          cursor: cursor('{"version":1,"sort":"updated-desc","taskId":"task-a","value":1e309}'),
        }),
      ),
    ).toThrow("Invalid orchestration fleet pagination cursor.")
    expect(() =>
      service.listFleet(
        query({
          sort: "name-asc",
          cursor: cursor('{"version":1,"sort":"name-asc","taskId":"task-a","value":42}'),
        }),
      ),
    ).toThrow("Invalid orchestration fleet pagination cursor.")
    expect(() =>
      service.listFleet(
        query({
          sort: "name-asc",
          cursor: cursor(
            JSON.stringify({
              version: 1,
              sort: "name-asc",
              taskId: "task-a",
              value: "x".repeat(513),
            }),
          ),
        }),
      ),
    ).toThrow("Invalid orchestration fleet pagination cursor.")
  })
})

function query(overrides: Partial<OrchestrationFleetQuery> = {}): OrchestrationFleetQuery {
  return {
    projectIds: [],
    taskIds: [],
    statuses: [],
    providers: [],
    state: "all",
    archiveScope: "visible",
    sort: "updated-desc",
    limit: 25,
    ...overrides,
  }
}

function seedOrchestration(input: {
  taskId: string
  projectId: string
  status: string
  provider: string | null
  updatedAt: number
  archived?: boolean
}) {
  const chatId = `chat-${input.taskId}`
  const agentChatId = `agent-chat-${input.taskId}`
  const runId = `run-${input.taskId}`
  const agentId = `agent-${input.taskId}`
  const harness = input.provider === "anthropic" ? "claude-code" : "codex"
  sqlite
    .prepare("INSERT INTO tasks (id, project_id, name, archived_at) VALUES (?, ?, ?, ?)")
    .run(
      input.taskId,
      input.projectId,
      `Task ${input.taskId}`,
      input.archived ? input.updatedAt : null,
    )
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, project_id, task_id, scope, permission_mode, harness) VALUES (?, ?, ?, ?, 'task', 'read-only', 'codex')",
    )
    .run(chatId, `Chat ${input.taskId}`, input.projectId, input.taskId)
  sqlite
    .prepare(
      "INSERT INTO chats (id, name, project_id, task_id, scope, permission_mode, harness) VALUES (?, ?, ?, ?, 'task', 'read-only', 'codex')",
    )
    .run(agentChatId, `Agent ${input.taskId}`, input.projectId, input.taskId)
  sqlite
    .prepare(
      `INSERT INTO task_orchestrations (
        task_id, initiating_chat_id, status, max_parallel_agents, max_depth,
        stop_conditions, blocker_count, engine_snapshot_version, coordination_engine,
        coordination_engine_version, coordination_engine_source,
        coordination_engine_capability_snapshot, coordination_engine_provider_identity,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, 2, 4, '{}', 0, 1, 'workflow', 'workflow-v1', 'product',
        '{"schemaVersion":1,"engine":"workflow","engineVersion":"workflow-v1","status":"available","capturedAt":"2026-07-14T00:00:00.000Z","capabilities":["durable-workflow","checkpoints","mixed-runtimes"],"limitations":[],"unavailableReason":null}',
        'null', ?, ?, ?)`,
    )
    .run(
      input.taskId,
      chatId,
      input.status,
      input.updatedAt,
      input.updatedAt,
      input.status === "completed" ? input.updatedAt : null,
    )
  sqlite
    .prepare(
      "INSERT INTO agent_runs (id, chat_id, harness, permission_mode, runtime_snapshot_version, runtime_preference, runtime_preference_source, resolved_runtime, runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot, runtime_control_snapshot, status, started_at, completed_at) VALUES (?, ?, ?, 'read-only', 1, 'flapstack-native', 'product', 'flapstack-native', 'test', 'test', '{}', '{}', ?, ?, ?)",
    )
    .run(
      runId,
      agentChatId,
      harness,
      input.status === "completed" ? "success" : "running",
      input.updatedAt,
      input.status === "completed" ? input.updatedAt : null,
    )
  sqlite
    .prepare(
      "INSERT INTO orchestration_agents (id, task_id, chat_id, run_id, definition, status, progress_percent, total_tokens, cost_quality, blocker_count, queued_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 50, 100, 'unknown', 0, ?, ?)",
    )
    .run(
      agentId,
      input.taskId,
      agentChatId,
      runId,
      JSON.stringify({
        role: "Worker",
        prompt: "Work",
        harness,
        ...(input.provider ? { provider: input.provider } : {}),
        permissionMode: "read-only",
        worktreeStrategy: "none",
        dependencyAgentIds: [],
        completionCriteria: "Done",
      }),
      input.status === "completed" ? "completed" : "active",
      input.updatedAt,
      input.updatedAt,
    )
}

function durableCounts() {
  return {
    tasks: (sqlite.prepare("SELECT count(*) count FROM tasks").get() as { count: number }).count,
    chats: (sqlite.prepare("SELECT count(*) count FROM chats").get() as { count: number }).count,
    runs: (sqlite.prepare("SELECT count(*) count FROM agent_runs").get() as { count: number })
      .count,
    agents: (
      sqlite.prepare("SELECT count(*) count FROM orchestration_agents").get() as { count: number }
    ).count,
  }
}
