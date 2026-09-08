import { z } from "zod"

export const DISCUSSION_ASSISTANT_POLICY = {
  timeoutMs: 45_000,
  maxResponseBytes: 128 * 1024,
  maxContextCharacters: 16_000,
  maxReplyCharacters: 8_000,
  maxSummaryCharacters: 2_000,
  contextTokens: 4096,
  outputTokens: 900,
  captureRepairAttempts: 1,
  captureMaxModelCalls: 4,
  canonicalDescriptionCharacters: 2000,
  captureMaxSpans: 64,
  captureReviewReserveCharacters: 4000,
} as const
export const discussionSummarySchema = z
  .object({
    summary: z.string().trim().min(1).max(DISCUSSION_ASSISTANT_POLICY.maxSummaryCharacters),
  })
  .strict()
export const discussionReplySchema = z
  .object({ reply: z.string().trim().min(1).max(DISCUSSION_ASSISTANT_POLICY.maxReplyCharacters) })
  .strict()

export const mixedCaptureSuggestionSchema = z
  .object({
    topics: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            kind: z.enum(["fix", "idea", "note"]),
            spanIds: z.array(z.string().min(1).max(32)).min(1).max(64),
            summary: z.string().trim().min(1).max(2_000),
            existingTopicId: z.string().nullable(),
            recordIds: z.array(z.string()).max(0),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()

export const mixedCaptureMatchesSchema = z
  .object({
    matches: z
      .array(
        z
          .object({
            groupId: z.string().min(1).max(32),
            recordIds: z.array(z.string().min(1).max(200)).max(6),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()

export const mixedCaptureReviewSchema = z
  .object({
    accepted: z.boolean(),
    issues: z.array(z.string().trim().min(1).max(800)).max(8),
  })
  .strict()
  .refine(
    (value) => value.accepted === (value.issues.length === 0),
    "A rejected review needs issues; an accepted review must have none",
  )

// Ollama constrains decoding; the Zod schemas still validate all returned data.
export const discussionOutputFormats = {
  reply: {
    type: "object",
    properties: { reply: { type: "string" } },
    required: ["reply"],
    additionalProperties: false,
  },
  summary: {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
    additionalProperties: false,
  },
  capture: {
    type: "object",
    required: ["topics"],
    additionalProperties: false,
    properties: {
      topics: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "kind", "spanIds", "summary", "existingTopicId", "recordIds"],
          properties: {
            title: { type: "string" },
            kind: { type: "string", enum: ["fix", "idea", "note"] },
            spanIds: { type: "array", minItems: 1, maxItems: 64, items: { type: "string" } },
            summary: { type: "string" },
            existingTopicId: { type: ["string", "null"] },
            recordIds: { type: "array", items: { type: "string" }, maxItems: 0 },
          },
        },
      },
    },
  },
  "capture-match": {
    type: "object",
    required: ["matches"],
    additionalProperties: false,
    properties: {
      matches: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          required: ["groupId", "recordIds"],
          additionalProperties: false,
          properties: {
            groupId: { type: "string" },
            recordIds: { type: "array", maxItems: 6, items: { type: "string" } },
          },
        },
      },
    },
  },
  "capture-review": {
    type: "object",
    required: ["accepted", "issues"],
    additionalProperties: false,
    properties: {
      accepted: { type: "boolean" },
      issues: { type: "array", maxItems: 8, items: { type: "string" } },
    },
  },
} as const
