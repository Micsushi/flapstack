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
export type UsageBudgetScope = z.infer<typeof usageBudgetScopeSchema>
export type UsageBudgetThreshold = z.infer<typeof usageBudgetThresholdSchema>
export type UsageBudgetAction = z.infer<typeof usageBudgetActionSchema>
export type UsageBudgetReset = z.infer<typeof usageBudgetResetSchema>
export type UsageBudgetPolicyDto = z.infer<typeof usageBudgetPolicyDtoSchema>
