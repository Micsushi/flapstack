import { z } from "zod"

export const DISCUSSION_ASSISTANT_POLICY = {
  timeoutMs: 45_000,
  maxResponseBytes: 128 * 1024,
  maxContextCharacters: 16_000,
  maxReplyCharacters: 8_000,
  maxSummaryCharacters: 2_000,
  contextTokens: 4096,
  outputTokens: 900,
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
            quote: z.string().trim().min(1).max(16_384),
            summary: z.string().trim().min(1).max(2_000),
            existingTopicId: z.string().nullable(),
            recordIds: z.array(z.string()).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()

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
          required: ["title", "kind", "quote", "summary", "existingTopicId", "recordIds"],
          properties: {
            title: { type: "string" },
            kind: { type: "string", enum: ["fix", "idea", "note"] },
            quote: { type: "string" },
            summary: { type: "string" },
            existingTopicId: { type: ["string", "null"] },
            recordIds: { type: "array", items: { type: "string" }, maxItems: 10 },
          },
        },
      },
    },
  },
} as const
