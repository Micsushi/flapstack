import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createOrchestrationOperationsService,
  OrchestrationOperationsError,
  policyApprovalAuthority,
  templateLaunchAuthority,
} from "../src/main/lib/agent-orchestration/operations-config"
import {
  approvalContextHash,
  POLICY_APPROVAL_TOOL,
  TEMPLATE_LAUNCH_APPROVAL_TOOL,
} from "../src/main/lib/agent-orchestration/approval-authority"
import { WorkflowEngine } from "../src/main/lib/agent-orchestration/workflow-engine"
import { createCodexCoordinationAdapter } from "../src/main/lib/agent-orchestration/codex-engines"
import { CascadeControlService } from "../src/main/lib/agent-orchestration/cascade-control"
import { createAgentOrchestrationService } from "../src/main/lib/agent-orchestration/service"
import {
  OrchestrationActivityProjectionService,
  recordOrchestrationTransition,
} from "../src/main/lib/agent-orchestration/activity-projection"
import type { RuntimeLaunchCoordinatorPort } from "../src/main/lib/agent-orchestration/runtime-launch-port"
import type { OrchestrationTemplateDefinition } from "../src/shared/orchestration-operations"
import type { CoordinationEngineContext } from "../src/shared/coordination-engine"
import * as schema from "../src/main/lib/db/schema"
import { testCoordinationEngineSnapshotSqlValues } from "./coordination-engine-test-db"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"

let directory = ""
let databasePath = ""

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "flapstack-orchestration-operations-"))
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
    "INSERT INTO task_orchestrations (task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions, engine_snapshot_version, coordination_engine, coordination_engine_version, coordination_engine_source, coordination_engine_capability_snapshot, coordination_engine_provider_identity, created_at, updated_at) VALUES ('task-1','chat-1','queued',2,4,'{}',?,?,?,?,?,?,1,1)",
  ).run(...testCoordinationEngineSnapshotSqlValues())
  db.close()
})

afterEach(() => rmSync(directory, { recursive: true, force: true }))

describe("multi-agent operations configuration", () => {
  it("versions policy, requires approval for authority increases, and detects stale writes", () => {
    const service = createOrchestrationOperationsService(databasePath)
    const initial = service.getPolicy("task-1")
    expect(initial.version).toBe(1)
    const tighter = service.updatePolicy({
      taskId: "task-1",
      expectedVersion: 1,
      policy: { ...initial.policy, maxParallelAgents: 1 },
    })
    expect(tighter).toMatchObject({ version: 2, changeKind: "tighten" })
    expect(
      service.previewPolicy({
        taskId: "task-1",
        expectedVersion: 2,
        policy: { ...initial.policy, maxParallelAgents: 4 },
      }),
    ).toMatchObject({ changeKind: "relax", approvalRequired: true })
    expect(() =>
      service.updatePolicy({
        taskId: "task-1",
        expectedVersion: 2,
        policy: { ...initial.policy, maxParallelAgents: 4 },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<OrchestrationOperationsError>>({ code: "approval-required" }),
    )
    const relaxation = {
      taskId: "task-1",
      expectedVersion: 2,
      policy: { ...initial.policy, maxParallelAgents: 4 },
    }
    expect(() => service.updatePolicy(relaxation, "fake-audit")).toThrowError(
      expect.objectContaining<Partial<OrchestrationOperationsError>>({ code: "invalid-approval" }),
    )
    seedAuthorityApproval("audit-1", policyApprovalAuthority(relaxation, "relax"))
    expect(service.updatePolicy(relaxation, "audit-1")).toMatchObject({
      version: 3,
      approvalAuditId: "audit-1",
    })
    expect(() =>
      service.updatePolicy({ taskId: "task-1", expectedVersion: 2, policy: initial.policy }),
    ).toThrowError(
      expect.objectContaining<Partial<OrchestrationOperationsError>>({ code: "version-conflict" }),
    )
    const db = new Database(databasePath)
    expect(
      db
        .prepare(
          "SELECT max_parallel_agents, policy_version FROM task_orchestrations WHERE task_id = 'task-1'",
        )
        .get(),
    ).toEqual({ max_parallel_agents: 4, policy_version: 3 })
    expect(() =>
      db
        .prepare("UPDATE orchestration_policy_versions SET version = 99 WHERE task_id = 'task-1'")
        .run(),
    ).toThrow(/append-only/i)
    expect(() =>
      db.prepare("DELETE FROM orchestration_policy_versions WHERE task_id = 'task-1'").run(),
    ).toThrow(/append-only/i)
    db.close()
  })

  it("stores redacted versioned templates and rejects live authority", () => {
    const service = createOrchestrationOperationsService(databasePath)
    const created = service.createTemplate({ name: "Review", definition: template() })
    expect(service.listTemplates()).toMatchObject([{ id: created.id, version: 1 }])
    expect(
      service.updateTemplate({
        id: created.id,
        expectedVersion: 1,
        name: "Review v2",
        definition: template(),
      }),
    ).toMatchObject({ version: 2 })
    expect(() =>
      service.updateTemplate({
        id: created.id,
        expectedVersion: 1,
        name: "Stale",
        definition: template(),
      }),
    ).toThrowError(/stale/i)
    expect(() =>
      service.createTemplate({ name: "Unsafe", definition: { ...template(), api_key: "secret" } }),
    ).toThrow()
    for (const [field, secret] of [
      ["prompt", "authorization=super-secret-value"],
      ["spec", "Bearer eyJhbGciOiJIUzI1NiJ9.secret"],
      ["completionCriteria", "token: ghp_012345678901234567890123456789"],
      ["model", "sk-proj-012345678901234567890123"],
      ["worktreePath", "/tmp/project/.ssh/id_ed25519"],
    ] as const) {
      const unsafe = template()
      unsafe.agents[0] = {
        ...unsafe.agents[0]!,
        [field]: secret,
        ...(field === "worktreePath" ? { worktreeStrategy: "existing" as const } : {}),
      }
      expect(() => service.createTemplate({ name: `Unsafe ${field}`, definition: unsafe })).toThrow(
        /Template contains/i,
      )
    }
    expect(service.previewTemplate(template())).toMatchObject({
      engine: "workflow",
      requiresRuntimeProbe: true,
      agents: [{ runtimePreference: "codex" }],
    })
    const launchDefinition = template()
    launchDefinition.policy.maxTotalTokens = 10_000
    const launchAuthority = templateLaunchAuthority("task-1", launchDefinition, 1)
    expect(() =>
      service.verifyTemplateLaunchApproval("task-1", launchDefinition, null),
    ).toThrowError(
      expect.objectContaining<Partial<OrchestrationOperationsError>>({ code: "approval-required" }),
    )
    expect(() =>
      service.verifyTemplateLaunchApproval("task-1", launchDefinition, "fake-audit"),
    ).toThrowError(
      expect.objectContaining<Partial<OrchestrationOperationsError>>({ code: "invalid-approval" }),
    )
    seedAuthorityApproval("template-audit", launchAuthority, TEMPLATE_LAUNCH_APPROVAL_TOOL)
    expect(
      service.verifyTemplateLaunchApproval("task-1", launchDefinition, "template-audit"),
    ).toEqual({ approvalRequired: true, auditId: "template-audit" })
    new WorkflowEngine(databasePath, {
      reserve: vi.fn(async (request) => ({
        orchestrationAgentId: `agent-${request.runId}`,
        agentDefinitionId: request.agentDefinitionId,
      })),
      launch: vi.fn(),
      reconcile: vi.fn(),
      cancel: vi.fn(),
    }).start("task-1", launchDefinition, "template-audit")
    expect(() =>
      service.verifyTemplateLaunchApproval("task-1", launchDefinition, "template-audit"),
    ).toThrowError(
      expect.objectContaining<Partial<OrchestrationOperationsError>>({ code: "invalid-approval" }),
    )
    expect(service.archiveTemplate({ id: created.id, expectedVersion: 2 })).toMatchObject({
      id: created.id,
      version: 3,
    })
    expect(service.listTemplates()).toEqual([])
  })

  it("keeps orchestration tables available after later migrations", () => {
    const db = new Database(databasePath)
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string
      }>
    ).map((row) => row.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "coordination_engine_defaults",
        "orchestration_templates",
        "orchestration_workflow_runs",
        "coordination_action_intents",
      ]),
    )
    db.close()
  })
})

describe("coordination engines", () => {
  it("runs deterministic checkpoints through the F11 coordinator without selecting adapters", async () => {
    const launch = vi.fn(
      async (request: Parameters<RuntimeLaunchCoordinatorPort["launch"]>[0]) => ({
        runId: request.runId,
        chatId: request.chatId,
        subChatId: request.subChatId,
        lifecycleState: "completed" as const,
        activityReference: { runId: request.runId, afterSequence: 0 },
      }),
    )
    const coordinator: RuntimeLaunchCoordinatorPort = {
      reserve: vi.fn(async (request) => ({
        orchestrationAgentId: `agent-${request.runId}`,
        agentDefinitionId: request.agentDefinitionId,
      })),
      launch,
      reconcile: vi.fn(),
      cancel: vi.fn(),
    }
    const engine = new WorkflowEngine(databasePath, coordinator)
    const run = engine.start("task-1", template())
    await engine.advance(run.id, {
      worker: {
        runId: "run-1",
        chatId: "chat-1",
        subChatId: "sub-run-1",
      },
    })
    const complete = await engine.advance(run.id, {
      worker: {
        runId: "run-1",
        chatId: "chat-1",
        subChatId: "sub-run-1",
      },
    })
    expect(complete.status).toBe("completed")
    expect(launch).toHaveBeenCalledTimes(1)
    expect(
      complete.checkpoints.find((checkpoint) => checkpoint.stepId === "worker")?.output,
    ).toMatchObject({ lifecycle: "completed", activityReference: { runId: "run-1" } })
  })

  it("reconciles durable running checkpoints without relaunch and rejects cyclic graphs", async () => {
    const launch = vi.fn(
      async (request: Parameters<RuntimeLaunchCoordinatorPort["launch"]>[0]) => ({
        runId: request.runId,
        chatId: request.chatId,
        subChatId: request.subChatId,
        lifecycleState: "running" as const,
        activityReference: { runId: request.runId, afterSequence: 2 },
      }),
    )
    const reconcile = vi.fn(async (runId: string) => ({
      runId,
      chatId: "chat-1",
      subChatId: `sub-${runId}`,
      lifecycleState: "completed" as const,
      activityReference: { runId, afterSequence: 4 },
    }))
    const engine = new WorkflowEngine(databasePath, {
      reserve: vi.fn(async (request) => ({
        orchestrationAgentId: `agent-${request.runId}`,
        agentDefinitionId: request.agentDefinitionId,
      })),
      launch,
      reconcile,
      cancel: vi.fn(),
    })
    const run = engine.start("task-1", template())
    expect(
      await engine.advance(run.id, {
        worker: {
          runId: "run-1",
          chatId: "chat-1",
          subChatId: "sub-run-1",
        },
      }),
    ).toMatchObject({ status: "running" })
    expect(await engine.advance(run.id, {})).toMatchObject({ status: "completed" })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledTimes(1)

    const cyclic = template()
    cyclic.workflow.steps[0]!.dependsOn = ["barrier"]
    expect(() => engine.preview(cyclic)).toThrow(/cycle/i)
  })

  it("persists Codex intent before dispatch and refuses uncertain replay", async () => {
    configureDurableEngine("codex-v2")
    seedActiveAgent("agent-1", "run-1")
    const sourceDb = new Database(databasePath)
    recordOrchestrationTransition(sourceDb, {
      dedupKey: "agent:agent-1:spawn:1",
      taskId: "task-1",
      entityType: "agent",
      entityId: "agent-1",
      agentId: "agent-1",
      runId: "run-1",
      kind: "spawn",
      phase: "active",
      createdAt: 1,
    })
    sourceDb.close()
    const client = {
      probe: vi.fn(async () => coordinationProbe("codex-v2")),
      dispatch: vi.fn(async () => {
        const db = new Database(databasePath)
        const row = db.prepare("SELECT state FROM coordination_action_intents").get() as {
          state: string
        }
        db.close()
        expect(row.state).toBe("dispatching")
        throw new Error("connection lost")
      }),
      reconcile: vi.fn(async () => ({ state: "completed" as const, result: { ok: true } })),
    }
    const adapter = createCodexCoordinationAdapter(databasePath, "codex-v2", client)
    const context = coordinationContext("codex-v2")
    const action = {
      schemaVersion: 1 as const,
      kind: "send" as const,
      orchestrationId: "task-1",
      providerIdentity: context.snapshot.providerIdentity!,
      targetAgentId: "agent-1",
      message: "Status?",
    }
    expect(await adapter.execute(context, action)).toMatchObject({ ok: false, state: "uncertain" })
    expect(await adapter.execute(context, action)).toMatchObject({ ok: false, state: "uncertain" })
    expect(client.dispatch).toHaveBeenCalledTimes(1)
    expect(await adapter.reconcile(context)).toMatchObject({
      ok: true,
      result: { reconciled: 1 },
    })
    expect(client.reconcile).toHaveBeenCalledTimes(1)
    expect(client.dispatch).toHaveBeenCalledTimes(1)
    const db = new Database(databasePath)
    expect(db.prepare("SELECT kind, state, body FROM orchestration_messages").get()).toEqual({
      kind: "message",
      state: "delivered",
      body: "Status?",
    })
    db.close()
    expect(createAgentOrchestrationService(databasePath).getLineage("task-1")).toMatchObject({
      engine: { providerIdentity: context.snapshot.providerIdentity },
      nodes: [
        {
          agentId: "agent-1",
          controls: {
            send: { enabled: true },
            followUp: { enabled: true },
            interrupt: { enabled: true },
          },
        },
      ],
    })
  })

  it("keeps Codex V1 ID-based and permits final wait without V2 follow-up", async () => {
    configureDurableEngine("codex-v1")
    const context = coordinationContext("codex-v1")
    const client = {
      probe: vi.fn(async () => coordinationProbe("codex-v1")),
      dispatch: vi.fn(async () => ({
        state: "completed" as const,
        providerIdentity: context.snapshot.providerIdentity,
        result: {},
      })),
      reconcile: vi.fn(),
    }
    const adapter = createCodexCoordinationAdapter(databasePath, "codex-v1", client)
    await expect(
      adapter.execute(context, {
        schemaVersion: 1,
        kind: "wait",
        orchestrationId: "task-1",
        providerIdentity: context.snapshot.providerIdentity!,
        targetAgentIds: ["agent-1"],
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({ ok: true, state: "completed" })
    await expect(
      adapter.execute(context, {
        schemaVersion: 1,
        kind: "follow-up",
        orchestrationId: "task-1",
        providerIdentity: context.snapshot.providerIdentity!,
        targetAgentId: "agent-1",
        message: "Again",
      }),
    ).rejects.toThrow(/does not support V2 follow-up/i)
  })

  it("records stop intent before runtime cancellation, survives partial failure, and never launches", async () => {
    seedActiveAgent("agent-1", "run-1")
    let cancellationAttempt = 0
    const cancel = vi.fn(async () => {
      const db = new Database(databasePath)
      expect(
        (
          db.prepare("SELECT status FROM task_orchestrations WHERE task_id = 'task-1'").get() as {
            status: string
          }
        ).status,
      ).toBe("stopped")
      db.close()
      cancellationAttempt += 1
      if (cancellationAttempt === 1) throw new Error("provider offline")
      return {
        runId: "run-1",
        chatId: "chat-1",
        subChatId: "sub-run-1",
        lifecycleState: "completed" as const,
        activityReference: null,
      }
    })
    const control = new CascadeControlService(databasePath, {
      reserve: vi.fn(),
      launch: vi.fn(),
      reconcile: vi.fn(),
      cancel,
    })
    const request = control.request("task-1", "stop")
    expect(request.preview.agents).toMatchObject([{ agentId: "agent-1", runId: "run-1" }])
    expect(await control.reconcile(request.intentId)).toMatchObject({ state: "partial" })
    expect(control.pendingIntents()).toEqual([request.intentId])
    expect(await control.reconcile(request.intentId)).toMatchObject({ state: "completed" })
    expect(control.pendingIntents()).toEqual([])
    expect(cancel).toHaveBeenCalledTimes(2)
  })

  it("rebuilds reference-only group activity without copying provider text", () => {
    seedActiveAgent("agent-1", "run-1")
    const sourceDb = new Database(databasePath)
    recordOrchestrationTransition(sourceDb, {
      dedupKey: "agent:agent-1:spawn:activity-test",
      taskId: "task-1",
      entityType: "agent",
      entityId: "agent-1",
      agentId: "agent-1",
      runId: "run-1",
      kind: "spawn",
      phase: "active",
      createdAt: 1,
    })
    sourceDb.close()
    const projection = new OrchestrationActivityProjectionService(databasePath)
    expect(projection.rebuild("task-1")).toBeGreaterThan(0)
    const beforeRestart = projection.list("task-1")
    expect(projection.rebuild("task-1")).toBeGreaterThan(0)
    expect(projection.list("task-1")).toEqual(beforeRestart)
    const id = projection.recordActivitySummary("task-1", "One worker is active.")
    const rows = projection.list("task-1") as Array<Record<string, unknown>>
    expect(rows.find((row) => row.id === id)?.summary).toBe(
      "Activity summary: One worker is active.",
    )
    expect(
      rows.every(
        (row) => row.summary === null || String(row.summary).startsWith("Activity summary:"),
      ),
    ).toBe(true)
    expect(projection.list("task-1", { agentId: "agent-1", phase: "active" })).toHaveLength(1)
  })
})

function template(): OrchestrationTemplateDefinition {
  return {
    schemaVersion: 1,
    engine: "workflow",
    agents: [
      {
        definitionId: "reviewer-definition",
        role: "Reviewer",
        prompt: "Review",
        harness: "codex",
        runtimePreference: "codex",
        permissionMode: "read-only",
        worktreeStrategy: "none",
        dependencyAgentIds: [],
        completionCriteria: "Report",
      },
    ],
    policy: {
      maxParallelAgents: 2,
      maxDepth: 4,
      maxTotalAgents: 8,
      maxTotalTokens: null,
      maxCostUsdMicros: null,
      allowSpawn: true,
    },
    workflow: {
      schemaVersion: 1,
      steps: [
        workflowStep("worker", "agent"),
        workflowStep("barrier", "barrier", { dependsOn: ["worker"] }),
      ],
    },
    presentationStyle: null,
  }
}
function workflowStep(
  id: string,
  kind: OrchestrationTemplateDefinition["workflow"]["steps"][number]["kind"],
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    kind,
    agentDefinitionId: ["agent", "synthesis"].includes(kind) ? "reviewer-definition" : null,
    dependsOn: [],
    childStepIds: [],
    condition: null,
    thenStepIds: [],
    elseStepIds: [],
    bodyStepIds: [],
    maxIterations: 1,
    timeoutMs: null,
    maxRetries: 0,
    outputSchema: null,
    ...overrides,
  }
}
function coordinationContext(engine: "codex-v2" | "codex-v1"): CoordinationEngineContext {
  return {
    orchestrationId: "task-1",
    signal: new AbortController().signal,
    snapshot: {
      schemaVersion: 1,
      requestedEngine: engine,
      source: "per-launch",
      engine,
      engineVersion: engine === "codex-v2" ? "codex-v2-v1" : "codex-v1-v1",
      capabilities: {
        schemaVersion: 1,
        engine,
        engineVersion: engine === "codex-v2" ? "codex-v2-v1" : "codex-v1-v1",
        status: "available",
        capturedAt: new Date().toISOString(),
        capabilities:
          engine === "codex-v2"
            ? [
                "named-task-paths",
                "selective-context-fork",
                "queued-messages",
                "follow-up",
                "mailbox",
                "interrupt-without-destroy",
                "resident-workers",
              ]
            : ["legacy-agent-ids", "legacy-resume", "legacy-close"],
        limitations: [],
        unavailableReason: null,
      },
      providerIdentity:
        engine === "codex-v2"
          ? {
              schemaVersion: 1,
              engine,
              canonicalTaskPath: "/root/worker",
              taskName: "worker",
              providerTaskId: null,
            }
          : { schemaVersion: 1, engine, providerAgentId: "agent-1", nickname: null },
    },
  }
}
function coordinationProbe(engine: "codex-v2" | "codex-v1") {
  const context = coordinationContext(engine)
  return {
    engine,
    available: true,
    engineVersion: context.snapshot.engineVersion,
    snapshot: context.snapshot.capabilities,
    reason: null,
  }
}
function configureDurableEngine(engine: "codex-v2" | "codex-v1") {
  const snapshot = coordinationContext(engine).snapshot
  const db = new Database(databasePath)
  db.prepare("DELETE FROM task_orchestrations WHERE task_id = 'task-1'").run()
  db.prepare(
    `INSERT INTO task_orchestrations
     (task_id, initiating_chat_id, status, max_parallel_agents, max_depth, stop_conditions,
      engine_snapshot_version, coordination_engine, coordination_engine_version,
      coordination_engine_source, coordination_engine_capability_snapshot,
      coordination_engine_provider_identity, created_at, updated_at)
     VALUES ('task-1','chat-1','queued',2,4,'{}',1,?,?,?,?,?,1,1)`,
  ).run(
    snapshot.engine,
    snapshot.engineVersion,
    snapshot.source,
    JSON.stringify(snapshot.capabilities),
    JSON.stringify(null),
  )
  db.close()
}
function seedActiveAgent(agentId: string, runId: string) {
  const db = new Database(databasePath)
  db.prepare(
    "INSERT INTO agent_runs (id, chat_id, harness, model, permission_mode, status, runtime_snapshot_version, runtime_preference, runtime_preference_source, resolved_runtime, runtime_adapter_version, runtime_protocol_version, runtime_capability_snapshot, runtime_control_snapshot) VALUES (?, 'chat-1', 'codex', 'gpt', 'read-only', 'running', ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(runId, ...testRuntimeSnapshotSqlValues())
  db.prepare(
    "INSERT INTO orchestration_agents (id, task_id, run_id, depth, definition, dependency_agent_ids, status, queued_at, updated_at) VALUES (?, 'task-1', ?, 1, ?, '[]', 'active', 1, 1)",
  ).run(
    agentId,
    runId,
    JSON.stringify({
      role: "Worker",
      prompt: "Work",
      harness: "codex",
      runtimePreference: "codex",
      permissionMode: "read-only",
      worktreeStrategy: "none",
      dependencyAgentIds: [],
      completionCriteria: "Done",
    }),
  )
  db.close()
}

function seedAuthorityApproval(
  auditId: string,
  authority: unknown,
  toolName:
    typeof POLICY_APPROVAL_TOOL | typeof TEMPLATE_LAUNCH_APPROVAL_TOOL = POLICY_APPROVAL_TOOL,
) {
  const db = new Database(databasePath)
  const invocationId = `invocation-${auditId}`
  const contextHash = approvalContextHash({
    toolName,
    callerChatId: "chat-1",
    callerRunId: null,
    authority,
  })
  db.prepare(
    `INSERT INTO mcp_approval_requests
     (id, invocation_id, caller_chat_id, caller_run_id, tool_name, tier, target_summary,
      input_summary, decision, grant_session, created_at, expires_at)
     VALUES (?, ?, 'chat-1', NULL, ?, 3, 'orchestration policy', ?, 'approve', 0, 1, 9999999999)`,
  ).run(invocationId, invocationId, toolName, JSON.stringify({ contextHash }))
  db.prepare(
    `INSERT INTO mcp_audit_records
     (id, invocation_id, status, caller_chat_id, caller_run_id, tool_name, tier,
      caller_snapshot, chat_snapshot, run_snapshot, input_summary, result_summary,
      duration_ms, created_at)
     VALUES (?, ?, 'completed', 'chat-1', NULL, ?, 3, '{}', '{}', '{}', '{}', '{}', 0, 1)`,
  ).run(auditId, invocationId, toolName)
  db.close()
}
