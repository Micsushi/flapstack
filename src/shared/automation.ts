import { z } from "zod"
import { AGENT_HARNESSES } from "./harness-types"
import { CUSTOM_PERMISSION_SCHEMA_VERSION } from "./permission-capabilities"

const idSchema = z.string().trim().min(1).max(200)
const pathSchema = z.string().trim().min(1).max(4_096)
const timestampSchema = z.number().int().nonnegative()

export const automationScopes = ["global", "project", "task", "chat"] as const
export const automationScopeTypeSchema = z.enum(automationScopes)

export const automationActionTypes = ["run-chat", "create-chat-run", "create-task-run"] as const
export const automationActionTypeSchema = z.enum(automationActionTypes)

export const automationTriggerTypes = ["manual", "schedule", "run-complete", "file-change"] as const
export const automationTriggerTypeSchema = z.enum(automationTriggerTypes)

export const DEFAULT_AUTOMATION_FILE_TRIGGER_EXCLUDES = [
  ".git/**",
  "**/.git/**",
  "node_modules/**",
  "**/node_modules/**",
  "dist/**",
  "**/dist/**",
  "build/**",
  "**/build/**",
  "out/**",
  "**/out/**",
  "target/**",
  "**/target/**",
  "coverage/**",
  "**/coverage/**",
  ".next/**",
  "**/.next/**",
  ".cache/**",
  "**/.cache/**",
  "*.log",
  "**/*.log",
] as const

export const automationStates = ["draft", "active", "paused", "archived"] as const
export const automationStateSchema = z.enum(automationStates)

export const automationApprovalStates = ["pending", "approved", "denied", "revoked"] as const
export const automationApprovalStateSchema = z.enum(automationApprovalStates)

export const automationOccurrenceStates = [
  "pending",
  "leased",
  "running",
  "completed",
  "cancelled",
  "skipped",
] as const
export const automationOccurrenceStateSchema = z.enum(automationOccurrenceStates)

export const automationRunStates = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "denied",
  "cancelled",
  "timed-out",
] as const
export const automationRunStateSchema = z.enum(automationRunStates)

export const automationRetryModes = ["none", "exponential"] as const
export const automationRetryModeSchema = z.enum(automationRetryModes)

export const automationInboxKinds = [
  "completed",
  "failed",
  "denied",
  "budget-exhausted",
  "cancelled",
] as const
export const automationInboxKindSchema = z.enum(automationInboxKinds)

export const automationScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }).strict(),
  z.object({ type: z.literal("project"), projectId: idSchema }).strict(),
  z.object({ type: z.literal("task"), taskId: idSchema }).strict(),
  z.object({ type: z.literal("chat"), chatId: idSchema }).strict(),
])

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run-chat") }).strict(),
  z
    .object({
      type: z.literal("create-chat-run"),
      chatName: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("create-task-run"),
      taskName: z.string().trim().min(1).max(256),
      chatName: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
])

const terminalRunStatuses = ["success", "failure", "cancelled"] as const

export const automationTriggerSchema = z.union([
  z.object({ type: z.literal("manual") }).strict(),
  z
    .object({
      type: z.literal("schedule"),
      cron: z.string().trim().min(1).max(200),
      timezone: z.string().trim().min(1).max(200),
      catchUp: z.enum(["none", "one"]).default("one"),
    })
    .strict(),
  z
    .object({
      type: z.literal("run-complete"),
      projectId: idSchema.optional(),
      taskId: idSchema.optional(),
      chatId: idSchema.optional(),
      statuses: z.array(z.enum(terminalRunStatuses)).min(1).max(3).default(["success", "failure"]),
    })
    .strict()
    .superRefine((value, context) => {
      const filters = [value.projectId, value.taskId, value.chatId].filter(Boolean)
      if (filters.length !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["projectId"],
          message: "Run-complete triggers require exactly one project, task, or chat filter.",
        })
      }
      if (new Set(value.statuses).size !== value.statuses.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["statuses"],
          message: "Run-complete statuses must be unique.",
        })
      }
    }),
  z
    .object({
      type: z.literal("file-change"),
      rootPath: pathSchema,
      includeGlobs: z.array(z.string().trim().min(1).max(1_024)).min(1).max(100).default(["**/*"]),
      excludeGlobs: z
        .array(z.string().trim().min(1).max(1_024))
        .max(100)
        .default([...DEFAULT_AUTOMATION_FILE_TRIGGER_EXCLUDES]),
      debounceMs: z.number().int().min(100).max(60_000).default(1_000),
    })
    .strict(),
])

const customPermissionCapabilitiesSchema = z
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

export const automationRunConfigSchema = z
  .object({
    prompt: z.string().trim().min(1).max(100_000),
    harness: z.enum(AGENT_HARNESSES),
    model: z.string().trim().min(1).max(200).optional(),
    permissionMode: z.enum([
      "read-only",
      "ask-before-edits",
      "auto-edit-project-only",
      "full-access",
      "custom",
    ]),
    customPermissions: customPermissionCapabilitiesSchema.optional(),
    worktreeStrategy: z.enum(["inherit", "task-primary", "existing", "none"]).default("inherit"),
    worktreePath: pathSchema.optional(),
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
    if (value.worktreeStrategy !== "existing" && value.worktreePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["worktreePath"],
        message: "A worktree path requires the existing worktree strategy.",
      })
    }
  })

export const DEFAULT_AUTOMATION_RETRY_POLICY = {
  mode: "none",
  maxAttempts: 1,
  initialDelayMs: 0,
  maxDelayMs: 0,
  deadlineMs: 0,
} as const

export const automationRetryPolicySchema = z
  .object({
    mode: automationRetryModeSchema.default(DEFAULT_AUTOMATION_RETRY_POLICY.mode),
    maxAttempts: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(DEFAULT_AUTOMATION_RETRY_POLICY.maxAttempts),
    initialDelayMs: z.number().int().min(0).max(86_400_000).default(0),
    maxDelayMs: z.number().int().min(0).max(86_400_000).default(0),
    deadlineMs: z
      .number()
      .int()
      .min(0)
      .max(31 * 86_400_000)
      .default(0),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.mode === "none" &&
      (value.maxAttempts !== 1 ||
        value.initialDelayMs !== 0 ||
        value.maxDelayMs !== 0 ||
        value.deadlineMs !== 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mode"],
        message: "No-retry policy requires one attempt and zero retry timing values.",
      })
    }
    if (
      value.mode === "exponential" &&
      (value.maxAttempts < 2 ||
        value.initialDelayMs < 100 ||
        value.maxDelayMs < value.initialDelayMs ||
        value.deadlineMs < value.initialDelayMs)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxAttempts"],
        message: "Exponential retry requires bounded attempts, delays, and a deadline.",
      })
    }
  })

export const DEFAULT_AUTOMATION_BUDGET = {
  maxDurationMs: 60 * 60 * 1_000,
  maxTotalTokens: null,
  maxCostUsdMicros: null,
  maxConcurrentRuns: 1,
} as const

export const automationBudgetSchema = z
  .object({
    maxDurationMs: z
      .number()
      .int()
      .min(1_000)
      .max(31 * 86_400_000)
      .nullable()
      .default(DEFAULT_AUTOMATION_BUDGET.maxDurationMs),
    maxTotalTokens: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .default(null),
    maxCostUsdMicros: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .default(null),
    maxConcurrentRuns: z.literal(1).default(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.maxCostUsdMicros !== null &&
      value.maxDurationMs === null &&
      value.maxTotalTokens === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCostUsdMicros"],
        message: "Cost budgets require a token or wall-clock fallback.",
      })
    }
  })

export const automationDraftSchema = z
  .object({
    name: z.string().trim().min(1).max(256),
    description: z.string().trim().max(20_000).nullable().optional(),
    scope: automationScopeSchema,
    action: automationActionSchema,
    trigger: automationTriggerSchema,
    run: automationRunConfigSchema,
    retry: automationRetryPolicySchema.default(DEFAULT_AUTOMATION_RETRY_POLICY),
    budget: automationBudgetSchema.default(DEFAULT_AUTOMATION_BUDGET),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action.type === "run-chat" && value.scope.type !== "chat") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["action"],
        message: "Run-chat actions require chat scope.",
      })
    }
    if (value.action.type === "create-chat-run" && value.scope.type === "chat") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["action"],
        message: "Create-chat actions require global, project, or task scope.",
      })
    }
    if (value.action.type === "create-task-run" && value.scope.type !== "project") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["action"],
        message: "Create-task actions require project scope.",
      })
    }
    if (value.trigger.type === "file-change" && value.scope.type === "global") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trigger"],
        message: "File-change triggers require project, task, or chat scope.",
      })
    }
    if (
      value.run.worktreeStrategy === "task-primary" &&
      value.scope.type !== "task" &&
      value.action.type !== "create-task-run"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["run", "worktreeStrategy"],
        message: "Task-primary worktrees require task scope or a create-task action.",
      })
    }
  })

export const automationOccurrenceDtoSchema = z
  .object({
    id: idSchema,
    automationId: idSchema,
    triggerId: idSchema,
    dedupeKey: z.string().trim().min(1).max(512),
    state: automationOccurrenceStateSchema,
    scheduledFor: timestampSchema,
    payload: z.record(z.string(), z.unknown()).default({}),
    createdAt: timestampSchema,
    terminalAt: timestampSchema.nullable(),
  })
  .strict()

export const automationExecutionDtoSchema = z
  .object({
    id: idSchema,
    occurrenceId: idSchema,
    attempt: z.number().int().min(1).max(10),
    state: automationRunStateSchema,
    runId: idSchema.nullable(),
    authoritySnapshot: z.record(z.string(), z.unknown()),
    budgetSnapshot: automationBudgetSchema,
    resultSummary: z.string().max(20_000).nullable(),
    stopReason: z.string().max(2_000).nullable(),
    startedAt: timestampSchema.nullable(),
    completedAt: timestampSchema.nullable(),
  })
  .strict()

export const automationLeaseDtoSchema = z
  .object({
    occurrenceId: idSchema,
    owner: idSchema,
    token: idSchema,
    acquiredAt: timestampSchema,
    expiresAt: timestampSchema,
  })
  .strict()
  .refine((value) => value.expiresAt > value.acquiredAt, {
    path: ["expiresAt"],
    message: "Lease expiry must be after acquisition.",
  })

export type AutomationScope = z.infer<typeof automationScopeSchema>
export type AutomationAction = z.infer<typeof automationActionSchema>
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>
export type AutomationRunConfig = z.infer<typeof automationRunConfigSchema>
export type AutomationRetryPolicy = z.infer<typeof automationRetryPolicySchema>
export type AutomationBudget = z.infer<typeof automationBudgetSchema>
export type AutomationDraft = z.infer<typeof automationDraftSchema>
export type AutomationOccurrenceDto = z.infer<typeof automationOccurrenceDtoSchema>
export type AutomationExecutionDto = z.infer<typeof automationExecutionDtoSchema>
export type AutomationLeaseDto = z.infer<typeof automationLeaseDtoSchema>
