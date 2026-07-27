import {
  orchestrationAgentDefinitionSchema,
  type OrchestrationAgentDefinition,
} from "../../../shared/agent-orchestration"

/**
 * Parses a persisted orchestration definition while preserving the legacy
 * meaning of an explicit null local-tool list: no local tool requirements.
 */
export function parseDurableOrchestrationAgentDefinition(
  value: unknown,
): OrchestrationAgentDefinition {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Durable orchestration agent definition is not an object.")
  }
  const normalized = { ...(parsed as Record<string, unknown>) }
  if (normalized.requiredLocalToolTiers === null) {
    delete normalized.requiredLocalToolTiers
  }
  return orchestrationAgentDefinitionSchema.parse(normalized)
}
