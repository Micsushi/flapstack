import type { AgentInputRequest, AgentInputStatusEvent } from "./agent-input"

export const DEV_AGENT_INPUT_CHANNEL = "dev-mcp:agent-input"

export type DevAgentInputPayload =
  | { type: "agent-input-request"; request: AgentInputRequest }
  | { type: "agent-input-status"; event: AgentInputStatusEvent }
