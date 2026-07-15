import Database from "better-sqlite3"
import type {
  CoordinationEngine,
  CoordinationEngineAdapter,
  CoordinationEngineProbe,
} from "../../../shared/coordination-engine"
import { OrchestrationActivityProjectionService } from "./activity-projection"
import { CascadeControlService } from "./cascade-control"
import {
  createMainRuntimeLaunchPort,
  type MainRuntimeLaunchServicePort,
  type RuntimeLaunchCoordinatorPort,
} from "./runtime-launch-port"
import { WorkflowEngine } from "./workflow-engine"
import { createCodexCoordinationAdapter, type CodexCoordinationClient } from "./codex-engines"
import type { WorkflowAgentMaterializerPort } from "./worker-materializer-port"
import { createCodexAppServerCoordinationClient } from "./codex-app-server-coordination"

export type OrchestrationOperationsRuntime = {
  runtime: RuntimeLaunchCoordinatorPort
  workerMaterializer?: WorkflowAgentMaterializerPort
  codexV2?: CoordinationEngineAdapter
  codexV1?: CoordinationEngineAdapter
}

let configured: OrchestrationOperationsRuntime | null = null

/** F11/provider startup owns registration. F3 never constructs or selects adapters here. */
export function registerOrchestrationOperationsRuntime(runtime: OrchestrationOperationsRuntime) {
  configured = runtime
}

/** Production binding for the reviewed F11 singleton; F3 does not construct it. */
export function registerMainRuntimeOperations(
  databasePath: string,
  service: MainRuntimeLaunchServicePort,
) {
  const codexClient = service.codexCoordination
    ? createCodexAppServerCoordinationClient({
        databasePath,
        transport: service.codexCoordination,
      })
    : null
  registerOrchestrationOperationsRuntime({
    runtime: createMainRuntimeLaunchPort(databasePath, service),
    ...(configured?.workerMaterializer
      ? { workerMaterializer: configured.workerMaterializer }
      : {}),
    ...(codexClient
      ? { codexV2: createCodexCoordinationAdapter(databasePath, "codex-v2", codexClient) }
      : configured?.codexV2
        ? { codexV2: configured.codexV2 }
        : {}),
    ...(codexClient
      ? { codexV1: createCodexCoordinationAdapter(databasePath, "codex-v1", codexClient) }
      : configured?.codexV1
        ? { codexV1: configured.codexV1 }
        : {}),
  })
}

export function registerWorkflowAgentMaterializer(materializer: WorkflowAgentMaterializerPort) {
  const runtime = requireRuntime()
  configured = { ...runtime, workerMaterializer: materializer }
}

export function registerCodexCoordinationClients(
  databasePath: string,
  clients: { v2?: CodexCoordinationClient; v1?: CodexCoordinationClient },
) {
  const runtime = requireRuntime()
  configured = {
    ...runtime,
    ...(clients.v2
      ? { codexV2: createCodexCoordinationAdapter(databasePath, "codex-v2", clients.v2) }
      : {}),
    ...(clients.v1
      ? { codexV1: createCodexCoordinationAdapter(databasePath, "codex-v1", clients.v1) }
      : {}),
  }
}

export async function getRegisteredCoordinationEngineProbes() {
  const probes: Partial<Record<CoordinationEngine, CoordinationEngineProbe>> = {}
  if (configured?.codexV2) {
    try {
      probes["codex-v2"] = await configured.codexV2.probe()
    } catch {
      // Routers retain their fail-closed unavailable probe when a provider probe fails.
    }
  }
  if (configured?.codexV1) {
    try {
      probes["codex-v1"] = await configured.codexV1.probe()
    } catch {
      // Routers retain their fail-closed unavailable probe when a provider probe fails.
    }
  }
  return probes
}

export function clearOrchestrationOperationsRuntime() {
  configured = null
}

export function orchestrationRuntimeAvailable() {
  return configured !== null
}

export function getWorkflowEngine(databasePath: string) {
  const runtime = requireRuntime()
  return new WorkflowEngine(databasePath, runtime.runtime, runtime.workerMaterializer)
}

export function getCascadeControl(databasePath: string) {
  return new CascadeControlService(databasePath, requireRuntime().runtime)
}

export function getCodexCoordination(engine: "codex-v2" | "codex-v1") {
  const runtime = requireRuntime()
  const adapter = engine === "codex-v2" ? runtime.codexV2 : runtime.codexV1
  if (!adapter) throw new Error(`${engine} coordination client is unavailable; no fallback.`)
  return adapter
}

export async function recoverOrchestrationOperations(databasePath: string) {
  const db = new Database(databasePath, { readonly: true })
  let taskIds: string[] = []
  try {
    taskIds = (
      db.prepare("SELECT task_id FROM task_orchestrations ORDER BY task_id").all() as Array<{
        task_id: string
      }>
    ).map((row) => row.task_id)
  } finally {
    db.close()
  }
  const activity = new OrchestrationActivityProjectionService(databasePath)
  for (const taskId of taskIds) activity.rebuild(taskId)
  if (!configured) return { rebuiltTasks: taskIds.length, reconciledControls: 0, runtime: false }
  const cascade = getCascadeControl(databasePath)
  let reconciledControls = 0
  for (const intentId of cascade.pendingIntents()) {
    await cascade.reconcile(intentId)
    reconciledControls += 1
  }
  return { rebuiltTasks: taskIds.length, reconciledControls, runtime: true }
}

export async function advancePendingWorkflows(databasePath: string) {
  if (!configured) return { attempted: 0, failed: 0, runtime: false }
  const db = new Database(databasePath, { readonly: true })
  let runIds: string[]
  try {
    runIds = (
      db
        .prepare(
          `SELECT id FROM orchestration_workflow_runs
           WHERE status IN ('queued','running','waiting','uncertain') AND stop_intent = 0
           ORDER BY updated_at, created_at, id LIMIT 32`,
        )
        .all() as Array<{ id: string }>
    ).map((row) => row.id)
  } finally {
    db.close()
  }
  const engine = getWorkflowEngine(databasePath)
  const settled = await Promise.allSettled(runIds.map((runId) => engine.advance(runId)))
  return {
    attempted: runIds.length,
    failed: settled.filter((result) => result.status === "rejected").length,
    runtime: true,
  }
}

function requireRuntime() {
  if (!configured)
    throw new Error(
      "F11 RuntimeLaunchCoordinator production registration is unavailable; dependent F3 operation remains open.",
    )
  return configured
}
