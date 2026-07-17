import { z } from "zod"
import { agentRuntimePreferenceSchema } from "./agent-runtime"
import {
  customPermissionCapabilitiesSchema,
  refineCustomPermissionMode,
} from "./permission-capabilities"

const idSchema = z.string().trim().min(1).max(200)
const boundedText = (max: number) => z.string().trim().max(max)

export const AGENT_PROFILE_SCHEMA_VERSION = 1 as const
export const AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES = [
  "model-blocked",
  "runtime-policy-blocked",
  "runtime-incompatible",
  "runtime-unavailable",
  "adapter-disabled",
  "evaluation-required",
  "evaluation-failed",
] as const
export const AGENT_PROFILE_BUNDLE_VERSION = 1 as const

export const agentProfileScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("built-in"), projectId: z.null() }).strict(),
  z.object({ type: z.literal("user"), projectId: z.null() }).strict(),
  z.object({ type: z.literal("project"), projectId: idSchema }).strict(),
])

export const agentProfileSourceSchema = z.enum(["built-in", "user", "imported"])
export const agentProfileEvaluationStateSchema = z.enum([
  "untested",
  "tested-local",
  "supported",
  "failed",
])
export const agentProfilePermissionModeSchema = z.enum([
  "read-only",
  "ask-before-edits",
  "auto-edit-project-only",
  "full-access",
  "custom",
])
export const agentProfileWorktreeStrategySchema = z.enum([
  "inherit",
  "task-primary",
  "existing",
  "attached-branch",
  "none",
])
export const agentCapabilityProfileSchema = z
  .object({
    schemaVersion: z.literal(AGENT_PROFILE_SCHEMA_VERSION),
    role: z.string().trim().min(1).max(120),
    instructions: z.string().trim().min(1).max(100_000),
    harness: z.enum(["codex", "claude-code"]),
    runtimePreference: agentRuntimePreferenceSchema,
    modelPreference: z.string().trim().min(1).max(200).nullable(),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).nullable(),
    tools: z.array(idSchema).max(128),
    skills: z.array(idSchema).max(128),
    permissionMode: agentProfilePermissionModeSchema,
    customPermissions: customPermissionCapabilitiesSchema.nullable(),
    memoryPolicy: z.object({ mode: z.literal("none") }).strict(),
    worktreeStrategy: agentProfileWorktreeStrategySchema,
    allowedDescendantProfileIds: z.array(idSchema).max(64),
    maxDescendants: z.number().int().min(0).max(64),
  })
  .strict()
  .superRefine((value, context) => {
    refineCustomPermissionMode(value, context)
    for (const field of ["tools", "skills", "allowedDescendantProfileIds"] as const) {
      if (new Set(value[field]).size !== value[field].length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} entries must be unique.`,
        })
      }
    }
  })

export const agentPresentationStyleSchema = z
  .object({
    schemaVersion: z.literal(AGENT_PROFILE_SCHEMA_VERSION),
    tone: z.enum(["neutral", "direct", "warm", "formal", "playful"]),
    verbosity: z.enum(["terse", "balanced", "detailed"]),
    formatting: z.enum(["plain", "structured", "markdown"]),
    responseStructure: boundedText(2_000),
    characterLabel: boundedText(120).nullable(),
    voiceLabel: boundedText(120).nullable(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
  })
  .strict()

export const agentProfileVersionRefSchema = z
  .object({ profileId: idSchema, version: z.number().int().min(1) })
  .strict()

export const agentProfileBaseRefSchema = agentProfileVersionRefSchema.nullable()

export const agentProfileVersionInputSchema = z
  .object({
    base: agentProfileBaseRefSchema,
    capability: agentCapabilityProfileSchema,
    presentation: agentPresentationStyleSchema,
    inheritCapabilityFields: z
      .array(
        z.enum([
          "role",
          "instructions",
          "harness",
          "runtimePreference",
          "modelPreference",
          "reasoningEffort",
          "tools",
          "skills",
          "permissionMode",
          "customPermissions",
          "memoryPolicy",
          "worktreeStrategy",
          "allowedDescendantProfileIds",
          "maxDescendants",
        ]),
      )
      .default([]),
    inheritPresentationFields: z
      .array(
        z.enum([
          "tone",
          "verbosity",
          "formatting",
          "responseStructure",
          "characterLabel",
          "voiceLabel",
          "color",
        ]),
      )
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !value.base &&
      (value.inheritCapabilityFields.length || value.inheritPresentationFields.length)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["base"],
        message: "Inherited fields require one exact base profile version.",
      })
    }
  })

export const agentProfileIdentityInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: boundedText(2_000),
    category: z.string().trim().min(1).max(80),
    scope: agentProfileScopeSchema,
  })
  .strict()

export const agentProfileCreateInputSchema = agentProfileIdentityInputSchema
  .extend({ definition: agentProfileVersionInputSchema })
  .strict()

export const agentProfileUpdateInputSchema = z
  .object({
    profileId: idSchema,
    expectedVersion: z.number().int().min(1),
    identity: agentProfileIdentityInputSchema.omit({ scope: true }).partial().optional(),
    definition: agentProfileVersionInputSchema,
  })
  .strict()

export const agentProfileListInputSchema = z
  .object({
    projectId: idSchema.optional(),
    query: z.string().trim().max(200).optional(),
    includeArchived: z.boolean().default(false),
    source: agentProfileSourceSchema.optional(),
  })
  .strict()

export const agentProfileArchiveInputSchema = z
  .object({ profileId: idSchema, expectedVersion: z.number().int().min(1) })
  .strict()

export const agentProfileDuplicateInputSchema = z
  .object({
    profile: agentProfileVersionRefSchema,
    name: z.string().trim().min(1).max(160),
    scope: z.discriminatedUnion("type", [
      z.object({ type: z.literal("user"), projectId: z.null() }).strict(),
      z.object({ type: z.literal("project"), projectId: idSchema }).strict(),
    ]),
  })
  .strict()

export const agentProfileBoundedOverrideSchema = z
  .object({
    instructionAppend: boundedText(20_000).nullable(),
    modelPreference: z.string().trim().min(1).max(200).nullable(),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).nullable(),
    presentation: agentPresentationStyleSchema.partial().nullable(),
  })
  .strict()

export const agentProfileLaunchPolicySchema = z
  .object({
    permissionMode: agentProfilePermissionModeSchema,
    customPermissions: customPermissionCapabilitiesSchema.nullable(),
    allowedTools: z.array(idSchema).max(128).nullable(),
    allowedSkills: z.array(idSchema).max(128).nullable(),
    allowedModels: z.array(z.string().trim().min(1).max(200)).max(128).nullable(),
    allowedRuntimes: z.array(agentRuntimePreferenceSchema).max(6).nullable(),
    maxDescendants: z.number().int().min(0).max(64),
  })
  .strict()

export const agentProfileResolveInputSchema = z
  .object({
    profile: agentProfileVersionRefSchema,
    overrides: agentProfileBoundedOverrideSchema.nullable().default(null),
    policy: agentProfileLaunchPolicySchema,
  })
  .strict()

export const agentProfileWorkflowBindingSchema = z
  .object({
    schemaVersion: z.literal(AGENT_PROFILE_SCHEMA_VERSION),
    workflowRunId: idSchema,
    stepId: idSchema,
    profile: agentProfileVersionRefSchema,
    workflowRole: z.string().trim().min(1).max(120),
    inputSchema: z.record(z.string(), z.unknown()).nullable(),
    outputSchema: z.record(z.string(), z.unknown()).nullable(),
    overrides: agentProfileBoundedOverrideSchema.nullable(),
  })
  .strict()

export const agentProfileWorkflowTemplateReferenceSchema = z
  .object({
    kind: z.literal("flapstack-agent-profile-workflow-binding"),
    schemaVersion: z.literal(AGENT_PROFILE_SCHEMA_VERSION),
    profile: agentProfileVersionRefSchema,
    workflowRole: z.string().trim().min(1).max(120),
    inputSchema: z.record(z.string(), z.unknown()).nullable(),
    outputSchema: z.record(z.string(), z.unknown()).nullable(),
    overrides: agentProfileBoundedOverrideSchema.nullable(),
  })
  .strict()

export const standaloneAgentLaunchInputSchema = z
  .object({
    requestId: idSchema,
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("task"), taskId: idSchema }).strict(),
      z.object({ kind: z.literal("chat"), chatId: idSchema }).strict(),
      z.object({ kind: z.literal("studio"), projectId: idSchema }).strict(),
    ]),
    profile: agentProfileVersionRefSchema,
    context: z.object({ includeTask: z.boolean(), includeParentChat: z.boolean() }).strict(),
    overrides: agentProfileBoundedOverrideSchema.nullable().default(null),
    orchestrationTaskId: idSchema.nullable().default(null),
    confirmedSnapshotDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()

export const agentProfileBundleEntrySchema = z
  .object({
    identity: agentProfileIdentityInputSchema.omit({ scope: true }),
    definition: agentProfileVersionInputSchema,
    sourceProfileId: idSchema,
    sourceVersion: z.number().int().min(1),
  })
  .strict()

export const agentProfileBundleSchema = z
  .object({
    kind: z.literal("flapstack-agent-profiles"),
    bundleVersion: z.literal(AGENT_PROFILE_BUNDLE_VERSION),
    exportedAt: z.string().datetime(),
    profiles: z.array(agentProfileBundleEntrySchema).min(1).max(256),
  })
  .strict()

export const agentProfileImportPreviewInputSchema = z
  .object({ bundle: z.string().min(1).max(4_000_000), sourceLabel: boundedText(500) })
  .strict()

export const agentProfileImportConfirmInputSchema = z
  .object({
    previewId: idSchema,
    expectedDigest: z.string().regex(/^[0-9a-f]{64}$/),
    conflict: z.enum(["duplicate", "new-version"]),
    projectId: idSchema.nullable(),
  })
  .strict()

export const AGENT_PROFILE_REQUIRED_EVALUATION_FIXTURES = [
  "schema",
  "capability",
  "permission",
  "prompt-injection",
  "determinism",
  "task-quality",
] as const

export const agentProfileEvaluationInputSchema = z
  .object({
    profile: agentProfileVersionRefSchema,
    runtime: z.enum(["codex", "claude-code", "flapstack-native"]),
    model: z.string().trim().min(1).max(200),
    fixtures: z
      .array(z.enum(AGENT_PROFILE_REQUIRED_EVALUATION_FIXTURES))
      .length(AGENT_PROFILE_REQUIRED_EVALUATION_FIXTURES.length)
      .superRefine((fixtures, context) => {
        if (new Set(fixtures).size !== fixtures.length) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: "Fixtures must be unique." })
        }
        for (const fixture of AGENT_PROFILE_REQUIRED_EVALUATION_FIXTURES) {
          if (!fixtures.includes(fixture)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Missing required fixture: ${fixture}.`,
            })
          }
        }
      }),
  })
  .strict()

export type AgentCapabilityProfile = z.infer<typeof agentCapabilityProfileSchema>
export type AgentPresentationStyle = z.infer<typeof agentPresentationStyleSchema>
export type AgentProfileVersionRef = z.infer<typeof agentProfileVersionRefSchema>
export type AgentProfileVersionInput = z.infer<typeof agentProfileVersionInputSchema>
export type AgentProfileScope = z.infer<typeof agentProfileScopeSchema>
export type AgentProfileBoundedOverride = z.infer<typeof agentProfileBoundedOverrideSchema>
export type AgentProfileLaunchPolicy = z.infer<typeof agentProfileLaunchPolicySchema>
export type AgentProfileWorkflowBinding = z.infer<typeof agentProfileWorkflowBindingSchema>
export type AgentProfileWorkflowTemplateReference = z.infer<
  typeof agentProfileWorkflowTemplateReferenceSchema
>

export type AgentProfileDto = {
  id: string
  name: string
  description: string
  category: string
  scope: AgentProfileScope
  source: z.infer<typeof agentProfileSourceSchema>
  currentVersion: number
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export type AgentProfileVersionDto = {
  profileId: string
  version: number
  definition: AgentProfileVersionInput
  provenance: {
    kind: "built-in" | "local" | "import"
    sourceLabel: string | null
    digest: string
    importedAt: string | null
    trusted: boolean
    disabledRequirements: Array<{ kind: string; id: string; reason: string }>
  }
  createdAt: number
}

export type AgentProfileResolvedFieldSource = {
  layer: "default" | "base" | "profile" | "workflow" | "launch" | "policy"
  profileId: string | null
  version: number | null
  note: string
}

export type ResolvedAgentProfileSnapshot = {
  schemaVersion: 1
  snapshotId: string
  profile: AgentProfileVersionRef
  displayName: string
  resolvedAt: string
  capability: AgentCapabilityProfile
  presentation: AgentPresentationStyle
  sources: Record<string, AgentProfileResolvedFieldSource>
  conflicts: Array<{ code: string; field: string; message: string; repair: string }>
  unresolvedRequirements: Array<{ kind: string; id: string; reason: string }>
  evaluation: {
    state: z.infer<typeof agentProfileEvaluationStateSchema>
    runtime: string
    model: string | null
    evidenceDigest: string | null
  }
  digest: string
}

export const DEFAULT_AGENT_CAPABILITY: AgentCapabilityProfile = {
  schemaVersion: 1,
  role: "specialist",
  instructions: "Complete the assigned task and report concrete evidence.",
  harness: "codex",
  runtimePreference: "auto",
  modelPreference: null,
  reasoningEffort: null,
  tools: [],
  skills: [],
  permissionMode: "read-only",
  customPermissions: null,
  memoryPolicy: { mode: "none" },
  worktreeStrategy: "inherit",
  allowedDescendantProfileIds: [],
  maxDescendants: 0,
}

export const DEFAULT_AGENT_PRESENTATION: AgentPresentationStyle = {
  schemaVersion: 1,
  tone: "direct",
  verbosity: "balanced",
  formatting: "markdown",
  responseStructure: "Lead with the outcome, then evidence and blockers.",
  characterLabel: null,
  voiceLabel: null,
  color: null,
}
