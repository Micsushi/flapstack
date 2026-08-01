import type {
  AgentPersonalityVersionRef,
  ResolvedAgentPersonalityDocument,
} from "../../../shared/agent-personalities"
import type { AgentProfileScope } from "../../../shared/agent-profiles"

export type AgentPersonalityResolutionPort = {
  resolve(
    ref: AgentPersonalityVersionRef,
    profileScope: AgentProfileScope,
  ): ResolvedAgentPersonalityDocument
}

let configuredPort: AgentPersonalityResolutionPort | null = null

export function configureAgentPersonalityResolutionPort(
  port: AgentPersonalityResolutionPort | null,
): void {
  configuredPort = port
}

export function resolveConfiguredAgentPersonality(
  ref: AgentPersonalityVersionRef,
  profileScope: AgentProfileScope,
): ResolvedAgentPersonalityDocument {
  if (!configuredPort) {
    throw new Error("Agent Personality storage is unavailable.")
  }
  return configuredPort.resolve(ref, profileScope)
}
