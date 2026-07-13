import type { HarnessContextMetadata } from "../harness/launch-context"
import type { AgentInputRequest, AgentInputStatusEvent } from "../../../shared/agent-input"

// AI SDK UIMessageChunk format
export type UIMessageChunk =
  // Message lifecycle
  | { type: "start"; messageId?: string }
  | { type: "finish"; messageMetadata?: MessageMetadata }
  | { type: "start-step" }
  | { type: "finish-step" }
  // Text streaming
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  // Reasoning (Extended Thinking)
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning"; id: string; text: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  // Tool calls
  | { type: "tool-input-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; inputTextDelta: string }
  | {
      type: "tool-input-available"
      toolCallId: string
      toolName: string
      input: unknown
      providerMetadata?: Record<string, unknown>
    }
  | { type: "tool-output-available"; toolCallId: string; output: unknown }
  | { type: "tool-output-error"; toolCallId: string; errorText: string }
  // Error & metadata
  | { type: "error"; errorText: string }
  | { type: "auth-error"; errorText: string }
  | { type: "retry-notification"; message: string }
  | {
      type: "agent-input-request"
      request: AgentInputRequest
    }
  | { type: "agent-input-status"; event: AgentInputStatusEvent }
  | { type: "message-metadata"; messageMetadata: MessageMetadata }
  // Session initialization (MCP servers, plugins, tools)
  | {
      type: "session-init"
      tools: string[]
      mcpServers: MCPServer[]
      plugins: { name: string; path: string }[]
      skills: string[]
    }

export type MCPServerStatus = "connected" | "failed" | "pending" | "needs-auth"

export type MCPServerIcon = {
  src: string
  mimeType?: string
  sizes?: string[]
  theme?: "light" | "dark"
}

export type MCPServer = {
  name: string
  status: MCPServerStatus
  serverInfo?: {
    name: string
    version: string
    icons?: MCPServerIcon[]
  }
  error?: string
}

export type MessageMetadata = {
  sessionId?: string
  sdkMessageUuid?: string // SDK's message UUID for resumeSessionAt (rollback support)
  inputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  outputTokens?: number
  totalTokens?: number
  totalCostUsd?: number
  durationMs?: number
  resultSubtype?: string
  finalTextId?: string
  context?: HarnessContextMetadata
}
