import { z } from "zod"
import type { RunPermissionMode } from "./harness-types"

export const AGENT_RUNTIME_PREFERENCES = [
  "auto",
  "codex",
  "codex-enhanced",
  "claude-code",
  "claude-code-enhanced",
  "flapstack-native",
] as const
export type AgentRuntimePreference = (typeof AGENT_RUNTIME_PREFERENCES)[number]

export const RESOLVED_AGENT_RUNTIMES = ["codex", "claude-code", "flapstack-native"] as const
export type ResolvedAgentRuntime = (typeof RESOLVED_AGENT_RUNTIMES)[number]

export function runtimeAdapterForPreference(
  preference: AgentRuntimePreference,
): ResolvedAgentRuntime | null {
  if (preference === "auto") return null
  if (preference === "codex" || preference === "codex-enhanced") return "codex"
  if (preference === "claude-code" || preference === "claude-code-enhanced") {
    return "claude-code"
  }
  return "flapstack-native"
}

export function usesFlapstackRuntimeEnhancements(preference: AgentRuntimePreference): boolean {
  return preference === "codex-enhanced" || preference === "claude-code-enhanced"
}

export const RUNTIME_PREFERENCE_SOURCES = [
  "chat",
  "project",
  "global",
  "product",
  "legacy",
] as const
export type RuntimePreferenceSource = (typeof RUNTIME_PREFERENCE_SOURCES)[number]

export type RuntimeBlockReasonCode =
  | "runtime-incompatible"
  | "runtime-unavailable"
  | "adapter-disabled"
  | "protocol-unsupported"
  | "chat-missing"
  | "chat-archived"
  | "project-missing"
  | "settings-version-conflict"

export type RuntimeBlockReason = {
  code: RuntimeBlockReasonCode
  message: string
  harness: string
  runtime: ResolvedAgentRuntime | null
  repair: string
}

export type RuntimeCompatibilityResult =
  | {
      compatible: true
      harness: string
      runtime: ResolvedAgentRuntime
      reason: null
    }
  | {
      compatible: false
      harness: string
      runtime: ResolvedAgentRuntime
      reason: RuntimeBlockReason
    }

export type RuntimeCapabilityStatus = "available" | "unavailable" | "unprobed" | "legacy"

export type RuntimeControlCapability = {
  supported: boolean
  reason: string | null
}

export type RuntimeCapabilitySnapshot = {
  schemaVersion: 1
  status: RuntimeCapabilityStatus
  capturedAt: string | null
  controls: {
    modelThinking: RuntimeControlCapability
    reasoningDisplay: RuntimeControlCapability
    subagentActivity: RuntimeControlCapability
    hookDiagnostics: RuntimeControlCapability
  }
  execution?: {
    continuation: RuntimeControlCapability
    delegation: RuntimeControlCapability
    structuredOutput: RuntimeControlCapability
    cancellation: RuntimeControlCapability
  }
  limitations: string[]
  unavailableReason: RuntimeBlockReason | null
}

export type RuntimeVersionSnapshot = {
  adapterVersion: string
  protocolVersion: string
}

export type RuntimeLaunchControls = {
  schemaVersion: 1
  modelEffort: string | null
  /** Provider service-tier id. Optional only for legacy schema-v1 snapshots. */
  serviceTier?: string | null
  modelThinking: boolean | null
  reasoningDisplay: boolean
  subagentActivity: boolean
  hookDiagnostics: boolean
}

export type RuntimePermissionSnapshot = {
  mode: RunPermissionMode
  customPermissions: Record<string, boolean> | null
}

export type ResolvedRuntimeLaunch = {
  schemaVersion: 1
  harness: string
  model: string | null
  requestedPreference: AgentRuntimePreference
  preferenceSource: RuntimePreferenceSource
  resolvedRuntime: ResolvedAgentRuntime
  compatibility: Extract<RuntimeCompatibilityResult, { compatible: true }>
  versions: RuntimeVersionSnapshot
  capabilities: RuntimeCapabilitySnapshot
  controls: RuntimeLaunchControls
  permission: RuntimePermissionSnapshot
}

export type RuntimeAdapterProbe = {
  runtime: ResolvedAgentRuntime
  harness: string
  available: boolean
  versions: RuntimeVersionSnapshot
  capabilities: RuntimeCapabilitySnapshot
  reason: RuntimeBlockReason | null
}

export type RuntimeAdapterSession = {
  providerSessionId: string | null
  providerThreadId: string | null
}

export type RuntimeAdapterTurn = {
  providerTurnId: string | null
}

export type RuntimeAdapterContext = {
  runId: string
  chatId: string
  subChatId: string | null
  launch: ResolvedRuntimeLaunch
  instructions?: string | null
  outputSchema?: Record<string, unknown> | null
  signal: AbortSignal
}

export interface HarnessAdapter<TActivity = unknown> {
  readonly runtime: ResolvedAgentRuntime
  probe(harness: string): Promise<RuntimeAdapterProbe>
  startSession(context: RuntimeAdapterContext): Promise<RuntimeAdapterSession>
  resumeSession(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
  ): Promise<RuntimeAdapterSession>
  startTurn(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    prompt: string,
  ): Promise<RuntimeAdapterTurn>
  streamActivity(
    context: RuntimeAdapterContext,
    session: RuntimeAdapterSession,
    turn: RuntimeAdapterTurn,
  ): AsyncIterable<TActivity>
  requestPermission(context: RuntimeAdapterContext, request: unknown): Promise<unknown>
  requestInput(context: RuntimeAdapterContext, request: unknown): Promise<unknown>
  cancel(context: RuntimeAdapterContext, reason: string): Promise<void>
  complete(context: RuntimeAdapterContext): Promise<void>
  reconcile(context: RuntimeAdapterContext): Promise<"running" | "completed" | "uncertain">
  cleanup(context: RuntimeAdapterContext): Promise<void>
}

export type HarnessAdapterFactory<TActivity = unknown> = () => HarnessAdapter<TActivity>

export interface HarnessAdapterRegistryContract<TActivity = unknown> {
  get(runtime: ResolvedAgentRuntime): HarnessAdapter<TActivity> | null
  list(): ReadonlyArray<{
    runtime: ResolvedAgentRuntime
    factory: HarnessAdapterFactory<TActivity>
  }>
}

export type RuntimeDefaultScope = { type: "global"; id: null } | { type: "project"; id: string }

export type AgentRuntimeDefaultDto = {
  scope: RuntimeDefaultScope
  harness: string
  preference: AgentRuntimePreference
  version: number
  createdAt: number
  updatedAt: number
}

export const agentRuntimePreferenceSchema = z.enum(AGENT_RUNTIME_PREFERENCES)
export const resolvedAgentRuntimeSchema = z.enum(RESOLVED_AGENT_RUNTIMES)
export const runtimeDefaultScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global"), id: z.null() }),
  z.object({ type: z.literal("project"), id: z.string().trim().min(1).max(128) }),
])
export const runtimeDefaultListInputSchema = z.object({
  scope: runtimeDefaultScopeSchema.optional(),
  harness: z.string().trim().min(1).max(80).optional(),
})
export const runtimeDefaultWriteInputSchema = z.object({
  scope: runtimeDefaultScopeSchema,
  harness: z.string().trim().min(1).max(80),
  preference: agentRuntimePreferenceSchema,
  expectedVersion: z.number().int().min(0),
})
export const runtimeDefaultDeleteInputSchema = z.object({
  scope: runtimeDefaultScopeSchema,
  harness: z.string().trim().min(1).max(80),
  expectedVersion: z.number().int().min(1),
})

export const DEFAULT_RUNTIME_CONTROLS: RuntimeLaunchControls = {
  schemaVersion: 1,
  modelEffort: null,
  serviceTier: null,
  modelThinking: null,
  reasoningDisplay: true,
  subagentActivity: true,
  hookDiagnostics: false,
}
