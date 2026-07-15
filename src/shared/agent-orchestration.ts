import { z } from "zod"
import { CUSTOM_PERMISSION_SCHEMA_VERSION } from "./permission-capabilities"
import { agentRuntimePreferenceSchema } from "./agent-runtime"
import {
  coordinationEngineSchema,
  type ResolvedCoordinationEngineSnapshot,
} from "./coordination-engine"

const idSchema = z.string().trim().min(1).max(200)

export const orchestrationStatuses = [
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "stopped",
] as const
export const orchestrationStatusSchema = z.enum(orchestrationStatuses)

export const orchestrationAgentStatuses = [
  "queued",
  "active",
  "completed",
  "failed",
  "stopped",
] as const
export const orchestrationAgentStatusSchema = z.enum(orchestrationAgentStatuses)

export const orchestrationControlActions = ["pause", "resume", "stop"] as const
export const orchestrationControlActionSchema = z.enum(orchestrationControlActions)

export const orchestrationHarnessSchema = z.enum(["codex", "claude-code"])
export const orchestrationPermissionModeSchema = z.enum([
  "read-only",
  "ask-before-edits",
  "auto-edit-project-only",
  "full-access",
  "custom",
])
export const orchestrationWorktreeStrategySchema = z.enum([
  "inherit",
  "task-primary",
  "existing",
  "attached-branch",
  "none",
])
export const orchestrationCostQualitySchema = z.enum([
  "exact",
  "provider-reported",
  "estimated",
  "unknown",
])

export const orchestrationFleetStates = ["all", "active", "terminal", "unknown"] as const
export const orchestrationFleetStateSchema = z.enum(orchestrationFleetStates)

export const orchestrationFleetArchiveScopes = ["visible", "archived", "all"] as const
export const orchestrationFleetArchiveScopeSchema = z.enum(orchestrationFleetArchiveScopes)

export const orchestrationFleetSorts = [
  "updated-desc",
  "updated-asc",
  "created-desc",
  "created-asc",
  "name-asc",
] as const
export const orchestrationFleetSortSchema = z.enum(orchestrationFleetSorts)

export const orchestrationFleetQuerySchema = z
  .object({
    projectIds: z.array(idSchema).max(100).default([]),
    taskIds: z.array(idSchema).max(100).default([]),
    statuses: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
    providers: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    state: orchestrationFleetStateSchema.default("all"),
    archiveScope: orchestrationFleetArchiveScopeSchema.default("visible"),
    sort: orchestrationFleetSortSchema.default("updated-desc"),
    limit: z.number().int().min(1).max(100).default(25),
    cursor: z.string().max(1_024).optional(),
  })
  .strict()

export const orchestrationStopConditionsSchema = z
  .object({
    targetCompletedAgents: z.number().int().positive().max(1_000).optional(),
    targetProgressPercent: z.number().int().min(1).max(100).optional(),
    maxWallClockMs: z
      .number()
      .int()
      .positive()
      .max(31 * 24 * 60 * 60 * 1_000)
      .optional(),
    maxTotalTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    maxCostUsdMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    maxFailures: z.number().int().positive().max(1_000).optional(),
    maxBlockers: z.number().int().positive().max(1_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.maxCostUsdMicros && !value.maxTotalTokens && !value.maxWallClockMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCostUsdMicros"],
        message:
          "Cost budgets require a token or wall-clock fallback when exact cost is unavailable.",
      })
    }
  })

export const orchestrationAgentDefinitionSchema = z
  .object({
    agentId: idSchema.optional(),
    role: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160).optional(),
    prompt: z.string().trim().min(1).max(100_000),
    spec: z.string().trim().min(1).max(100_000).optional(),
    harness: orchestrationHarnessSchema,
    provider: z.string().trim().min(1).max(120).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
    runtimePreference: agentRuntimePreferenceSchema.optional(),
    permissionMode: orchestrationPermissionModeSchema,
    customPermissions: z
      .object({
        schemaVersion: z.literal(CUSTOM_PERMISSION_SCHEMA_VERSION),
        projectWrite: z.boolean(),
        shell: z.boolean(),
        network: z.boolean(),
        git: z.boolean(),
        browser: z.boolean(),
        secrets: z.boolean(),
        subagents: z.boolean(),
        thirdPartyMcp: z.boolean(),
        productMcpRead: z.boolean(),
        productMcpWrite: z.boolean(),
        productMcpTier3: z.boolean(),
      })
      .strict()
      .optional(),
    worktreeStrategy: orchestrationWorktreeStrategySchema,
    worktreePath: z.string().trim().min(1).max(4_096).optional(),
    branch: z.string().trim().min(1).max(512).optional(),
    dependencyAgentIds: z.array(idSchema).max(100).default([]),
    completionCriteria: z.string().trim().min(1).max(20_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.permissionMode === "custom" && !value.customPermissions) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customPermissions"],
        message: "Custom permission mode requires explicit capabilities.",
      })
    }
    if (value.permissionMode !== "custom" && value.customPermissions) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customPermissions"],
        message: "Custom capabilities require custom permission mode.",
      })
    }
    if (value.worktreeStrategy === "existing" && !value.worktreePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["worktreePath"],
        message: "Existing worktree strategy requires a path.",
      })
    }
    if (value.worktreeStrategy === "attached-branch" && !value.branch) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["branch"],
        message: "Attached branch strategy requires a branch.",
      })
    }
    const provider = value.provider?.toLowerCase()
    if (
      provider &&
      ((value.harness === "codex" && !["codex", "openai"].includes(provider)) ||
        (value.harness === "claude-code" && !["claude", "anthropic"].includes(provider)))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provider"],
        message: `Provider ${value.provider} is not supported by ${value.harness}.`,
      })
    }
  })

export const createOrchestrationInputSchema = z
  .object({
    projectId: idSchema,
    task: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("create"), name: z.string().trim().min(1).max(200) }).strict(),
      z.object({ mode: z.literal("existing"), taskId: idSchema }).strict(),
    ]),
    initiatingChatId: idSchema,
    maxParallelAgents: z.number().int().min(1).max(64),
    maxDepth: z.number().int().min(1).max(32).default(8),
    coordinationEngine: coordinationEngineSchema.optional(),
    stopConditions: orchestrationStopConditionsSchema.default({}),
    agents: z.array(orchestrationAgentDefinitionSchema).min(1).max(256),
  })
  .strict()

export const addOrchestrationAgentInputSchema = z
  .object({
    taskId: idSchema,
    parentAgentId: idSchema.optional(),
    agent: orchestrationAgentDefinitionSchema,
  })
  .strict()

export const orchestrationUsageUpdateSchema = z
  .object({
    taskId: idSchema,
    agentId: idSchema,
    progressPercent: z.number().int().min(0).max(100).optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    costUsdMicros: z.number().int().nonnegative().optional(),
    // Public progress can report only estimates. Exact/provider-reported cost
    // enters through the trusted provider usage pipeline and usage_samples.
    costQuality: z.enum(["estimated", "unknown"]).optional(),
    status: z.enum(["active", "completed", "failed", "stopped"]).optional(),
    resultSummary: z.string().max(20_000).optional(),
    stopReason: z.string().max(2_000).optional(),
    blocked: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.costUsdMicros !== undefined && value.costQuality !== "estimated") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["costQuality"],
        message: "Public cost values must be explicitly labeled estimated.",
      })
    }
    if (value.costQuality === "estimated" && value.costUsdMicros === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["costUsdMicros"],
        message: "Estimated cost quality requires a cost value.",
      })
    }
  })

export type OrchestrationStatus = z.infer<typeof orchestrationStatusSchema>
export type OrchestrationAgentStatus = z.infer<typeof orchestrationAgentStatusSchema>
export type OrchestrationControlAction = z.infer<typeof orchestrationControlActionSchema>
export type OrchestrationStopConditions = z.infer<typeof orchestrationStopConditionsSchema>
export type OrchestrationAgentDefinition = z.infer<typeof orchestrationAgentDefinitionSchema>
export type CreateOrchestrationInput = z.infer<typeof createOrchestrationInputSchema>
export type AddOrchestrationAgentInput = z.infer<typeof addOrchestrationAgentInputSchema>
export type OrchestrationUsageUpdate = z.infer<typeof orchestrationUsageUpdateSchema>
export type OrchestrationFleetQuery = z.infer<typeof orchestrationFleetQuerySchema>
export type OrchestrationFleetState = z.infer<typeof orchestrationFleetStateSchema>
export type OrchestrationFleetSort = z.infer<typeof orchestrationFleetSortSchema>

export type OrchestrationAgentDto = {
  id: string
  taskId: string
  chatId: string | null
  runId: string | null
  parentAgentId: string | null
  replacedAgentId: string | null
  depth: number
  status: OrchestrationAgentStatus
  progressPercent: number
  definition: OrchestrationAgentDefinition
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsdMicros: number | null
  costQuality: z.infer<typeof orchestrationCostQualitySchema>
  resultSummary: string | null
  stopReason: string | null
  blockerCount: number
  queuedAt: number
  startedAt: number | null
  completedAt: number | null
}

export type OrchestrationTaskDto = {
  taskId: string
  projectId: string
  name: string
  initiatingChatId: string
  status: OrchestrationStatus
  engine: ResolvedCoordinationEngineSnapshot
  maxParallelAgents: number
  maxDepth: number
  stopConditions: OrchestrationStopConditions
  stopReason: string | null
  createdAt: number
  startedAt: number | null
  completedAt: number | null
}

export type OrchestrationAggregateDto = {
  total: number
  queued: number
  active: number
  completed: number
  failed: number
  blocked: number
  stopped: number
  progressPercent: number
  totalTokens: number
  exactCostUsdMicros: number
  providerReportedCostUsdMicros: number
  estimatedCostUsdMicros: number
  costQuality: z.infer<typeof orchestrationCostQualitySchema>
}

export type OrchestrationTaskOverviewDto = {
  orchestration: OrchestrationTaskDto
  aggregate: OrchestrationAggregateDto
  agents: OrchestrationAgentDto[]
}

export type OrchestrationLineageDto = {
  taskId: string
  nodes: Array<{
    agentId: string
    chatId: string | null
    parentAgentId: string | null
    replacedAgentId: string | null
    role: string
    name: string
    status: OrchestrationAgentStatus
  }>
  edges: Array<{
    fromAgentId: string
    toAgentId: string
    kind: "spawned" | "replacement"
  }>
}

export type OrchestrationFleetFreshness = "live" | "stale" | "terminal" | "unknown"

export type OrchestrationFleetAgentDto = {
  id: string
  status: string
  role: string
  name: string
  harness: string
  provider: string
  providerProvenance: "definition" | "harness" | "unknown"
  progressPercent: number
  blockerCount: number
  totalTokens: number
  costUsdMicros: number | null
  costQuality: string
  chat: { id: string | null; state: "live" | "archived" | "missing" | "unknown" }
  run: { id: string | null; status: string | null }
}

export type OrchestrationFleetItemDto = {
  taskId: string
  taskName: string
  taskArchived: boolean
  projectId: string
  projectName: string
  projectArchived: boolean
  status: string
  state: "active" | "terminal" | "unknown"
  freshness: OrchestrationFleetFreshness
  freshnessReason: string
  createdAt: number
  updatedAt: number
  completedAt: number | null
  maxParallelAgents: number
  maxDepth: number
  blockerCount: number
  providers: string[]
  harnesses: string[]
  aggregate: OrchestrationAggregateDto
  engine: {
    id: "workflow" | "codex-v2" | "codex-v1"
    label: string
    version: string
    provenance: "per-launch" | "project" | "global" | "product" | "legacy"
  }
  coordinationIdentity: { kind: "task"; label: string }
  initiatingChat: {
    id: string
    state: "live" | "archived" | "missing" | "unknown"
  }
  agents: OrchestrationFleetAgentDto[]
}

export type OrchestrationFleetFacetDto = { id: string; label: string; count: number }

export type OrchestrationFleetPageDto = {
  items: OrchestrationFleetItemDto[]
  total: number
  nextCursor: string | null
  observedAt: number
  facets: {
    projects: OrchestrationFleetFacetDto[]
    tasks: OrchestrationFleetFacetDto[]
    statuses: OrchestrationFleetFacetDto[]
    providers: OrchestrationFleetFacetDto[]
  }
}
