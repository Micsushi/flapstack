import type {
  SavedWorkspaceOperationAgent,
  SavedWorkspaceOperationProjection,
} from "./saved-workspaces"

export const MAX_WORKBENCH_PROJECTION_AGENTS = 100
export const MAX_WORKBENCH_PROJECTION_ACTIVITY = 500

export type WorkbenchProjectionActivity = {
  id: string
  sequence: number
  occurredAt: number
  agentId: string | null
  kind: string
  summary: string
}

export type WorkbenchProjectionTaskPath = {
  agentId: string
  canonicalPath: string
}

export type AdvancedWorkbenchProjection = {
  orchestrationId: string
  taskId: string
  fleet: Array<
    Pick<
      SavedWorkspaceOperationAgent,
      | "agentId"
      | "runId"
      | "parentAgentId"
      | "replacedAgentId"
      | "name"
      | "role"
      | "harness"
      | "status"
      | "progressPercent"
    > & { canReplay: false }
  >
  lineage: Array<{
    agentId: string
    parentAgentId: string
    replacedAgentId: string | null
  }>
  activity: WorkbenchProjectionActivity[]
  taskPaths: WorkbenchProjectionTaskPath[]
  truncatedAgentCount: number
}

export function createAdvancedWorkbenchProjection(
  operation: SavedWorkspaceOperationProjection,
  activity: readonly WorkbenchProjectionActivity[],
  taskPaths: readonly WorkbenchProjectionTaskPath[],
): AdvancedWorkbenchProjection {
  const deduplicated = new Map<string, SavedWorkspaceOperationAgent>()
  for (const agent of [...operation.agents].sort(compareAgents)) {
    if (!deduplicated.has(agent.agentId)) deduplicated.set(agent.agentId, agent)
  }
  const allAgents = [...deduplicated.values()]
  const selected = allAgents.slice(0, MAX_WORKBENCH_PROJECTION_AGENTS)
  const selectedIds = new Set(selected.map((agent) => agent.agentId))
  const fleet = selected.map((agent) => ({
    agentId: agent.agentId,
    runId: agent.runId,
    parentAgentId: agent.parentAgentId,
    replacedAgentId: agent.replacedAgentId,
    name: agent.name,
    role: agent.role,
    harness: agent.harness,
    status: agent.status,
    progressPercent: agent.progressPercent,
    canReplay: false as const,
  }))
  return {
    orchestrationId: operation.orchestrationId,
    taskId: operation.taskId,
    fleet,
    lineage: selected.flatMap((agent) =>
      agent.parentAgentId && selectedIds.has(agent.parentAgentId)
        ? [
            {
              agentId: agent.agentId,
              parentAgentId: agent.parentAgentId,
              replacedAgentId:
                agent.replacedAgentId && selectedIds.has(agent.replacedAgentId)
                  ? agent.replacedAgentId
                  : null,
            },
          ]
        : [],
    ),
    activity: deduplicateActivity(activity),
    taskPaths: deduplicateTaskPaths(taskPaths, selectedIds),
    truncatedAgentCount: Math.max(0, allAgents.length - selected.length),
  }
}

function compareAgents(left: SavedWorkspaceOperationAgent, right: SavedWorkspaceOperationAgent) {
  return left.queuedAt - right.queuedAt || left.agentId.localeCompare(right.agentId)
}

function deduplicateActivity(
  activity: readonly WorkbenchProjectionActivity[],
): WorkbenchProjectionActivity[] {
  const deduplicated = new Map<string, WorkbenchProjectionActivity>()
  for (const event of [...activity].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.occurredAt - right.occurredAt ||
      left.id.localeCompare(right.id),
  )) {
    if (event.kind === "private-reasoning") continue
    if (!deduplicated.has(event.id)) {
      deduplicated.set(event.id, {
        id: event.id,
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        agentId: event.agentId,
        kind: event.kind,
        summary: event.summary,
      })
    }
  }
  return [...deduplicated.values()].slice(-MAX_WORKBENCH_PROJECTION_ACTIVITY)
}

function deduplicateTaskPaths(
  taskPaths: readonly WorkbenchProjectionTaskPath[],
  selectedIds: ReadonlySet<string>,
): WorkbenchProjectionTaskPath[] {
  const deduplicated = new Map<string, WorkbenchProjectionTaskPath>()
  for (const entry of [...taskPaths].sort((left, right) =>
    left.agentId.localeCompare(right.agentId),
  )) {
    if (
      selectedIds.has(entry.agentId) &&
      entry.canonicalPath.trim() &&
      !deduplicated.has(entry.agentId)
    ) {
      deduplicated.set(entry.agentId, {
        agentId: entry.agentId,
        canonicalPath: entry.canonicalPath,
      })
    }
  }
  return [...deduplicated.values()]
}
