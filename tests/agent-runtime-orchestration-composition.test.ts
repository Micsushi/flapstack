import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAgentOrchestrationService } from "../src/main/lib/agent-orchestration/service"
import {
  createMainRuntimeLaunchPort,
  type RuntimeLaunchRequest,
} from "../src/main/lib/agent-orchestration/runtime-launch-port"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import { resolvedLaunchFromSnapshotRow } from "../src/main/lib/agent-runtime/snapshot"
import { AgentRuntimeRegistry } from "../src/main/lib/agent-runtime/registry"
import {
  getMainRuntimeLaunchService,
  resetMainRuntimeLaunchServicesForTests,
} from "../src/main/lib/main-run-launcher"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import * as schema from "../src/main/lib/db/schema"
import type { HarnessAdapter, RuntimeAdapterContext } from "../src/shared/agent-runtime"

// Provider routers are not part of this no-provider composition fixture.
vi.mock("../src/main/lib/trpc/routers", () => ({
  createAppRouter: () => ({ createCaller: () => ({}) }),
}))
vi.mock("../src/main/lib/mcp-control/invalidation-bridge", () => ({
  publishLocalProductInvalidation: vi.fn(),
}))

let directory: string
let databasePath: string
let projectPath: string
let db: Database.Database
let observed: Array<{
  context: RuntimeAdapterContext
  row: Record<string, unknown>
  intent: number
}>

beforeEach(() => {
  resetMainRuntimeLaunchServicesForTests()
  directory = mkdtempSync(join(tmpdir(), "flapstack-registry-composition-"))
  databasePath = join(directory, "agents.db")
  projectPath = join(directory, "project")
  execFileSync("git", ["init", "-b", "main", projectPath], { windowsHide: true })
  execFileSync("git", ["-C", projectPath, "commit", "--allow-empty", "-m", "fixture"], {
    windowsHide: true,
  })
  projectPath = realpathSync(projectPath)
  db = new Database(databasePath)
  migrateDatabase(drizzle(db, { schema }), db, resolve("drizzle"))
  db.prepare("INSERT INTO projects (id,name,path) VALUES ('project','Project',?)").run(projectPath)
  db.prepare(
    `INSERT INTO chats (id,name,scope,project_id,permission_mode,harness,worktree_path,branch,initiator_chat_id,ancestor_chat_ids)
    VALUES ('root','Root','project','project','full-access','codex',?,'main','root','[]')`,
  ).run(projectPath)
  observed = []
})

afterEach(() => {
  resetMainRuntimeLaunchServicesForTests()
  db.close()
  rmSync(directory, { recursive: true, force: true })
})

function definition(runtime: "codex" | "claude-code") {
  return {
    definitionId: `definition-${runtime}`,
    agentId: `worker-${runtime}`,
    role: "reviewer",
    prompt: `Inspect ${runtime}`,
    harness: runtime,
    model: "fixture-model",
    runtimePreference: runtime,
    permissionMode: "read-only" as const,
    worktreeStrategy: "inherit" as const,
    dependencyAgentIds: [],
    completionCriteria: "Report findings",
  }
}

function createWorkers() {
  const service = createAgentOrchestrationService(databasePath)
  const overview = service.create({
    projectId: "project",
    initiatingChatId: "root",
    task: { mode: "create", name: "Composition" },
    coordinationEngine: "workflow",
    maxParallelAgents: 2,
    maxDepth: 2,
    stopConditions: { maxTotalTokens: 1000 },
    agents: [definition("codex"), definition("claude-code")],
  })
  return overview.agents.map((agent): RuntimeLaunchRequest => {
    const row = db
      .prepare(
        "SELECT r.sub_chat_id, oa.definition FROM agent_runs r JOIN orchestration_agents oa ON oa.run_id=r.id WHERE r.id=?",
      )
      .get(agent.runId) as { sub_chat_id: string; definition: string }
    const agentDefinition = JSON.parse(row.definition)
    return {
      taskId: overview.orchestration.taskId,
      runId: agent.runId!,
      chatId: agent.chatId!,
      subChatId: row.sub_chat_id,
      agentDefinitionId: agentDefinition.definitionId,
      agentDefinition,
      outputSchema: null,
    }
  })
}

function adapter(runtime: "codex" | "claude-code"): HarnessAdapter {
  return {
    runtime,
    probe: async () => ({
      runtime,
      harness: runtime,
      available: true,
      versions: { adapterVersion: `${runtime}-fixture`, protocolVersion: "fixture-v1" },
      capabilities: {
        schemaVersion: 1,
        status: "available",
        capturedAt: null,
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
    }),
    startSession: async (context) => {
      const row = db.prepare("SELECT * FROM agent_runs WHERE id=?").get(context.runId) as Record<
        string,
        unknown
      >
      const intent = db
        .prepare(
          "SELECT count(*) n FROM agent_activity_events WHERE run_id=? AND json_extract(payload_json, '$.state')='intent-persisted'",
        )
        .get(context.runId) as { n: number }
      observed.push({ context, row, intent: intent.n })
      return {
        providerSessionId: `session-${context.runId}`,
        providerThreadId: `thread-${context.runId}`,
      }
    },
    resumeSession: async (_context, session) => session,
    startTurn: async (context) => ({ providerTurnId: `turn-${context.runId}` }),
    async *streamActivity(context) {
      const owner = db
        .prepare("SELECT id FROM orchestration_agents WHERE run_id=?")
        .get(context.runId) as { id: string }
      yield createAgentActivityStore(db).append(context.runId, {
        provider: runtime === "codex" ? "openai" : "anthropic",
        kind: "agent-text",
        phase: "completed",
        displayClass: "provider-visible",
        privacyClass: "public",
        orchestrationAgentId: owner.id,
        dedupKey: `answer-${context.runId}`,
        payload: { text: `answer-${runtime}` },
      })
    },
    requestPermission: async () => ({ decision: "deny" }),
    requestInput: async () => ({ answers: {} }),
    cancel: async () => undefined,
    complete: async () => undefined,
    reconcile: async () => "completed",
    cleanup: async () => undefined,
  }
}

function runtimeService(disabled = false) {
  const registry = new AgentRuntimeRegistry(
    ["codex", "claude-code"].map((runtime) => ({
      runtime: runtime as "codex" | "claude-code",
      enabled: !disabled,
      factory: () => adapter(runtime as "codex" | "claude-code"),
    })),
  )
  return getMainRuntimeLaunchService(databasePath, { registry })
}

describe("actual orchestration materialization through the Runtime registry", () => {
  it("preserves worker authority and terminal activity through the real launch port and service recreation", async () => {
    const requests = createWorkers()
    expect(requests).toHaveLength(2)
    const snapshots = requests.map(({ runId }) =>
      db
        .prepare(
          "SELECT runtime_capability_snapshot,runtime_control_snapshot,runtime_adapter_version,runtime_protocol_version,resolved_runtime FROM agent_runs WHERE id=?",
        )
        .get(runId),
    )
    const port = createMainRuntimeLaunchPort(databasePath, runtimeService())
    for (const request of requests) {
      const ownership = {
        workflowRunId: "composition",
        stepId: request.agentDefinitionId,
        attemptCount: 1,
      }
      await port.reserve(request, ownership)
      await expect(port.launch(request, ownership)).resolves.toMatchObject({
        runId: request.runId,
        lifecycleState: "completed",
      })
    }
    expect(observed.map(({ context }) => context.launch.resolvedRuntime).sort()).toEqual([
      "claude-code",
      "codex",
    ])
    for (const { context, row, intent } of observed) {
      expect(intent).toBeGreaterThan(0)
      expect(row).toMatchObject({
        status: "running",
        permission_mode: "read-only",
        custom_permissions: null,
        worktree_path: projectPath,
      })
      expect(context.launch.permission).toEqual({ mode: "read-only", customPermissions: null })
      expect(row.runtime_adapter_version).toBe("unresolved")
      expect(row.runtime_protocol_version).toBe("unresolved")
      const captured = JSON.parse(String(row.runtime_launch_identity))
      expect(captured).toMatchObject({
        runtime: context.launch.resolvedRuntime,
        harness: context.launch.harness,
        versions: {
          adapterVersion: `${context.launch.resolvedRuntime}-fixture`,
          protocolVersion: "fixture-v1",
        },
      })
      expect(context.launch.versions).toEqual(captured.versions)
      expect(resolvedLaunchFromSnapshotRow(row).versions).toEqual(captured.versions)
      expect(() =>
        db
          .prepare("UPDATE agent_runs SET runtime_launch_identity=NULL WHERE id=?")
          .run(context.runId),
      ).toThrow("immutable")
    }
    expect(
      requests.map(({ runId }) =>
        db
          .prepare(
            "SELECT runtime_capability_snapshot,runtime_control_snapshot,runtime_adapter_version,runtime_protocol_version,resolved_runtime FROM agent_runs WHERE id=?",
          )
          .get(runId),
      ),
    ).toEqual(snapshots)
    resetMainRuntimeLaunchServicesForTests()
    const restarted = createMainRuntimeLaunchPort(databasePath, runtimeService(true))
    for (const request of requests) {
      await expect(restarted.reconcile(request.runId)).resolves.toMatchObject({
        lifecycleState: "completed",
        activityReference: { runId: request.runId },
      })
      expect(
        db
          .prepare(
            "SELECT count(*) n FROM agent_activity_events WHERE run_id=? AND kind='agent-text'",
          )
          .get(request.runId),
      ).toEqual({ n: 1 })
    }
    for (const request of requests) {
      const row = db.prepare("SELECT * FROM agent_runs WHERE id=?").get(request.runId) as Record<
        string,
        unknown
      >
      expect(resolvedLaunchFromSnapshotRow(row).versions.adapterVersion).toBe(
        `${row.resolved_runtime}-fixture`,
      )
      for (const captured of [
        "not-json",
        "null",
        JSON.stringify({
          schemaVersion: 1,
          runtime: "wrong",
          harness: row.harness,
          versions: { adapterVersion: "fixture", protocolVersion: "v1" },
        }),
        JSON.stringify({
          schemaVersion: 1,
          runtime: row.resolved_runtime,
          harness: row.harness,
          versions: { adapterVersion: "unresolved", protocolVersion: "v1" },
        }),
      ]) {
        expect(() =>
          resolvedLaunchFromSnapshotRow({ ...row, runtime_launch_identity: captured }),
        ).toThrow("Runtime launch identity")
      }
    }
    expect(observed).toHaveLength(2)
  })

  it("rejects disabled adapters and forged worker identity without provider intent or duplicate runs", async () => {
    const requests = createWorkers()
    const port = createMainRuntimeLaunchPort(databasePath, runtimeService(true))
    const request = requests[0]!
    const ownership = {
      workflowRunId: "disabled",
      stepId: request.agentDefinitionId,
      attemptCount: 1,
    }
    await expect(
      port.reserve(
        { ...request, agentDefinition: { ...request.agentDefinition, prompt: "Forged prompt" } },
        ownership,
      ),
    ).rejects.toThrow("snapshot mismatch")
    await port.reserve(request, ownership)
    await expect(port.launch(request, ownership)).rejects.toThrow("disabled")
    expect(observed).toEqual([])
    expect(db.prepare("SELECT count(*) n FROM agent_runs").get()).toEqual({ n: 2 })
    expect(
      db
        .prepare(
          "SELECT count(*) n FROM agent_activity_events WHERE json_extract(payload_json, '$.state')='intent-persisted'",
        )
        .get(),
    ).toEqual({ n: 0 })
  })
  it("rolls captured identity back when durable intent cannot commit", async () => {
    const [request] = createWorkers()
    const port = createMainRuntimeLaunchPort(databasePath, runtimeService())
    const ownership = {
      workflowRunId: "rollback",
      stepId: request!.agentDefinitionId,
      attemptCount: 1,
    }
    await port.reserve(request!, ownership)
    db.exec(`CREATE TRIGGER fail_intent BEFORE INSERT ON agent_activity_events
      WHEN json_extract(NEW.payload_json, '$.state') = 'intent-persisted'
      BEGIN SELECT RAISE(ABORT, 'fixture intent failure'); END`)
    await expect(port.launch(request!, ownership)).rejects.toThrow("fixture intent failure")
    expect(
      db.prepare("SELECT runtime_launch_identity FROM agent_runs WHERE id=?").get(request!.runId),
    ).toEqual({ runtime_launch_identity: null })
    expect(observed).toEqual([])
  })
})
