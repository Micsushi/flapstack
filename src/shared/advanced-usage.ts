import { z } from "zod"
import { AGENT_HARNESSES } from "./harness-types"

const idSchema = z.string().trim().min(1).max(200)
const nullableIdSchema = idSchema.nullable()
const nullableNameSchema = z.string().trim().min(1).max(256).nullable()
const timestampSchema = z.number().int().nonnegative()

export const usageAttributionStates = ["attributed", "unknown"] as const
export const usageAttributionStateSchema = z.enum(usageAttributionStates)

export const usageSourceClasses = [
  "provider-account-total",
  "flapstack-run",
  "external-provider",
  "unknown",
] as const
export const usageSourceClassSchema = z.enum(usageSourceClasses)

export const usageDedupeStrategies = ["exact-fact", "overlap-group", "unknown"] as const
export const usageDedupeStrategySchema = z.enum(usageDedupeStrategies)

export const usageAttributionSnapshotSchema = z
  .object({
    state: usageAttributionStateSchema,
    harness: z.enum(AGENT_HARNESSES).nullable(),
    projectId: nullableIdSchema,
    projectName: nullableNameSchema,
    taskId: nullableIdSchema,
    taskName: nullableNameSchema,
    chatId: nullableIdSchema,
    chatName: nullableNameSchema,
    automationId: nullableIdSchema,
    automationName: nullableNameSchema,
    orchestrationId: nullableIdSchema,
    orchestrationName: nullableNameSchema,
    runId: nullableIdSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const hasAttribution = Object.entries(value).some(
      ([key, field]) => key !== "state" && field !== null,
    )
    if (value.state === "unknown" && hasAttribution) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "Unknown attribution cannot contain inferred scope values.",
      })
    }
    if (value.state === "attributed" && !hasAttribution) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["state"],
        message: "Attributed usage requires at least one snapshotted scope value.",
      })
    }
  })

export const usageFactClassificationSchema = z
  .object({
    sourceClass: usageSourceClassSchema,
    dedupeStrategy: usageDedupeStrategySchema,
    dedupeGroupKey: z.string().trim().min(1).max(512).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dedupeStrategy === "overlap-group" && value.dedupeGroupKey === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dedupeGroupKey"],
        message: "Overlap-group facts require a stable dedupe group key.",
      })
    }
    if (value.dedupeStrategy !== "overlap-group" && value.dedupeGroupKey !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dedupeGroupKey"],
        message: "Dedupe group keys are reserved for overlap-group facts.",
      })
    }
  })

export const usageRollupScopeTypes = [
  "global",
  "provider-account",
  "project",
  "task",
  "chat",
  "automation",
  "orchestration",
  "run",
] as const

export const usageRollupScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }).strict(),
  z
    .object({
      type: z.literal("provider-account"),
      providerId: idSchema,
      accountTag: z.string().max(256),
    })
    .strict(),
  z.object({ type: z.literal("project"), id: idSchema }).strict(),
  z.object({ type: z.literal("task"), id: idSchema }).strict(),
  z.object({ type: z.literal("chat"), id: idSchema }).strict(),
  z.object({ type: z.literal("automation"), id: idSchema }).strict(),
  z.object({ type: z.literal("orchestration"), id: idSchema }).strict(),
  z.object({ type: z.literal("run"), id: idSchema }).strict(),
])

export const usageRollupGroupDimensions = [
  "none",
  "provider-account",
  "project",
  "task",
  "chat",
  "automation",
  "orchestration",
  "run",
  "harness",
  "model",
  "source",
  "source-class",
  "quality",
] as const
export const usageRollupGroupDimensionSchema = z.enum(usageRollupGroupDimensions)

export const usageRollupBucketUnits = ["none", "hour", "day", "week", "month"] as const
export const usageRollupBucketUnitSchema = z.enum(usageRollupBucketUnits)

export const usageRollupQualities = ["exact", "provider-reported", "estimated", "unknown"] as const
export const usageRollupQualitySchema = z.enum(usageRollupQualities)

export const usageRollupQuerySchema = z
  .object({
    scope: usageRollupScopeSchema.default({ type: "global" }),
    providerIds: z.array(idSchema).max(50).optional(),
    accountTags: z.array(z.string().max(256)).max(50).optional(),
    harnesses: z.array(z.enum(AGENT_HARNESSES)).max(50).optional(),
    models: z.array(idSchema).max(100).optional(),
    sources: z.array(idSchema).max(50).optional(),
    sourceClasses: z.array(usageSourceClassSchema).max(4).optional(),
    qualities: z.array(usageRollupQualitySchema).max(4).optional(),
    fromMs: timestampSchema.optional(),
    toMs: timestampSchema.optional(),
    timezone: z.string().trim().min(1).max(100).default("UTC"),
    bucket: usageRollupBucketUnitSchema.default("none"),
    groupBy: usageRollupGroupDimensionSchema.default("none"),
    limit: z.number().int().min(1).max(500).default(100),
    cursor: z.string().min(1).max(4096).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.fromMs !== undefined && value.toMs !== undefined && value.toMs <= value.fromMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toMs"],
        message: "Rollup end time must be later than the start time.",
      })
    }
    try {
      new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(0)
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["timezone"],
        message: "Rollup timezone must be a valid IANA timezone.",
      })
    }
  })

export const usageInsightMetrics = ["cost-usd-micros", "total-tokens", "request-count"] as const
export const usageInsightMetricSchema = z.enum(usageInsightMetrics)

export const usageInsightUnits = ["usd-micros", "tokens", "requests"] as const
export const usageInsightUnitSchema = z.enum(usageInsightUnits)

export const usageInsightResetWindowSchema = z
  .object({
    startMs: timestampSchema,
    endMs: timestampSchema,
    source: z.enum(["provider", "explicit"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endMs <= value.startMs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endMs"],
        message: "Insight reset end must be later than its start.",
      })
    }
  })

export const usageInsightCapacitySchema = z
  .object({
    value: z.number().positive().max(Number.MAX_SAFE_INTEGER),
    unit: usageInsightUnitSchema,
    source: z.enum(["provider-quota", "explicit"]),
    resetWindow: usageInsightResetWindowSchema.nullable().optional(),
  })
  .strict()

export const usageInsightQuerySchema = z
  .object({
    rollup: usageRollupQuerySchema,
    metric: usageInsightMetricSchema.default("cost-usd-micros"),
    nowMs: timestampSchema.optional(),
    lookbackMs: z
      .number()
      .int()
      .positive()
      .max(366 * 24 * 60 * 60 * 1_000)
      .default(30 * 24 * 60 * 60 * 1_000),
    forecastHorizonMs: z
      .number()
      .int()
      .positive()
      .max(366 * 24 * 60 * 60 * 1_000)
      .default(7 * 24 * 60 * 60 * 1_000),
    capacity: usageInsightCapacitySchema.nullable().optional(),
    coverage: z
      .object({
        minSamples: z.number().int().min(2).max(100).default(4),
        minBuckets: z.number().int().min(2).max(100).default(3),
        minRatio: z.number().min(0.05).max(1).default(0.5),
      })
      .strict()
      .default({}),
    anomaly: z
      .object({
        minBaselineBuckets: z.number().int().min(3).max(100).default(3),
        spikeMultiplier: z.number().min(1.1).max(100).default(3),
      })
      .strict()
      .default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.rollup.bucket !== "none" || value.rollup.groupBy !== "none") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rollup"],
        message: "Insight queries own bucketing and do not accept grouped rollups.",
      })
    }
    if (value.rollup.cursor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rollup", "cursor"],
        message: "Insight queries do not accept rollup cursors.",
      })
    }
    if (value.capacity && value.capacity.unit !== metricUnit(value.metric)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capacity", "unit"],
        message: "Insight capacity unit must match the selected metric.",
      })
    }
  })

function metricUnit(metric: z.infer<typeof usageInsightMetricSchema>) {
  if (metric === "cost-usd-micros") return "usd-micros" as const
  if (metric === "total-tokens") return "tokens" as const
  return "requests" as const
}

export const usageBudgetScopeTypes = [
  "global",
  "provider-account",
  "project",
  "task",
  "automation",
  "orchestration",
] as const
export const usageBudgetScopeTypeSchema = z.enum(usageBudgetScopeTypes)

export const usageBudgetScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }).strict(),
  z
    .object({
      type: z.literal("provider-account"),
      providerId: idSchema,
      accountTag: z.string().trim().min(1).max(256).nullable(),
    })
    .strict(),
  z.object({ type: z.literal("project"), projectId: idSchema }).strict(),
  z.object({ type: z.literal("task"), taskId: idSchema }).strict(),
  z.object({ type: z.literal("automation"), automationId: idSchema }).strict(),
  z.object({ type: z.literal("orchestration"), orchestrationId: idSchema }).strict(),
])

export const usageBudgetThresholdTypes = [
  "cost-usd-micros",
  "total-tokens",
  "request-count",
  "quota-percent-micros",
] as const
export const usageBudgetThresholdTypeSchema = z.enum(usageBudgetThresholdTypes)

const positiveThresholdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const usageBudgetThresholdSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cost-usd-micros"), value: positiveThresholdSchema }).strict(),
  z.object({ type: z.literal("total-tokens"), value: positiveThresholdSchema }).strict(),
  z.object({ type: z.literal("request-count"), value: positiveThresholdSchema }).strict(),
  z
    .object({
      type: z.literal("quota-percent-micros"),
      value: z.number().int().min(1).max(100_000_000),
    })
    .strict(),
])

export const usageBudgetActions = ["soft-alert", "hard-stop"] as const
export const usageBudgetActionSchema = z.enum(usageBudgetActions)

export const usageBudgetResetTypes = [
  "none",
  "daily",
  "weekly",
  "monthly",
  "provider-cycle",
] as const
export const usageBudgetResetTypeSchema = z.enum(usageBudgetResetTypes)

export const usageBudgetResetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }).strict(),
  z.object({ type: z.literal("daily"), timezone: idSchema }).strict(),
  z.object({ type: z.literal("weekly"), timezone: idSchema }).strict(),
  z.object({ type: z.literal("monthly"), timezone: idSchema }).strict(),
  z.object({ type: z.literal("provider-cycle") }).strict(),
])

export const usageBudgetPolicyDtoSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(256),
    enabled: z.boolean(),
    scope: usageBudgetScopeSchema,
    threshold: usageBudgetThresholdSchema,
    action: usageBudgetActionSchema,
    reset: usageBudgetResetSchema,
    version: z.number().int().min(1),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.scope.type === "provider-account" && value.action === "hard-stop") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["action"],
        message: "Provider-account usage is external and supports soft alerts only.",
      })
    }
    if (
      value.threshold.type === "quota-percent-micros" &&
      value.scope.type !== "provider-account"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["threshold"],
        message: "Quota-percent thresholds require provider-account scope.",
      })
    }
    if (value.reset.type === "provider-cycle" && value.scope.type !== "provider-account") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reset"],
        message: "Provider-cycle resets require provider-account scope.",
      })
    }
  })

export type UsageAttributionSnapshot = z.infer<typeof usageAttributionSnapshotSchema>
export type UsageFactClassification = z.infer<typeof usageFactClassificationSchema>
export type UsageSourceClass = z.infer<typeof usageSourceClassSchema>
export type UsageRollupScope = z.infer<typeof usageRollupScopeSchema>
export type UsageRollupGroupDimension = z.infer<typeof usageRollupGroupDimensionSchema>
export type UsageRollupBucketUnit = z.infer<typeof usageRollupBucketUnitSchema>
export type UsageRollupQuality = z.infer<typeof usageRollupQualitySchema>
export type UsageRollupQuery = z.infer<typeof usageRollupQuerySchema>
export type UsageRollupQueryInput = z.input<typeof usageRollupQuerySchema>
export type UsageInsightMetric = z.infer<typeof usageInsightMetricSchema>
export type UsageInsightUnit = z.infer<typeof usageInsightUnitSchema>
export type UsageInsightResetWindow = z.infer<typeof usageInsightResetWindowSchema>
export type UsageInsightCapacity = z.infer<typeof usageInsightCapacitySchema>
export type UsageInsightQuery = z.infer<typeof usageInsightQuerySchema>
export type UsageInsightQueryInput = z.input<typeof usageInsightQuerySchema>
export type UsageBudgetScope = z.infer<typeof usageBudgetScopeSchema>
export type UsageBudgetThreshold = z.infer<typeof usageBudgetThresholdSchema>
export type UsageBudgetAction = z.infer<typeof usageBudgetActionSchema>
export type UsageBudgetReset = z.infer<typeof usageBudgetResetSchema>
export type UsageBudgetPolicyDto = z.infer<typeof usageBudgetPolicyDtoSchema>
