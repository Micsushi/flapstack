import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk"
import type { AgentActivityAppend } from "../../../../shared/agent-activity"
import type {
  RuntimeAdapterContext,
  RuntimeAdapterProbe,
  RuntimeAdapterSession,
} from "../../../../shared/agent-runtime"

export const CLAUDE_AGENT_SDK_VERSION = "0.3.207"
export const CLAUDE_CODE_VERSION = "2.1.207"
export const CLAUDE_RUNTIME_ADAPTER_VERSION = "1"
export const CLAUDE_RUNTIME_PROTOCOL_VERSION = `claude-agent-sdk/${CLAUDE_AGENT_SDK_VERSION}`

export type ClaudeRuntimeResumeState = {
  sessionId: string
  resumeAtUuid?: string | null
  fork?: boolean
}

export type ClaudeRuntimeQueryInput = {
  prompt: string | AsyncIterable<unknown>
  options: Record<string, unknown>
}

export type ClaudeRuntimeProbeInput = {
  available: boolean
  sdkVersion: string | null
  claudeCodeVersion: string | null
  features: {
    partialMessages: boolean
    thinking: boolean
    hooks: boolean
    subagentForwarding: boolean
    resume: boolean
    resumeAt: boolean
    fork: boolean
    cancellation: boolean
  }
  unavailableReason?: string | null
}

export type ClaudeRuntimeRecoveryStatus = "running" | "completed" | "uncertain"

export type ClaudeRuntimeDependencies = {
  query(input: ClaudeRuntimeQueryInput): AsyncIterable<SDKMessage>
  probe(): Promise<ClaudeRuntimeProbeInput>
  buildQueryOptions(
    context: RuntimeAdapterContext,
    prompt: string,
    abortController: AbortController,
  ): Promise<Record<string, unknown>> | Record<string, unknown>
  resolvePrompt?(
    context: RuntimeAdapterContext,
    prompt: string,
  ): Promise<string | AsyncIterable<unknown>> | string | AsyncIterable<unknown>
  loadSession(context: RuntimeAdapterContext): Promise<ClaudeRuntimeResumeState | null>
  persistSession(context: RuntimeAdapterContext, sessionId: string): Promise<void> | void
  clearStaleSession(context: RuntimeAdapterContext, sessionId: string): Promise<void> | void
  persistMessageUuid?(context: RuntimeAdapterContext, messageUuid: string): Promise<void> | void
  appendActivity(
    context: RuntimeAdapterContext,
    activity: readonly AgentActivityAppend[],
  ): Promise<void> | void
  requestPermission?(context: RuntimeAdapterContext, request: unknown): Promise<unknown>
  requestInput?(context: RuntimeAdapterContext, request: unknown): Promise<unknown>
  cancel?(context: RuntimeAdapterContext, reason: string): Promise<void> | void
  complete?(context: RuntimeAdapterContext): Promise<void> | void
  reconcile?(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
  ): Promise<ClaudeRuntimeRecoveryStatus>
  cleanup?(context: RuntimeAdapterContext): Promise<void> | void
  isMissingSessionError?(error: unknown): boolean
}

export type ClaudeRuntimeAdapterProbe = RuntimeAdapterProbe
