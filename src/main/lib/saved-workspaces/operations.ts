import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import {
  savedWorkspaceLayoutSchema,
  savedWorkspaceRosterSchema,
  type SavedWorkspaceLayout,
  type SavedWorkspaceOperationAgent,
  type SavedWorkspaceOperationProjection,
  type SavedWorkspaceRosterEntry,
} from "../../../shared/saved-workspaces"
import { epochSecondsToMilliseconds, nowEpochSeconds } from "../db/timestamps"

type OperationSourceRow = {
  task_id: string
  initiating_chat_id: string
  status: string
  created_at: number | null
  updated_at: number | null
  completed_at: number | null
  task_name: string
  project_id: string
  lead_chat_name: string | null
}

type OperationAgentRow = {
  id: string
  chat_id: string | null
  run_id: string | null
  parent_agent_id: string | null
  replaced_agent_id: string | null
  definition: string
  status: string
  progress_percent: number
  result_summary: string | null
  stop_reason: string | null
  blocker_count: number
  queued_at: number | null
  started_at: number | null
  completed_at: number | null
  chat_name: string | null
  chat_archived_at: number | null
}

type OperationWorkspaceRow = {
  id: string
  task_id: string
  orchestration_id: string
}

type OperationWorkspaceDeletionIntentRow = {
  id: string
  scope_type: string
  task_id: string | null
  owner_kind: string
  orchestration_id: string | null
  sort_order: string
}

const OPERATION_WORKSPACE_DELETION_SORT_ORDER = "zz-operation-workspace-deleted"

export type EnsureOperationWorkspaceResult = {
  workspaceId: string
  orchestrationId: string
  taskId: string
  created: boolean
}

export type OperationWorkspaceReconciliationResult = {
  inspected: number
  created: number
  workspaceIds: string[]
}

export class SavedWorkspaceOperationError extends Error {
  constructor(
    readonly code: "not-found" | "conflict" | "invalid-data",
    message: string,
  ) {
    super(message)
    this.name = "SavedWorkspaceOperationError"
  }
}

/**
 * Stage 3 keys orchestration rows by task. Saved workspaces expose a separate,
 * opaque identity so task IDs never leak into pane/window ownership contracts.
 * The deterministic digest also permits lineage-based regeneration after the
 * workspace metadata alone is deleted.
 */
export function stableOperationOrchestrationId(taskId: string): string {
  return `operation-${digest(taskId)}`
}

export function stableOperationWorkspaceId(taskId: string): string {
  return `saved-operation-${digest(taskId)}`
}

export function isOperationWorkspaceDeletionIntent(
  row: OperationWorkspaceDeletionIntentRow,
): boolean {
  return Boolean(
    row.scope_type === "task" &&
    row.task_id &&
    row.id === stableOperationWorkspaceId(row.task_id) &&
    row.owner_kind === "manual" &&
    row.orchestration_id === null &&
    row.sort_order === OPERATION_WORKSPACE_DELETION_SORT_ORDER,
  )
}

export function markOperationWorkspaceDeletedInTransaction(
  database: Database.Database,
  input: { workspaceId: string; taskId: string; expectedVersion: number },
): Database.RunResult {
  const identity = digest(input.taskId).slice(0, 24)
  const deletedLayout = savedWorkspaceLayoutSchema.parse({
    version: 1,
    root: {
      type: "tabs",
      id: `deleted-operation-${identity}-tabs`,
      activePaneId: `deleted-operation-${identity}-pane`,
      panes: [
        {
          id: `deleted-operation-${identity}-pane`,
          title: "Deleted operation workspace",
          binding: { type: "browser", url: "https://flapstack.invalid/deleted-workspace" },
        },
      ],
    },
  })
  const now = nowEpochSeconds()
  return database
    .prepare(
      `UPDATE saved_workspaces
       SET name = 'Deleted operation workspace', owner_kind = 'manual',
           orchestration_id = NULL, layout_version = 1, layout_json = ?,
           sort_order = ?, version = version + 1, updated_at = ?, archived_at = ?
       WHERE id = ? AND task_id = ? AND owner_kind = 'orchestration' AND version = ?`,
    )
    .run(
      JSON.stringify(deletedLayout),
      OPERATION_WORKSPACE_DELETION_SORT_ORDER,
      now,
      now,
      input.workspaceId,
      input.taskId,
      input.expectedVersion,
    )
}

export function createOperationWorkspaceLayout(input: {
  taskId: string
  orchestrationId: string
  initiatingChatId: string
}): SavedWorkspaceLayout {
  const identity = digest(input.taskId).slice(0, 24)
  const id = (suffix: string) => `operation-${identity}-${suffix}`
  return savedWorkspaceLayoutSchema.parse({
    version: 1,
    root: {
      type: "split",
      id: id("root"),
      direction: "row",
      sizes: [0.58, 0.42],
      children: [
        {
          type: "tabs",
          id: id("lead-tabs"),
          activePaneId: id("lead"),
          panes: [
            {
              id: id("lead"),
              title: "Lead chat",
              binding: { type: "chat", chatId: input.initiatingChatId },
            },
          ],
        },
        {
          type: "split",
          id: id("navigator-split"),
          direction: "column",
          sizes: [0.28, 0.44, 0.28],
          children: [
            {
              type: "tabs",
              id: id("roster-tabs"),
              activePaneId: id("roster"),
              panes: [
                {
                  id: id("roster"),
                  title: "Agent navigator",
                  binding: {
                    type: "agent-roster",
                    orchestrationId: input.orchestrationId,
                  },
                },
              ],
            },
            {
              type: "tabs",
              id: id("selected-tabs"),
              activePaneId: id("selected"),
              panes: [
                {
                  id: id("selected"),
                  title: "Selected agent",
                  binding: {
                    type: "selected-agent",
                    orchestrationId: input.orchestrationId,
                    agentId: null,
                  },
                },
              ],
            },
            {
              type: "tabs",
              id: id("activity-tabs"),
              activePaneId: id("activity"),
              panes: [
                {
                  id: id("activity"),
                  title: "Operation activity",
                  binding: { type: "activity", orchestrationId: input.orchestrationId },
                },
              ],
            },
          ],
        },
      ],
    },
  })
}

/** Caller-owned transaction helper for the future orchestration launch seam. */
export function ensureOperationWorkspaceInTransaction(
  database: Database.Database,
  taskId: string,
): EnsureOperationWorkspaceResult {
  const source = requireOperationSource(database, taskId)
  const orchestrationId = stableOperationOrchestrationId(source.task_id)
  const existing = findOperationWorkspace(database, source.task_id, orchestrationId)
  if (existing) return toEnsureResult(existing, false)
  if (findOperationWorkspaceDeletionIntent(database, source.task_id)) {
    throw new SavedWorkspaceOperationError(
      "conflict",
      "Operation workspace was explicitly deleted; regenerate it before reuse.",
    )
  }

  const workspaceId = stableOperationWorkspaceId(source.task_id)
  const layout = createOperationWorkspaceLayout({
    taskId: source.task_id,
    orchestrationId,
    initiatingChatId: source.initiating_chat_id,
  })
  const now = nowEpochSeconds()
  try {
    database
      .prepare(
        `INSERT INTO saved_workspaces
           (id, name, scope_type, project_id, task_id, owner_kind, orchestration_id,
            layout_version, layout_json, sort_order, version, created_at, updated_at, archived_at)
         VALUES (?, ?, 'task', NULL, ?, 'orchestration', ?, 1, ?, ?, 1, ?, ?, NULL)`,
      )
      .run(
        workspaceId,
        operationWorkspaceName(source.task_name),
        source.task_id,
        orchestrationId,
        JSON.stringify(layout),
        `operation:${digest(source.task_id)}`,
        now,
        now,
      )
  } catch (error) {
    const winner = findOperationWorkspace(database, source.task_id, orchestrationId)
    if (winner) return toEnsureResult(winner, false)
    const message = error instanceof Error ? error.message : "Operation workspace creation failed."
    throw new SavedWorkspaceOperationError("conflict", message)
  }
  return { workspaceId, orchestrationId, taskId: source.task_id, created: true }
}

export function ensureOperationWorkspace(
  databasePath: string,
  taskId: string,
): EnsureOperationWorkspaceResult {
  return withDatabase(databasePath, (database) =>
    database.transaction(() => ensureOperationWorkspaceInTransaction(database, taskId)).immediate(),
  )
}

export function regenerateOperationWorkspace(
  databasePath: string,
  taskId: string,
): EnsureOperationWorkspaceResult {
  return withDatabase(databasePath, (database) =>
    database
      .transaction(() => {
        const source = requireOperationSource(database, taskId)
        const deleted = findOperationWorkspaceDeletionIntent(database, source.task_id)
        if (!deleted) return ensureOperationWorkspaceInTransaction(database, source.task_id)
        const orchestrationId = stableOperationOrchestrationId(source.task_id)
        const layout = createOperationWorkspaceLayout({
          taskId: source.task_id,
          orchestrationId,
          initiatingChatId: source.initiating_chat_id,
        })
        const result = database
          .prepare(
            `UPDATE saved_workspaces
             SET name = ?, owner_kind = 'orchestration', orchestration_id = ?,
                 layout_version = 1, layout_json = ?, sort_order = ?,
                 version = version + 1, updated_at = ?, archived_at = NULL
             WHERE id = ? AND task_id = ? AND owner_kind = 'manual'
               AND orchestration_id IS NULL AND sort_order = ?`,
          )
          .run(
            operationWorkspaceName(source.task_name),
            orchestrationId,
            JSON.stringify(layout),
            `operation:${digest(source.task_id)}`,
            nowEpochSeconds(),
            deleted.id,
            source.task_id,
            OPERATION_WORKSPACE_DELETION_SORT_ORDER,
          )
        if (result.changes !== 1) {
          throw new SavedWorkspaceOperationError(
            "conflict",
            "Operation workspace deletion intent changed before regeneration.",
          )
        }
        return {
          workspaceId: deleted.id,
          orchestrationId,
          taskId: source.task_id,
          created: true,
        }
      })
      .immediate(),
  )
}

export function reconcileOperationWorkspaces(
  databasePath: string,
): OperationWorkspaceReconciliationResult {
  return withDatabase(databasePath, (database) =>
    database
      .transaction(() => {
        const taskIds = database
          .prepare("SELECT task_id FROM task_orchestrations ORDER BY created_at, task_id")
          .all() as Array<{ task_id: string }>
        const results = taskIds.flatMap(({ task_id }) =>
          findOperationWorkspaceDeletionIntent(database, task_id)
            ? []
            : [ensureOperationWorkspaceInTransaction(database, task_id)],
        )
        return {
          inspected: taskIds.length,
          created: results.filter((result) => result.created).length,
          workspaceIds: results.map((result) => result.workspaceId),
        }
      })
      .immediate(),
  )
}

export function getOperationWorkspaceForTask(
  databasePath: string,
  taskId: string,
): EnsureOperationWorkspaceResult | null {
  return withDatabase(
    databasePath,
    (database) => {
      requireOperationSource(database, taskId)
      const orchestrationId = stableOperationOrchestrationId(taskId)
      const workspace = findOperationWorkspace(database, taskId, orchestrationId)
      return workspace ? toEnsureResult(workspace, false) : null
    },
    true,
  )
}

export function getOperationWorkspaceProjection(
  databasePath: string,
  workspaceId: string,
): SavedWorkspaceOperationProjection {
  return withDatabase(
    databasePath,
    (database) => {
      const workspace = database
        .prepare(
          `SELECT id, task_id, orchestration_id
           FROM saved_workspaces
           WHERE id = ? AND owner_kind = 'orchestration'`,
        )
        .get(workspaceId) as OperationWorkspaceRow | undefined
      if (!workspace) {
        throw new SavedWorkspaceOperationError(
          "not-found",
          `Operation workspace ${workspaceId} was not found.`,
        )
      }
      const expectedIdentity = stableOperationOrchestrationId(workspace.task_id)
      if (workspace.orchestration_id !== expectedIdentity) {
        throw new SavedWorkspaceOperationError(
          "invalid-data",
          "Operation workspace identity does not match its durable task lineage.",
        )
      }
      return projectOperation(database, workspace)
    },
    true,
  )
}

export function deriveOperationRoster(
  database: Database.Database,
  taskId: string,
): SavedWorkspaceRosterEntry[] {
  const source = findOperationSource(database, taskId)
  if (!source) return []
  const agents = listOperationAgents(database, taskId)
  return rosterFromRows(source.initiating_chat_id, agents)
}

function projectOperation(
  database: Database.Database,
  workspace: OperationWorkspaceRow,
): SavedWorkspaceOperationProjection {
  const source = requireOperationSource(database, workspace.task_id)
  const rows = listOperationAgents(database, workspace.task_id)
  const roster = rosterFromRows(source.initiating_chat_id, rows)
  const agents = rows.map(toAgentProjection)
  const materializedAgentCount = roster.filter((entry) => entry.kind === "agent").length
  return {
    workspaceId: workspace.id,
    orchestrationId: workspace.orchestration_id,
    taskId: source.task_id,
    taskName: source.task_name,
    projectId: source.project_id,
    initiatingChatId: source.initiating_chat_id,
    initiatingChatName: source.lead_chat_name,
    status: source.status,
    roster,
    agents,
    materializedAgentCount,
    pendingAgentCount: agents.filter((agent) => agent.chatId === null).length,
    overflowChatCount: Math.max(0, roster.length - 4),
    createdAt: epochSecondsToMilliseconds(source.created_at) ?? 0,
    updatedAt: epochSecondsToMilliseconds(source.updated_at) ?? 0,
    completedAt: epochSecondsToMilliseconds(source.completed_at),
  }
}

function requireOperationSource(database: Database.Database, taskId: string): OperationSourceRow {
  const row = findOperationSource(database, taskId)
  if (!row) {
    throw new SavedWorkspaceOperationError(
      "not-found",
      `Orchestration lineage for task ${taskId} was not found.`,
    )
  }
  return row
}

function findOperationSource(
  database: Database.Database,
  taskId: string,
): OperationSourceRow | undefined {
  return database
    .prepare(
      `SELECT o.task_id, o.initiating_chat_id, o.status, o.created_at, o.updated_at,
              o.completed_at, t.name AS task_name, t.project_id,
              c.name AS lead_chat_name
       FROM task_orchestrations o
       JOIN tasks t ON t.id = o.task_id
       JOIN chats c ON c.id = o.initiating_chat_id
       WHERE o.task_id = ?`,
    )
    .get(taskId) as OperationSourceRow | undefined
}

function listOperationAgents(database: Database.Database, taskId: string): OperationAgentRow[] {
  return database
    .prepare(
      `SELECT a.id, a.chat_id, a.run_id, a.parent_agent_id, a.replaced_agent_id,
              a.definition, a.status, a.progress_percent, a.result_summary, a.stop_reason,
              a.blocker_count, a.queued_at, a.started_at, a.completed_at,
              c.name AS chat_name, c.archived_at AS chat_archived_at
       FROM orchestration_agents a
       LEFT JOIN chats c ON c.id = a.chat_id
       WHERE a.task_id = ?
       ORDER BY a.queued_at, a.id
       LIMIT 1000`,
    )
    .all(taskId) as OperationAgentRow[]
}

function rosterFromRows(
  initiatingChatId: string,
  agents: OperationAgentRow[],
): SavedWorkspaceRosterEntry[] {
  const chatIds = new Set([initiatingChatId])
  const roster: SavedWorkspaceRosterEntry[] = [
    { kind: "lead", chatId: initiatingChatId, agentId: null, order: 0 },
  ]
  for (const agent of agents) {
    if (!agent.chat_id || chatIds.has(agent.chat_id)) continue
    chatIds.add(agent.chat_id)
    roster.push({
      kind: "agent",
      chatId: agent.chat_id,
      agentId: agent.id,
      order: roster.length,
    })
  }
  return savedWorkspaceRosterSchema.parse(roster)
}

function toAgentProjection(row: OperationAgentRow): SavedWorkspaceOperationAgent {
  const definition = parseAgentDefinition(row.definition)
  return {
    agentId: row.id,
    chatId: row.chat_id,
    chatName: row.chat_name,
    chatState:
      row.chat_id === null ? "pending" : row.chat_archived_at === null ? "ready" : "archived",
    runId: row.run_id,
    parentAgentId: row.parent_agent_id,
    replacedAgentId: row.replaced_agent_id,
    role: definition.role,
    name: definition.name,
    harness: definition.harness,
    status: row.status,
    progressPercent: Math.max(0, Math.min(100, Number(row.progress_percent) || 0)),
    resultSummary: row.result_summary,
    stopReason: row.stop_reason,
    blockerCount: Number(row.blocker_count) || 0,
    queuedAt: epochSecondsToMilliseconds(row.queued_at) ?? 0,
    startedAt: epochSecondsToMilliseconds(row.started_at),
    completedAt: epochSecondsToMilliseconds(row.completed_at),
  }
}

function parseAgentDefinition(value: string): {
  role: string
  name: string
  harness: string | null
} {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const role = nonEmptyString(parsed.role) ?? "Agent"
    return {
      role,
      name: nonEmptyString(parsed.name) ?? role,
      harness: nonEmptyString(parsed.harness),
    }
  } catch {
    return { role: "Agent", name: "Agent", harness: null }
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null
}

function findOperationWorkspace(
  database: Database.Database,
  taskId: string,
  orchestrationId: string,
): OperationWorkspaceRow | undefined {
  const row = database
    .prepare(
      `SELECT id, task_id, orchestration_id
       FROM saved_workspaces
       WHERE orchestration_id = ? OR (owner_kind = 'orchestration' AND task_id = ?)
       ORDER BY CASE WHEN orchestration_id = ? THEN 0 ELSE 1 END
       LIMIT 2`,
    )
    .all(orchestrationId, taskId, orchestrationId) as OperationWorkspaceRow[]
  if (
    row.length > 1 ||
    (row[0] && (row[0].orchestration_id !== orchestrationId || row[0].task_id !== taskId))
  ) {
    throw new SavedWorkspaceOperationError(
      "conflict",
      "Task lineage is already linked to a different operation workspace identity.",
    )
  }
  return row[0]
}

function findOperationWorkspaceDeletionIntent(
  database: Database.Database,
  taskId: string,
): OperationWorkspaceDeletionIntentRow | undefined {
  const row = database
    .prepare(
      `SELECT id, scope_type, task_id, owner_kind, orchestration_id, sort_order
       FROM saved_workspaces WHERE id = ? AND task_id = ?`,
    )
    .get(stableOperationWorkspaceId(taskId), taskId) as
    OperationWorkspaceDeletionIntentRow | undefined
  return row && isOperationWorkspaceDeletionIntent(row) ? row : undefined
}

function toEnsureResult(
  workspace: OperationWorkspaceRow,
  created: boolean,
): EnsureOperationWorkspaceResult {
  return {
    workspaceId: workspace.id,
    orchestrationId: workspace.orchestration_id,
    taskId: workspace.task_id,
    created,
  }
}

function operationWorkspaceName(taskName: string): string {
  const suffix = " operation"
  const trimmed = taskName.trim() || "Multi-agent"
  return `${trimmed.slice(0, 256 - suffix.length)}${suffix}`
}

function digest(taskId: string): string {
  return createHash("sha256").update(`flapstack-operation-workspace-v1\0${taskId}`).digest("hex")
}

function withDatabase<T>(
  databasePath: string,
  operation: (database: Database.Database) => T,
  readonly = false,
): T {
  const database = new Database(databasePath, readonly ? { readonly: true } : undefined)
  try {
    database.pragma("foreign_keys = ON")
    database.pragma("busy_timeout = 5000")
    return operation(database)
  } finally {
    database.close()
  }
}
