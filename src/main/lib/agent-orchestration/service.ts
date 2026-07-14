import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import {
  addOrchestrationAgentInputSchema,
  createOrchestrationInputSchema,
  orchestrationAgentDefinitionSchema,
  orchestrationStopConditionsSchema,
  orchestrationUsageUpdateSchema,
  type AddOrchestrationAgentInput,
  type CreateOrchestrationInput,
  type OrchestrationAgentDefinition,
  type OrchestrationAgentDto,
  type OrchestrationAggregateDto,
  type OrchestrationLineageDto,
  type OrchestrationStopConditions,
  type OrchestrationTaskDto,
  type OrchestrationTaskOverviewDto,
  type OrchestrationUsageUpdate,
} from "../../../shared/agent-orchestration"
import { parseCustomPermissionCapabilities } from "../../../shared/permission-capabilities"
import { epochSecondsToMilliseconds, nowEpochSeconds } from "../db/timestamps"

type Row = Record<string, unknown>
type Sqlite = Database.Database

const TERMINAL_RUN_STATUSES = new Set(["success", "failure", "cancelled"])
const TERMINAL_AGENT_STATUSES = new Set(["completed", "failed", "stopped"])

export class AgentOrchestrationError extends Error {
  constructor(
    readonly code:
      | "invalid-input"
      | "stale-caller"
      | "stale-target"
      | "out-of-scope"
      | "forbidden-loop"
      | "permission-denied"
      | "conflict",
    message: string,
  ) {
    super(message)
  }
}

export type AgentOrchestrationService = ReturnType<typeof createAgentOrchestrationService>

export function createAgentOrchestrationService(databasePath: string) {
  const open = () => {
    const db = new Database(databasePath)
    db.pragma("foreign_keys = ON")
    db.pragma("busy_timeout = 5000")
    return db
  }

  return {
    create(
      inputValue: unknown,
      trustedCallerChatId?: string,
      options: { deferScheduling?: boolean } = {},
    ): OrchestrationTaskOverviewDto {
      const parsed = createOrchestrationInputSchema.safeParse(inputValue)
      if (!parsed.success) invalid(parsed.error.issues[0]?.message)
      const input = parsed.data
      if (trustedCallerChatId && input.initiatingChatId !== trustedCallerChatId) {
        throw new AgentOrchestrationError(
          "stale-caller",
          "The initiating chat must match the trusted MCP caller.",
        )
      }
      validateDefinitions(input.agents)
      const db = open()
      try {
        let taskId = ""
        const create = db.transaction(() => {
          taskId = createOrAttachTask(db, input)
          validateInitialWorktrees(db, taskId, input)
          const existing = db
            .prepare("SELECT task_id FROM task_orchestrations WHERE task_id = ?")
            .get(taskId)
          if (existing) {
            throw new AgentOrchestrationError(
              "conflict",
              "The selected task already has an orchestration.",
            )
          }
          const now = nowEpochSeconds()
          const initialStatus = options.deferScheduling ? "paused" : "queued"
          db.prepare(
            `INSERT INTO task_orchestrations (
              task_id, initiating_chat_id, status, max_parallel_agents, max_depth,
              stop_conditions, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            taskId,
            input.initiatingChatId,
            initialStatus,
            input.maxParallelAgents,
            input.maxDepth,
            JSON.stringify(input.stopConditions),
            now,
            now,
          )
          for (const definition of input.agents) {
            insertAgent(db, {
              id: definition.agentId ?? randomUUID(),
              taskId,
              definition,
              parentAgentId: null,
              replacedAgentId: null,
              ancestorAgentIds: [],
              depth: 1,
              now,
            })
          }
        })
        create.immediate()
        if (!options.deferScheduling) safeTickTask(db, taskId)
        return requireOverview(db, taskId)
      } finally {
        db.close()
      }
    },

    addAgent(inputValue: unknown): OrchestrationAgentDto {
      const parsed = addOrchestrationAgentInputSchema.safeParse(inputValue)
      if (!parsed.success) invalid(parsed.error.issues[0]?.message)
      const db = open()
      try {
        let result!: OrchestrationAgentDto
        const add = db.transaction(() => {
          result = addAgent(db, parsed.data)
        })
        add.immediate()
        safeTickTask(db, parsed.data.taskId)
        return result
      } finally {
        db.close()
      }
    },

    retryAgent(taskId: string, agentId: string): OrchestrationAgentDto {
      const db = open()
      try {
        let result!: OrchestrationAgentDto
        const retry = db.transaction(() => {
          const source = requireAgent(db, taskId, agentId)
          if (source.status === "completed") {
            throw new AgentOrchestrationError(
              "conflict",
              "Completed agents cannot be retried or duplicated.",
            )
          }
          if (!TERMINAL_AGENT_STATUSES.has(String(source.status))) {
            throw new AgentOrchestrationError("conflict", "Only terminal agents can be retried.")
          }
          const definition = parseDefinition(source.definition)
          result = addAgent(
            db,
            {
              taskId,
              parentAgentId: stringOrNull(source.parent_agent_id) ?? undefined,
              agent: {
                ...definition,
                agentId: undefined,
                dependencyAgentIds: parseIds(source.dependency_agent_ids),
              },
            },
            agentId,
            true,
          )
          recoverDependents(db, taskId, agentId, result.id)
          reopenTaskForRecovery(db, taskId)
        })
        retry.immediate()
        safeTickTask(db, taskId)
        return result
      } finally {
        db.close()
      }
    },

    replaceAgent(taskId: string, agentId: string, definitionValue: unknown): OrchestrationAgentDto {
      const parsed = orchestrationAgentDefinitionSchema.safeParse(definitionValue)
      if (!parsed.success) invalid(parsed.error.issues[0]?.message)
      const db = open()
      try {
        let result!: OrchestrationAgentDto
        const replace = db.transaction(() => {
          const source = requireAgent(db, taskId, agentId)
          if (source.status === "completed") {
            throw new AgentOrchestrationError(
              "conflict",
              "Completed agents cannot be replaced or duplicated.",
            )
          }
          const now = nowEpochSeconds()
          if (!TERMINAL_AGENT_STATUSES.has(String(source.status))) {
            db.prepare(
              `UPDATE orchestration_agents SET status = 'stopped', stop_reason = 'replaced',
               completed_at = ?, updated_at = ? WHERE id = ? AND task_id = ?`,
            ).run(now, now, agentId, taskId)
            if (source.run_id) {
              cancelRunIfActive(db, String(source.run_id), now)
            }
          }
          result = addAgent(
            db,
            {
              taskId,
              parentAgentId: stringOrNull(source.parent_agent_id) ?? undefined,
              agent: parsed.data,
            },
            agentId,
            true,
          )
          recoverDependents(db, taskId, agentId, result.id)
          reopenTaskForRecovery(db, taskId)
        })
        replace.immediate()
        safeTickTask(db, taskId)
        return result
      } finally {
        db.close()
      }
    },

    control(taskId: string, action: "pause" | "resume" | "stop"): OrchestrationTaskOverviewDto {
      const db = open()
      try {
        let shouldTick = false
        const control = db.transaction(() => {
          const orchestration = requireOrchestration(db, taskId)
          const current = String(orchestration.status)
          if (action === "pause") {
            if (current !== "running" && current !== "queued") {
              throw new AgentOrchestrationError("conflict", "Only active orchestration can pause.")
            }
            db.prepare(
              "UPDATE task_orchestrations SET status = 'paused', updated_at = ? WHERE task_id = ?",
            ).run(nowEpochSeconds(), taskId)
          } else if (action === "resume") {
            if (current !== "paused") {
              throw new AgentOrchestrationError("conflict", "Only paused orchestration can resume.")
            }
            const now = nowEpochSeconds()
            db.prepare(
              `UPDATE task_orchestrations
               SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
               WHERE task_id = ?`,
            ).run(now, now, taskId)
            shouldTick = true
          } else if (!["completed", "failed", "stopped"].includes(current)) {
            stopTask(db, taskId, "manual-stop", "stopped")
          }
        })
        control.immediate()
        if (shouldTick) safeTickTask(db, taskId)
        return requireOverview(db, taskId)
      } finally {
        db.close()
      }
    },

    reportProgress(inputValue: unknown): OrchestrationTaskOverviewDto {
      const parsed = orchestrationUsageUpdateSchema.safeParse(inputValue)
      if (!parsed.success) invalid(parsed.error.issues[0]?.message)
      const db = open()
      try {
        const report = db.transaction(() => reportProgress(db, parsed.data))
        report.immediate()
        safeTickTask(db, parsed.data.taskId)
        return requireOverview(db, parsed.data.taskId)
      } finally {
        db.close()
      }
    },

    getOverview(taskId: string): OrchestrationTaskOverviewDto | null {
      const db = open()
      try {
        if (!findOrchestration(db, taskId)) return null
        safeTickTask(db, taskId)
        return requireOverview(db, taskId)
      } finally {
        db.close()
      }
    },

    getLineage(taskId: string): OrchestrationLineageDto {
      const db = open()
      try {
        requireOrchestration(db, taskId)
        const agents = listAgentRows(db, taskId).map(toAgentDto)
        return {
          taskId,
          nodes: agents.map((agent) => ({
            agentId: agent.id,
            chatId: agent.chatId,
            parentAgentId: agent.parentAgentId,
            replacedAgentId: agent.replacedAgentId,
            role: agent.definition.role,
            name: agent.definition.name ?? agent.definition.role,
            status: agent.status,
          })),
          edges: agents.flatMap((agent) => [
            ...(agent.parentAgentId
              ? [
                  {
                    fromAgentId: agent.parentAgentId,
                    toAgentId: agent.id,
                    kind: "spawned" as const,
                  },
                ]
              : []),
            ...(agent.replacedAgentId
              ? [
                  {
                    fromAgentId: agent.replacedAgentId,
                    toAgentId: agent.id,
                    kind: "replacement" as const,
                  },
                ]
              : []),
          ]),
        }
      } finally {
        db.close()
      }
    },

    archiveTerminal(taskId: string): { taskId: string; archivedChats: number; archived: true } {
      const db = open()
      try {
        const orchestration = requireOrchestration(db, taskId)
        if (!["completed", "failed", "stopped"].includes(String(orchestration.status))) {
          throw new AgentOrchestrationError(
            "conflict",
            "Only terminal orchestrations can be archived.",
          )
        }
        const archive = db.transaction(() => {
          const now = nowEpochSeconds()
          const chats = db
            .prepare(
              "UPDATE chats SET archived_at = ?, updated_at = ? WHERE task_id = ? AND archived_at IS NULL",
            )
            .run(now, now, taskId)
          db.prepare(
            "UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
          ).run(now, now, taskId)
          return Number(chats.changes)
        })
        return { taskId, archivedChats: archive.immediate(), archived: true }
      } finally {
        db.close()
      }
    },

    listCancellationRequests(): Array<{
      harness: "codex" | "claude-code"
      subChatId: string
      runId: string
    }> {
      const db = open()
      try {
        return (
          db
            .prepare(
              `SELECT r.harness, r.sub_chat_id, r.id run_id
               FROM orchestration_agents a
               JOIN agent_runs r ON r.id = a.run_id
               WHERE a.status = 'stopped' AND r.status = 'cancelled'
                 AND a.lease_owner IS NULL
                 AND r.harness IN ('codex','claude-code')`,
            )
            .all() as Row[]
        ).map((row) => ({
          harness: row.harness as "codex" | "claude-code",
          subChatId: String(row.sub_chat_id),
          runId: String(row.run_id),
        }))
      } finally {
        db.close()
      }
    },

    acknowledgeCancellationRequest(runId: string): boolean {
      const db = open()
      try {
        return (
          db
            .prepare(
              `UPDATE orchestration_agents
               SET lease_owner = 'cancellation-consumed', lease_expires_at = NULL, updated_at = ?
               WHERE run_id = ? AND status = 'stopped' AND lease_owner IS NULL`,
            )
            .run(nowEpochSeconds(), runId).changes === 1
        )
      } finally {
        db.close()
      }
    },

    /** Reconcile run outcomes, enforce budgets, and fill durable queue slots. */
    tickAll(): number {
      const db = open()
      try {
        const rows = db
          .prepare(
            "SELECT task_id FROM task_orchestrations WHERE status IN ('queued', 'running', 'paused')",
          )
          .all() as Row[]
        for (const row of rows) safeTickTask(db, String(row.task_id))
        return rows.length
      } finally {
        db.close()
      }
    },
  }
}

function createOrAttachTask(db: Sqlite, input: CreateOrchestrationInput): string {
  const project = db
    .prepare(
      "SELECT id, default_permission_mode, default_custom_permissions FROM projects WHERE id = ? AND archived_at IS NULL",
    )
    .get(input.projectId) as Row | undefined
  if (!project) throw new AgentOrchestrationError("stale-target", "Project is missing or archived.")
  const caller = db
    .prepare("SELECT id, project_id, task_id FROM chats WHERE id = ? AND archived_at IS NULL")
    .get(input.initiatingChatId) as Row | undefined
  if (!caller) throw new AgentOrchestrationError("stale-caller", "Initiating chat is stale.")
  if (caller.project_id !== input.projectId) {
    throw new AgentOrchestrationError("out-of-scope", "Initiating chat is outside the project.")
  }
  validateChatParentChain(db, input.initiatingChatId)

  let taskId: string
  if (input.task.mode === "existing") {
    const task = db
      .prepare("SELECT id FROM tasks WHERE id = ? AND project_id = ? AND archived_at IS NULL")
      .get(input.task.taskId, input.projectId) as Row | undefined
    if (!task) throw new AgentOrchestrationError("stale-target", "Task is missing or archived.")
    taskId = input.task.taskId
  } else {
    taskId = randomUUID()
    const now = nowEpochSeconds()
    db.prepare(
      `INSERT INTO tasks (
        id, project_id, name, default_permission_mode, default_custom_permissions, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      taskId,
      input.projectId,
      input.task.name,
      project.default_permission_mode,
      project.default_custom_permissions ?? null,
      now,
      now,
    )
  }
  const conflictingDescendant = db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
        SELECT ?
        UNION
        SELECT c.id FROM chats c JOIN descendants d ON c.parent_chat_id = d.id
      )
      SELECT c.id, c.task_id FROM chats c
      WHERE c.id IN (SELECT id FROM descendants)
        AND c.project_id = ?
        AND c.task_id IS NOT NULL
        AND c.task_id <> ?
      LIMIT 1`,
    )
    .get(input.initiatingChatId, input.projectId, taskId) as Row | undefined
  if (conflictingDescendant) {
    throw new AgentOrchestrationError(
      "conflict",
      "The initiating chat lineage already belongs to another task.",
    )
  }
  db.prepare(
    `WITH RECURSIVE descendants(id) AS (
      SELECT ?
      UNION
      SELECT c.id FROM chats c JOIN descendants d ON c.parent_chat_id = d.id
    )
    UPDATE chats SET task_id = ?, scope = 'task', updated_at = ?
    WHERE id IN (SELECT id FROM descendants) AND project_id = ?`,
  ).run(input.initiatingChatId, taskId, nowEpochSeconds(), input.projectId)
  return taskId
}

function validateInitialWorktrees(
  db: Sqlite,
  taskId: string,
  input: CreateOrchestrationInput,
): void {
  const task = db
    .prepare(
      "SELECT t.*, p.path project_path FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND t.archived_at IS NULL",
    )
    .get(taskId) as Row | undefined
  const parentChat = db
    .prepare("SELECT * FROM chats WHERE id = ? AND task_id = ? AND archived_at IS NULL")
    .get(input.initiatingChatId, taskId) as Row | undefined
  if (!task || !parentChat) {
    throw new AgentOrchestrationError("stale-target", "Initial task worktree scope is stale.")
  }
  for (const definition of input.agents) resolveWorktree(db, task, parentChat, definition)
}

function validateChatParentChain(db: Sqlite, startingChatId: string): void {
  const seen = new Set<string>()
  let current: string | null = startingChatId
  while (current) {
    if (seen.has(current)) {
      throw new AgentOrchestrationError("forbidden-loop", "Chat parent cycle blocked.")
    }
    seen.add(current)
    const row = db
      .prepare(
        "SELECT parent_chat_id, ancestor_chat_ids FROM chats WHERE id = ? AND archived_at IS NULL",
      )
      .get(current) as Row | undefined
    if (!row) throw new AgentOrchestrationError("stale-caller", "Chat lineage is stale.")
    const ancestors = parseIds(row.ancestor_chat_ids)
    if (new Set(ancestors).size !== ancestors.length || ancestors.includes(current)) {
      throw new AgentOrchestrationError("forbidden-loop", "Duplicate chat ancestor blocked.")
    }
    current = stringOrNull(row.parent_chat_id)
  }
}

function validateDefinitions(definitions: OrchestrationAgentDefinition[]): void {
  const ids = definitions.map((definition) => definition.agentId).filter(Boolean) as string[]
  if (new Set(ids).size !== ids.length) {
    throw new AgentOrchestrationError("forbidden-loop", "Agent identifiers must be unique.")
  }
  const known = new Set(ids)
  for (const definition of definitions) {
    validateDefinitionPermissions(definition)
    if (definition.dependencyAgentIds.includes(definition.agentId ?? "")) {
      throw new AgentOrchestrationError("forbidden-loop", "An agent cannot depend on itself.")
    }
    if (definition.dependencyAgentIds.some((id) => !known.has(id))) {
      throw new AgentOrchestrationError(
        "stale-target",
        "Initial dependencies must reference explicit agentId values in this orchestration.",
      )
    }
  }
  const graph = new Map(
    definitions.map((definition) => [definition.agentId!, definition.dependencyAgentIds]),
  )
  for (const id of ids) assertAcyclic(graph, id, new Set(), new Set())
}

function validateDefinitionPermissions(definition: OrchestrationAgentDefinition): void {
  if (definition.permissionMode === "custom") {
    if (!parseCustomPermissionCapabilities(definition.customPermissions)) {
      throw new AgentOrchestrationError("permission-denied", "Custom permissions are malformed.")
    }
  } else if (definition.customPermissions) {
    throw new AgentOrchestrationError(
      "permission-denied",
      "Custom permissions require custom permission mode.",
    )
  }
}

function assertAcyclic(
  graph: Map<string, string[]>,
  id: string,
  visiting: Set<string>,
  visited: Set<string>,
): void {
  if (visited.has(id)) return
  if (visiting.has(id))
    throw new AgentOrchestrationError("forbidden-loop", "Dependency cycle blocked.")
  visiting.add(id)
  for (const dependency of graph.get(id) ?? []) assertAcyclic(graph, dependency, visiting, visited)
  visiting.delete(id)
  visited.add(id)
}

function addAgent(
  db: Sqlite,
  input: AddOrchestrationAgentInput,
  replacedAgentId: string | null = null,
  allowTerminalRecovery = false,
): OrchestrationAgentDto {
  validateDefinitionPermissions(input.agent)
  const orchestration = requireOrchestration(db, input.taskId)
  if (
    !allowTerminalRecovery &&
    ["completed", "failed", "stopped"].includes(String(orchestration.status))
  ) {
    throw new AgentOrchestrationError("conflict", "Terminal orchestration cannot accept agents.")
  }
  const dependencies = input.agent.dependencyAgentIds
  for (const dependency of dependencies) requireAgent(db, input.taskId, dependency)

  let depth = 1
  let ancestors: string[] = []
  if (input.parentAgentId) {
    const parent = requireAgent(db, input.taskId, input.parentAgentId)
    ancestors = [...parseIds(parent.ancestor_agent_ids), input.parentAgentId]
    if (new Set(ancestors).size !== ancestors.length) {
      throw new AgentOrchestrationError("forbidden-loop", "Duplicate ancestor blocked.")
    }
    depth = Number(parent.depth) + 1
  }
  if (depth > Number(orchestration.max_depth)) {
    throw new AgentOrchestrationError("forbidden-loop", "Maximum orchestration depth exceeded.")
  }
  const id = input.agent.agentId ?? randomUUID()
  if (ancestors.includes(id) || dependencies.includes(id)) {
    throw new AgentOrchestrationError("forbidden-loop", "Agent lineage would contain itself.")
  }
  const now = nowEpochSeconds()
  insertAgent(db, {
    id,
    taskId: input.taskId,
    definition: input.agent,
    parentAgentId: input.parentAgentId ?? null,
    replacedAgentId,
    ancestorAgentIds: ancestors,
    depth,
    now,
  })
  return toAgentDto(requireAgent(db, input.taskId, id))
}

function insertAgent(
  db: Sqlite,
  input: {
    id: string
    taskId: string
    definition: OrchestrationAgentDefinition
    parentAgentId: string | null
    replacedAgentId: string | null
    ancestorAgentIds: string[]
    depth: number
    now: number
  },
): void {
  db.prepare(
    `INSERT INTO orchestration_agents (
      id, task_id, parent_agent_id, replaced_agent_id, ancestor_agent_ids, depth,
      definition, dependency_agent_ids, status, queued_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(
    input.id,
    input.taskId,
    input.parentAgentId,
    input.replacedAgentId,
    JSON.stringify(input.ancestorAgentIds),
    input.depth,
    JSON.stringify(input.definition),
    JSON.stringify(input.definition.dependencyAgentIds),
    input.now,
    input.now,
  )
}

function reportProgress(db: Sqlite, input: OrchestrationUsageUpdate): void {
  requireOrchestration(db, input.taskId)
  const current = requireAgent(db, input.taskId, input.agentId)
  if (TERMINAL_AGENT_STATUSES.has(String(current.status))) {
    throw new AgentOrchestrationError("conflict", "Terminal agent updates are immutable.")
  }
  const quality = strongestCostQuality(String(current.cost_quality), input.costQuality ?? "unknown")
  const terminal = input.status && input.status !== "active"
  const nextStatus = input.status ?? String(current.status)
  const blockerIncrement = input.blocked && Number(current.blocker_count) === 0 ? 1 : 0
  const now = nowEpochSeconds()
  db.prepare(
    `UPDATE orchestration_agents SET
      progress_percent = ?, input_tokens = ?, output_tokens = ?, reasoning_tokens = ?,
      total_tokens = ?, cost_usd_micros = ?, cost_quality = ?, status = ?,
      result_summary = COALESCE(?, result_summary), stop_reason = COALESCE(?, stop_reason),
      blocker_count = blocker_count + ?, completed_at = ?, updated_at = ?
     WHERE id = ? AND task_id = ?`,
  ).run(
    terminal && nextStatus === "completed"
      ? 100
      : Math.max(Number(current.progress_percent), input.progressPercent ?? 0),
    Math.max(Number(current.input_tokens), input.inputTokens ?? 0),
    Math.max(Number(current.output_tokens), input.outputTokens ?? 0),
    Math.max(Number(current.reasoning_tokens), input.reasoningTokens ?? 0),
    Math.max(Number(current.total_tokens), input.totalTokens ?? 0),
    costValueForQuality(current, input, quality),
    quality,
    nextStatus,
    input.resultSummary ?? null,
    input.stopReason ?? null,
    blockerIncrement,
    terminal ? now : null,
    now,
    input.agentId,
    input.taskId,
  )
  if (blockerIncrement) {
    db.prepare(
      "UPDATE task_orchestrations SET blocker_count = blocker_count + 1, updated_at = ? WHERE task_id = ?",
    ).run(now, input.taskId)
  }
}

function tickTask(db: Sqlite, taskId: string): void {
  const tick = db.transaction(() => {
    let orchestration = requireOrchestration(db, taskId)
    reconcileRunOutcomes(db, taskId)
    failUnrecoverableDependencies(db, taskId)
    orchestration = requireOrchestration(db, taskId)
    if (["completed", "failed", "stopped"].includes(String(orchestration.status))) {
      stopTask(
        db,
        taskId,
        String(orchestration.stop_reason ?? `orchestration-${orchestration.status}`),
        orchestration.status as "completed" | "failed" | "stopped",
      )
      return
    }
    const stop = stopDecision(db, orchestration)
    if (stop) {
      stopTask(db, taskId, stop.reason, stop.status)
      return
    }
    if (String(orchestration.status) === "paused") return
    const now = nowEpochSeconds()
    if (String(orchestration.status) === "queued") {
      db.prepare(
        "UPDATE task_orchestrations SET status = 'running', started_at = ?, updated_at = ? WHERE task_id = ?",
      ).run(now, now, taskId)
    }
    let active = Number(
      (
        db
          .prepare(
            "SELECT count(*) count FROM orchestration_agents WHERE task_id = ? AND status = 'active'",
          )
          .get(taskId) as Row
      ).count,
    )
    const max = Number(orchestration.max_parallel_agents)
    if (active >= max) return
    const queued = db
      .prepare(
        "SELECT * FROM orchestration_agents WHERE task_id = ? AND status = 'queued' ORDER BY queued_at, id",
      )
      .all(taskId) as Row[]
    for (const agent of queued) {
      if (active >= max) break
      if (!dependenciesCompleted(db, taskId, parseIds(agent.dependency_agent_ids))) continue
      materializeAgent(db, orchestration, agent)
      active += 1
    }
  })
  tick.immediate()
}

function safeTickTask(db: Sqlite, taskId: string): void {
  try {
    tickTask(db, taskId)
  } catch (error) {
    if (!(error instanceof AgentOrchestrationError)) throw error
    const stop = db.transaction(() => stopTask(db, taskId, `scheduler-${error.code}`, "failed"))
    stop.immediate()
  }
}

function reconcileRunOutcomes(db: Sqlite, taskId: string): void {
  const rows = db
    .prepare(
      `SELECT a.id, a.run_id, r.status run_status, r.completed_at
       FROM orchestration_agents a
       LEFT JOIN agent_runs r ON r.id = a.run_id
       WHERE a.task_id = ? AND a.status = 'active'`,
    )
    .all(taskId) as Row[]
  for (const row of rows) {
    if (!row.run_id || !TERMINAL_RUN_STATUSES.has(String(row.run_status))) continue
    const status =
      row.run_status === "success"
        ? "completed"
        : row.run_status === "cancelled"
          ? "stopped"
          : "failed"
    const now = nowEpochSeconds()
    db.prepare(
      `UPDATE orchestration_agents SET status = ?, progress_percent = CASE WHEN ? = 'completed' THEN 100 ELSE progress_percent END,
       completed_at = COALESCE(?, ?), updated_at = ? WHERE id = ? AND status = 'active'`,
    ).run(status, status, row.completed_at ?? null, now, now, row.id)
  }
  persistMessageUsageSamples(db, taskId)
  const usageRows = db
    .prepare(
      `SELECT a.id,
        COALESCE(MAX(u.input_tokens), 0) input_tokens,
        COALESCE(MAX(u.output_tokens), 0) output_tokens,
        COALESCE(MAX(u.reasoning_tokens), 0) reasoning_tokens,
        COALESCE(MAX(u.total_tokens), 0) total_tokens,
        COALESCE(MAX(CASE WHEN u.cost_quality IN ('exact','provider-reported') THEN u.cost_usd_micros ELSE 0 END), 0) exact_cost,
        COALESCE(MAX(CASE WHEN u.cost_quality = 'estimated' THEN u.cost_usd_estimated_micros ELSE 0 END), 0) estimated_cost,
        MAX(CASE WHEN u.cost_quality = 'exact' THEN 4 WHEN u.cost_quality = 'provider-reported' THEN 3 WHEN u.cost_quality = 'estimated' THEN 2 ELSE 1 END) quality_rank
       FROM orchestration_agents a
       LEFT JOIN usage_samples u ON u.run_id = a.run_id
       WHERE a.task_id = ? GROUP BY a.id`,
    )
    .all(taskId) as Row[]
  for (const usage of usageRows) {
    const rank = Number(usage.quality_rank ?? 1)
    const quality =
      rank >= 4 ? "exact" : rank === 3 ? "provider-reported" : rank === 2 ? "estimated" : "unknown"
    const cost =
      rank >= 3 ? Number(usage.exact_cost) : rank === 2 ? Number(usage.estimated_cost) : null
    db.prepare(
      `UPDATE orchestration_agents SET input_tokens = MAX(input_tokens, ?), output_tokens = MAX(output_tokens, ?),
       reasoning_tokens = MAX(reasoning_tokens, ?), total_tokens = MAX(total_tokens, ?),
       cost_usd_micros = CASE WHEN ? IS NULL THEN cost_usd_micros ELSE MAX(COALESCE(cost_usd_micros, 0), ?) END,
       cost_quality = CASE
         WHEN cost_quality = 'exact' THEN cost_quality
         WHEN cost_quality = 'provider-reported' AND ? IN ('estimated','unknown') THEN cost_quality
         WHEN cost_quality = 'estimated' AND ? = 'unknown' THEN cost_quality
         ELSE ? END
       WHERE id = ?`,
    ).run(
      usage.input_tokens,
      usage.output_tokens,
      usage.reasoning_tokens,
      usage.total_tokens,
      cost,
      cost,
      quality,
      quality,
      quality,
      usage.id,
    )
  }
}

function persistMessageUsageSamples(db: Sqlite, taskId: string): void {
  const rows = db
    .prepare(
      `SELECT a.run_id, r.harness, r.model, s.messages
       FROM orchestration_agents a
       JOIN agent_runs r ON r.id = a.run_id
       JOIN sub_chats s ON s.id = r.sub_chat_id
       WHERE a.task_id = ? AND a.run_id IS NOT NULL`,
    )
    .all(taskId) as Row[]
  for (const row of rows) {
    const runId = String(row.run_id)
    const usage = extractPersistedMessageUsage(row.messages, runId)
    if (!usage) continue
    const providerId = row.harness === "claude-code" ? "anthropic" : "codex"
    const dedupeKey = `flapstack-run:${runId}:persisted-message-usage`
    const costQuality = usage.costUsdMicros === null ? "unknown" : "provider-reported"
    db.prepare(
      `INSERT INTO usage_samples (
        id, provider_id, source, cost_quality, captured_at, input_tokens, output_tokens,
        reasoning_tokens, total_tokens, cost_usd_micros, currency, model, run_id,
        raw_payload, dedupe_key, created_at
      ) VALUES (?, ?, 'flapstack-run', ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        captured_at = excluded.captured_at,
        input_tokens = MAX(COALESCE(usage_samples.input_tokens, 0), COALESCE(excluded.input_tokens, 0)),
        output_tokens = MAX(COALESCE(usage_samples.output_tokens, 0), COALESCE(excluded.output_tokens, 0)),
        reasoning_tokens = MAX(COALESCE(usage_samples.reasoning_tokens, 0), COALESCE(excluded.reasoning_tokens, 0)),
        total_tokens = MAX(COALESCE(usage_samples.total_tokens, 0), COALESCE(excluded.total_tokens, 0)),
        cost_usd_micros = CASE
          WHEN excluded.cost_usd_micros IS NULL THEN usage_samples.cost_usd_micros
          ELSE MAX(COALESCE(usage_samples.cost_usd_micros, 0), excluded.cost_usd_micros)
        END,
        cost_quality = CASE
          WHEN usage_samples.cost_quality IN ('exact','provider-reported') THEN usage_samples.cost_quality
          ELSE excluded.cost_quality
        END,
        model = COALESCE(excluded.model, usage_samples.model)`,
    ).run(
      randomUUID(),
      providerId,
      costQuality,
      nowEpochSeconds(),
      usage.inputTokens,
      usage.outputTokens,
      usage.reasoningTokens,
      usage.totalTokens,
      usage.costUsdMicros,
      stringOrNull(row.model),
      runId,
      JSON.stringify({ origin: "persisted-message-metadata" }),
      dedupeKey,
      nowEpochSeconds(),
    )
  }
}

function extractPersistedMessageUsage(
  messagesValue: unknown,
  runId: string,
): {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsdMicros: number | null
} | null {
  if (typeof messagesValue !== "string") return null
  try {
    const messages = JSON.parse(messagesValue) as unknown[]
    let found = false
    let inputTokens = 0
    let outputTokens = 0
    let reasoningTokens = 0
    let totalTokens = 0
    let costUsdMicros: number | null = null
    for (const value of messages) {
      if (!value || typeof value !== "object") continue
      const message = value as Record<string, unknown>
      if (
        message.role !== "assistant" ||
        !message.metadata ||
        typeof message.metadata !== "object"
      ) {
        continue
      }
      const metadata = message.metadata as Record<string, unknown>
      if (typeof metadata.runId === "string" && metadata.runId !== runId) continue
      const input = nonNegativeNumber(metadata.inputTokens)
      const output = nonNegativeNumber(metadata.outputTokens)
      const reasoning = nonNegativeNumber(metadata.reasoningTokens)
      const total = nonNegativeNumber(metadata.totalTokens)
      const cost = nonNegativeNumber(metadata.totalCostUsd)
      if (
        input === null &&
        output === null &&
        reasoning === null &&
        total === null &&
        cost === null
      ) {
        continue
      }
      found = true
      inputTokens = Math.max(inputTokens, input ?? 0)
      outputTokens = Math.max(outputTokens, output ?? 0)
      reasoningTokens = Math.max(reasoningTokens, reasoning ?? 0)
      totalTokens = Math.max(totalTokens, total ?? (input ?? 0) + (output ?? 0))
      if (cost !== null) costUsdMicros = Math.max(costUsdMicros ?? 0, Math.round(cost * 1_000_000))
    }
    return found ? { inputTokens, outputTokens, reasoningTokens, totalTokens, costUsdMicros } : null
  } catch {
    return null
  }
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

function stopDecision(
  db: Sqlite,
  orchestration: Row,
): { status: "completed" | "failed" | "stopped"; reason: string } | null {
  const taskId = String(orchestration.task_id)
  const rows = listAgentRows(db, taskId)
  const stop = parseStopConditions(orchestration.stop_conditions)
  const aggregate = aggregateRows(rows)
  if (
    stop.maxWallClockMs &&
    orchestration.started_at &&
    Date.now() - Number(orchestration.started_at) * 1_000 >= stop.maxWallClockMs
  ) {
    return { status: "stopped", reason: "wall-clock-budget" }
  }
  if (stop.maxTotalTokens && aggregate.totalTokens >= stop.maxTotalTokens) {
    return { status: "stopped", reason: "token-budget" }
  }
  // Only exact provider spend can stop cost. Provider-reported and estimated
  // spend stay visible, while the required token/time fallback remains enforceable.
  if (stop.maxCostUsdMicros && aggregate.exactCostUsdMicros >= stop.maxCostUsdMicros) {
    return { status: "stopped", reason: "exact-cost-budget" }
  }
  if (stop.maxFailures && aggregate.failed >= stop.maxFailures) {
    return { status: "failed", reason: "failure-threshold" }
  }
  if (stop.maxBlockers && aggregate.blocked >= stop.maxBlockers) {
    return { status: "failed", reason: "blocker-threshold" }
  }
  if (stop.targetCompletedAgents && aggregate.completed >= stop.targetCompletedAgents) {
    return { status: "completed", reason: "completion-target" }
  }
  if (stop.targetProgressPercent && aggregate.progressPercent >= stop.targetProgressPercent) {
    return { status: "completed", reason: "progress-target" }
  }
  if (rows.length > 0 && aggregate.active === 0 && aggregate.queued === 0) {
    return aggregate.failed > 0
      ? { status: "failed", reason: "agents-failed" }
      : aggregate.stopped > 0
        ? { status: "stopped", reason: "agents-stopped" }
        : { status: "completed", reason: "all-agents-completed" }
  }
  return null
}

function stopTask(
  db: Sqlite,
  taskId: string,
  reason: string,
  status: "completed" | "failed" | "stopped",
): void {
  const now = nowEpochSeconds()
  const terminalAgentStatus =
    status === "completed" ? "stopped" : status === "failed" ? "stopped" : "stopped"
  db.prepare(
    `UPDATE task_orchestrations SET status = ?, stop_reason = ?, completed_at = ?, updated_at = ?
     WHERE task_id = ? AND status NOT IN ('completed','failed','stopped')`,
  ).run(status, reason, now, now, taskId)
  db.prepare(
    `UPDATE orchestration_agents SET status = ?, stop_reason = ?, completed_at = ?, updated_at = ?
     WHERE task_id = ? AND status IN ('queued','active')`,
  ).run(terminalAgentStatus, reason, now, now, taskId)
  const runs = db
    .prepare("SELECT run_id FROM orchestration_agents WHERE task_id = ? AND run_id IS NOT NULL")
    .all(taskId) as Row[]
  for (const run of runs) {
    cancelRunIfActive(db, String(run.run_id), now)
  }
}

/** Cancel one owned run without letting an old orchestration overwrite a newer
 * pending/running owner of the same conversation. */
function cancelRunIfActive(db: Sqlite, runId: string, now: number): boolean {
  const run = db.prepare("SELECT sub_chat_id FROM agent_runs WHERE id = ?").get(runId) as
    Row | undefined
  if (!run?.sub_chat_id) return false
  const cancelled = db
    .prepare(
      "UPDATE agent_runs SET status = 'cancelled', completed_at = ? WHERE id = ? AND status IN ('pending','running')",
    )
    .run(now, runId)
  if (cancelled.changes !== 1) return false
  db.prepare(
    `UPDATE sub_chats SET run_status = COALESCE((
       SELECT status FROM agent_runs
       WHERE sub_chat_id = ? AND id <> ? AND status IN ('pending','running')
       ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, started_at, id
       LIMIT 1
     ), 'cancelled'), updated_at = ? WHERE id = ?`,
  ).run(run.sub_chat_id, runId, now, run.sub_chat_id)
  return true
}

function dependenciesCompleted(db: Sqlite, taskId: string, dependencies: string[]): boolean {
  if (dependencies.length === 0) return true
  const rows = dependencies.map((id) => requireAgent(db, taskId, id))
  return rows.every((row) => row.status === "completed")
}

function failUnrecoverableDependencies(db: Sqlite, taskId: string): void {
  let changed = true
  while (changed) {
    changed = false
    const queued = db
      .prepare(
        "SELECT id, dependency_agent_ids FROM orchestration_agents WHERE task_id = ? AND status = 'queued'",
      )
      .all(taskId) as Row[]
    for (const agent of queued) {
      const failedDependency = parseIds(agent.dependency_agent_ids)
        .map((id) => requireAgent(db, taskId, id))
        .find((dependency) => dependency.status === "failed" || dependency.status === "stopped")
      if (!failedDependency) continue
      const dependencyId = String(failedDependency.id)
      const dependencyStatus = String(failedDependency.status)
      const now = nowEpochSeconds()
      const result = db
        .prepare(
          `UPDATE orchestration_agents
           SET status = 'failed', stop_reason = ?,
             result_summary = COALESCE(result_summary, ?), completed_at = ?, updated_at = ?
           WHERE id = ? AND task_id = ? AND status = 'queued'`,
        )
        .run(
          `dependency-${dependencyStatus}:${dependencyId}`,
          `Dependency ${dependencyId} ${dependencyStatus}; queued work was not launched.`,
          now,
          now,
          agent.id,
          taskId,
        )
      changed ||= result.changes === 1
    }
  }
}

function recoverDependents(
  db: Sqlite,
  taskId: string,
  sourceAgentId: string,
  replacementAgentId: string,
): void {
  const recoveryQueue = [sourceAgentId]
  const visited = new Set<string>()
  while (recoveryQueue.length > 0) {
    const dependencyId = recoveryQueue.shift()!
    if (visited.has(dependencyId)) continue
    visited.add(dependencyId)
    const dependents = listAgentRows(db, taskId).filter((candidate) =>
      parseIds(candidate.dependency_agent_ids).includes(dependencyId),
    )
    for (const dependent of dependents) {
      const oldDependencies = parseIds(dependent.dependency_agent_ids)
      const newDependencies = oldDependencies.map((id) =>
        id === sourceAgentId ? replacementAgentId : id,
      )
      const definition = parseDefinition(dependent.definition)
      const dependencyFailure = String(dependent.stop_reason ?? "").startsWith("dependency-")
      const now = nowEpochSeconds()
      db.prepare(
        `UPDATE orchestration_agents SET dependency_agent_ids = ?, definition = ?,
          status = CASE WHEN ? THEN 'queued' ELSE status END,
          stop_reason = CASE WHEN ? THEN NULL ELSE stop_reason END,
          result_summary = CASE WHEN ? THEN NULL ELSE result_summary END,
          completed_at = CASE WHEN ? THEN NULL ELSE completed_at END,
          queued_at = CASE WHEN ? THEN ? ELSE queued_at END,
          updated_at = ?
         WHERE id = ? AND task_id = ?`,
      ).run(
        JSON.stringify(newDependencies),
        JSON.stringify({ ...definition, dependencyAgentIds: newDependencies }),
        dependencyFailure ? 1 : 0,
        dependencyFailure ? 1 : 0,
        dependencyFailure ? 1 : 0,
        dependencyFailure ? 1 : 0,
        dependencyFailure ? 1 : 0,
        now,
        now,
        dependent.id,
        taskId,
      )
      if (dependencyFailure) recoveryQueue.push(String(dependent.id))
    }
  }
}

function reopenTaskForRecovery(db: Sqlite, taskId: string): void {
  db.prepare(
    `UPDATE task_orchestrations
     SET status = CASE WHEN status IN ('completed','failed','stopped') THEN 'running' ELSE status END,
       stop_reason = CASE WHEN status IN ('completed','failed','stopped') THEN NULL ELSE stop_reason END,
       completed_at = CASE WHEN status IN ('completed','failed','stopped') THEN NULL ELSE completed_at END,
       updated_at = ?
     WHERE task_id = ?`,
  ).run(nowEpochSeconds(), taskId)
}

function materializeAgent(db: Sqlite, orchestration: Row, agent: Row): void {
  const taskId = String(orchestration.task_id)
  const task = db
    .prepare(
      "SELECT t.*, p.path project_path FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND t.archived_at IS NULL",
    )
    .get(taskId) as Row | undefined
  if (!task) throw new AgentOrchestrationError("stale-target", "Orchestration task is stale.")
  const definition = parseDefinition(agent.definition)
  validateDefinitionPermissions(definition)
  const parentAgent = agent.parent_agent_id
    ? requireAgent(db, taskId, String(agent.parent_agent_id))
    : null
  const parentChatId = parentAgent?.chat_id
    ? String(parentAgent.chat_id)
    : String(orchestration.initiating_chat_id)
  const parentChat = db
    .prepare("SELECT * FROM chats WHERE id = ? AND task_id = ? AND archived_at IS NULL")
    .get(parentChatId, taskId) as Row | undefined
  if (!parentChat)
    throw new AgentOrchestrationError("stale-caller", "Parent chat identity is stale.")
  const parentAncestors = parseIds(parentChat.ancestor_chat_ids)
  if (
    new Set(parentAncestors).size !== parentAncestors.length ||
    parentAncestors.includes(parentChatId)
  ) {
    throw new AgentOrchestrationError("forbidden-loop", "Parent chat lineage is malformed.")
  }
  const worktree = resolveWorktree(db, task, parentChat, definition)
  const chatId = randomUUID()
  const subChatId = randomUUID()
  const runId = randomUUID()
  const now = nowEpochSeconds()
  const promptMessageId = `mcp-orchestration-${agent.id}`
  const prompt = [
    definition.prompt,
    definition.spec ? `Specification:\n${definition.spec}` : null,
    `Completion criteria:\n${definition.completionCriteria}`,
  ]
    .filter(Boolean)
    .join("\n\n")
  db.prepare(
    `INSERT INTO chats (
      id, name, project_id, task_id, scope, permission_mode, custom_permissions, harness, model,
      parent_chat_id, initiator_chat_id, parent_run_id, ancestor_chat_ids,
      worktree_path, branch, base_branch, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'task', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    chatId,
    definition.name ?? definition.role,
    task.project_id,
    taskId,
    definition.permissionMode,
    definition.customPermissions ? JSON.stringify(definition.customPermissions) : null,
    definition.harness,
    definition.model ?? null,
    parentChatId,
    orchestration.initiating_chat_id,
    parentAgent?.run_id ?? null,
    JSON.stringify([...parentAncestors, parentChatId]),
    worktree.path,
    worktree.branch,
    parentChat.base_branch ?? null,
    now,
    now,
  )
  db.prepare(
    `INSERT INTO sub_chats (
      id, chat_id, harness, model, permission_mode, worktree_path, run_status, messages, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', '[]', ?, ?)`,
  ).run(
    subChatId,
    chatId,
    definition.harness,
    definition.model ?? null,
    definition.permissionMode,
    worktree.path,
    now,
    now,
  )
  db.prepare(
    `INSERT INTO agent_runs (
      id, chat_id, sub_chat_id, harness, model, permission_mode, custom_permissions,
      worktree_path, prompt_message_id, initial_prompt, status, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    runId,
    chatId,
    subChatId,
    definition.harness,
    definition.model ?? null,
    definition.permissionMode,
    definition.customPermissions ? JSON.stringify(definition.customPermissions) : null,
    worktree.path,
    promptMessageId,
    prompt,
    now,
  )
  db.prepare(
    `UPDATE orchestration_agents SET chat_id = ?, run_id = ?, status = 'active', started_at = ?, updated_at = ?
     WHERE id = ? AND status = 'queued'`,
  ).run(chatId, runId, now, now, agent.id)
}

function resolveWorktree(
  db: Sqlite,
  task: Row,
  parentChat: Row,
  definition: OrchestrationAgentDefinition,
): { path: string | null; branch: string | null } {
  if (definition.worktreeStrategy === "none") return { path: null, branch: null }
  const projectPath = stringOrNull(task.project_path)
  if (!projectPath) {
    throw new AgentOrchestrationError("stale-target", "Project path is missing.")
  }
  const registered = listRegisteredWorktrees(projectPath)
  if (definition.worktreeStrategy === "inherit") {
    const path = stringOrNull(parentChat.worktree_path)
    if (!path) throw new AgentOrchestrationError("stale-target", "Inherited worktree is missing.")
    return requireRegisteredWorktree(registered, path, stringOrNull(parentChat.branch))
  }
  if (definition.worktreeStrategy === "task-primary") {
    const path = stringOrNull(task.primary_worktree_path)
    if (!path)
      throw new AgentOrchestrationError("stale-target", "Task primary worktree is missing.")
    return requireRegisteredWorktree(registered, path, stringOrNull(task.primary_branch))
  }
  const source = db
    .prepare(
      `SELECT worktree_path, branch FROM chats
       WHERE task_id = ? AND archived_at IS NULL
         AND ((? = 'existing' AND worktree_path = ?) OR (? = 'attached-branch' AND branch = ?))
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(
      task.id,
      definition.worktreeStrategy,
      definition.worktreePath ?? null,
      definition.worktreeStrategy,
      definition.branch ?? null,
    ) as Row | undefined
  if (!source || !source.worktree_path) {
    throw new AgentOrchestrationError(
      "stale-target",
      "Requested existing worktree or branch is not durably attached to this task.",
    )
  }
  return requireRegisteredWorktree(
    registered,
    String(source.worktree_path),
    stringOrNull(source.branch),
  )
}

type RegisteredWorktree = { path: string; branch: string | null }

function listRegisteredWorktrees(projectPath: string): RegisteredWorktree[] {
  if (!existsSync(projectPath)) {
    throw new AgentOrchestrationError("stale-target", "Project path does not exist.")
  }
  let output: string
  try {
    output = execFileSync("git", ["-C", projectPath, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
  } catch {
    throw new AgentOrchestrationError(
      "stale-target",
      "Project worktree registry could not be verified.",
    )
  }
  return output
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n")
      const pathLine = lines.find((line) => line.startsWith("worktree "))
      if (!pathLine) return null
      const branchLine = lines.find((line) => line.startsWith("branch refs/heads/"))
      const rawPath = pathLine.slice("worktree ".length)
      if (!existsSync(rawPath)) return null
      return {
        path: realpathSync(rawPath),
        branch: branchLine ? branchLine.slice("branch refs/heads/".length) : null,
      }
    })
    .filter((entry): entry is RegisteredWorktree => entry !== null)
}

function requireRegisteredWorktree(
  registered: RegisteredWorktree[],
  path: string,
  expectedBranch: string | null,
): RegisteredWorktree {
  if (!existsSync(path)) {
    throw new AgentOrchestrationError("stale-target", "Requested worktree path does not exist.")
  }
  const canonicalPath = realpathSync(path)
  const match = registered.find((worktree) => worktree.path === canonicalPath)
  if (!match) {
    throw new AgentOrchestrationError(
      "stale-target",
      "Requested worktree is not registered with the project repository.",
    )
  }
  if (expectedBranch && match.branch !== expectedBranch) {
    throw new AgentOrchestrationError(
      "stale-target",
      "Requested worktree branch does not match the registered Git branch.",
    )
  }
  return match
}

function requireOverview(db: Sqlite, taskId: string): OrchestrationTaskOverviewDto {
  const orchestration = requireOrchestration(db, taskId)
  const task = db.prepare("SELECT id, project_id, name FROM tasks WHERE id = ?").get(taskId) as
    Row | undefined
  if (!task) throw new AgentOrchestrationError("stale-target", "Task is stale.")
  const agents = listAgentRows(db, taskId).map(toAgentDto)
  return {
    orchestration: toTaskDto(orchestration, task),
    aggregate: aggregateRows(agents),
    agents,
  }
}

function aggregateRows(rows: Array<Row | OrchestrationAgentDto>): OrchestrationAggregateDto {
  const agents = rows.map((row) =>
    "definition" in row && typeof row.definition === "object"
      ? (row as OrchestrationAgentDto)
      : toAgentDto(row as Row),
  )
  const count = (status: string) => agents.filter((agent) => agent.status === status).length
  const exact = agents.filter((agent) => agent.costQuality === "exact")
  const providerReported = agents.filter((agent) => agent.costQuality === "provider-reported")
  const estimated = agents.filter((agent) => agent.costQuality === "estimated")
  return {
    total: agents.length,
    queued: count("queued"),
    active: count("active"),
    completed: count("completed"),
    failed: count("failed"),
    blocked: agents.filter((agent) => agent.blockerCount > 0).length,
    stopped: count("stopped"),
    progressPercent:
      agents.length === 0
        ? 0
        : Math.floor(agents.reduce((sum, agent) => sum + agent.progressPercent, 0) / agents.length),
    totalTokens: agents.reduce((sum, agent) => sum + agent.totalTokens, 0),
    exactCostUsdMicros: exact.reduce((sum, agent) => sum + (agent.costUsdMicros ?? 0), 0),
    providerReportedCostUsdMicros: providerReported.reduce(
      (sum, agent) => sum + (agent.costUsdMicros ?? 0),
      0,
    ),
    estimatedCostUsdMicros: estimated.reduce((sum, agent) => sum + (agent.costUsdMicros ?? 0), 0),
    costQuality: exact.some((agent) => agent.costQuality === "exact")
      ? "exact"
      : providerReported.length > 0
        ? "provider-reported"
        : estimated.length > 0
          ? "estimated"
          : "unknown",
  }
}

function toTaskDto(row: Row, task: Row): OrchestrationTaskDto {
  return {
    taskId: String(row.task_id),
    projectId: String(task.project_id),
    name: String(task.name),
    initiatingChatId: String(row.initiating_chat_id),
    status: row.status as OrchestrationTaskDto["status"],
    maxParallelAgents: Number(row.max_parallel_agents),
    maxDepth: Number(row.max_depth),
    stopConditions: parseStopConditions(row.stop_conditions),
    stopReason: stringOrNull(row.stop_reason),
    createdAt: epochSecondsToMilliseconds(row.created_at) ?? 0,
    startedAt: epochSecondsToMilliseconds(row.started_at),
    completedAt: epochSecondsToMilliseconds(row.completed_at),
  }
}

function toAgentDto(row: Row): OrchestrationAgentDto {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    chatId: stringOrNull(row.chat_id),
    runId: stringOrNull(row.run_id),
    parentAgentId: stringOrNull(row.parent_agent_id),
    replacedAgentId: stringOrNull(row.replaced_agent_id),
    depth: Number(row.depth),
    status: row.status as OrchestrationAgentDto["status"],
    progressPercent: Number(row.progress_percent),
    definition: parseDefinition(row.definition),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    reasoningTokens: Number(row.reasoning_tokens),
    totalTokens: Number(row.total_tokens),
    costUsdMicros: numberOrNull(row.cost_usd_micros),
    costQuality: row.cost_quality as OrchestrationAgentDto["costQuality"],
    resultSummary: stringOrNull(row.result_summary),
    stopReason: stringOrNull(row.stop_reason),
    blockerCount: Number(row.blocker_count),
    queuedAt: epochSecondsToMilliseconds(row.queued_at) ?? 0,
    startedAt: epochSecondsToMilliseconds(row.started_at),
    completedAt: epochSecondsToMilliseconds(row.completed_at),
  }
}

function findOrchestration(db: Sqlite, taskId: string): Row | undefined {
  return db.prepare("SELECT * FROM task_orchestrations WHERE task_id = ?").get(taskId) as
    Row | undefined
}

function requireOrchestration(db: Sqlite, taskId: string): Row {
  const row = findOrchestration(db, taskId)
  if (!row) throw new AgentOrchestrationError("stale-target", "Orchestration is missing.")
  return row
}

function requireAgent(db: Sqlite, taskId: string, agentId: string): Row {
  const row = db
    .prepare("SELECT * FROM orchestration_agents WHERE id = ? AND task_id = ?")
    .get(agentId, taskId) as Row | undefined
  if (!row) throw new AgentOrchestrationError("stale-target", "Agent is missing or stale.")
  return row
}

function listAgentRows(db: Sqlite, taskId: string): Row[] {
  return db
    .prepare("SELECT * FROM orchestration_agents WHERE task_id = ? ORDER BY queued_at, id")
    .all(taskId) as Row[]
}

function parseDefinition(value: unknown): OrchestrationAgentDefinition {
  try {
    return orchestrationAgentDefinitionSchema.parse(
      typeof value === "string" ? JSON.parse(value) : value,
    )
  } catch {
    throw new AgentOrchestrationError("invalid-input", "Durable agent definition is malformed.")
  }
}

function parseStopConditions(value: unknown): OrchestrationStopConditions {
  try {
    return orchestrationStopConditionsSchema.parse(
      typeof value === "string" ? JSON.parse(value) : value,
    )
  } catch {
    throw new AgentOrchestrationError("invalid-input", "Durable stop conditions are malformed.")
  }
}

function parseIds(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string" && id.length > 0)) {
      throw new Error("invalid")
    }
    return parsed
  } catch {
    throw new AgentOrchestrationError("forbidden-loop", "Durable lineage is malformed.")
  }
}

function strongestCostQuality(left: string, right: string): string {
  const rank: Record<string, number> = {
    unknown: 0,
    estimated: 1,
    "provider-reported": 2,
    exact: 3,
  }
  return (rank[left] ?? 0) >= (rank[right] ?? 0) ? left : right
}

function costValueForQuality(
  current: Row,
  input: OrchestrationUsageUpdate,
  quality: string,
): number | null {
  const currentCost = numberOrNull(current.cost_usd_micros)
  if (input.costUsdMicros === undefined) return currentCost
  if (quality === String(current.cost_quality) && quality !== (input.costQuality ?? "unknown")) {
    return currentCost
  }
  return Math.max(currentCost ?? 0, input.costUsdMicros)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function invalid(message?: string): never {
  throw new AgentOrchestrationError("invalid-input", message ?? "Invalid orchestration input.")
}
