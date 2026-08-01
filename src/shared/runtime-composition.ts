import { z } from "zod"
import { AGENT_HARNESSES } from "./harness-types"
import { RESOLVED_AGENT_RUNTIMES } from "./agent-runtime"
import { customPermissionCapabilitiesSchema } from "./permission-capabilities"

const identifierSchema = z.string().trim().min(1).max(512)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const permissionModeSchema = z.enum([
  "read-only",
  "ask-before-edits",
  "auto-edit-project-only",
  "full-access",
  "custom",
])

export const runtimeModeSchema = z.enum(["native", "enhanced", "translated", "flapstack-native"])

export const runtimeCapabilitySnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    fingerprint: sha256Schema,
    capabilities: z.record(z.enum(["available", "unavailable", "unknown", "lossy"])),
  })
  .strict()

export const executionTargetSchema = z
  .object({
    schemaVersion: z.literal(1),
    harness: z.enum(AGENT_HARNESSES),
    runtime: z.enum(RESOLVED_AGENT_RUNTIMES),
    runtimeMode: runtimeModeSchema,
    adapterChain: z
      .array(
        z
          .object({
            id: identifierSchema,
            version: identifierSchema,
          })
          .strict(),
      )
      .max(8),
    provider: identifierSchema,
    model: z.string().trim().min(1).max(256).nullable(),
    accountId: identifierSchema.nullable(),
    agentProfile: z
      .object({
        id: identifierSchema,
        version: z.number().int().min(1),
        snapshotId: identifierSchema,
      })
      .strict()
      .nullable(),
    permission: z
      .object({
        mode: permissionModeSchema,
        customPermissions: customPermissionCapabilitiesSchema.nullable(),
      })
      .strict(),
    workspace: z
      .object({
        projectId: identifierSchema.nullable(),
        rootPath: z.string().min(1).max(32_768).nullable(),
        worktreePath: z.string().min(1).max(32_768).nullable(),
        branch: z.string().min(1).max(512).nullable(),
      })
      .strict(),
    capabilities: runtimeCapabilitySnapshotSchema,
    losses: z
      .array(
        z
          .object({
            code: identifierSchema,
            summary: z.string().trim().min(1).max(1_024),
          })
          .strict(),
      )
      .max(64),
  })
  .strict()
  .superRefine((target, context) => {
    const parityRuntime =
      target.harness === "codex"
        ? "codex"
        : target.harness === "claude-code"
          ? "claude-code"
          : "flapstack-native"
    if (
      (target.runtimeMode === "native" || target.runtimeMode === "enhanced") &&
      target.runtime !== parityRuntime
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtime"],
        message: `${target.runtimeMode} execution must use the harness parity Runtime.`,
      })
    }
    if (target.runtimeMode === "flapstack-native" && target.runtime !== "flapstack-native") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["runtime"],
        message: "Flapstack Native mode must use the Flapstack Native Runtime.",
      })
    }
    if (target.runtimeMode === "translated" && target.adapterChain.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adapterChain"],
        message: "Translated execution requires an explicit adapter chain.",
      })
    }
    if (target.runtimeMode !== "translated" && target.adapterChain.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adapterChain"],
        message: "Only translated execution may declare an adapter chain.",
      })
    }
  })

export const visibleContextOmissionClassSchema = z.enum([
  "private-reasoning",
  "encrypted-reasoning",
  "hidden-tool-state",
  "secret-or-credential",
  "unselected-message",
  "unselected-file",
  "unselected-attachment",
  "unsupported-content",
])

export const visibleContextManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceChatId: identifierSchema,
    sourceRunId: identifierSchema.nullable(),
    selected: z.array(
      z
        .object({
          sourceSubChatId: identifierSchema,
          messageId: identifierSchema,
          role: z.string().trim().min(1).max(80),
          partIndexes: z.array(z.number().int().min(0)).max(1_000),
          contentDigest: sha256Schema,
          byteLength: z.number().int().min(0).max(1_000_000),
        })
        .strict(),
    ),
    selectedFileRefs: z.array(identifierSchema).max(1_000),
    selectedArtifactRefs: z.array(identifierSchema).max(1_000),
    omissions: z.array(
      z
        .object({
          class: visibleContextOmissionClassSchema,
          count: z.number().int().min(1),
        })
        .strict(),
    ),
    contentDigest: sha256Schema,
    digest: sha256Schema,
  })
  .strict()

export const delegationAuthorityCeilingSchema = z
  .object({
    schemaVersion: z.literal(1),
    permissionMode: permissionModeSchema,
    customPermissions: customPermissionCapabilitiesSchema.nullable(),
    allowedToolTiers: z.array(z.enum(["read", "project-write", "shell", "git", "network"])).max(5),
    network: z.boolean(),
    maxDescendantDepth: z.number().int().min(0).max(64),
    tokenBudget: z.number().int().positive().nullable(),
    costBudgetMicros: z.number().int().nonnegative().nullable(),
    providerAccountId: identifierSchema.nullable(),
    allowedProfileSnapshotIds: z.array(identifierSchema).max(100),
    workspaceRoot: z.string().min(1).max(32_768).nullable(),
    worktreePath: z.string().min(1).max(32_768).nullable(),
    worktreeLeaseId: identifierSchema.nullable(),
  })
  .strict()

export const runtimeCompositionWorktreeLeaseSchema = z
  .object({
    leaseId: identifierSchema.nullable(),
    path: z.string().min(1).max(32_768).nullable(),
    branch: z.string().min(1).max(512).nullable(),
    fingerprint: sha256Schema,
  })
  .strict()

export const runtimeCompositionPreviewSchema = z
  .object({
    schemaVersion: z.literal(1),
    mode: z.enum(["continue", "delegate"]),
    objectiveDigest: sha256Schema,
    requiredCapabilities: z.array(identifierSchema).max(100),
    outputSchemaDigest: sha256Schema.nullable(),
    targetSnapshot: executionTargetSchema,
    visibleContextManifest: visibleContextManifestSchema,
    authorityCeiling: delegationAuthorityCeilingSchema,
    worktreeLease: runtimeCompositionWorktreeLeaseSchema,
    availability: z
      .object({
        state: z.enum(["available", "blocked", "repair-required"]),
        reason: z.string().trim().min(1).max(2_000).nullable(),
        repair: z.string().trim().min(1).max(2_000).nullable(),
      })
      .strict(),
    digest: sha256Schema,
  })
  .strict()

export const compositionAttemptReferenceSchema = z
  .object({
    attemptId: identifierSchema,
    attemptNumber: z.number().int().min(1),
    priorAttemptId: identifierSchema.nullable(),
  })
  .strict()

export const compositionUsageReferenceSchema = z
  .object({
    usageRecordId: identifierSchema,
    runId: identifierSchema,
    provider: identifierSchema,
    accountId: identifierSchema.nullable(),
    model: z.string().trim().min(1).max(256).nullable(),
    runtime: z.enum(RESOLVED_AGENT_RUNTIMES),
  })
  .strict()

export const crossProviderTaskEnvelopeSchema = z
  .object({
    version: z.literal(1),
    idempotencyKey: identifierSchema,
    previewDigest: sha256Schema,
    mode: z.enum(["continue", "delegate"]),
    initiatorChatId: identifierSchema,
    parentChatId: identifierSchema,
    ancestorChatIds: z.array(identifierSchema).max(100),
    attempt: compositionAttemptReferenceSchema,
    targetSnapshot: executionTargetSchema,
    objective: z.string().trim().min(1).max(100_000),
    visibleContextManifest: visibleContextManifestSchema,
    fileAndArtifactRefs: z.array(identifierSchema).max(1_000),
    requiredCapabilities: z.array(identifierSchema).max(100),
    outputSchema: z.record(z.unknown()).nullable(),
    permissionCeiling: delegationAuthorityCeilingSchema,
    worktreeLeaseId: identifierSchema.nullable(),
    deadline: z.string().datetime().nullable(),
  })
  .strict()

export const crossProviderResultEnvelopeSchema = z
  .object({
    version: z.literal(1),
    taskEnvelopeVersion: z.literal(1),
    childChatId: identifierSchema,
    runId: identifierSchema,
    attempt: compositionAttemptReferenceSchema,
    targetSnapshot: executionTargetSchema,
    status: z.enum(["success", "failure", "cancelled", "uncertain"]),
    structuredOutput: z.unknown().nullable(),
    visibleSummary: z.string().max(100_000),
    artifactAndChangeRefs: z.array(identifierSchema).max(1_000),
    checkpointRefs: z.array(identifierSchema).max(1_000),
    usageRefs: z.array(compositionUsageReferenceSchema).max(1_000),
    activityRefs: z
      .array(
        z
          .object({
            runId: identifierSchema,
            afterSequence: z.number().int().min(0),
          })
          .strict(),
      )
      .max(1_000),
    partial: z.boolean(),
    cancellationRequestedAt: z.string().datetime().nullable(),
    limitations: z.array(z.string().max(1_024)).max(100),
    warnings: z.array(z.string().max(1_024)).max(100),
    terminalEvidence: z
      .object({
        reconciledAt: z.string().datetime(),
        providerTerminalState: z.string().trim().min(1).max(200),
        activityHighWater: z.number().int().min(0),
      })
      .strict(),
  })
  .strict()

export type ExecutionTarget = z.infer<typeof executionTargetSchema>
export type VisibleContextManifest = z.infer<typeof visibleContextManifestSchema>
export type DelegationAuthorityCeiling = z.infer<typeof delegationAuthorityCeilingSchema>
export type RuntimeCompositionPreview = z.infer<typeof runtimeCompositionPreviewSchema>
export type CrossProviderTaskEnvelope = z.infer<typeof crossProviderTaskEnvelopeSchema>
export type CrossProviderResultEnvelope = z.infer<typeof crossProviderResultEnvelopeSchema>
