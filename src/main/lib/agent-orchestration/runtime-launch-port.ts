import Database from "better-sqlite3"
import type { ResolvedRuntimeLaunch } from "../../../shared/agent-runtime"
import {
  orchestrationAgentDefinitionSchema,
  type OrchestrationAgentDefinition,
} from "../../../shared/agent-orchestration"
import type { AgentHarness } from "../../../shared/harness-types"
import { resolvedLaunchFromSnapshotRow } from "../agent-runtime/snapshot"
import { claimPendingRunWithinUsageBudget } from "../usage/budgets"
import { recordOrchestrationTransition } from "./activity-projection"

type Row = Record<string, unknown>

export type RuntimeReconciliationState =
  "running" | "completed" | "cancelled" | "failed" | "uncertain"

export type RuntimeLaunchReference = {
  runId: string
  chatId: string
  subChatId: string
  lifecycleState: RuntimeReconciliationState
  activityReference: { runId: string; afterSequence: number } | null
}

export type RuntimeStructuredOutput = {
  value: unknown
  activityReference: { runId: string; eventId: string; sequence: number }
}

export type RuntimeLaunchRequest = {
  taskId: string
  runId: string
  chatId: string
  subChatId: string
  agentDefinitionId: string
  agentDefinition: OrchestrationAgentDefinition
}

export type RuntimeLaunchBinding = {
  orchestrationAgentId: string
  agentDefinitionId: string
}

export type RuntimeLaunchOwnership = {
  workflowRunId: string
  stepId: string
  attemptCount: number
}

/** Exact durable input accepted by F11 MainRuntimeLaunchService.launch. */
export type MainRuntimeQueuedRun = {
  runId: string
  chatId: string
  subChatId: string
  harness: AgentHarness
  prompt: string
  model: string | null
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | null
  permissionMode: string
  customPermissions: string | null
  worktreePath: string | null
  projectPath: string | null
  runtimeLaunch: ResolvedRuntimeLaunch
}

/** Structural view of the reviewed F11 singleton. F3 never constructs it. */
export interface MainRuntimeLaunchServicePort {
  launch(run: MainRuntimeQueuedRun): Promise<void>
  reconcileRun(runId: string): Promise<RuntimeReconciliationState>
  cancel(runId: string, reason: string): Promise<boolean>
  pause?(runId: string): Promise<boolean>
  resume?(runId: string): Promise<boolean>
  readStructuredOutput?(runId: string): Promise<RuntimeStructuredOutput | null>
}

/** F3 consumes this provider-neutral port only. */
export interface RuntimeLaunchCoordinatorPort {
  reserve(
    request: RuntimeLaunchRequest,
    ownership: RuntimeLaunchOwnership,
  ): Promise<RuntimeLaunchBinding>
  launch(
    request: RuntimeLaunchRequest,
    ownership: RuntimeLaunchOwnership,
  ): Promise<RuntimeLaunchReference>
  reconcile(runId: string): Promise<RuntimeLaunchReference>
  cancel(runId: string, reason: string): Promise<RuntimeLaunchReference>
  pause?(runId: string): Promise<RuntimeLaunchReference>
  resume?(runId: string): Promise<RuntimeLaunchReference>
  readStructuredOutput?(runId: string): Promise<RuntimeStructuredOutput | null>
}

/**
 * Thin F3 bridge over the F11 singleton and durable rows. It never selects an
 * adapter, rebuilds a Runtime snapshot, or copies provider activity text.
 */
export function createMainRuntimeLaunchPort(
  databasePath: string,
  service: MainRuntimeLaunchServicePort,
): RuntimeLaunchCoordinatorPort {
  return {
    async reserve(request, ownership) {
      const db = open(databasePath)
      try {
        return db.transaction(() => reserveDurableRun(db, request, ownership)).immediate()
      } finally {
        db.close()
      }
    },
    async launch(request, ownership) {
      const db = open(databasePath)
      let run: ReturnType<typeof loadDurableRun>
      try {
        run = loadDurableRun(db, request)
        if (run.status !== "running" || !hasExactReservation(db, request, ownership, run.binding))
          throw new Error("Runtime launch is not owned by this workflow checkpoint attempt.")
      } finally {
        db.close()
      }
      await service.launch(run.value)
      return reference(databasePath, service, request.runId)
    },
    async reconcile(runId) {
      requireDurableIdentity(databasePath, runId)
      return reference(databasePath, service, runId)
    },
    async cancel(runId, reason) {
      requireDurableIdentity(databasePath, runId)
      await service.cancel(runId, reason)
      return reference(databasePath, service, runId)
    },
    async pause(runId) {
      requireDurableIdentity(databasePath, runId)
      if (!service.pause || !(await service.pause(runId)))
        throw new Error(`Runtime run ${runId} has no active pause authority.`)
      return reference(databasePath, service, runId)
    },
    async resume(runId) {
      requireDurableIdentity(databasePath, runId)
      if (!service.resume || !(await service.resume(runId)))
        throw new Error(`Runtime run ${runId} has no active resume authority.`)
      return reference(databasePath, service, runId)
    },
    async readStructuredOutput(runId) {
      requireDurableIdentity(databasePath, runId)
      if (!service.readStructuredOutput) return null
      return service.readStructuredOutput(runId)
    },
  }
}

function loadDurableRun(
  db: Database.Database,
  request: RuntimeLaunchRequest,
): { status: string; value: MainRuntimeQueuedRun; binding: RuntimeLaunchBinding } {
  if (!request.runId || !request.chatId || !request.subChatId)
    throw new Error("Runtime launch requires durable run/chat/subchat identity.")
  const rows = db
    .prepare(
      `SELECT r.*, c.project_id, p.path project_path, s.chat_id sub_chat_chat_id, oa.task_id,
                oa.id orchestration_agent_id, oa.chat_id orchestration_chat_id,
                oa.definition orchestration_definition, oa.status orchestration_agent_status,
                json_extract(oa.definition, '$.reasoningEffort') reasoning_effort
         FROM agent_runs r
         JOIN chats c ON c.id = r.chat_id
         JOIN sub_chats s ON s.id = r.sub_chat_id
         LEFT JOIN projects p ON p.id = c.project_id
         JOIN orchestration_agents oa ON oa.run_id = r.id
         WHERE r.id = ?`,
    )
    .all(request.runId) as Row[]
  if (rows.length === 0) throw new Error(`Runtime run ${request.runId} is missing.`)
  if (rows.length !== 1)
    throw new Error("Runtime launch durable orchestration agent ownership is ambiguous.")
  const row = rows[0]!
  if (
    String(row.chat_id) !== request.chatId ||
    String(row.sub_chat_id) !== request.subChatId ||
    String(row.sub_chat_chat_id) !== request.chatId ||
    String(row.task_id) !== request.taskId ||
    String(row.orchestration_chat_id) !== request.chatId ||
    String(row.orchestration_agent_status) !== "active"
  )
    throw new Error("Runtime launch durable run/chat/subchat identity mismatch.")
  const expectedDefinition = orchestrationAgentDefinitionSchema.parse(request.agentDefinition)
  const durableDefinition = orchestrationAgentDefinitionSchema.parse(
    JSON.parse(String(row.orchestration_definition)),
  )
  if (
    !request.agentDefinitionId ||
    expectedDefinition.definitionId !== request.agentDefinitionId ||
    durableDefinition.definitionId !== request.agentDefinitionId ||
    canonicalJson(durableDefinition) !== canonicalJson(expectedDefinition)
  )
    throw new Error("Runtime launch durable agent definition snapshot mismatch.")
  const prompt = typeof row.initial_prompt === "string" ? row.initial_prompt.trim() : ""
  if (!prompt) throw new Error("Runtime launch durable prompt is missing.")
  const harness = String(row.harness)
  if (!isAgentHarness(harness)) throw new Error("Runtime launch durable harness is invalid.")
  const runtimeLaunch = resolvedLaunchFromSnapshotRow(row)
  const durableCustomPermissions = row.custom_permissions
    ? JSON.parse(String(row.custom_permissions))
    : null
  if (
    harness !== durableDefinition.harness ||
    stringOrNull(row.model) !== (durableDefinition.model ?? null) ||
    String(row.permission_mode) !== durableDefinition.permissionMode ||
    canonicalJson(durableCustomPermissions) !==
      canonicalJson(durableDefinition.customPermissions ?? null) ||
    runtimeLaunch.harness !== durableDefinition.harness ||
    runtimeLaunch.model !== (durableDefinition.model ?? null) ||
    runtimeLaunch.permission.mode !== durableDefinition.permissionMode ||
    canonicalJson(runtimeLaunch.permission.customPermissions) !==
      canonicalJson(durableDefinition.customPermissions ?? null) ||
    (durableDefinition.runtimePreference !== undefined &&
      runtimeLaunch.requestedPreference !== durableDefinition.runtimePreference)
  )
    throw new Error("Runtime launch durable fields do not match the agent definition snapshot.")
  return {
    status: String(row.status),
    value: {
      runId: request.runId,
      chatId: request.chatId,
      subChatId: request.subChatId,
      harness,
      prompt,
      model: stringOrNull(row.model),
      reasoningEffort: isReasoningEffort(row.reasoning_effort) ? row.reasoning_effort : null,
      permissionMode: String(row.permission_mode),
      customPermissions: stringOrNull(row.custom_permissions),
      worktreePath: stringOrNull(row.worktree_path),
      projectPath: stringOrNull(row.project_path),
      runtimeLaunch,
    },
    binding: {
      orchestrationAgentId: String(row.orchestration_agent_id),
      agentDefinitionId: request.agentDefinitionId,
    },
  }
}

function reserveDurableRun(
  db: Database.Database,
  request: RuntimeLaunchRequest,
  ownership: RuntimeLaunchOwnership,
): RuntimeLaunchBinding {
  const run = loadDurableRun(db, request)
  if (run.status === "running" && hasExactReservation(db, request, ownership, run.binding))
    return run.binding
  if (run.status !== "pending")
    throw new Error("Workflow launch requires a fresh pending Runtime run.")
  if (hasAnyReservation(db, request, ownership, run.binding))
    throw new Error("Runtime run, orchestration agent, or checkpoint attempt is already reserved.")
  const entityId = ownershipEntityId(ownership)
  if (
    !recordReservation(db, {
      dedupKey: checkpointReservationKey(ownership),
      request,
      binding: run.binding,
      entityId,
      phase: "checkpoint-attempt-bound",
    }) ||
    !recordReservation(db, {
      dedupKey: runReservationKey(request.runId),
      request,
      binding: run.binding,
      entityId,
      phase: "runtime-run-bound",
    }) ||
    !recordReservation(db, {
      dedupKey: agentReservationKey(run.binding.orchestrationAgentId),
      request,
      binding: run.binding,
      entityId,
      phase: "orchestration-agent-bound",
    })
  )
    throw new Error("Runtime reservation ownership was lost.")
  const claim = claimPendingRunWithinUsageBudget(db, request.runId)
  if (!claim.claimed) throw new Error("Runtime pending-run claim was lost.")
  db.prepare("UPDATE sub_chats SET run_status = 'running', updated_at = ? WHERE id = ?").run(
    epoch(),
    request.subChatId,
  )
  return run.binding
}

function hasExactReservation(
  db: Database.Database,
  request: RuntimeLaunchRequest,
  ownership: RuntimeLaunchOwnership,
  binding: RuntimeLaunchBinding,
) {
  const entityId = ownershipEntityId(ownership)
  const rows = db
    .prepare(
      `SELECT dedup_key, entity_id, run_id, agent_id FROM orchestration_transition_events
       WHERE dedup_key IN (?, ?, ?)`,
    )
    .all(
      checkpointReservationKey(ownership),
      runReservationKey(request.runId),
      agentReservationKey(binding.orchestrationAgentId),
    ) as Row[]
  return (
    rows.length === 3 &&
    rows.every(
      (row) =>
        String(row.entity_id) === entityId &&
        String(row.run_id) === request.runId &&
        String(row.agent_id) === binding.orchestrationAgentId,
    )
  )
}

function hasAnyReservation(
  db: Database.Database,
  request: RuntimeLaunchRequest,
  ownership: RuntimeLaunchOwnership,
  binding: RuntimeLaunchBinding,
) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM orchestration_transition_events
         WHERE dedup_key IN (?, ?, ?) LIMIT 1`,
      )
      .get(
        checkpointReservationKey(ownership),
        runReservationKey(request.runId),
        agentReservationKey(binding.orchestrationAgentId),
      ),
  )
}

function recordReservation(
  db: Database.Database,
  input: {
    dedupKey: string
    request: RuntimeLaunchRequest
    binding: RuntimeLaunchBinding
    entityId: string
    phase: string
  },
) {
  return recordOrchestrationTransition(db, {
    dedupKey: input.dedupKey,
    taskId: input.request.taskId,
    entityType: "checkpoint",
    entityId: input.entityId,
    agentId: input.binding.orchestrationAgentId,
    runId: input.request.runId,
    kind: "dependency",
    phase: input.phase,
  })
}

function ownershipEntityId(ownership: RuntimeLaunchOwnership) {
  return `${ownership.workflowRunId}:${ownership.stepId}:${ownership.attemptCount}`
}

function runReservationKey(runId: string) {
  return `workflow-runtime-run-binding:${runId}`
}

function checkpointReservationKey(ownership: RuntimeLaunchOwnership) {
  return `workflow-checkpoint-attempt-binding:${ownershipEntityId(ownership)}`
}

function agentReservationKey(agentId: string) {
  return `workflow-orchestration-agent-binding:${agentId}`
}

function requireDurableIdentity(databasePath: string, runId: string) {
  const db = open(databasePath)
  try {
    const row = db
      .prepare(
        `SELECT r.chat_id, r.sub_chat_id, s.chat_id sub_chat_chat_id
         FROM agent_runs r JOIN sub_chats s ON s.id = r.sub_chat_id WHERE r.id = ?`,
      )
      .get(runId) as Row | undefined
    if (!row || typeof row.sub_chat_id !== "string" || row.chat_id !== row.sub_chat_chat_id)
      throw new Error("Runtime durable run/chat/subchat identity is missing or mismatched.")
    return {
      runId,
      chatId: String(row.chat_id),
      subChatId: String(row.sub_chat_id),
    }
  } finally {
    db.close()
  }
}

async function reference(
  databasePath: string,
  service: MainRuntimeLaunchServicePort,
  runId: string,
): Promise<RuntimeLaunchReference> {
  const identity = requireDurableIdentity(databasePath, runId)
  const lifecycleState = await service.reconcileRun(runId)
  const db = open(databasePath)
  try {
    const highWater = Number(
      (
        db
          .prepare(
            "SELECT COALESCE(MAX(sequence), 0) value FROM agent_activity_events WHERE run_id = ?",
          )
          .get(runId) as { value: number }
      ).value,
    )
    return {
      ...identity,
      lifecycleState,
      activityReference: highWater > 0 ? { runId, afterSequence: highWater } : null,
    }
  } finally {
    db.close()
  }
}

function open(databasePath: string) {
  const db = new Database(databasePath)
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  return db
}

function isAgentHarness(value: string): value is AgentHarness {
  return ["codex", "claude-code", "cursor-agent", "openrouter", "nanogpt", "local"].includes(value)
}

function isReasoningEffort(
  value: unknown,
): value is "minimal" | "low" | "medium" | "high" | "xhigh" {
  return ["minimal", "low", "medium", "high", "xhigh"].includes(String(value))
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`
  return JSON.stringify(value)
}

function epoch() {
  return Math.floor(Date.now() / 1000)
}
