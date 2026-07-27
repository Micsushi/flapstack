import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkflowEngine } from "../src/main/lib/agent-orchestration/workflow-engine"
import { templateLaunchAuthority } from "../src/main/lib/agent-orchestration/operations-config"
import {
  approvalContextHash,
  TEMPLATE_LAUNCH_APPROVAL_TOOL,
} from "../src/main/lib/agent-orchestration/approval-authority"
import { createAgentOrchestrationService } from "../src/main/lib/agent-orchestration/service"
import {
  CascadeControlService,
  redactProviderError,
} from "../src/main/lib/agent-orchestration/cascade-control"
import {
  canonicalJson,
  createCodexCoordinationAdapter,
} from "../src/main/lib/agent-orchestration/codex-engines"
import {
  OrchestrationActivityProjectionService,
  redactActivitySummary,
} from "../src/main/lib/agent-orchestration/activity-projection"
import {
  createMainRuntimeLaunchPort,
  type MainRuntimeLaunchServicePort,
  type RuntimeLaunchCoordinatorPort,
  type RuntimeReconciliationState,
} from "../src/main/lib/agent-orchestration/runtime-launch-port"
import {
  advancePendingWorkflows,
  clearOrchestrationOperationsRuntime,
  getWorkflowEngine,
  getRegisteredCoordinationEngineProbes,
  recoverOrchestrationOperations,
  registerCodexCoordinationClients,
  registerMainRuntimeOperations,
  registerOrchestrationOperationsRuntime,
  registerWorkflowAgentMaterializer,
} from "../src/main/lib/agent-orchestration/operations-runtime"
import {
  createCodexAppServerCoordinationClient,
  type CodexAppServerCoordinationTransportPort,
} from "../src/main/lib/agent-orchestration/codex-app-server-coordination"
import type { OrchestrationTemplateDefinition } from "../src/shared/orchestration-operations"
import type { OrchestrationAgentDefinition } from "../src/shared/agent-orchestration"
import type {
  CoordinationEngineAction,
  CoordinationEngineContext,
} from "../src/shared/coordination-engine"
import * as schema from "../src/main/lib/db/schema"
import { testCoordinationEngineSnapshotSqlValues } from "./coordination-engine-test-db"
import { testRuntimeSnapshotSqlValues } from "./agent-runtime-test-db"
import { drainPendingMcpRuns } from "../src/main/lib/run-launch-service"

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

describe("production wiring", () => {
  it("fails closed before F11 registration and runs startup recovery after registration", async () => {
    expect(() => getWorkflowEngine(databasePath)).toThrow(/F11 RuntimeLaunchCoordinator/)
    registerOrchestrationOperationsRuntime({ runtime: runtime() })
    expect(getWorkflowEngine(databasePath)).toBeInstanceOf(WorkflowEngine)
    await expect(recoverOrchestrationOperations(databasePath)).resolves.toEqual({
      rebuiltTasks: 1,
      reconciledControls: 0,
      runtime: true,
    })
  })

  it("binds the reviewed F11 singleton through durable identity and activity references", async () => {
    const identity = seedPendingRuntimeRun("bridge-run")
    let state: RuntimeReconciliationState = "running"
    const service: MainRuntimeLaunchServicePort = {
      launch: vi.fn(async () => undefined),
      reconcileRun: vi.fn(async () => state),
      cancel: vi.fn(async () => {
        state = "cancelled"
        return true
      }),
    }
    registerMainRuntimeOperations(databasePath, service)
    const port = createMainRuntimeLaunchPort(databasePath, service)
    const ownership = { workflowRunId: "bridge-workflow", stepId: "worker", attemptCount: 1 }
    await port.reserve(identity, ownership)
    const launched = await port.launch(identity, ownership)
    expect(launched).toMatchObject({
      runId: identity.runId,
      chatId: identity.chatId,
      subChatId: identity.subChatId,
      lifecycleState: "running",
    })
    expect(service.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: identity.runId,
        chatId: identity.chatId,
        subChatId: identity.subChatId,
        prompt: "Durable worker prompt",
        permissionMode: "read-only",
        projectPath: "/tmp/project",
        outputSchema: null,
        runtimeLaunch: expect.objectContaining({
          requestedPreference: "codex",
          resolvedRuntime: "codex",
        }),
      }),
    )
    expect(getWorkflowEngine(databasePath)).toBeInstanceOf(WorkflowEngine)

    const db = new Database(databasePath)
    expect(db.prepare("SELECT status FROM agent_runs WHERE id = ?").get(identity.runId)).toEqual({
      status: "running",
    })
    db.prepare(
      `INSERT INTO agent_activity_events
       (event_id, run_id, chat_id, sub_chat_id, runtime, harness, provider, sequence,
        kind, phase, display_class, privacy_class, redaction_state, payload_json,
        received_at, created_at)
       VALUES ('bridge-event', ?, ?, ?, 'codex', 'codex', 'runtime', 7,
        'lifecycle', 'started', 'status', 'public', 'none', '{}', 1, 1)`,
    ).run(identity.runId, identity.chatId, identity.subChatId)
    db.close()
    expect(await port.cancel(identity.runId, "workflow-stop")).toMatchObject({
      lifecycleState: "cancelled",
      activityReference: { runId: identity.runId, afterSequence: 7 },
    })
  })

  it("advances queued workflows through the registered production Runtime", async () => {
    const coordinator = runtime()
    registerOrchestrationOperationsRuntime({ runtime: coordinator })
    const engine = getWorkflowEngine(databasePath)
    const run = engine.start("task-1", baseDefinition([step("worker", "agent")]))
    await expect(advancePendingWorkflows(databasePath)).resolves.toEqual({
      attempted: 1,
      failed: 0,
      runtime: true,
    })
    expect(engine.get(run.id).status).toBe("completed")
    expect(coordinator.launch).toHaveBeenCalledTimes(1)
  })

  it("reads structured output only from the durable F11 activity projection", async () => {
    const identity = {
      ...seedPendingRuntimeRun("structured-bridge-run"),
      outputSchema: { type: "object", required: ["result"] },
    }
    const service: MainRuntimeLaunchServicePort = {
      launch: vi.fn(async () => undefined),
      reconcileRun: vi.fn(async () => "completed"),
      cancel: vi.fn(async () => true),
    }
    const port = createMainRuntimeLaunchPort(databasePath, service)
    await port.reserve(identity, {
      workflowRunId: "structured-workflow",
      stepId: "structured",
      attemptCount: 1,
    })
    const db = new Database(databasePath)
    db.prepare("UPDATE agent_runs SET status = 'success', completed_at = 2 WHERE id = ?").run(
      identity.runId,
    )
    db.prepare(
      `INSERT INTO agent_activity_events
       (event_id, run_id, chat_id, sub_chat_id, runtime, harness, provider, sequence,
        kind, phase, display_class, privacy_class, redaction_state, payload_json,
        received_at, created_at)
       VALUES ('structured-bridge-event', ?, ?, ?, 'codex', 'codex', 'runtime', 8,
        'agent-text', 'completed', 'summary', 'public', 'none', ?, 2, 2)`,
    ).run(
      identity.runId,
      identity.chatId,
      identity.subChatId,
      JSON.stringify({ text: JSON.stringify({ result: "ok" }) }),
    )
    db.close()

    await expect(port.readStructuredOutput?.(identity.runId)).resolves.toEqual({
      value: { result: "ok" },
      activityReference: {
        runId: identity.runId,
        eventId: "structured-bridge-event",
        sequence: 8,
      },
    })
  })

  it("registers capability-gated Codex clients without changing Runtime ownership", async () => {
    const coordinator = runtime()
    registerOrchestrationOperationsRuntime({ runtime: coordinator })
    const client = {
      probe: vi.fn(
        async () =>
          context().snapshot.capabilities && {
            engine: "codex-v2" as const,
            available: true,
            engineVersion: "codex-v2-v1",
            snapshot: context().snapshot.capabilities,
            reason: null,
          },
      ),
      dispatch: vi.fn(),
      reconcile: vi.fn(),
    }
    registerCodexCoordinationClients(databasePath, { v2: client })
    await expect(getRegisteredCoordinationEngineProbes()).resolves.toMatchObject({
      "codex-v2": { available: true, engineVersion: "codex-v2-v1" },
    })
    expect(getWorkflowEngine(databasePath)).toBeInstanceOf(WorkflowEngine)
  })

  it("rejects missing, mismatched, or corrupt durable Runtime identities before launch", async () => {
    const identity = seedPendingRuntimeRun("identity-run")
    const service: MainRuntimeLaunchServicePort = {
      launch: vi.fn(async () => undefined),
      reconcileRun: vi.fn(async () => "running" as const),
      cancel: vi.fn(async () => false),
    }
    const port = createMainRuntimeLaunchPort(databasePath, service)
    const ownership = { workflowRunId: "identity-workflow", stepId: "worker", attemptCount: 1 }
    await expect(port.reserve({ ...identity, taskId: "wrong-task" }, ownership)).rejects.toThrow(
      /mismatch/,
    )
    await expect(port.reserve({ ...identity, chatId: "wrong-chat" }, ownership)).rejects.toThrow(
      /mismatch/,
    )
    await expect(
      port.reserve({ ...identity, subChatId: "wrong-subchat" }, ownership),
    ).rejects.toThrow(/mismatch/)
    await expect(
      port.reserve({ ...identity, subChatId: null as unknown as string }, ownership),
    ).rejects.toThrow(/run\/chat\/subchat identity/)
    await expect(port.reserve({ ...identity, runId: "missing-run" }, ownership)).rejects.toThrow(
      /missing/,
    )
    expect(service.launch).not.toHaveBeenCalled()
  })

  it("rejects pre-running and terminal historical runs before checkpoint claim", async () => {
    const service: MainRuntimeLaunchServicePort = {
      launch: vi.fn(async () => undefined),
      reconcileRun: vi.fn(async () => "completed" as const),
      cancel: vi.fn(async () => false),
    }
    const engine = new WorkflowEngine(
      databasePath,
      createMainRuntimeLaunchPort(databasePath, service),
    )
    for (const status of ["running", "completed", "failed"] as const) {
      const definition = baseDefinition([step(`worker-${status}`, "agent")])
      const identity = seedPendingRuntimeRun(`historical-${status}`, definition.agents[0]!)
      const db = new Database(databasePath)
      db.prepare("UPDATE agent_runs SET status = ? WHERE id = ?").run(status, identity.runId)
      db.close()
      const run = engine.start("task-1", definition)
      await expect(
        engine.advance(run.id, { [step(`worker-${status}`, "agent").id]: identity }),
      ).rejects.toThrow(/fresh pending Runtime run/)
      expect(engine.get(run.id).checkpoints[0]).toMatchObject({
        status: "pending",
        attemptCount: 0,
        output: null,
      })
    }
    expect(service.launch).not.toHaveBeenCalled()
  })

  it("lets one concurrent workflow own a pending run and leaves the loser unclaimed", async () => {
    const definition = baseDefinition([step("worker", "agent")])
    const identity = seedPendingRuntimeRun("concurrent-claim-run", definition.agents[0]!)
    const service: MainRuntimeLaunchServicePort = {
      launch: vi.fn(async () => undefined),
      reconcileRun: vi.fn(async () => "completed" as const),
      cancel: vi.fn(async () => false),
    }
    const engine = new WorkflowEngine(
      databasePath,
      createMainRuntimeLaunchPort(databasePath, service),
    )
    const first = engine.start("task-1", definition)
    const second = engine.start("task-1", definition)
    const settled = await Promise.allSettled([
      engine.advance(first.id, { worker: identity }),
      engine.advance(second.id, { worker: identity }),
    ])
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1)
    const checkpoints = [engine.get(first.id), engine.get(second.id)].map(
      (run) => run.checkpoints[0]!,
    )
    expect(checkpoints.filter((checkpoint) => checkpoint.status === "completed")).toHaveLength(1)
    expect(checkpoints.filter((checkpoint) => checkpoint.status === "pending")).toEqual([
      expect.objectContaining({ attemptCount: 0, output: null }),
    ])
    expect(service.launch).toHaveBeenCalledTimes(1)
  })

  it("allows only one fresh run reservation for concurrent advances of one checkpoint attempt", async () => {
    const definition = baseDefinition([step("worker", "agent")])
    const firstIdentity = seedPendingRuntimeRun("same-checkpoint-first", definition.agents[0]!)
    const secondIdentity = seedPendingRuntimeRun("same-checkpoint-second", definition.agents[0]!)
    const service: MainRuntimeLaunchServicePort = {
      launch: vi.fn(async () => undefined),
      reconcileRun: vi.fn(async () => "completed" as const),
      cancel: vi.fn(async () => false),
    }
    const engine = new WorkflowEngine(
      databasePath,
      createMainRuntimeLaunchPort(databasePath, service),
    )
    const run = engine.start("task-1", definition)
    const settled = await Promise.allSettled([
      engine.advance(run.id, { worker: firstIdentity }),
      engine.advance(run.id, { worker: secondIdentity }),
    ])
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect(engine.get(run.id).checkpoints[0]).toMatchObject({
      status: "completed",
      attemptCount: 1,
    })
    const db = new Database(databasePath)
    const runtimeRows = db
      .prepare("SELECT id, status FROM agent_runs WHERE id IN (?, ?) ORDER BY id")
      .all(firstIdentity.runId, secondIdentity.runId) as Array<{ id: string; status: string }>
    expect(runtimeRows.map((row) => row.status).sort()).toEqual(["pending", "running"])
    const winner = runtimeRows.find((row) => row.status === "running")!
    const loser = runtimeRows.find((row) => row.status === "pending")!
    expect(
      db
        .prepare("SELECT run_id, agent_id FROM orchestration_transition_events WHERE dedup_key = ?")
        .get(`workflow-checkpoint-attempt-binding:${run.id}:worker:1`),
    ).toEqual({ run_id: winner.id, agent_id: `agent-${winner.id}` })
    expect(
      db
        .prepare(
          "SELECT count(*) count FROM orchestration_transition_events WHERE dedup_key IN (?, ?)",
        )
        .get(
          `workflow-runtime-run-binding:${loser.id}`,
          `workflow-orchestration-agent-binding:agent-${loser.id}`,
        ),
    ).toEqual({ count: 0 })
    db.close()
    expect(service.launch).toHaveBeenCalledTimes(1)
    expect(service.launch).toHaveBeenCalledWith(expect.objectContaining({ runId: winner.id }))
  })

  it("binds a worker checkpoint to the exact durable agent definition and identity", async () => {
    const definition = baseDefinition([step("worker", "agent")])
    const identity = seedPendingRuntimeRun("exact-binding-run", definition.agents[0]!)
    const service: MainRuntimeLaunchServicePort = {
      launch: vi.fn(async () => undefined),
      reconcileRun: vi.fn(async () => "completed" as const),
      cancel: vi.fn(async () => false),
    }
    const engine = new WorkflowEngine(
      databasePath,
      createMainRuntimeLaunchPort(databasePath, service),
    )
    const run = engine.start("task-1", definition)
    const result = await engine.advance(run.id, { worker: identity })
    expect(result.checkpoints[0]).toMatchObject({
      status: "completed",
      attemptCount: 1,
      output: {
        runId: identity.runId,
        orchestrationAgentId: `agent-${identity.runId}`,
        agentDefinitionId: "worker-definition",
      },
    })
    expect(service.launch).toHaveBeenCalledTimes(1)
    const db = new Database(databasePath)
    expect(
      db
        .prepare(
          "SELECT dedup_key FROM orchestration_transition_events WHERE dedup_key LIKE 'workflow-%-binding:%' ORDER BY dedup_key",
        )
        .all(),
    ).toEqual([
      { dedup_key: `workflow-checkpoint-attempt-binding:${run.id}:worker:1` },
      { dedup_key: `workflow-orchestration-agent-binding:agent-${identity.runId}` },
      { dedup_key: `workflow-runtime-run-binding:${identity.runId}` },
    ])
    db.close()
  })

  it("rejects cross-step runtime reuse before a second checkpoint claim", async () => {
    const definition = baseDefinition([step("first", "agent"), step("second", "agent")])
    const identity = seedPendingRuntimeRun("shared-binding-run", definition.agents[0]!)
    const service: MainRuntimeLaunchServicePort = {
      launch: vi.fn(async () => undefined),
      reconcileRun: vi.fn(async () => "completed" as const),
      cancel: vi.fn(async () => false),
    }
    const engine = new WorkflowEngine(
      databasePath,
      createMainRuntimeLaunchPort(databasePath, service),
    )
    const run = engine.start("task-1", definition)
    await expect(engine.advance(run.id, { first: identity, second: identity })).rejects.toThrow(
      /fresh pending Runtime run|already reserved by another checkpoint/,
    )
    expect(engine.get(run.id).checkpoints).toMatchObject([
      { stepId: "first", status: "completed", attemptCount: 1 },
      { stepId: "second", status: "pending", attemptCount: 0 },
    ])
    expect(service.launch).toHaveBeenCalledTimes(1)
  })

  it("rejects same-task wrong-agent substitution and altered definition snapshots", async () => {
    const definition = baseDefinition([step("worker", "agent")])
    definition.agents.push({
      ...definition.agents[0]!,
      definitionId: "other-definition",
      role: "Other worker",
    })
    const wrongAgent = seedPendingRuntimeRun("wrong-agent-run", definition.agents[1]!)
    const service: MainRuntimeLaunchServicePort = {
      launch: vi.fn(async () => undefined),
      reconcileRun: vi.fn(async () => "running" as const),
      cancel: vi.fn(async () => false),
    }
    const engine = new WorkflowEngine(
      databasePath,
      createMainRuntimeLaunchPort(databasePath, service),
    )
    const wrongRun = engine.start("task-1", definition)
    await expect(engine.advance(wrongRun.id, { worker: wrongAgent })).rejects.toThrow(
      /definition snapshot mismatch/,
    )
    expect(engine.get(wrongRun.id).checkpoints[0]).toMatchObject({
      status: "pending",
      attemptCount: 0,
    })

    const altered = { ...definition.agents[0]!, prompt: "Altered durable prompt" }
    const alteredIdentity = seedPendingRuntimeRun("altered-definition-run", altered)
    const alteredRun = engine.start("task-1", definition)
    await expect(engine.advance(alteredRun.id, { worker: alteredIdentity })).rejects.toThrow(
      /definition snapshot mismatch/,
    )
    expect(engine.get(alteredRun.id).checkpoints[0]).toMatchObject({
      status: "pending",
      attemptCount: 0,
    })
    expect(service.launch).not.toHaveBeenCalled()
  })
})

describe("workflow review invariants", () => {
  it("requires stable unique agent definitions and exact worker-only step references", () => {
    const engine = new WorkflowEngine(databasePath, runtime())
    const missingDefinition = baseDefinition([step("worker", "agent")])
    delete missingDefinition.agents[0]!.definitionId
    expect(() => engine.preview(missingDefinition)).toThrow(/stable definitionId/)

    const duplicateDefinition = baseDefinition([step("worker", "agent")])
    duplicateDefinition.agents.push({ ...duplicateDefinition.agents[0]! })
    expect(() => engine.preview(duplicateDefinition)).toThrow(/definitionId values must be unique/)

    const unknownReference = baseDefinition([
      step("worker", "agent", { agentDefinitionId: "missing-definition" }),
    ])
    expect(() => engine.preview(unknownReference)).toThrow(
      /must reference a defined template agent/,
    )

    const controlReference = baseDefinition([
      step("gate", "human-gate", { agentDefinitionId: "worker-definition" }),
    ])
    expect(() => engine.preview(controlReference)).toThrow(
      /Non-worker steps cannot carry an agentDefinitionId/,
    )
  })

  it("creates run and checkpoints atomically and keeps human gates explicit", async () => {
    const db = new Database(databasePath)
    db.exec(`CREATE TRIGGER reject_second_checkpoint BEFORE INSERT ON orchestration_workflow_checkpoints
      WHEN NEW.step_id = 'gate' BEGIN SELECT RAISE(ABORT, 'checkpoint rejected'); END;`)
    db.close()
    const engine = new WorkflowEngine(databasePath, runtime())
    expect(() => engine.start("task-1", gateWorkflow())).toThrow(/checkpoint rejected/)
    const verify = new Database(databasePath)
    expect(verify.prepare("SELECT count(*) count FROM orchestration_workflow_runs").get()).toEqual({
      count: 0,
    })
    verify.exec("DROP TRIGGER reject_second_checkpoint")
    verify.close()

    const run = engine.start("task-1", gateWorkflow())
    const waiting = await engine.advance(run.id, {})
    expect(waiting.status).toBe("waiting")
    expect(waiting.checkpoints.find((item) => item.stepId === "gate")?.status).toBe("waiting")
    expect(engine.decideHumanGate(run.id, "gate", "approve").status).toBe("completed")
  })

  it("keeps auto-materialized workflow runs out of the generic pending-run drain", async () => {
    const coordinator = runtime()
    const engine = new WorkflowEngine(databasePath, coordinator)
    const run = engine.start("task-1", baseDefinition([step("worker", "agent")]))
    await engine.advance(run.id)
    const genericLaunch = vi.fn(async () => undefined)
    await expect(drainPendingMcpRuns(databasePath, genericLaunch)).resolves.toBe(0)
    expect(genericLaunch).not.toHaveBeenCalled()
    expect(coordinator.launch).toHaveBeenCalledTimes(1)
  })

  it("registers direct Codex coordination only when F11 supplies its request authority", async () => {
    const transport = fakeCodexProtocol(async (method) => {
      if (method === "thread/loaded/list") return { data: [] }
      throw new Error(`Unexpected Codex request ${method}`)
    })
    const service: MainRuntimeLaunchServicePort = {
      launch: vi.fn(async () => undefined),
      reconcileRun: vi.fn(async () => "completed"),
      cancel: vi.fn(async () => true),
      codexCoordination: transport,
    }
    registerMainRuntimeOperations(databasePath, service)

    await expect(getRegisteredCoordinationEngineProbes()).resolves.toMatchObject({
      "codex-v2": { available: true, engineVersion: "codex-v2-v1" },
      "codex-v1": { available: true, engineVersion: "codex-v1-v1" },
    })
    expect(transport.version).toHaveBeenCalledTimes(2)
    expect(transport.request).toHaveBeenCalledTimes(2)
  })

  it("preserves the injected worker materializer when F11 registers afterward", async () => {
    const materialize = vi.fn(
      async ({ agentDefinition }: { agentDefinition: OrchestrationAgentDefinition }) => ({
        agentDefinition: { ...agentDefinition, prompt: "Registered bound prompt" },
        profileSnapshotId: "registered-snapshot",
      }),
    )
    registerOrchestrationOperationsRuntime({ runtime: runtime() })
    registerWorkflowAgentMaterializer({ materialize })
    const service: MainRuntimeLaunchServicePort = {
      launch: vi.fn(async (queued) => {
        const db = new Database(databasePath)
        db.prepare("UPDATE agent_runs SET status = 'success', completed_at = 2 WHERE id = ?").run(
          queued.runId,
        )
        db.close()
      }),
      reconcileRun: vi.fn(async () => "completed"),
      cancel: vi.fn(async () => true),
    }
    registerMainRuntimeOperations(databasePath, service)
    const engine = getWorkflowEngine(databasePath)
    const run = engine.start("task-1", baseDefinition([step("worker", "agent")]))

    await expect(engine.advance(run.id)).resolves.toMatchObject({ status: "completed" })
    expect(materialize).toHaveBeenCalledTimes(1)
    expect(engine.get(run.id).checkpoints[0]?.output).toMatchObject({
      materialization: {
        profileSnapshotId: "registered-snapshot",
        agentDefinition: { prompt: "Registered bound prompt" },
      },
    })
  })

  it("materializes the exact definition before durable worker rows and passes its schema to F11", async () => {
    const definition = baseDefinition([
      step("worker", "agent", {
        outputSchema: { type: "object", required: ["result"] },
      }),
    ])
    const returnedDefinition = {
      ...definition.agents[0]!,
      name: "Bound worker",
      prompt: "Bound prompt",
      model: "gpt-bound",
    }
    const materialize = vi.fn(async () => ({
      agentDefinition: returnedDefinition,
      profileSnapshotId: "profile-snapshot-1",
      bindingVersion: 7,
    }))
    const coordinator = {
      ...runtime(),
      readStructuredOutput: vi.fn(async (runId: string) => ({
        value: { result: "ok" },
        activityReference: { runId, eventId: "structured-event", sequence: 1 },
      })),
    }
    const reserve = vi.fn(coordinator.reserve)
    const engine = new WorkflowEngine(databasePath, { ...coordinator, reserve }, { materialize })
    const run = engine.start("task-1", definition)

    await expect(engine.advance(run.id)).resolves.toMatchObject({ status: "completed" })
    expect(materialize).toHaveBeenCalledWith({
      workflowRunId: run.id,
      taskId: "task-1",
      stepId: "worker",
      attemptCount: 1,
      agentDefinition: definition.agents[0],
    })
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        agentDefinition: returnedDefinition,
        outputSchema: { type: "object", required: ["result"] },
      }),
      { workflowRunId: run.id, stepId: "worker", attemptCount: 1 },
    )
    const db = new Database(databasePath, { readonly: true })
    const rows = db
      .prepare(
        `SELECT a.definition, c.mcp_exposure_enabled
         FROM orchestration_agents a JOIN chats c ON c.id = a.chat_id
         WHERE a.task_id = 'task-1'`,
      )
      .all() as Array<{ definition: string; mcp_exposure_enabled: number }>
    db.close()
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]!.definition)).toEqual(returnedDefinition)
    expect(rows[0]!.mcp_exposure_enabled).toBe(1)
    expect(engine.get(run.id).checkpoints[0]?.output).toMatchObject({
      materialization: {
        state: "materialized",
        attemptCount: 1,
        agentDefinition: returnedDefinition,
        profileSnapshotId: "profile-snapshot-1",
        bindingVersion: 7,
      },
    })
  })

  it("keeps product MCP disabled for unsupported local workflow workers", async () => {
    const definition = baseDefinition([step("worker", "agent")])
    definition.agents[0] = {
      ...definition.agents[0]!,
      harness: "local",
      provider: "local",
      model: "local-test-model",
      runtimePreference: "flapstack-native",
    }
    const engine = new WorkflowEngine(databasePath, runtime())
    const run = engine.start("task-1", definition)

    await expect(engine.advance(run.id)).resolves.toMatchObject({ status: "completed" })
    const db = new Database(databasePath, { readonly: true })
    const created = db
      .prepare(
        `SELECT c.harness, c.mcp_exposure_enabled
         FROM chats c JOIN orchestration_agents a ON a.chat_id = c.id
         WHERE a.task_id = 'task-1'`,
      )
      .get()
    db.close()
    expect(created).toEqual({ harness: "local", mcp_exposure_enabled: 0 })
  })

  it("blocks safely with zero worker rows when pre-durable materialization fails", async () => {
    const materialize = vi.fn(async () => {
      throw new Error(`Bearer ${"secret".repeat(30)}`)
    })
    const engine = new WorkflowEngine(databasePath, runtime(), { materialize })
    const run = engine.start("task-1", baseDefinition([step("worker", "agent")]))
    const result = await engine.advance(run.id)

    expect(result).toMatchObject({
      status: "blocked",
      checkpoints: [{ status: "blocked", error: "Bearer [REDACTED]" }],
    })
    const db = new Database(databasePath, { readonly: true })
    expect(db.prepare("SELECT count(*) count FROM orchestration_agents").get()).toEqual({
      count: 0,
    })
    expect(db.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT count(*) count FROM sub_chats").get()).toEqual({ count: 0 })
    expect(db.prepare("SELECT count(*) count FROM chats").get()).toEqual({ count: 1 })
    db.close()
  })

  it("runs eligibility before materialization and rejects changed identity/topology", async () => {
    const ineligible = baseDefinition([step("worker", "agent")])
    ineligible.policy.allowSpawn = false
    const skippedMaterializer = vi.fn(async () => ({ agentDefinition: ineligible.agents[0]! }))
    const blockedEngine = new WorkflowEngine(databasePath, runtime(), {
      materialize: skippedMaterializer,
    })
    const blockedRun = blockedEngine.start("task-1", ineligible)
    await expect(blockedEngine.advance(blockedRun.id)).resolves.toMatchObject({
      status: "blocked",
    })
    expect(skippedMaterializer).not.toHaveBeenCalled()

    const definition = baseDefinition([step("worker", "agent")])
    const changedTopology = vi.fn(async () => ({
      agentDefinition: {
        ...definition.agents[0]!,
        dependencyAgentIds: ["different-dependency"],
      },
    }))
    const engine = new WorkflowEngine(databasePath, runtime(), { materialize: changedTopology })
    const run = engine.start("task-1", definition)
    await expect(engine.advance(run.id)).resolves.toMatchObject({
      status: "blocked",
      checkpoints: [
        {
          error: expect.stringContaining("changed immutable definition identity or topology"),
        },
      ],
    })
    const db = new Database(databasePath, { readonly: true })
    expect(db.prepare("SELECT count(*) count FROM orchestration_agents").get()).toEqual({
      count: 0,
    })
    expect(db.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
    db.close()
  })

  it("claims materialization once and reuses its snapshot after a concurrent pause/resume", async () => {
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve
    })
    const definition = baseDefinition([step("worker", "agent")])
    const returnedDefinition = { ...definition.agents[0]!, prompt: "Bound once" }
    const materialize = vi.fn(async () => {
      entered()
      await waiting
      return { agentDefinition: returnedDefinition, profileSnapshotId: "snapshot-once" }
    })
    const engine = new WorkflowEngine(databasePath, runtime(), { materialize })
    const run = engine.start("task-1", definition)
    const first = engine.advance(run.id)
    await enteredPromise
    const concurrent = engine.advance(run.id)
    engine.control(run.id, "pause")
    release()

    await expect(first).resolves.toMatchObject({ status: "paused" })
    await expect(concurrent).resolves.toMatchObject({ status: "paused" })
    expect(materialize).toHaveBeenCalledTimes(1)
    let db = new Database(databasePath, { readonly: true })
    expect(db.prepare("SELECT count(*) count FROM orchestration_agents").get()).toEqual({
      count: 0,
    })
    expect(db.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 0 })
    db.close()

    engine.control(run.id, "resume")
    await expect(engine.advance(run.id)).resolves.toMatchObject({ status: "completed" })
    expect(materialize).toHaveBeenCalledTimes(1)
    db = new Database(databasePath, { readonly: true })
    expect(db.prepare("SELECT count(*) count FROM orchestration_agents").get()).toEqual({
      count: 1,
    })
    expect(db.prepare("SELECT count(*) count FROM agent_runs").get()).toEqual({ count: 1 })
    db.close()
  })

  it("evaluates branches, skips the unselected path, bounds loops, and materializes workers", async () => {
    const engine = new WorkflowEngine(databasePath, runtime())
    const definition = branchLoopWorkflow()
    const run = engine.start("task-1", definition)
    await engine.advance(run.id, {})
    engine.decideHumanGate(run.id, "gate", "approve")
    const selected = await engine.advance(run.id, {})
    const branched = await engine.advance(run.id, {})
    expect(selected.checkpoints.find((item) => item.stepId === "branch")?.output).toMatchObject({
      selectedStepIds: ["then-worker"],
      skippedStepIds: ["else-worker"],
    })
    expect(branched.checkpoints.find((item) => item.stepId === "else-worker")?.status).toBe(
      "skipped",
    )
    expect(branched.checkpoints.find((item) => item.stepId === "then-worker")?.status).toBe(
      "completed",
    )

    const loopRun = engine.start("task-1", loopWorkflow())
    await engine.advance(loopRun.id, {})
    expect(
      engine.resolveLoop(loopRun.id, "loop", { continue: true, output: { pass: 1 } }).status,
    ).toBe("running")
    seedRun("run-loop-1")
    expect((await engine.advance(loopRun.id, { body: launchRequest("run-loop-1") })).status).toBe(
      "waiting",
    )
    engine.resolveLoop(loopRun.id, "loop", { continue: true, output: { pass: 2 } })
    seedRun("run-loop-2")
    expect((await engine.advance(loopRun.id, { body: launchRequest("run-loop-2") })).status).toBe(
      "waiting",
    )
    expect(() =>
      engine.resolveLoop(loopRun.id, "loop", { continue: true, output: { pass: 3 } }),
    ).toThrow(/maxIterations/)
    expect(() =>
      engine.resolveLoop(loopRun.id, "loop", { continue: false, output: { done: "yes" } }),
    ).toThrow(/JSON Schema type boolean/)
    engine.resolveLoop(loopRun.id, "loop", { continue: false, output: { done: true } })
    expect((await engine.advance(loopRun.id, {})).status).toBe("completed")
  })

  it("enforces maxParallelAgents while Runtime launches are active", async () => {
    const launch = vi.fn(
      async (request: Parameters<RuntimeLaunchCoordinatorPort["launch"]>[0]) => ({
        runId: request.runId,
        chatId: request.chatId,
        subChatId: request.subChatId,
        lifecycleState: "running" as const,
        activityReference: null,
      }),
    )
    const engine = new WorkflowEngine(databasePath, { ...runtime(), launch })
    const definition = twoWorkerWorkflow()
    const run = engine.start("task-1", definition)
    seedRun("run-a")
    seedRun("run-b")
    const result = await engine.advance(run.id, {
      a: launchRequest("run-a"),
      b: launchRequest("run-b"),
    })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(result.checkpoints.find((item) => item.stepId === "b")?.status).toBe("blocked")
  })

  it("fails closed for disabled spawning and structurally ungated branch or loop workers", async () => {
    const launch = vi.fn(async (request) => reference(request.runId, "completed"))
    const engine = new WorkflowEngine(databasePath, { ...runtime(), launch })
    const disabled = baseDefinition([step("worker", "agent")])
    disabled.policy.allowSpawn = false
    seedRun("run-spawn-disabled")
    const disabledRun = engine.start("task-1", disabled)
    const blocked = await engine.advance(disabledRun.id, {
      worker: launchRequest("run-spawn-disabled"),
    })
    expect(blocked.checkpoints[0]).toMatchObject({
      status: "blocked",
      error: expect.stringContaining("spawn"),
    })
    expect(launch).not.toHaveBeenCalled()

    const reorderedBranch = baseDefinition([
      step("losing-worker", "agent"),
      step("gate", "human-gate"),
      step("branch", "branch", {
        dependsOn: ["gate"],
        condition: { stepId: "gate", path: ["decision"], equals: "approve" },
        thenStepIds: [],
        elseStepIds: ["losing-worker"],
      }),
    ])
    expect(() => engine.preview(reorderedBranch)).toThrow(/members must depend on the branch gate/)

    const reorderedLoop = baseDefinition([
      step("body", "agent"),
      step("loop", "loop", { bodyStepIds: ["body"] }),
    ])
    expect(() => engine.start("task-1", reorderedLoop)).toThrow(
      /body members must depend on the loop gate/,
    )
    expect(launch).not.toHaveBeenCalled()
  })

  it("projects an explicit Runtime cancellation as a failed workflow checkpoint", async () => {
    const engine = new WorkflowEngine(databasePath, {
      ...runtime(),
      launch: vi.fn(async (request) => ({
        ...request,
        lifecycleState: "cancelled" as const,
        activityReference: null,
      })),
    })
    const run = engine.start("task-1", baseDefinition([step("worker", "agent")]))
    seedRun("run-cancelled")
    const result = await engine.advance(run.id, {
      worker: launchRequest("run-cancelled"),
    })
    expect(result.checkpoints[0]).toMatchObject({
      status: "failed",
      error: "Runtime was cancelled.",
      output: { lifecycle: "cancelled" },
    })
  })

  it("enforces maxTotalAgents and gives parallel, pipeline, and barrier truthful outcomes", async () => {
    const launch = vi.fn(async (request) => reference(request.runId, "completed"))
    const engine = new WorkflowEngine(databasePath, { ...runtime(), launch })
    const totalDefinition = twoWorkerWorkflow()
    totalDefinition.policy.maxParallelAgents = 2
    totalDefinition.policy.maxTotalAgents = 1
    seedRun("run-total-a")
    seedRun("run-total-b")
    const bounded = await engine.advance(engine.start("task-1", totalDefinition).id, {
      a: launchRequest("run-total-a"),
      b: launchRequest("run-total-b"),
    })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(bounded.checkpoints.find((item) => item.stepId === "b")?.status).toBe("blocked")

    const grouped = baseDefinition([
      step("first", "agent"),
      step("second", "agent", { dependsOn: ["first"] }),
      step("pipeline", "pipeline", { childStepIds: ["first", "second"] }),
      step("parallel", "parallel", { childStepIds: ["first", "second"] }),
      step("barrier", "barrier", {
        dependsOn: ["pipeline", "parallel"],
        childStepIds: ["first", "second"],
      }),
    ])
    seedRun("run-group-first")
    seedRun("run-group-second")
    const groupedResult = await engine.advance(engine.start("task-1", grouped).id, {
      first: launchRequest("run-group-first"),
      second: launchRequest("run-group-second"),
    })
    expect(groupedResult.status).toBe("completed")
    for (const id of ["pipeline", "parallel", "barrier"])
      expect(groupedResult.checkpoints.find((item) => item.stepId === id)).toMatchObject({
        status: "completed",
        output: { completed: true },
      })

    const failedLaunch = vi
      .fn()
      .mockImplementationOnce(async (request) => reference(request.runId, "completed"))
      .mockImplementationOnce(async (request) => reference(request.runId, "failed"))
    const failedEngine = new WorkflowEngine(databasePath, { ...runtime(), launch: failedLaunch })
    const failedBarrier = baseDefinition([
      step("left", "agent"),
      step("right", "agent"),
      step("barrier", "barrier", { childStepIds: ["left", "right"] }),
    ])
    seedRun("run-barrier-left")
    seedRun("run-barrier-right")
    const failed = await failedEngine.advance(failedEngine.start("task-1", failedBarrier).id, {
      left: launchRequest("run-barrier-left"),
      right: launchRequest("run-barrier-right"),
    })
    expect(failed.status).toBe("failed")
    expect(failed.checkpoints.find((item) => item.stepId === "barrier")).toMatchObject({
      status: "failed",
      error: expect.stringContaining("failed closed"),
    })
  })

  it("enforces retries, timeouts, budgets, output schemas, and pipeline ordering", async () => {
    const failedThenComplete = vi
      .fn()
      .mockImplementationOnce(async (request) => reference(request.runId, "failed"))
      .mockImplementationOnce(async (request) => reference(request.runId, "completed"))
    const cancel = vi.fn(async (runId: string) => reference(runId, "completed"))
    const engine = new WorkflowEngine(databasePath, {
      ...runtime(),
      launch: failedThenComplete,
      cancel,
    })
    const retryDefinition = baseDefinition([step("worker", "agent", { maxRetries: 1 })])
    seedRun("run-retry-1")
    const retryRun = engine.start("task-1", retryDefinition)
    expect(
      (await engine.advance(retryRun.id, { worker: launchRequest("run-retry-1") })).checkpoints[0],
    ).toMatchObject({ status: "waiting", attemptCount: 1 })
    engine.retryStep(retryRun.id, "worker")
    seedRun("run-retry-2")
    expect(
      (await engine.advance(retryRun.id, { worker: launchRequest("run-retry-2") })).status,
    ).toBe("completed")

    const runningEngine = new WorkflowEngine(databasePath, {
      ...runtime(),
      launch: vi.fn(async (request) => reference(request.runId, "running")),
      cancel,
    })
    const timeoutDefinition = baseDefinition([step("slow", "agent", { timeoutMs: 1 })])
    seedRun("run-timeout")
    const timeoutRun = runningEngine.start("task-1", timeoutDefinition)
    await runningEngine.advance(timeoutRun.id, { slow: launchRequest("run-timeout") })
    const timeoutDb = new Database(databasePath)
    const timeoutOutput = JSON.parse(
      String(
        (
          timeoutDb
            .prepare(
              "SELECT output_json FROM orchestration_workflow_checkpoints WHERE workflow_run_id = ? AND step_id = 'slow'",
            )
            .get(timeoutRun.id) as { output_json: string }
        ).output_json,
      ),
    )
    timeoutDb
      .prepare(
        "UPDATE orchestration_workflow_checkpoints SET output_json = ? WHERE workflow_run_id = ? AND step_id = 'slow'",
      )
      .run(JSON.stringify({ ...timeoutOutput, startedAt: 1 }), timeoutRun.id)
    timeoutDb.close()
    expect((await runningEngine.advance(timeoutRun.id, {})).status).toBe("failed")
    expect(cancel).toHaveBeenCalledWith("run-timeout", expect.stringContaining("workflow-timeout"))

    const schemaDefinition = baseDefinition([
      step("structured", "agent", { outputSchema: { type: "object", required: ["result"] } }),
    ])
    seedRun("run-structured")
    const schemaEngine = new WorkflowEngine(databasePath, runtime())
    const schemaRun = schemaEngine.start("task-1", schemaDefinition)
    const schemaResult = await schemaEngine.advance(schemaRun.id, {
      structured: launchRequest("run-structured"),
    })
    expect(schemaResult.checkpoints[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("no structured output activity reference"),
    })

    seedRun("run-structured-valid")
    const structuredEngine = new WorkflowEngine(databasePath, {
      ...runtime(),
      readStructuredOutput: vi.fn(async (runId) => ({
        value: { result: "ok" },
        activityReference: { runId, eventId: "structured-event", sequence: 9 },
      })),
    })
    const structuredRun = structuredEngine.start("task-1", schemaDefinition)
    const structuredResult = await structuredEngine.advance(structuredRun.id, {
      structured: launchRequest("run-structured-valid"),
    })
    expect(structuredResult.checkpoints[0]).toMatchObject({
      status: "completed",
      output: {
        structuredOutput: { result: "ok" },
        structuredOutputReference: {
          runId: "run-structured-valid",
          eventId: "structured-event",
          sequence: 9,
        },
      },
    })

    seedAgent("usage-agent", "run-usage")
    const usageDb = new Database(databasePath)
    usageDb
      .prepare("UPDATE orchestration_agents SET total_tokens = 100 WHERE id = 'usage-agent'")
      .run()
    usageDb.close()
    const budgetDefinition = baseDefinition([step("budgeted", "agent")])
    budgetDefinition.policy.maxTotalTokens = 100
    expect(() => engine.start("task-1", budgetDefinition, "fake-budget-audit")).toThrow(
      /does not match a completed Stage 3 decision/,
    )
    seedTemplateApproval("budget-audit", budgetDefinition)
    const budgetRun = engine.start("task-1", budgetDefinition, "budget-audit")
    expect((await engine.advance(budgetRun.id, {})).checkpoints[0]?.status).toBe("blocked")

    const invalidPipeline = baseDefinition([
      step("first", "agent"),
      step("second", "agent"),
      step("pipeline", "pipeline", { childStepIds: ["first", "second"] }),
    ])
    expect(() => engine.preview(invalidPipeline)).toThrow(/ordered dependencies/)
  })

  it("requires a new runtime run and orchestration agent for every retry attempt", async () => {
    const launch = vi
      .fn()
      .mockImplementationOnce(async (request) => reference(request.runId, "failed"))
      .mockImplementationOnce(async (request) => reference(request.runId, "completed"))
    let reserved = false
    const coordinator: RuntimeLaunchCoordinatorPort = {
      ...runtime(),
      reserve: vi.fn(async (request) => {
        if (reserved)
          throw new Error(
            "Orchestration agent is already bound to another workflow checkpoint attempt.",
          )
        reserved = true
        return {
          orchestrationAgentId: "reused-agent",
          agentDefinitionId: request.agentDefinitionId,
        }
      }),
      launch,
    }
    const engine = new WorkflowEngine(databasePath, coordinator)
    const definition = baseDefinition([step("worker", "agent", { maxRetries: 1 })])
    seedRun("retry-binding-one")
    seedRun("retry-binding-two")
    const run = engine.start("task-1", definition)
    expect(
      (await engine.advance(run.id, { worker: launchRequest("retry-binding-one") })).checkpoints[0],
    ).toMatchObject({ status: "waiting", attemptCount: 1 })
    engine.retryStep(run.id, "worker")
    await expect(
      engine.advance(run.id, { worker: launchRequest("retry-binding-two") }),
    ).rejects.toThrow(/Orchestration agent is already bound/)
    expect(engine.get(run.id).checkpoints[0]).toMatchObject({
      status: "pending",
      attemptCount: 1,
    })
    expect(launch).toHaveBeenCalledTimes(1)
  })
})

describe("cascade review invariants", () => {
  it("rejects stale previews, fails closed for pause/resume, and redacts bounded errors", async () => {
    seedAgent("agent-1", "run-1")
    const control = new CascadeControlService(databasePath, runtime())
    const stale = control.preview("task-1", "pause")
    seedAgent("agent-2", "run-2")
    expect(() => control.request("task-1", "pause", stale.fingerprint)).toThrow(/stale/)

    const fresh = control.preview("task-1", "pause")
    const paused = control.request("task-1", "pause", fresh.fingerprint)
    expect(readTaskStatus()).not.toBe("paused")
    expect(await control.reconcile(paused.intentId)).toMatchObject({ state: "partial" })
    expect(readTaskStatus()).not.toBe("paused")
    const resumePreview = control.preview("task-1", "resume")
    const resumed = control.request("task-1", "resume", resumePreview.fingerprint)
    expect(await control.reconcile(resumed.intentId)).toMatchObject({ state: "partial" })
    expect(readTaskStatus()).not.toBe("paused")

    const secret =
      "provider failed with Bearer top-secret-token and api_key=sk-proj-0123456789012345"
    expect(redactProviderError(new Error(secret))).not.toContain("top-secret-token")
    const failing = new CascadeControlService(databasePath, {
      ...runtime(),
      cancel: vi.fn(async () => {
        throw new Error(secret.repeat(20))
      }),
    })
    const stopPreview = failing.preview("task-1", "stop")
    const stopped = failing.request("task-1", "stop", stopPreview.fingerprint)
    expect(await failing.reconcile(stopped.intentId)).toMatchObject({ state: "partial" })
    const db = new Database(databasePath)
    const errors = db
      .prepare("SELECT error FROM orchestration_control_targets WHERE intent_id = ?")
      .all(stopped.intentId) as Array<{ error: string }>
    db.close()
    expect(
      errors.every((row) => !row.error.includes("top-secret-token") && row.error.length <= 500),
    ).toBe(true)
  })

  it("commits pause/resume truth only after every active Runtime target acknowledges", async () => {
    seedAgent("pause-agent", "pause-run")
    const pause = vi.fn(async (runId: string) => reference(runId, "running"))
    const resume = vi.fn(async (runId: string) => reference(runId, "running"))
    const control = new CascadeControlService(databasePath, {
      ...runtime(),
      pause,
      resume,
    })
    const pausePreview = control.preview("task-1", "pause")
    const pauseIntent = control.request("task-1", "pause", pausePreview.fingerprint)
    expect(readTaskStatus()).not.toBe("paused")
    expect(await control.reconcile(pauseIntent.intentId)).toMatchObject({ state: "completed" })
    expect(readTaskStatus()).toBe("paused")
    expect(pause).toHaveBeenCalledWith("pause-run")

    const resumePreview = control.preview("task-1", "resume")
    const resumeIntent = control.request("task-1", "resume", resumePreview.fingerprint)
    expect(await control.reconcile(resumeIntent.intentId)).toMatchObject({ state: "completed" })
    expect(readTaskStatus()).toBe("running")
    expect(resume).toHaveBeenCalledWith("pause-run")
  })
})

describe("Codex durability review invariants", () => {
  it("canonicalizes keys and gives concurrent execution one dispatch owner", async () => {
    seedAgent("agent-1", "run-1")
    let release!: () => void
    const dispatch = vi.fn(
      () =>
        new Promise<{
          state: "completed"
          providerIdentity: CoordinationEngineContext["snapshot"]["providerIdentity"]
          result: unknown
        }>((resolve) => {
          release = () =>
            resolve({
              state: "completed",
              providerIdentity: context().snapshot.providerIdentity,
              result: {},
            })
        }),
    )
    const client = { probe: vi.fn(), dispatch, reconcile: vi.fn() }
    const adapter = createCodexCoordinationAdapter(databasePath, "codex-v2", client)
    const firstAction = action("same message")
    const reordered = JSON.parse(
      `{"targetAgentId":"agent-1","providerIdentity":${JSON.stringify(firstAction.providerIdentity)},"orchestrationId":"task-1","message":"same message","kind":"send","schemaVersion":1}`,
    )
    expect(canonicalJson(firstAction)).toBe(canonicalJson(reordered))
    const first = adapter.execute(context(), firstAction)
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    const duplicate = await adapter.execute(context(), reordered)
    expect(duplicate).toMatchObject({ ok: false, state: "uncertain" })
    release()
    await expect(first).resolves.toMatchObject({ ok: true, state: "completed" })
    const identityDb = new Database(databasePath, { readonly: true })
    expect(
      JSON.parse(
        String(
          (
            identityDb
              .prepare(
                "SELECT provider_identity_json identity FROM coordination_action_intents WHERE task_id = 'task-1'",
              )
              .get() as { identity: string }
          ).identity,
        ),
      ),
    ).toEqual(context().snapshot.providerIdentity)
    expect(
      identityDb
        .prepare(
          "SELECT coordination_engine_provider_identity identity FROM task_orchestrations WHERE task_id = 'task-1'",
        )
        .get(),
    ).toEqual({ identity: "null" })
    identityDb.close()
    expect(await adapter.execute(context(), reordered)).toMatchObject({
      ok: true,
      state: "completed",
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

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

  it("reconciles durable running actions without dispatch replay", async () => {
    seedAgent("agent-1", "run-1")
    const dispatch = vi.fn(async () => ({
      state: "running" as const,
      providerIdentity: context().snapshot.providerIdentity,
      result: { accepted: true },
    }))
    const reconcile = vi.fn(async () => ({
      state: "completed" as const,
      result: { providerMessageId: "m-running" },
    }))
    const adapter = createCodexCoordinationAdapter(databasePath, "codex-v2", {
      probe: vi.fn(),
      dispatch,
      reconcile,
    })
    await expect(adapter.execute(context(), action("running"))).resolves.toMatchObject({
      state: "running",
    })
    await expect(adapter.reconcile(context())).resolves.toMatchObject({
      ok: true,
      result: { reconciled: 1 },
    })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(reconcile).toHaveBeenCalledTimes(1)
    const db = new Database(databasePath)
    expect(db.prepare("SELECT state FROM coordination_action_intents").get()).toEqual({
      state: "completed",
    })
    expect(
      db.prepare("SELECT state, provider_message_id FROM orchestration_messages").get(),
    ).toEqual({
      state: "delivered",
      provider_message_id: "m-running",
    })
    db.close()
  })

  it.each(["running", "waiting", "uncertain"] as const)(
    "reconciles a repeatedly %s intent only once per invocation",
    async (state) => {
      seedAgent("agent-1", "run-1")
      const dispatch = vi.fn(async () => ({
        state: "running" as const,
        providerIdentity: context().snapshot.providerIdentity,
        result: { accepted: true },
      }))
      const reconcile = vi.fn(async () => ({ state, result: { still: state } }))
      const adapter = createCodexCoordinationAdapter(databasePath, "codex-v2", {
        probe: vi.fn(),
        dispatch,
        reconcile,
      })
      await adapter.execute(context(), action(`repeat-${state}`))

      const first = await adapter.reconcile(context())
      expect(first).toMatchObject({ state })
      expect(reconcile).toHaveBeenCalledTimes(1)
      const firstDb = new Database(databasePath)
      expect(firstDb.prepare("SELECT state FROM coordination_action_intents").get()).toEqual({
        state,
      })
      firstDb.close()

      await adapter.reconcile(context())
      expect(reconcile).toHaveBeenCalledTimes(2)
      expect(dispatch).toHaveBeenCalledTimes(1)
    },
  )

  it("renews a live provider claim beyond expiry and permits expired-owner takeover", async () => {
    seedAgent("agent-1", "run-1")
    const dispatch = vi.fn(async () => {
      throw new Error("provider outcome unknown")
    })
    let release!: () => void
    const reconcile = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ state: "running"; result: unknown }>((resolve) => {
            release = () => resolve({ state: "running", result: { alive: true } })
          }),
      )
      .mockResolvedValueOnce({ state: "completed", result: { takeover: true } })
    const adapter = createCodexCoordinationAdapter(databasePath, "codex-v2", {
      probe: vi.fn(),
      dispatch,
      reconcile,
    })
    await adapter.execute(context(), action("lease"))

    const now = Date.now()
    vi.useFakeTimers({ now })
    const first = adapter.reconcile(context())
    expect(reconcile).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(301_000)
    await expect(adapter.reconcile(context())).resolves.toMatchObject({
      ok: true,
      result: { reconciled: 0 },
    })
    expect(reconcile).toHaveBeenCalledTimes(1)
    release()
    await expect(first).resolves.toMatchObject({ ok: true, state: "running" })

    const crashed = new Database(databasePath)
    crashed
      .prepare(
        "UPDATE coordination_action_intents SET claim_owner = 'expired-owner', claim_expires_at = ?",
      )
      .run(Math.floor(Date.now() / 1000) + 300)
    crashed.close()
    await vi.advanceTimersByTimeAsync(301_000)
    await expect(adapter.reconcile(context())).resolves.toMatchObject({
      ok: true,
      state: "completed",
      result: { reconciled: 1, completed: 1 },
    })
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it("validates Codex V2 task paths across POSIX and Windows formats", async () => {
    seedAgent("agent-1", "run-1")
    const dispatch = vi.fn(async (_engine: string, dispatchedAction: CoordinationEngineAction) => ({
      state: "completed" as const,
      providerIdentity: dispatchedAction.providerIdentity,
      result: {},
    }))
    const adapter = createCodexCoordinationAdapter(databasePath, "codex-v2", {
      probe: vi.fn(),
      dispatch,
      reconcile: vi.fn(),
    })
    const withPath = (path: string, message: string) => ({
      ...action(message),
      providerIdentity: { ...action(message).providerIdentity, canonicalTaskPath: path },
    })

    await expect(
      adapter.execute(context(), withPath("/work/../worker", "posix-traversal")),
    ).rejects.toThrow(/canonical task path is invalid/)
    await expect(
      adapter.execute(context(), withPath("C:\\work\\..\\worker", "windows-traversal")),
    ).rejects.toThrow(/canonical task path is invalid/)
    await expect(
      adapter.execute(context(), withPath("\\worker", "windows-root-relative")),
    ).rejects.toThrow(/canonical task path is invalid/)
    await expect(
      adapter.execute(context(), withPath("C:\\work\\\\worker", "windows-repeated")),
    ).rejects.toThrow(/canonical task path is invalid/)
    await expect(
      adapter.execute(context(), withPath("/work//worker", "posix-repeated")),
    ).rejects.toThrow(/canonical task path is invalid/)
    await expect(
      adapter.execute(context(), withPath("/work/./worker", "posix-dot")),
    ).rejects.toThrow(/canonical task path is invalid/)
    await expect(
      adapter.execute(context(), withPath("C:\\work\\worker", "windows-absolute")),
    ).resolves.toMatchObject({ ok: true, state: "completed" })
    await expect(
      adapter.execute(context(), withPath("\\\\server\\share\\worker", "windows-unc-absolute")),
    ).resolves.toMatchObject({ ok: true, state: "completed" })
    await expect(
      adapter.execute(context(), withPath("/work/worker..review", "lookalike")),
    ).resolves.toMatchObject({ ok: true, state: "completed" })
    expect(dispatch).toHaveBeenCalledTimes(3)
    const db = new Database(databasePath)
    const paths = (
      db.prepare("SELECT provider_identity_json FROM coordination_action_intents").all() as Array<{
        provider_identity_json: string
      }>
    ).map((row) => JSON.parse(row.provider_identity_json).canonicalTaskPath)
    db.close()
    expect(paths).toEqual(
      expect.arrayContaining([
        "C:\\work\\worker",
        "\\\\server\\share\\worker",
        "/work/worker..review",
      ]),
    )
  })
})

describe("direct Codex App Server coordination", () => {
  it("fails capability probing closed on Codex protocol version drift", async () => {
    const transport = fakeCodexProtocol(async () => ({}))
    vi.mocked(transport.version).mockResolvedValue("0.145.0")
    const client = createCodexAppServerCoordinationClient({ databasePath, transport })

    await expect(client.probe("codex-v2")).resolves.toMatchObject({
      available: false,
      reason: {
        code: "engine-unavailable",
        message: expect.stringContaining("pinned to 0.144.1"),
      },
    })
    expect(transport.request).not.toHaveBeenCalled()
  })

  it("maps V2 context forks, active messages, and V1 interrupt-then-send to direct RPCs", async () => {
    seedAgent("agent-v2", "run-v2")
    seedAgent("agent-v1", "run-v1")
    const db = new Database(databasePath)
    db.prepare("UPDATE sub_chats SET session_id = 'thread-v2' WHERE id = 'sub-run-v2'").run()
    db.prepare("UPDATE sub_chats SET session_id = 'thread-v1' WHERE id = 'sub-run-v1'").run()
    db.close()
    let v1Reads = 0
    const protocol = fakeCodexProtocol(async (method, params) => {
      if (method === "initialize" || method === "thread/loaded/list") return {}
      if (method === "thread/fork") return { thread: { id: "forked-root" } }
      if (method === "thread/read" && params?.threadId === "thread-v2")
        return {
          thread: {
            id: "thread-v2",
            status: { type: "active" },
            turns: [{ id: "turn-v2", status: "inProgress" }],
          },
        }
      if (method === "turn/steer") return { turnId: "turn-v2" }
      if (method === "thread/read" && params?.threadId === "thread-v1") {
        v1Reads += 1
        return {
          thread: {
            id: "thread-v1",
            status: { type: v1Reads === 1 ? "active" : "idle" },
            turns:
              v1Reads === 1
                ? [{ id: "turn-v1-active", status: "inProgress" }]
                : [{ id: "turn-v1-active", status: "interrupted" }],
          },
        }
      }
      if (method === "turn/interrupt") return {}
      if (method === "turn/start") return { turn: { id: "turn-v1-followup" } }
      throw new Error(`Unexpected Codex request ${method}`)
    })
    const client = createCodexAppServerCoordinationClient({
      databasePath,
      transport: protocol,
    })

    await expect(client.probe("codex-v2")).resolves.toMatchObject({
      available: true,
      snapshot: { capabilities: expect.arrayContaining(["selective-context-fork", "mailbox"]) },
    })
    await expect(
      client.dispatch(
        "codex-v2",
        {
          schemaVersion: 1,
          kind: "start",
          orchestrationId: "task-1",
          providerIdentity: null,
          contextFork: {
            sourceProviderThreadId: "source-thread",
            lastTurnId: "source-turn-4",
          },
        },
        { intentId: "start-intent", idempotencyKey: "start-key" },
      ),
    ).resolves.toMatchObject({
      state: "running",
      providerIdentity: { engine: "codex-v2", providerTaskId: "forked-root" },
    })
    await client.dispatch(
      "codex-v2",
      {
        schemaVersion: 1,
        kind: "send",
        orchestrationId: "task-1",
        providerIdentity: v2Identity("root-v2"),
        targetAgentId: "agent-v2",
        message: "steer now",
      },
      { intentId: "send-v2", idempotencyKey: "message-v2" },
    )
    await client.dispatch(
      "codex-v1",
      {
        schemaVersion: 1,
        kind: "send",
        orchestrationId: "task-1",
        providerIdentity: {
          schemaVersion: 1,
          engine: "codex-v1",
          providerAgentId: "root-v1",
          nickname: "legacy-root",
        },
        targetAgentId: "agent-v1",
        message: "replace active turn",
      },
      { intentId: "send-v1", idempotencyKey: "message-v1" },
    )

    expect(protocol.request).toHaveBeenCalledWith("thread/fork", {
      threadId: "source-thread",
      lastTurnId: "source-turn-4",
    })
    expect(protocol.request).toHaveBeenCalledWith("turn/steer", {
      threadId: "thread-v2",
      clientUserMessageId: "message-v2",
      input: [{ type: "text", text: "steer now", text_elements: [] }],
      expectedTurnId: "turn-v2",
    })
    expect(protocol.request).toHaveBeenCalledWith("turn/interrupt", {
      threadId: "thread-v1",
      turnId: "turn-v1-active",
    })
    expect(protocol.request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread-v1",
      clientUserMessageId: "message-v1",
      input: [{ type: "text", text: "replace active turn", text_elements: [] }],
    })
  })

  it("fails wait closed when any direct Codex target has uncertain provider state", async () => {
    seedAgent("agent-uncertain", "run-uncertain")
    const db = new Database(databasePath)
    db.prepare(
      "UPDATE sub_chats SET session_id = 'thread-uncertain' WHERE id = 'sub-run-uncertain'",
    ).run()
    db.close()
    const protocol = fakeCodexProtocol(async (method) => {
      if (method === "initialize") return {}
      if (method === "thread/read")
        return {
          thread: {
            id: "thread-uncertain",
            status: { type: "systemError" },
            turns: [{ id: "failed-turn", status: "failed" }],
          },
        }
      throw new Error(`Unexpected Codex request ${method}`)
    })
    const client = createCodexAppServerCoordinationClient({
      databasePath,
      transport: protocol,
    })
    await expect(
      client.dispatch(
        "codex-v2",
        {
          schemaVersion: 1,
          kind: "wait",
          orchestrationId: "task-1",
          providerIdentity: v2Identity("root-v2"),
          targetAgentIds: ["agent-uncertain"],
          timeoutMs: 1,
        },
        { intentId: "wait-intent", idempotencyKey: "wait-key" },
      ),
    ).rejects.toThrow(/states are uncertain/)
    await expect(
      client.dispatch(
        "codex-v2",
        {
          schemaVersion: 1,
          kind: "complete",
          orchestrationId: "task-1",
          providerIdentity: v2Identity("thread-uncertain"),
          resultSummary: null,
        },
        { intentId: "complete-intent", idempotencyKey: "complete-key" },
      ),
    ).rejects.toThrow(/state is uncertain/)
    await expect(
      client.dispatch(
        "codex-v2",
        {
          schemaVersion: 1,
          kind: "interrupt",
          orchestrationId: "task-1",
          providerIdentity: v2Identity("root-v2"),
          targetAgentId: "agent-uncertain",
          message: null,
        },
        { intentId: "interrupt-intent", idempotencyKey: "interrupt-key" },
      ),
    ).rejects.toThrow(/state is uncertain/)
  })

  it("treats unknown App Server thread or turn statuses as uncertain", async () => {
    const transport = fakeCodexProtocol(async (method, params) => {
      if (method === "thread/read")
        return {
          thread: {
            id: params?.threadId,
            status: { type: "futureStatus" },
            turns: [{ id: "future-turn", status: "futureTurnStatus" }],
          },
        }
      throw new Error(`Unexpected Codex request ${method}`)
    })
    const client = createCodexAppServerCoordinationClient({ databasePath, transport })
    await expect(
      client.dispatch(
        "codex-v2",
        {
          schemaVersion: 1,
          kind: "complete",
          orchestrationId: "task-1",
          providerIdentity: v2Identity("future-thread"),
          resultSummary: null,
        },
        { intentId: "future-intent", idempotencyKey: "future-key" },
      ),
    ).rejects.toThrow(/state is uncertain/)
  })

  it("maps reload, wait, completion, interrupt, and V2/V1 residency cleanup directly", async () => {
    seedAgent("agent-idle", "run-idle")
    const db = new Database(databasePath)
    db.prepare("UPDATE sub_chats SET session_id = 'thread-idle' WHERE id = 'sub-run-idle'").run()
    db.close()
    const transport = fakeCodexProtocol(async (method, params) => {
      if (["thread/resume", "thread/unsubscribe", "thread/archive"].includes(method)) return {}
      if (method === "thread/read") {
        const threadId = String(params?.threadId)
        return {
          thread: {
            id: threadId,
            status: { type: "idle" },
            turns: [{ id: `${threadId}-turn`, status: "completed" }],
          },
        }
      }
      throw new Error(`Unexpected Codex request ${method}`)
    })
    const client = createCodexAppServerCoordinationClient({ databasePath, transport })
    const identity = v2Identity("root-v2")
    const dispatchIdentity = { intentId: "lifecycle-intent", idempotencyKey: "lifecycle-key" }

    await expect(
      client.dispatch(
        "codex-v2",
        {
          schemaVersion: 1,
          kind: "resume",
          orchestrationId: "task-1",
          providerIdentity: identity,
        },
        dispatchIdentity,
      ),
    ).resolves.toMatchObject({ state: "running" })
    await expect(
      client.dispatch(
        "codex-v2",
        {
          schemaVersion: 1,
          kind: "wait",
          orchestrationId: "task-1",
          providerIdentity: identity,
          targetAgentIds: ["agent-idle"],
          timeoutMs: 1,
        },
        dispatchIdentity,
      ),
    ).resolves.toMatchObject({ state: "completed", result: { waiting: false } })
    await expect(
      client.dispatch(
        "codex-v2",
        {
          schemaVersion: 1,
          kind: "complete",
          orchestrationId: "task-1",
          providerIdentity: identity,
          resultSummary: "done",
        },
        dispatchIdentity,
      ),
    ).resolves.toMatchObject({ state: "completed", result: { resultSummary: "done" } })
    await expect(
      client.dispatch(
        "codex-v2",
        {
          schemaVersion: 1,
          kind: "interrupt",
          orchestrationId: "task-1",
          providerIdentity: identity,
          targetAgentId: "agent-idle",
          message: null,
        },
        dispatchIdentity,
      ),
    ).resolves.toMatchObject({ state: "cancelled", result: { interrupted: false } })
    await client.dispatch(
      "codex-v2",
      {
        schemaVersion: 1,
        kind: "cleanup",
        orchestrationId: "task-1",
        providerIdentity: identity,
      },
      dispatchIdentity,
    )
    await client.dispatch(
      "codex-v1",
      {
        schemaVersion: 1,
        kind: "cleanup",
        orchestrationId: "task-1",
        providerIdentity: {
          schemaVersion: 1,
          engine: "codex-v1",
          providerAgentId: "root-v1",
          nickname: null,
        },
      },
      dispatchIdentity,
    )
    expect(transport.request).toHaveBeenCalledWith("thread/resume", { threadId: "root-v2" })
    expect(transport.request).toHaveBeenCalledWith("thread/unsubscribe", {
      threadId: "root-v2",
    })
    expect(transport.request).toHaveBeenCalledWith("thread/archive", { threadId: "root-v1" })
  })
})

describe("activity source review invariants", () => {
  it("redacts before storage and rebuilds the same history after restart", () => {
    seedAgent("activity-agent", "activity-run")
    createAgentOrchestrationService(databasePath).reportProgress({
      taskId: "task-1",
      agentId: "activity-agent",
      status: "completed",
      resultSummary: "Done",
    })
    const projection = new OrchestrationActivityProjectionService(databasePath)
    projection.recordActivitySummary(
      "task-1",
      "token=sk-proj-012345678901234567 https://user:password@example.test xoxb-1234567890123456 worker started",
    )
    const first = projection.list("task-1")
    expect(
      first.some((event) => event.agentId === "activity-agent" && event.phase === "completed"),
    ).toBe(true)
    const summary = first.find((event) => event.phase === "summary")?.summary
    expect(summary).toContain("[REDACTED]")
    expect(summary).not.toContain("sk-proj")
    expect(summary).not.toContain("password")
    expect(summary).not.toContain("xoxb-")
    const restarted = new OrchestrationActivityProjectionService(databasePath)
    restarted.rebuild("task-1")
    expect(restarted.list("task-1")).toEqual(first)
    expect(redactActivitySummary("x".repeat(10_000)).length).toBeLessThan(1_100)
  })
})

function baseDefinition(
  steps: OrchestrationTemplateDefinition["workflow"]["steps"],
): OrchestrationTemplateDefinition {
  return {
    schemaVersion: 1,
    engine: "workflow",
    agents: [
      {
        definitionId: "worker-definition",
        role: "Worker",
        prompt: "Work",
        harness: "codex",
        runtimePreference: "codex",
        permissionMode: "read-only",
        worktreeStrategy: "none",
        dependencyAgentIds: [],
        completionCriteria: "Done",
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
    workflow: { schemaVersion: 1, steps },
    presentationStyle: null,
  }
}
function step(
  id: string,
  kind: OrchestrationTemplateDefinition["workflow"]["steps"][number]["kind"],
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    kind,
    agentDefinitionId: ["agent", "synthesis"].includes(kind) ? "worker-definition" : null,
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
function gateWorkflow() {
  return baseDefinition([step("gate", "human-gate")])
}
function branchLoopWorkflow() {
  return baseDefinition([
    step("gate", "human-gate"),
    step("branch", "branch", {
      dependsOn: ["gate"],
      condition: { stepId: "gate", path: ["decision"], equals: "approve" },
      thenStepIds: ["then-worker"],
      elseStepIds: ["else-worker"],
    }),
    step("then-worker", "agent", { dependsOn: ["branch"] }),
    step("else-worker", "agent", { dependsOn: ["branch"] }),
  ])
}
function loopWorkflow() {
  return baseDefinition([
    step("loop", "loop", {
      bodyStepIds: ["body"],
      maxIterations: 2,
      outputSchema: {
        type: "object",
        required: ["done"],
        properties: { done: { type: "boolean" } },
        additionalProperties: false,
      },
    }),
    step("body", "agent", { dependsOn: ["loop"] }),
  ])
}
function twoWorkerWorkflow() {
  const definition = baseDefinition([step("a", "agent"), step("b", "agent")])
  definition.policy.maxParallelAgents = 1
  return definition
}
function runtime(): RuntimeLaunchCoordinatorPort {
  return {
    reserve: vi.fn(async (request) => ({
      orchestrationAgentId: `agent-${request.runId}`,
      agentDefinitionId: request.agentDefinitionId,
    })),
    launch: vi.fn(async (request) => ({
      runId: request.runId,
      chatId: request.chatId,
      subChatId: request.subChatId,
      lifecycleState: "completed" as const,
      activityReference: null,
    })),
    reconcile: vi.fn(async (runId) => reference(runId, "completed")),
    cancel: vi.fn(async (runId) => reference(runId, "completed")),
  }
}
function reference(runId: string, lifecycleState: "running" | "completed" | "failed") {
  return {
    runId,
    chatId: "chat-1",
    subChatId: `sub-${runId}`,
    lifecycleState,
    activityReference: null,
  } as const
}
function launchRequest(runId: string) {
  return { runId, chatId: "chat-1", subChatId: `sub-${runId}` }
}
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
function seedPendingRuntimeRun(
  runId: string,
  agentDefinition: OrchestrationAgentDefinition = {
    definitionId: "worker-definition",
    role: "Worker",
    prompt: "Durable worker prompt",
    harness: "codex" as const,
    permissionMode: "read-only" as const,
    worktreeStrategy: "none" as const,
    dependencyAgentIds: [],
    completionCriteria: "Done",
  },
) {
  if (!agentDefinition.definitionId) throw new Error("Test agent definitionId is required.")
  const db = new Database(databasePath)
  const subChatId = `sub-${runId}`
  db.prepare(
    "INSERT INTO sub_chats (id, chat_id, harness, permission_mode, run_status, messages, created_at, updated_at) VALUES (?, 'chat-1', 'codex', 'read-only', 'pending', '[]', 1, 1)",
  ).run(subChatId)
  db.prepare(
    `INSERT INTO agent_runs
     (id, chat_id, sub_chat_id, harness, model, permission_mode, initial_prompt,
      status, started_at, runtime_snapshot_version, runtime_preference,
      runtime_preference_source, resolved_runtime, runtime_adapter_version,
      runtime_protocol_version, runtime_capability_snapshot, runtime_control_snapshot)
     VALUES (?, 'chat-1', ?, 'codex', ?, 'read-only', 'Durable worker prompt',
      'pending', 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    subChatId,
    agentDefinition.model ?? null,
    ...testRuntimeSnapshotSqlValues("codex", "codex"),
  )
  db.prepare(
    `INSERT INTO orchestration_agents
     (id, task_id, chat_id, run_id, depth, definition, dependency_agent_ids,
      status, queued_at, updated_at)
     VALUES (?, 'task-1', 'chat-1', ?, 1, ?, '[]', 'active', 1, 1)`,
  ).run(`agent-${runId}`, runId, JSON.stringify(agentDefinition))
  db.close()
  return {
    taskId: "task-1",
    runId,
    chatId: "chat-1",
    subChatId,
    agentDefinitionId: agentDefinition.definitionId,
    agentDefinition,
    outputSchema: null,
  }
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
function seedTemplateApproval(auditId: string, definition: OrchestrationTemplateDefinition) {
  const db = new Database(databasePath)
  const invocationId = `invocation-${auditId}`
  const callerRunId = (
    db
      .prepare(
        "SELECT id FROM agent_runs WHERE chat_id = 'chat-1' ORDER BY started_at DESC, id DESC LIMIT 1",
      )
      .get() as { id: string } | undefined
  )?.id
  const contextHash = approvalContextHash({
    toolName: TEMPLATE_LAUNCH_APPROVAL_TOOL,
    callerChatId: "chat-1",
    callerRunId: callerRunId ?? null,
    authority: templateLaunchAuthority("task-1", definition, 1),
  })
  db.prepare(
    `INSERT INTO mcp_approval_requests
     (id, invocation_id, caller_chat_id, caller_run_id, tool_name, tier, target_summary,
      input_summary, decision, grant_session, created_at, expires_at)
     VALUES (?, ?, 'chat-1', ?, ?, 3, 'workflow launch', ?, 'approve', 0, 1, 9999999999)`,
  ).run(
    invocationId,
    invocationId,
    callerRunId ?? null,
    TEMPLATE_LAUNCH_APPROVAL_TOOL,
    JSON.stringify({ contextHash }),
  )
  db.prepare(
    `INSERT INTO mcp_audit_records
     (id, invocation_id, status, caller_chat_id, caller_run_id, tool_name, tier,
      caller_snapshot, chat_snapshot, run_snapshot, input_summary, result_summary,
      duration_ms, created_at)
     VALUES (?, ?, 'completed', 'chat-1', ?, ?, 3, '{}', '{}', '{}', '{}', '{}', 0, 1)`,
  ).run(auditId, invocationId, callerRunId ?? null, TEMPLATE_LAUNCH_APPROVAL_TOOL)
  db.close()
}
function readTaskStatus() {
  const db = new Database(databasePath, { readonly: true })
  const row = db
    .prepare("SELECT status FROM task_orchestrations WHERE task_id = 'task-1'")
    .get() as { status: string }
  db.close()
  return row.status
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

function v2Identity(providerTaskId: string) {
  return {
    schemaVersion: 1 as const,
    engine: "codex-v2" as const,
    canonicalTaskPath: "/root/worker",
    taskName: "worker",
    providerTaskId,
  }
}

function fakeCodexProtocol(
  handler: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): CodexAppServerCoordinationTransportPort & { request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(handler)
  return {
    version: vi.fn(async () => "0.144.1"),
    request,
  }
}
