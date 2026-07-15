import Database from "better-sqlite3"
import { execFileSync } from "node:child_process"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createAgentOrchestrationService } from "../src/main/lib/agent-orchestration/service"
import {
  stableOperationOrchestrationId,
  stableOperationWorkspaceId,
} from "../src/main/lib/saved-workspaces/operations"
import { nowEpochSeconds } from "../src/main/lib/db/timestamps"
import { McpApprovalLifecycle } from "../src/main/lib/mcp-control/approval-lifecycle"
import { createMcpMutationService } from "../src/main/lib/mcp-control/mutation-service"
import { invokeMcpControlTool } from "../src/main/lib/mcp-control/registry"
import * as schema from "../src/main/lib/db/schema"

let directory = ""
let path = ""
let projectPath = ""
let sqlite: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-agent-orchestration-"))
  path = join(directory, "agents.db")
  projectPath = join(directory, "project")
  execFileSync("git", ["init", "-b", "main", projectPath])
  execFileSync("git", [
    "-C",
    projectPath,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--allow-empty",
    "-m",
    "init",
  ])
  sqlite = new Database(path)
  migrate(drizzle(sqlite, { schema }), { migrationsFolder: resolve(process.cwd(), "drizzle") })
  sqlite
    .prepare("INSERT INTO projects (id, name, path) VALUES ('project-1', 'Project', ?)")
    .run(projectPath)
  sqlite
    .prepare(
      `INSERT INTO chats (
        id, name, scope, project_id, permission_mode, harness, worktree_path,
        branch, initiator_chat_id, ancestor_chat_ids
      ) VALUES ('root-chat', 'Root', 'project', 'project-1', 'full-access', 'codex',
        ?, 'main', 'root-chat', '[]')`,
    )
    .run(projectPath)
})

afterEach(() => {
  sqlite.close()
  rmSync(directory, { recursive: true, force: true })
})

describe("durable agent task orchestration", () => {
  it("uses the authoritative 0031 saved-workspace constraints and indexes", () => {
    const table = sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'saved_workspaces'")
      .get() as { sql: string }
    const normalizedSql = table.sql.replace(/["`]/g, "").toLowerCase()
    expect(normalizedSql).toContain("length(trim(saved_workspaces.name)) between 1 and 256")
    expect(normalizedSql).toContain("length(trim(saved_workspaces.sort_order)) between 1 and 512")
    expect(normalizedSql).toContain(
      "json_extract(saved_workspaces.layout_json, '$.version') = saved_workspaces.layout_version",
    )
    expect(normalizedSql).toContain("length(cast(saved_workspaces.layout_json as blob)) <= 262144")
    expect(
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name LIKE 'saved_workspaces_%_idx'
           ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "saved_workspaces_orchestration_idx" },
      { name: "saved_workspaces_project_order_idx" },
      { name: "saved_workspaces_task_order_idx" },
    ])
  })

  it("creates one task, attaches descendants, and atomically fills only configured slots", () => {
    sqlite
      .prepare(
        `INSERT INTO chats (
          id, name, scope, project_id, permission_mode, harness, parent_chat_id,
          initiator_chat_id, ancestor_chat_ids
        ) VALUES ('old-child', 'Old child', 'project', 'project-1', 'read-only', 'claude-code',
          'root-chat', 'root-chat', '["root-chat"]')`,
      )
      .run()
    const service = createAgentOrchestrationService(path)
    const overview = service.create(createInput({ maxParallelAgents: 2, count: 3 }))

    expect(overview.aggregate).toMatchObject({ total: 3, active: 2, queued: 1 })
    expect(sqlite.prepare("SELECT task_id, scope FROM chats WHERE id = 'root-chat'").get()).toEqual(
      { task_id: overview.orchestration.taskId, scope: "task" },
    )
    expect(sqlite.prepare("SELECT task_id FROM chats WHERE id = 'old-child'").get()).toEqual({
      task_id: overview.orchestration.taskId,
    })
    expect(
      sqlite
        .prepare(
          `SELECT id, task_id, owner_kind, orchestration_id
           FROM saved_workspaces WHERE task_id = ?`,
        )
        .get(overview.orchestration.taskId),
    ).toEqual({
      id: stableOperationWorkspaceId(overview.orchestration.taskId),
      task_id: overview.orchestration.taskId,
      owner_kind: "orchestration",
      orchestration_id: stableOperationOrchestrationId(overview.orchestration.taskId),
    })
    expect(
      sqlite
        .prepare(
          "SELECT count(*) count FROM chats WHERE parent_chat_id = 'root-chat' AND id <> 'old-child'",
        )
        .get(),
    ).toEqual({ count: 2 })
    const children = sqlite
      .prepare(
        "SELECT parent_chat_id, initiator_chat_id, ancestor_chat_ids FROM chats WHERE id NOT IN ('root-chat','old-child') ORDER BY created_at",
      )
      .all()
    expect(children).toEqual([
      {
        parent_chat_id: "root-chat",
        initiator_chat_id: "root-chat",
        ancestor_chat_ids: '["root-chat"]',
      },
      {
        parent_chat_id: "root-chat",
        initiator_chat_id: "root-chat",
        ancestor_chat_ids: '["root-chat"]',
      },
    ])
  })

  it("persists deferred initial scheduling across concurrent and restart drains", () => {
    const service = createAgentOrchestrationService(path)
    const created = service.create(
      createInput({ count: 2, stopConditions: { maxWallClockMs: 10 } }),
      undefined,
      { deferScheduling: true },
    )
    expect(created.orchestration.status).toBe("paused")
    expect(created.aggregate).toMatchObject({ queued: 2, active: 0 })

    const concurrentRead = createAgentOrchestrationService(path).getOverview(
      created.orchestration.taskId,
    )
    const restartedRead = createAgentOrchestrationService(path).getOverview(
      created.orchestration.taskId,
    )
    expect(concurrentRead?.orchestration.status).toBe("paused")
    expect(restartedRead?.orchestration.status).toBe("paused")
    expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })

    const resumed = createAgentOrchestrationService(path).control(
      created.orchestration.taskId,
      "resume",
    )
    expect(resumed.orchestration.startedAt).toEqual(expect.any(Number))
    sqlite
      .prepare("UPDATE task_orchestrations SET started_at = ? WHERE task_id = ?")
      .run(nowEpochSeconds() - 1, created.orchestration.taskId)
    expect(
      createAgentOrchestrationService(path).getOverview(created.orchestration.taskId)
        ?.orchestration,
    ).toMatchObject({ status: "stopped", stopReason: "wall-clock-budget" })
  })

  it("unblocks dependencies and queued work only after durable completion", () => {
    const service = createAgentOrchestrationService(path)
    const input = createInput({ maxParallelAgents: 2, count: 0 })
    input.agents = [
      definition("build", { agentId: "agent-a" }),
      definition("review", { agentId: "agent-b", dependencyAgentIds: ["agent-a"] }),
    ]
    const created = service.create(input)
    expect(created.aggregate).toMatchObject({ active: 1, queued: 1 })
    const first = created.agents.find((agent) => agent.id === "agent-a")!
    sqlite
      .prepare("UPDATE agent_runs SET status = 'success', completed_at = ? WHERE id = ?")
      .run(nowEpochSeconds(), first.runId)

    const resumed = createAgentOrchestrationService(path).getOverview(created.orchestration.taskId)!
    expect(resumed.agents.find((agent) => agent.id === "agent-a")?.status).toBe("completed")
    expect(resumed.agents.find((agent) => agent.id === "agent-b")?.status).toBe("active")
  })

  it("fails blocked dependency chains honestly and rewires them through a retry", () => {
    const service = createAgentOrchestrationService(path)
    const input = createInput({ maxParallelAgents: 2, count: 0 })
    input.agents = [
      definition("build", { agentId: "agent-a" }),
      definition("review", { agentId: "agent-b", dependencyAgentIds: ["agent-a"] }),
    ]
    const created = service.create(input)
    const first = created.agents.find((agent) => agent.id === "agent-a")!
    sqlite
      .prepare("UPDATE agent_runs SET status = 'failure', completed_at = ? WHERE id = ?")
      .run(nowEpochSeconds(), first.runId)

    const failed = service.getOverview(created.orchestration.taskId)!
    expect(failed.orchestration.status).toBe("failed")
    expect(failed.agents.find((agent) => agent.id === "agent-b")).toMatchObject({
      status: "failed",
    })

    const retry = service.retryAgent(created.orchestration.taskId, "agent-a")
    const recovered = service.getOverview(created.orchestration.taskId)!
    expect(recovered.orchestration.status).toBe("running")
    expect(recovered.agents.find((agent) => agent.id === "agent-b")).toMatchObject({
      status: "queued",
      definition: expect.objectContaining({ dependencyAgentIds: [retry.id] }),
    })
  })

  it("consumes durable cancellation requests once", () => {
    const service = createAgentOrchestrationService(path)
    const created = service.create(createInput({ count: 1 }))
    const runId = created.agents[0]!.runId!
    service.control(created.orchestration.taskId, "stop")
    expect(service.listCancellationRequests()).toEqual([
      expect.objectContaining({ runId, subChatId: expect.any(String) }),
    ])
    expect(service.acknowledgeCancellationRequest(runId)).toBe(true)
    expect(service.acknowledgeCancellationRequest(runId)).toBe(false)
    expect(service.listCancellationRequests()).toEqual([])
  })

  it("does not let orchestration stop clobber a newer conversation run", () => {
    const service = createAgentOrchestrationService(path)
    const created = service.create(createInput({ count: 2, maxParallelAgents: 1 }))
    const first = created.agents.find((agent) => agent.status === "active")!
    sqlite
      .prepare("UPDATE agent_runs SET status = 'success', completed_at = ? WHERE id = ?")
      .run(nowEpochSeconds(), first.runId)
    service.tickAll()
    const firstSubChat = sqlite
      .prepare("SELECT sub_chat_id FROM agent_runs WHERE id = ?")
      .get(first.runId) as { sub_chat_id: string }
    sqlite
      .prepare(
        `INSERT INTO agent_runs (
          id, chat_id, sub_chat_id, harness, permission_mode,
          runtime_snapshot_version, runtime_preference, runtime_preference_source,
          resolved_runtime, runtime_adapter_version, runtime_protocol_version,
          runtime_capability_snapshot, runtime_control_snapshot, status, started_at
        ) SELECT 'newer-run', chat_id, sub_chat_id, harness, permission_mode,
          runtime_snapshot_version, runtime_preference, runtime_preference_source,
          resolved_runtime, runtime_adapter_version, runtime_protocol_version,
          runtime_capability_snapshot, runtime_control_snapshot, 'running', ?
          FROM agent_runs WHERE id = ?`,
      )
      .run(nowEpochSeconds() + 1, first.runId)
    sqlite
      .prepare("UPDATE sub_chats SET run_status = 'running' WHERE id = ?")
      .run(firstSubChat.sub_chat_id)

    service.control(created.orchestration.taskId, "stop")

    expect(sqlite.prepare("SELECT status FROM agent_runs WHERE id = 'newer-run'").get()).toEqual({
      status: "running",
    })
    expect(
      sqlite.prepare("SELECT run_status FROM sub_chats WHERE id = ?").get(firstSubChat.sub_chat_id),
    ).toEqual({ run_status: "running" })
  })

  it("does not launch stale queued work after an orchestration is terminal", () => {
    const service = createAgentOrchestrationService(path)
    const created = service.create(createInput({ count: 1 }))
    service.control(created.orchestration.taskId, "stop")
    const staleAgent = "stale-after-stop"
    const now = nowEpochSeconds()
    sqlite
      .prepare(
        `INSERT INTO orchestration_agents (
          id, task_id, ancestor_agent_ids, depth, definition, dependency_agent_ids,
          status, queued_at, updated_at
        ) VALUES (?, ?, '[]', 1, ?, '[]', 'queued', ?, ?)`,
      )
      .run(
        staleAgent,
        created.orchestration.taskId,
        JSON.stringify(createInput({ count: 1 }).agents[0]),
        now,
        now,
      )

    const overview = service.getOverview(created.orchestration.taskId)!

    expect(overview.orchestration.status).toBe("stopped")
    expect(overview.agents.find((agent) => agent.id === staleAgent)).toMatchObject({
      status: "stopped",
      chatId: null,
      runId: null,
    })
  })

  it("persists provider message usage into durable run samples", () => {
    const service = createAgentOrchestrationService(path)
    const created = service.create(createInput({ count: 1 }))
    const agent = created.agents[0]!
    sqlite
      .prepare(
        "UPDATE sub_chats SET messages = ? WHERE id = (SELECT sub_chat_id FROM agent_runs WHERE id = ?)",
      )
      .run(
        JSON.stringify([
          {
            id: "assistant-usage",
            role: "assistant",
            parts: [],
            metadata: {
              runId: agent.runId,
              inputTokens: 120,
              outputTokens: 30,
              reasoningTokens: 10,
              totalTokens: 150,
            },
          },
        ]),
        agent.runId,
      )
    expect(service.getOverview(created.orchestration.taskId)?.aggregate.totalTokens).toBe(150)
    expect(
      sqlite
        .prepare(
          `SELECT provider_id, total_tokens, cost_quality, attribution_state,
                  attribution_project_id, attribution_task_id, attribution_chat_id,
                  attribution_orchestration_id, attribution_run_id,
                  source_class, dedupe_strategy
           FROM usage_samples WHERE run_id = ?`,
        )
        .get(agent.runId),
    ).toEqual({
      provider_id: "codex",
      total_tokens: 150,
      cost_quality: "unknown",
      attribution_state: "attributed",
      attribution_project_id: "project-1",
      attribution_task_id: created.orchestration.taskId,
      attribution_chat_id: agent.chatId,
      attribution_orchestration_id: created.orchestration.taskId,
      attribution_run_id: agent.runId,
      source_class: "flapstack-run",
      dedupe_strategy: "exact-fact",
    })
  })

  it("survives restart and supports pause, resume, manual stop, retry, and active replacement", () => {
    const firstService = createAgentOrchestrationService(path)
    const created = firstService.create(createInput({ maxParallelAgents: 1, count: 2 }))
    firstService.control(created.orchestration.taskId, "pause")
    const afterRestart = createAgentOrchestrationService(path)
    expect(afterRestart.getOverview(created.orchestration.taskId)?.orchestration.status).toBe(
      "paused",
    )
    expect(afterRestart.control(created.orchestration.taskId, "resume").orchestration.status).toBe(
      "running",
    )

    const active = afterRestart
      .getOverview(created.orchestration.taskId)!
      .agents.find((agent) => agent.status === "active")!
    const replacement = afterRestart.replaceAgent(
      created.orchestration.taskId,
      active.id,
      definition("replacement"),
    )
    expect(replacement.replacedAgentId).toBe(active.id)
    expect(afterRestart.getOverview(created.orchestration.taskId)?.aggregate.active).toBe(1)

    const stopped = afterRestart.control(created.orchestration.taskId, "stop")
    expect(stopped.orchestration).toMatchObject({ status: "stopped", stopReason: "manual-stop" })
    const failed = stopped.agents.find((agent) => agent.status === "stopped")!
    const retry = afterRestart.retryAgent(created.orchestration.taskId, failed.id)
    expect(retry.replacedAgentId).toBe(failed.id)
    expect(afterRestart.getOverview(created.orchestration.taskId)?.orchestration.status).toBe(
      "running",
    )
  })

  it("labels estimates without using them as exact cost and enforces honest token/exact-cost stops", () => {
    const service = createAgentOrchestrationService(path)
    const estimated = service.create(
      createInput({ count: 1, stopConditions: { maxCostUsdMicros: 100, maxTotalTokens: 50 } }),
    )
    const agent = estimated.agents[0]!
    let overview = service.reportProgress({
      taskId: estimated.orchestration.taskId,
      agentId: agent.id,
      costUsdMicros: 1_000,
      costQuality: "estimated",
      totalTokens: 25,
    })
    expect(overview.orchestration.status).toBe("running")
    expect(overview.aggregate).toMatchObject({
      exactCostUsdMicros: 0,
      estimatedCostUsdMicros: 1_000,
    })
    overview = service.reportProgress({
      taskId: estimated.orchestration.taskId,
      agentId: agent.id,
      totalTokens: 50,
    })
    expect(overview.orchestration).toMatchObject({ status: "stopped", stopReason: "token-budget" })

    const exactService = createAgentOrchestrationService(path)
    sqlite
      .prepare(
        `INSERT INTO chats (id, name, scope, project_id, permission_mode, harness, worktree_path, branch, initiator_chat_id, ancestor_chat_ids)
         VALUES ('root-2', 'Root 2', 'project', 'project-1', 'full-access', 'codex', ?, 'main', 'root-2', '[]')`,
      )
      .run(projectPath)
    const exact = exactService.create({
      ...createInput({
        count: 1,
        stopConditions: { maxCostUsdMicros: 100, maxTotalTokens: 10_000 },
      }),
      initiatingChatId: "root-2",
      task: { mode: "create" as const, name: "Exact cost task" },
    })
    const exactAgent = exact.agents[0]!
    sqlite
      .prepare(
        `INSERT INTO usage_samples (
          id, provider_id, source, cost_quality, cost_usd_micros, run_id, dedupe_key
        ) VALUES ('usage-1', 'codex', 'flapstack-run', 'provider-reported', 150, ?, 'usage-1')`,
      )
      .run(exactAgent.runId)
    expect(exactService.getOverview(exact.orchestration.taskId)?.orchestration.status).toBe(
      "running",
    )
    sqlite
      .prepare(
        `INSERT INTO usage_samples (
          id, provider_id, source, cost_quality, cost_usd_micros, run_id, dedupe_key
        ) VALUES ('usage-2', 'codex', 'flapstack-run', 'exact', 150, ?, 'usage-2')`,
      )
      .run(exactAgent.runId)
    expect(exactService.getOverview(exact.orchestration.taskId)?.orchestration).toMatchObject({
      status: "stopped",
      stopReason: "exact-cost-budget",
    })
  })

  it("enforces failure/blocker thresholds and rejects cycle, depth, stale identity, and permissions attacks", () => {
    const service = createAgentOrchestrationService(path)
    const blocked = service.create(
      createInput({ count: 1, stopConditions: { maxBlockers: 1, maxFailures: 2 } }),
    )
    const blockedResult = service.reportProgress({
      taskId: blocked.orchestration.taskId,
      agentId: blocked.agents[0]!.id,
      status: "failed",
      blocked: true,
      stopReason: "needs credential",
    })
    expect(blockedResult.orchestration).toMatchObject({
      status: "failed",
      stopReason: "blocker-threshold",
    })

    sqlite
      .prepare(
        `INSERT INTO chats (id, name, scope, project_id, permission_mode, harness, worktree_path, branch, initiator_chat_id, ancestor_chat_ids)
         VALUES ('attack-root', 'Attack', 'project', 'project-1', 'full-access', 'codex', ?, 'main', 'attack-root', '[]')`,
      )
      .run(projectPath)
    const cyclic = {
      ...createInput({ count: 0 }),
      initiatingChatId: "attack-root",
      task: { mode: "create" as const, name: "Attack task" },
      agents: [
        definition("a", { agentId: "a", dependencyAgentIds: ["b"] }),
        definition("b", { agentId: "b", dependencyAgentIds: ["a"] }),
      ],
    }
    expect(() => service.create(cyclic)).toThrow(/cycle/i)
    expect(
      sqlite.prepare("SELECT count(*) count FROM tasks WHERE name = 'Attack task'").get(),
    ).toEqual({ count: 0 })
    expect(() =>
      service.create({
        ...createInput({ count: 1 }),
        initiatingChatId: "missing-chat",
        task: { mode: "create", name: "Stale task" },
      }),
    ).toThrow(/stale/i)
    const malformedCustom = definition("bad", {
      permissionMode: "custom",
      customPermissions: { schemaVersion: 1, shell: true } as never,
    })
    expect(() =>
      service.create({ ...createInput({ count: 0 }), agents: [malformedCustom] }),
    ).toThrow()
  })

  it("keeps concurrent/repeated scheduler drains bounded and never replays completed workers", () => {
    const service = createAgentOrchestrationService(path)
    const created = service.create(createInput({ count: 5, maxParallelAgents: 2 }))
    for (let index = 0; index < 20; index += 1) {
      createAgentOrchestrationService(path).tickAll()
      createAgentOrchestrationService(path).getOverview(created.orchestration.taskId)
    }
    expect(service.getOverview(created.orchestration.taskId)?.aggregate).toMatchObject({
      active: 2,
      queued: 3,
    })
    expect(
      sqlite
        .prepare(
          "SELECT count(*) total, count(DISTINCT chat_id) distinct_chats, count(DISTINCT run_id) distinct_runs FROM orchestration_agents WHERE task_id = ? AND chat_id IS NOT NULL",
        )
        .get(created.orchestration.taskId),
    ).toEqual({ total: 2, distinct_chats: 2, distinct_runs: 2 })

    while (service.getOverview(created.orchestration.taskId)?.orchestration.status === "running") {
      sqlite
        .prepare(
          `UPDATE agent_runs SET status = 'success', completed_at = ?
           WHERE id IN (SELECT run_id FROM orchestration_agents WHERE task_id = ? AND status = 'active')`,
        )
        .run(nowEpochSeconds(), created.orchestration.taskId)
      service.tickAll()
    }
    const beforeRestart = sqlite.prepare("SELECT count(*) count FROM agent_runs").get()
    for (let index = 0; index < 10; index += 1) createAgentOrchestrationService(path).tickAll()
    expect(sqlite.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual(beforeRestart)
    expect(service.getOverview(created.orchestration.taskId)?.aggregate).toMatchObject({
      completed: 5,
      active: 0,
      queued: 0,
    })
  })

  it("enforces wall-clock, failure, progress, and completion stop conditions independently", () => {
    const service = createAgentOrchestrationService(path)
    const wall = service.create(createInput({ count: 1, stopConditions: { maxWallClockMs: 10 } }))
    sqlite
      .prepare("UPDATE task_orchestrations SET started_at = ? WHERE task_id = ?")
      .run(nowEpochSeconds() - 1, wall.orchestration.taskId)
    expect(service.getOverview(wall.orchestration.taskId)?.orchestration).toMatchObject({
      status: "stopped",
      stopReason: "wall-clock-budget",
    })

    seedRoot("failure-root")
    const failure = service.create({
      ...createInput({ count: 2, stopConditions: { maxFailures: 1 } }),
      initiatingChatId: "failure-root",
      task: { mode: "create" as const, name: "Failure threshold" },
    })
    expect(
      service.reportProgress({
        taskId: failure.orchestration.taskId,
        agentId: failure.agents[0]!.id,
        status: "failed",
      }).orchestration,
    ).toMatchObject({ status: "failed", stopReason: "failure-threshold" })

    seedRoot("progress-root")
    const progress = service.create({
      ...createInput({ count: 1, stopConditions: { targetProgressPercent: 50 } }),
      initiatingChatId: "progress-root",
      task: { mode: "create" as const, name: "Progress target" },
    })
    expect(
      service.reportProgress({
        taskId: progress.orchestration.taskId,
        agentId: progress.agents[0]!.id,
        progressPercent: 50,
      }).orchestration,
    ).toMatchObject({ status: "completed", stopReason: "progress-target" })

    seedRoot("completion-root")
    const completion = service.create({
      ...createInput({ count: 2, stopConditions: { targetCompletedAgents: 1 } }),
      initiatingChatId: "completion-root",
      task: { mode: "create" as const, name: "Completion target" },
    })
    sqlite
      .prepare("UPDATE agent_runs SET status = 'success', completed_at = ? WHERE id = ?")
      .run(nowEpochSeconds(), completion.agents[0]!.runId)
    expect(service.getOverview(completion.orchestration.taskId)?.orchestration).toMatchObject({
      status: "completed",
      stopReason: "completion-target",
    })
  })

  it("adds and retries agents without duplicating completed work", () => {
    const service = createAgentOrchestrationService(path)
    const created = service.create(createInput({ count: 2, maxParallelAgents: 1 }))
    const active = created.agents.find((agent) => agent.status === "active")!
    service.reportProgress({
      taskId: created.orchestration.taskId,
      agentId: active.id,
      status: "failed",
    })
    const retry = service.retryAgent(created.orchestration.taskId, active.id)
    expect(retry.replacedAgentId).toBe(active.id)
    const added = service.addAgent({
      taskId: created.orchestration.taskId,
      agent: definition("extra"),
    })
    expect(added.status).toBe("queued")
    expect(service.getOverview(created.orchestration.taskId)?.aggregate.total).toBe(4)

    const currentlyActive = service
      .getOverview(created.orchestration.taskId)!
      .agents.find((agent) => agent.status === "active")!
    sqlite
      .prepare("UPDATE agent_runs SET status = 'success', completed_at = ? WHERE id = ?")
      .run(nowEpochSeconds(), currentlyActive.runId)
    service.tickAll()
    expect(() => service.retryAgent(created.orchestration.taskId, currentlyActive.id)).toThrow(
      /terminal agents|completed/i,
    )
  })

  it("rolls back conflicting attachment and rejects depth, corrupt lineage, provider, and cost spoof attacks", () => {
    const service = createAgentOrchestrationService(path)
    const created = service.create({ ...createInput({ count: 1 }), maxDepth: 1 })
    expect(() =>
      service.addAgent({
        taskId: created.orchestration.taskId,
        parentAgentId: created.agents[0]!.id,
        agent: definition("too-deep"),
      }),
    ).toThrow(/depth/i)
    expect(() =>
      service.reportProgress({
        taskId: created.orchestration.taskId,
        agentId: created.agents[0]!.id,
        costUsdMicros: 100,
        costQuality: "exact" as never,
      }),
    ).toThrow(/estimated/i)

    seedRoot("attach-root")
    expect(() =>
      service.create({
        ...createInput({ count: 1 }),
        initiatingChatId: "attach-root",
        task: { mode: "existing", taskId: created.orchestration.taskId },
      }),
    ).toThrow(/already has/i)
    expect(
      sqlite.prepare("SELECT task_id, scope FROM chats WHERE id = 'attach-root'").get(),
    ).toEqual({
      task_id: null,
      scope: "project",
    })

    seedRoot("same-name-root")
    const sameName = service.create({
      ...createInput({ count: 1 }),
      initiatingChatId: "same-name-root",
    })
    expect(sameName.orchestration.taskId).not.toBe(created.orchestration.taskId)

    seedRoot("duplicate-root")
    sqlite
      .prepare("UPDATE chats SET ancestor_chat_ids = '[\"x\",\"x\"]' WHERE id = 'duplicate-root'")
      .run()
    expect(() =>
      service.create({
        ...createInput({ count: 1 }),
        initiatingChatId: "duplicate-root",
        task: { mode: "create", name: "Duplicate ancestor" },
      }),
    ).toThrow(/duplicate/i)

    seedRoot("cycle-root")
    sqlite
      .prepare(
        `INSERT INTO chats (id, name, scope, project_id, permission_mode, harness, parent_chat_id, initiator_chat_id, ancestor_chat_ids)
         VALUES ('cycle-child', 'Cycle child', 'project', 'project-1', 'full-access', 'claude-code', 'cycle-root', 'cycle-root', '["cycle-root"]')`,
      )
      .run()
    sqlite.prepare("UPDATE chats SET parent_chat_id = 'cycle-child' WHERE id = 'cycle-root'").run()
    expect(() =>
      service.create({
        ...createInput({ count: 1 }),
        initiatingChatId: "cycle-root",
        task: { mode: "create", name: "Parent cycle" },
      }),
    ).toThrow(/cycle/i)
    expect(
      sqlite.prepare("SELECT count(*) count FROM tasks WHERE name = 'Parent cycle'").get(),
    ).toEqual({
      count: 0,
    })

    seedRoot("provider-root")
    expect(() =>
      service.create({
        ...createInput({ count: 0 }),
        initiatingChatId: "provider-root",
        task: { mode: "create", name: "Bad provider" },
        agents: [definition("bad-provider", { provider: "openrouter" })],
      }),
    ).toThrow(/provider/i)

    seedRoot("cross-task-root")
    sqlite
      .prepare(
        "INSERT INTO tasks (id, project_id, name, created_at, updated_at) VALUES ('foreign-task', 'project-1', 'Foreign', ?, ?)",
      )
      .run(nowEpochSeconds(), nowEpochSeconds())
    sqlite
      .prepare(
        `INSERT INTO chats (id, name, scope, project_id, task_id, permission_mode, harness,
          parent_chat_id, initiator_chat_id, ancestor_chat_ids)
         VALUES ('foreign-child', 'Foreign child', 'task', 'project-1', 'foreign-task',
          'full-access', 'codex', 'cross-task-root', 'cross-task-root', '["cross-task-root"]')`,
      )
      .run()
    expect(() =>
      service.create({
        ...createInput({ count: 1 }),
        initiatingChatId: "cross-task-root",
        task: { mode: "create", name: "Conflicting descendants" },
      }),
    ).toThrow(/another task/i)
    expect(
      sqlite
        .prepare("SELECT count(*) count FROM tasks WHERE name = 'Conflicting descendants'")
        .get(),
    ).toEqual({ count: 0 })
  })

  it("requires inherited and attached-branch worktrees to match Git's registry", () => {
    const service = createAgentOrchestrationService(path)
    seedRoot("bad-branch-root")
    sqlite.prepare("UPDATE chats SET branch = 'wrong' WHERE id = 'bad-branch-root'").run()
    expect(() => service.create({ ...createInput(), initiatingChatId: "bad-branch-root" })).toThrow(
      /registered Git branch/i,
    )

    const featurePath = join(directory, "feature-worktree")
    execFileSync("git", ["-C", projectPath, "branch", "feature"])
    execFileSync("git", ["-C", projectPath, "worktree", "add", featurePath, "feature"])
    sqlite
      .prepare(
        `INSERT INTO chats (id, name, scope, project_id, permission_mode, harness,
          worktree_path, branch, initiator_chat_id, ancestor_chat_ids)
         VALUES ('feature-root', 'Feature', 'project', 'project-1', 'full-access', 'codex',
          ?, 'feature', 'feature-root', '[]')`,
      )
      .run(featurePath)
    const attached = service.create({
      ...createInput({ count: 0 }),
      initiatingChatId: "feature-root",
      agents: [
        definition("attached", {
          worktreeStrategy: "attached-branch",
          branch: "feature",
        }),
      ],
    })
    expect(attached.agents[0]).toMatchObject({ status: "active" })
    expect(
      sqlite
        .prepare("SELECT worktree_path FROM chats WHERE id = ?")
        .get(attached.agents[0]!.chatId),
    ).toEqual({ worktree_path: realpathSync(featurePath) })
  })

  it("routes MCP orchestration through Tier 3 approval, audit, and trusted caller identity", async () => {
    const approvals = new McpApprovalLifecycle()
    const statuses: string[] = []
    const resultPromise = invokeMcpControlTool(
      "orchestrate_task",
      { chatId: "root-chat", permissionMode: "full-access" },
      createInput({ count: 2 }),
      undefined,
      {
        approvals,
        approvalId: () => "orchestration-approval",
        mutations: createMcpMutationService(path),
        audit: { append: (record) => statuses.push(record.status) },
      },
    )
    approvals.approve("orchestration-approval")
    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      data: { aggregate: { active: 2 } },
    })
    expect(statuses).toEqual(["approval-required", "allowed", "dispatch-started", "completed"])

    sqlite
      .prepare(
        `INSERT INTO chats (id, name, scope, project_id, permission_mode, harness, worktree_path, branch, initiator_chat_id, ancestor_chat_ids)
         VALUES ('other-chat', 'Other', 'project', 'project-1', 'full-access', 'codex', ?, 'main', 'other-chat', '[]')`,
      )
      .run(projectPath)
    const denied = await createMcpMutationService(path).invoke(
      "orchestrate_task",
      { chatId: "root-chat" },
      {
        ...createInput({ count: 1 }),
        initiatingChatId: "other-chat",
        task: { mode: "create", name: "Spoofed" },
      },
    )
    expect(denied).toMatchObject({ ok: false, error: { code: "stale-caller" } })
    approvals.shutdown()
  })
})

function createInput(
  options: {
    count?: number
    maxParallelAgents?: number
    stopConditions?: Record<string, number>
  } = {},
) {
  return {
    projectId: "project-1",
    task: { mode: "create" as const, name: "Finish Stage 4" },
    initiatingChatId: "root-chat",
    maxParallelAgents: options.maxParallelAgents ?? 2,
    maxDepth: 4,
    stopConditions: options.stopConditions ?? {},
    agents: Array.from({ length: options.count ?? 1 }, (_, index) => definition(`worker-${index}`)),
  }
}

function seedRoot(id: string): void {
  sqlite
    .prepare(
      `INSERT INTO chats (
        id, name, scope, project_id, permission_mode, harness, worktree_path,
        branch, initiator_chat_id, ancestor_chat_ids
      ) VALUES (?, ?, 'project', 'project-1', 'full-access', 'codex',
        ?, 'main', ?, '[]')`,
    )
    .run(id, id, projectPath, id)
}

function definition(role: string, overrides: Partial<ReturnType<typeof definitionBase>> = {}) {
  return { ...definitionBase(role), ...overrides }
}

function definitionBase(role: string) {
  return {
    role,
    name: role,
    prompt: `Do ${role}`,
    harness: role.includes("review") ? ("claude-code" as const) : ("codex" as const),
    model: "test-model",
    reasoningEffort: "high" as const,
    permissionMode: "full-access" as const,
    worktreeStrategy: "inherit" as const,
    dependencyAgentIds: [] as string[],
    completionCriteria: `${role} complete`,
  }
}
