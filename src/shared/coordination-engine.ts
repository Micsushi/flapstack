import { z } from "zod"

export const COORDINATION_ENGINES = ["workflow", "codex-v2", "codex-v1"] as const
export type CoordinationEngine = (typeof COORDINATION_ENGINES)[number]

export const COORDINATION_ENGINE_VERSIONS = {
  workflow: "workflow-v1",
  "codex-v2": "codex-v2-v1",
  "codex-v1": "codex-v1-v1",
} as const satisfies Record<CoordinationEngine, string>

export const COORDINATION_ENGINE_SOURCES = [
  "per-launch",
  "project",
  "global",
  "product",
  "legacy",
] as const
export type CoordinationEngineSource = (typeof COORDINATION_ENGINE_SOURCES)[number]

export const COORDINATION_ENGINE_LIFECYCLE_ACTIONS = [
  "prepare",
  "start",
  "resume",
  "send",
  "follow-up",
  "interrupt",
  "wait",
  "complete",
  "reconcile",
  "cancel",
  "cleanup",
] as const
export type CoordinationEngineLifecycleAction =
  (typeof COORDINATION_ENGINE_LIFECYCLE_ACTIONS)[number]

export const COORDINATION_ENGINE_CAPABILITIES = [
  "durable-workflow",
  "checkpoints",
  "mixed-runtimes",
  "named-task-paths",
  "selective-context-fork",
  "queued-messages",
  "follow-up",
  "mailbox",
  "interrupt-without-destroy",
  "resident-workers",
  "legacy-agent-ids",
  "legacy-resume",
  "legacy-close",
] as const
export type CoordinationEngineCapability = (typeof COORDINATION_ENGINE_CAPABILITIES)[number]

export type CoordinationEngineBlockCode =
  | "engine-unavailable"
  | "engine-capability-missing"
  | "engine-version-unsupported"
  | "engine-settings-version-conflict"
  | "project-missing"
  | "active-orchestration"

export type CoordinationEngineBlockReason = {
  code: CoordinationEngineBlockCode
  engine: CoordinationEngine
  message: string
  missingCapabilities: CoordinationEngineCapability[]
  repair: string
}

export type CoordinationEngineCapabilitySnapshot = {
  schemaVersion: 1
  engine: CoordinationEngine
  engineVersion: string
  status: "available" | "unavailable" | "unprobed" | "legacy"
  capturedAt: string | null
  capabilities: CoordinationEngineCapability[]
  limitations: string[]
  unavailableReason: CoordinationEngineBlockReason | null
}

export type CoordinationEngineProviderIdentity =
  | {
      schemaVersion: 1
      engine: "workflow"
      workflowRunId: string
    }
  | {
      schemaVersion: 1
      engine: "codex-v2"
      canonicalTaskPath: string
      taskName: string
      providerTaskId: string | null
    }
  | {
      schemaVersion: 1
      engine: "codex-v1"
      providerAgentId: string
      nickname: string | null
    }

export type CoordinationEngineProbe = {
  engine: CoordinationEngine
  available: boolean
  engineVersion: string
  snapshot: CoordinationEngineCapabilitySnapshot
  reason: CoordinationEngineBlockReason | null
}

export type ResolvedCoordinationEngineSnapshot = {
  schemaVersion: 1
  requestedEngine: CoordinationEngine
  source: CoordinationEngineSource
  engine: CoordinationEngine
  engineVersion: string
  capabilities: CoordinationEngineCapabilitySnapshot
  providerIdentity: CoordinationEngineProviderIdentity | null
}

export type CoordinationEngineAction =
  | {
      schemaVersion: 1
      kind: "prepare" | "start" | "resume" | "reconcile" | "cancel" | "cleanup"
      orchestrationId: string
      providerIdentity: CoordinationEngineProviderIdentity | null
      contextFork?: {
        sourceProviderThreadId: string
        lastTurnId: string | null
      } | null
    }
  | {
      schemaVersion: 1
      kind: "send" | "follow-up" | "interrupt"
      orchestrationId: string
      providerIdentity: CoordinationEngineProviderIdentity
      targetAgentId: string
      message: string | null
    }
  | {
      schemaVersion: 1
      kind: "wait"
      orchestrationId: string
      providerIdentity: CoordinationEngineProviderIdentity
      targetAgentIds: string[]
      timeoutMs: number | null
    }
  | {
      schemaVersion: 1
      kind: "complete"
      orchestrationId: string
      providerIdentity: CoordinationEngineProviderIdentity
      resultSummary: string | null
    }

export type CoordinationEngineActionResult =
  | {
      schemaVersion: 1
      ok: true
      action: CoordinationEngineLifecycleAction
      state: "prepared" | "running" | "waiting" | "completed" | "cancelled" | "clean"
      providerIdentity: CoordinationEngineProviderIdentity | null
      result: unknown
    }
  | {
      schemaVersion: 1
      ok: false
      action: CoordinationEngineLifecycleAction
      state: "blocked" | "uncertain" | "failed"
      providerIdentity: CoordinationEngineProviderIdentity | null
      reason: CoordinationEngineBlockReason
    }

export type CoordinationEngineContext = {
  orchestrationId: string
  snapshot: ResolvedCoordinationEngineSnapshot
  signal: AbortSignal
}

export interface CoordinationEngineAdapter {
  readonly engine: CoordinationEngine
  readonly version: string
  probe(): Promise<CoordinationEngineProbe>
  prepare(context: CoordinationEngineContext): Promise<CoordinationEngineActionResult>
  start(context: CoordinationEngineContext): Promise<CoordinationEngineActionResult>
  resume(context: CoordinationEngineContext): Promise<CoordinationEngineActionResult>
  execute(
    context: CoordinationEngineContext,
    action: CoordinationEngineAction,
  ): Promise<CoordinationEngineActionResult>
  reconcile(context: CoordinationEngineContext): Promise<CoordinationEngineActionResult>
  cancel(context: CoordinationEngineContext): Promise<CoordinationEngineActionResult>
  cleanup(context: CoordinationEngineContext): Promise<CoordinationEngineActionResult>
}

export type CoordinationEngineDefaultScope =
  { type: "global"; id: null } | { type: "project"; id: string }

export type CoordinationEngineDefaultDto = {
  scope: CoordinationEngineDefaultScope
  engine: CoordinationEngine
  version: number
  createdAt: number
  updatedAt: number
}

export type CoordinationEngineOptionPreview = {
  engine: CoordinationEngine
  label: string
  description: string
  advanced: boolean
  selected: boolean
  supported: boolean
  reason: CoordinationEngineBlockReason | null
}

export type CoordinationEngineLaunchPreview = {
  ok: boolean
  source: CoordinationEngineSource
  requestedEngine: CoordinationEngine
  resolved: ResolvedCoordinationEngineSnapshot | null
  blockedReason: CoordinationEngineBlockReason | null
  options: CoordinationEngineOptionPreview[]
}

export const PROFILE_PROMOTION_BOUNDARY = {
  schemaVersion: 1,
  capabilityProfile:
    "Role, instructions, tools, skills, model ceiling, permissions, memory, worktree, and descendants.",
  presentationStyle: "Tone, verbosity, formatting, response shape, and optional voice only.",
  workflowBinding: "Topology, phases, dependencies, schemas, gates, and bounded step overrides.",
  runtimeSnapshot:
    "Immutable resolved harness, Runtime, model, permissions, controls, and source versions for one launch.",
  authorityRule:
    "Presentation and workflow metadata cannot widen capability, permissions, secrets, memory, descendants, model ceiling, Runtime compatibility, or coordination policy.",
} as const

export const coordinationEngineSchema = z.enum(COORDINATION_ENGINES)
export const coordinationEngineDefaultScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global"), id: z.null() }),
  z.object({ type: z.literal("project"), id: z.string().trim().min(1).max(200) }),
])
export const coordinationEngineDefaultListSchema = z.object({
  scope: coordinationEngineDefaultScopeSchema.optional(),
})
export const coordinationEngineDefaultWriteSchema = z.object({
  scope: coordinationEngineDefaultScopeSchema,
  engine: coordinationEngineSchema,
  expectedVersion: z.number().int().nonnegative(),
})
export const coordinationEngineDefaultDeleteSchema = z.object({
  scope: coordinationEngineDefaultScopeSchema,
  expectedVersion: z.number().int().positive(),
})
export const coordinationEnginePreviewSchema = z.object({
  projectId: z.string().trim().min(1).max(200),
  perLaunchEngine: coordinationEngineSchema.nullish(),
})
