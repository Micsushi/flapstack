import type { OrchestrationAgentDefinition } from "../../../shared/agent-orchestration"

export type WorkflowAgentMaterializationRequest = {
  workflowRunId: string
  taskId: string
  stepId: string
  attemptCount: number
  agentDefinition: OrchestrationAgentDefinition
}

export type WorkflowAgentMaterializationResult = {
  agentDefinition: OrchestrationAgentDefinition
  profileSnapshotId?: string
  bindingVersion?: number
}

/**
 * Provider-neutral pre-durable-worker binding seam. Implementations must be
 * idempotent for one workflowRunId/stepId/attemptCount tuple.
 */
export interface WorkflowAgentMaterializerPort {
  materialize(
    request: WorkflowAgentMaterializationRequest,
  ): Promise<WorkflowAgentMaterializationResult>
}

export const identityWorkflowAgentMaterializer: WorkflowAgentMaterializerPort = {
  async materialize({ agentDefinition }) {
    return { agentDefinition }
  },
}
