import Database from "better-sqlite3"
import type { CoordinationEngineAdapter } from "../../../shared/coordination-engine"
import { OrchestrationActivityProjectionService } from "./activity-projection"
import { CascadeControlService } from "./cascade-control"
import {
  createMainRuntimeLaunchPort,
  type MainRuntimeLaunchServicePort,
  type RuntimeLaunchCoordinatorPort,
} from "./runtime-launch-port"
import { WorkflowEngine } from "./workflow-engine"

export type OrchestrationOperationsRuntime = {
  runtime: RuntimeLaunchCoordinatorPort
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
  registerOrchestrationOperationsRuntime({
    runtime: createMainRuntimeLaunchPort(databasePath, service),
  })
}

export function clearOrchestrationOperationsRuntime() {
  configured = null
}

export function orchestrationRuntimeAvailable() {
  return configured !== null
}

export function getWorkflowEngine(databasePath: string) {
  return new WorkflowEngine(databasePath, requireRuntime().runtime)
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

function requireRuntime() {
  if (!configured)
    throw new Error(
      "F11 RuntimeLaunchCoordinator production registration is unavailable; dependent F3 operation remains open.",
    )
  return configured
}
