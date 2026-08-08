import { z } from "zod"
import type { ResolvedAgentRuntime } from "./agent-runtime"

export const AGENT_ACTIVITY_KINDS = [
  "lifecycle",
  "status",
  "agent-text",
  "reasoning-summary",
  "provider-visible-reasoning",
  "plan",
  "tool",
  "command",
  "patch",
  "permission",
  "hook",
  "subagent",
  "warning",
  "compaction",
  "usage",
  "opaque-metadata",
  "private-metadata",
] as const
export type AgentActivityKind = (typeof AGENT_ACTIVITY_KINDS)[number]

export const AGENT_ACTIVITY_PHASES = [
  "queued",
  "started",
  "delta",
  "updated",
  "completed",
  "failed",
  "cancelled",
  "snapshot",
] as const
export type AgentActivityPhase = (typeof AGENT_ACTIVITY_PHASES)[number]

export const AGENT_ACTIVITY_DISPLAY_CLASSES = [
  "summary",
  "provider-visible",
  "status",
  "tool",
  "private",
  "metadata",
] as const
export type AgentActivityDisplayClass = (typeof AGENT_ACTIVITY_DISPLAY_CLASSES)[number]

export const AGENT_ACTIVITY_PRIVACY_CLASSES = [
  "public",
  "sensitive",
  "private",
  "encrypted",
] as const
export type AgentActivityPrivacyClass = (typeof AGENT_ACTIVITY_PRIVACY_CLASSES)[number]

export const AGENT_ACTIVITY_REDACTION_STATES = [
  "none",
  "redacted",
  "retained-redaction",
  "corrupt",
] as const
export type AgentActivityRedactionState = (typeof AGENT_ACTIVITY_REDACTION_STATES)[number]

export const MAX_AGENT_ACTIVITY_PAYLOAD_BYTES = 65_536
export const MAX_AGENT_ACTIVITY_BATCH_SIZE = 1_000
export const MAX_AGENT_ACTIVITY_QUERY_SIZE = 500
export const MAX_AGENT_ACTIVITY_METADATA_DEPTH = 6
export const MAX_AGENT_ACTIVITY_METADATA_ENTRIES = 100
export const MAX_AGENT_ACTIVITY_METADATA_STRING = 4_096

const boundedText = z.string().max(MAX_AGENT_ACTIVITY_PAYLOAD_BYTES)
const shortText = z.string().trim().min(1).max(512)
const nullableShortText = z.string().max(512).nullable().optional()
const finiteNonNegative = z.number().finite().nonnegative()

export type BoundedActivityMetadata =
  | null
  | boolean
  | number
  | string
  | BoundedActivityMetadata[]
  | { [key: string]: BoundedActivityMetadata }

const payloadSchemas = {
  lifecycle: z.object({ state: shortText, detail: boundedText.nullable().optional() }).strict(),
  status: z.object({ message: boundedText, code: nullableShortText }).strict(),
  "agent-text": z.object({ text: boundedText }).strict(),
  "reasoning-summary": z.object({ text: boundedText, label: nullableShortText }).strict(),
  "provider-visible-reasoning": z.object({ text: boundedText, label: nullableShortText }).strict(),
  plan: z
    .object({
      text: boundedText.nullable().optional(),
      items: z
        .array(
          z
            .object({
              id: z.string().max(512).nullable().optional(),
              text: boundedText,
              status: z.string().max(128).nullable().optional(),
            })
            .strict(),
        )
        .max(500)
        .optional(),
    })
    .strict(),
  tool: z
    .object({
      name: shortText,
      state: shortText,
      input: z.unknown().optional(),
      output: z.unknown().optional(),
      inputSummary: boundedText.nullable().optional(),
      outputSummary: boundedText.nullable().optional(),
    })
    .strict(),
  command: z
    .object({
      command: boundedText.nullable().optional(),
      state: shortText,
      exitCode: z.number().int().nullable().optional(),
      outputSummary: boundedText.nullable().optional(),
    })
    .strict(),
  patch: z
    .object({
      path: boundedText.nullable().optional(),
      state: shortText,
      summary: boundedText.nullable().optional(),
      diff: boundedText.nullable().optional(),
      changes: z
        .array(
          z
            .object({
              path: boundedText,
              kind: z.string().max(128).nullable().optional(),
              diff: boundedText.nullable().optional(),
            })
            .strict(),
        )
        .max(500)
        .optional(),
    })
    .strict(),
  permission: z
    .object({
      requestType: shortText,
      state: shortText,
      decision: z.string().max(128).nullable().optional(),
    })
    .strict(),
  hook: z
    .object({ name: shortText, state: shortText, summary: boundedText.nullable().optional() })
    .strict(),
  subagent: z
    .object({
      agentId: z.string().max(512).nullable().optional(),
      state: shortText,
      message: boundedText.nullable().optional(),
    })
    .strict(),
  warning: z.object({ message: boundedText, code: nullableShortText }).strict(),
  compaction: z.object({ state: shortText, summary: boundedText.nullable().optional() }).strict(),
  usage: z
    .object({
      inputTokens: finiteNonNegative.nullable().optional(),
      outputTokens: finiteNonNegative.nullable().optional(),
      cachedTokens: finiteNonNegative.nullable().optional(),
      reasoningTokens: finiteNonNegative.nullable().optional(),
      contextWindow: finiteNonNegative.nullable().optional(),
      costUsd: finiteNonNegative.nullable().optional(),
    })
    .strict(),
  "opaque-metadata": z.object({ eventType: shortText, metadata: z.unknown().optional() }).strict(),
  "private-metadata": z.object({ eventType: shortText, metadata: z.unknown().optional() }).strict(),
} as const

export type AgentActivityPayloadByKind = {
  [K in keyof typeof payloadSchemas]: z.infer<(typeof payloadSchemas)[K]>
}

export type AgentActivityProviderIdentity = {
  providerEventId?: string | null
  providerSessionId?: string | null
  providerThreadId?: string | null
  providerTurnId?: string | null
  providerItemId?: string | null
  providerParentItemId?: string | null
  providerMessageId?: string | null
  providerToolId?: string | null
  summaryIndex?: number | null
  contentIndex?: number | null
  partIndex?: number | null
  sectionBoundary?: string | null
}

export type AgentActivityAppendBase = AgentActivityProviderIdentity & {
  provider: string
  orchestrationAgentId?: string | null
  phase: AgentActivityPhase
  displayClass: AgentActivityDisplayClass
  privacyClass: AgentActivityPrivacyClass
  providerTimestamp?: number | null
  receivedAt?: number
  dedupKey?: string | null
}

export type AgentActivityAppend = {
  [K in AgentActivityKind]: AgentActivityAppendBase & {
    kind: K
    payload: AgentActivityPayloadByKind[K]
  }
}[AgentActivityKind]

export type AgentActivityEvent = AgentActivityAppend & {
  storageId: number
  eventId: string
  runId: string
  chatId: string
  subChatId: string | null
  runtime: ResolvedAgentRuntime
  harness: string
  sequence: number
  receivedAt: number
  redactionState: AgentActivityRedactionState
  redactionReason: string | null
  createdAt: number
}

export type AgentActivityQuery = {
  runId?: string
  chatId?: string
  kinds?: AgentActivityKind[]
  privacyClasses?: AgentActivityPrivacyClass[]
  afterStorageId?: number
  beforeStorageId?: number
  limit?: number
  direction?: "forward" | "backward"
  corruptionMode?: "fail" | "redacted-placeholder"
}

export type AgentActivityPage = {
  events: AgentActivityEvent[]
  nextCursor: number | null
  hasMore: boolean
}

export type AgentActivityInvalidation = {
  reason: "append" | "redaction" | "retention"
  runId: string
  chatId: string
  firstSequence: number
  lastSequence: number
  lastStorageId: number
  insertedCount: number
}

export type UnknownAgentActivity = {
  provider: string
  eventType: string
  criticality: "metadata" | "execution" | "permission" | "identity"
  metadata?: unknown
  providerIdentity?: AgentActivityProviderIdentity
  providerTimestamp?: number | null
}

const appendBaseSchema = z.object({
  provider: shortText,
  orchestrationAgentId: z.string().max(512).nullable().optional(),
  phase: z.enum(AGENT_ACTIVITY_PHASES),
  displayClass: z.enum(AGENT_ACTIVITY_DISPLAY_CLASSES),
  privacyClass: z.enum(AGENT_ACTIVITY_PRIVACY_CLASSES),
  providerTimestamp: z.number().finite().nullable().optional(),
  receivedAt: z.number().finite().nonnegative().optional(),
  dedupKey: z.string().max(2_048).nullable().optional(),
  providerEventId: z.string().max(2_048).nullable().optional(),
  providerSessionId: z.string().max(2_048).nullable().optional(),
  providerThreadId: z.string().max(2_048).nullable().optional(),
  providerTurnId: z.string().max(2_048).nullable().optional(),
  providerItemId: z.string().max(2_048).nullable().optional(),
  providerParentItemId: z.string().max(2_048).nullable().optional(),
  providerMessageId: z.string().max(2_048).nullable().optional(),
  providerToolId: z.string().max(2_048).nullable().optional(),
  summaryIndex: z.number().int().nonnegative().nullable().optional(),
  contentIndex: z.number().int().nonnegative().nullable().optional(),
  partIndex: z.number().int().nonnegative().nullable().optional(),
  sectionBoundary: z.string().max(512).nullable().optional(),
})

export const agentActivityAppendSchema = appendBaseSchema
  .extend({
    kind: z.enum(AGENT_ACTIVITY_KINDS),
    payload: z.unknown(),
  })
  .strict()

export const agentActivityQuerySchema = z
  .object({
    runId: z.string().trim().min(1).max(512).optional(),
    chatId: z.string().trim().min(1).max(512).optional(),
    kinds: z.array(z.enum(AGENT_ACTIVITY_KINDS)).max(AGENT_ACTIVITY_KINDS.length).optional(),
    privacyClasses: z
      .array(z.enum(AGENT_ACTIVITY_PRIVACY_CLASSES))
      .max(AGENT_ACTIVITY_PRIVACY_CLASSES.length)
      .optional(),
    afterStorageId: z.number().int().positive().optional(),
    beforeStorageId: z.number().int().positive().optional(),
    limit: z.number().int().min(1).max(MAX_AGENT_ACTIVITY_QUERY_SIZE).default(100),
    direction: z.enum(["forward", "backward"]).default("forward"),
    corruptionMode: z.enum(["fail", "redacted-placeholder"]).default("fail"),
  })
  .strict()
  .refine((value) => value.runId || value.chatId, "runId or chatId is required")

export function parseAgentActivityAppend(value: unknown): AgentActivityAppend {
  const parsed = agentActivityAppendSchema.parse(value)
  return {
    ...parsed,
    payload: parseAgentActivityPayload(parsed.kind, parsed.payload),
  } as AgentActivityAppend
}

export function parseAgentActivityPayload<K extends AgentActivityKind>(
  kind: K,
  value: unknown,
): AgentActivityPayloadByKind[K] {
  return payloadSchemas[kind].parse(value) as AgentActivityPayloadByKind[K]
}
