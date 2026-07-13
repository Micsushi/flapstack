/**
 * OpenCode sidecar harness contract (Track E - E1).
 *
 * Typed inputs/outputs that every downstream sidecar module depends on. This is
 * the Flapstack-owned boundary around the OpenCode server: Flapstack controls
 * launch, config, credentials, permission mapping, and event normalization;
 * OpenCode owns the model/tool loop.
 *
 * These types are the stable boundary used by the live sidecar runtime and its
 * persisted run loop.
 */

import type {
  HarnessPermissionApplication,
  OpencodeHarness,
} from "../../../../shared/harness-types"
import type { PermissionMode } from "../../permissions"

/** Flapstack-facing provider identity. The runtime engine is always OpenCode. */
export type OpencodeProviderId = OpencodeHarness

/**
 * OpenCode addresses models as `providerID/modelID`. For Flapstack's two Stage 2
 * providers the OpenCode provider id is fixed per Flapstack provider.
 */
export type OpencodeModelSpec = {
  providerId: string
  modelId: string
}

export type SidecarAttachment = {
  mime: string
  url: string
  filename?: string
}

/** Everything Flapstack passes to launch and drive one sidecar run. */
export type SidecarLaunchInput = {
  provider: OpencodeProviderId
  /** OpenCode `providerID/modelID` string, e.g. `openrouter/anthropic/claude-opus-4-8`. */
  model: string
  prompt: string
  attachments?: SidecarAttachment[]
  /** Working directory OpenCode operates in (project/worktree checkout). */
  cwd: string
  permissionMode: PermissionMode
  reasoningEnabled: boolean
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh"
  /** Resume/fork an existing OpenCode session when continuing a chat. */
  resumeSessionId?: string
  /** Extra environment for the child process (never logged raw). */
  env?: Record<string, string>
  /** Abort signal wired to Flapstack run cancellation. */
  signal?: AbortSignal
}

/**
 * Reasons a sidecar run cannot start or continue. Each maps to an honest,
 * actionable UI state - never a silent no-op.
 */
export type SidecarLimitationCode =
  | "opencode-missing"
  | "node-or-npx-missing"
  | "provider-key-missing"
  | "provider-auth-failed"
  | "model-missing"
  | "config-write-failed"
  | "server-startup-timeout"
  | "permission-bridge-unavailable"

export type SidecarLimitation = {
  code: SidecarLimitationCode
  message: string
  /** What the user (or a repair action) should do about it. */
  remedy: string
}

/** Lifecycle phases surfaced through the shared run lifecycle. */
export type SidecarPhase =
  | "resolving-binary"
  | "writing-config"
  | "starting-server"
  | "awaiting-health"
  | "creating-session"
  | "streaming"
  | "cancelling"
  | "done"
  | "failed"

/**
 * Normalized sidecar event. OpenCode's raw SSE events are mapped into this
 * shape before they touch the run/persistence layer or the reasoning-output UI. Keeping
 * this provider-agnostic is what lets OpenRouter, NanoGPT, and any future
 * OpenCode-backed provider share one renderer path.
 */
export type NormalizedSidecarEvent =
  | { kind: "session-start"; sessionId: string }
  | { kind: "phase"; phase: SidecarPhase }
  | { kind: "text-delta"; partId: string; delta: string }
  | { kind: "reasoning-delta"; partId: string; delta: string }
  | { kind: "reasoning-summary"; partId: string; text: string }
  | { kind: "reasoning-metadata"; partId: string; metadata: unknown }
  | { kind: "tool-input-start"; toolCallId: string; toolName: string }
  | { kind: "tool-input-delta"; toolCallId: string; delta: string }
  | { kind: "tool-input-available"; toolCallId: string; toolName: string; input: unknown }
  | { kind: "tool-output"; toolCallId: string; output: unknown }
  | { kind: "tool-error"; toolCallId: string; errorText: string }
  | {
      kind: "permission-asked"
      requestId: string
      toolCallId: string
      permission: string
      /** Exact OpenCode permission patterns (commands, paths, or resource globs). */
      patterns: string[]
      /** Original command when OpenCode provides it separately from its patterns. */
      command?: string
    }
  | {
      kind: "permission-decision"
      requestId: string
      toolCallId: string
      permission: string
      patterns: string[]
      reply: SidecarApprovalDecision["reply"]
      message?: string
      source: "policy" | "user" | "fallback"
      replyStatus: "applied" | "no-longer-pending"
    }
  | { kind: "permission-application"; application: HarnessPermissionApplication }
  | { kind: "usage"; usage: SidecarUsage }
  | { kind: "error"; errorText: string; auth?: boolean }
  | { kind: "idle" }
  | { kind: "done" }

/**
 * Usage/cost quality mirrors the Track B labeling so U8/U9 never treat an
 * estimate as billing truth.
 */
export type SidecarCostQuality = "provider-reported" | "estimated" | "unknown"

export type SidecarUsage = {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
  costUsd?: number
  costQuality: SidecarCostQuality
  /** Provider generation id (OpenRouter) for later exact-cost reconciliation. */
  generationId?: string
  /** OpenCode assistant-message id used only to merge repeated updates. It is
   * not an upstream provider generation id. */
  observationId?: string
}

/** Result of one sidecar run, fed into run persistence + usage hooks. */
export type SidecarRunResult = {
  status: "succeeded" | "failed" | "cancelled"
  sessionId?: string
  usage?: SidecarUsage
  limitations: SidecarLimitation[]
  /** OpenCode server version, recorded on the run for reproducibility. */
  serverVersion?: string
  error?: string
}

/** Decision Flapstack returns when OpenCode asks for tool permission. */
export type SidecarApprovalDecision =
  { reply: "once" } | { reply: "always" } | { reply: "reject"; message: string }

export type SidecarApprovalCallback = (request: {
  requestId: string
  toolCallId: string
  permission: string
  patterns: string[]
  command?: string
}) => Promise<SidecarApprovalDecision>

export type SidecarPermissionResolution = {
  decision: SidecarApprovalDecision
  source: "policy" | "user" | "fallback"
  replyStatus: "applied" | "no-longer-pending"
}

export function limitation(
  code: SidecarLimitationCode,
  message: string,
  remedy: string,
): SidecarLimitation {
  return { code, message, remedy }
}
