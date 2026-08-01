import { z } from "zod"

export const AGENT_PERSONALITY_SCHEMA_VERSION = 1 as const
export const AGENT_PERSONALITY_MAX_BYTES = 65_536

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
const scopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), projectId: z.null() }).strict(),
  z.object({ type: z.literal("project"), projectId: idSchema }).strict(),
])
export const agentPersonalityVersionRefSchema = z
  .object({
    personalityId: idSchema,
    version: z.number().int().min(1),
  })
  .strict()
const toneSchema = z.enum(["neutral", "direct", "warm", "formal", "playful"])
const verbositySchema = z.enum(["terse", "balanced", "detailed"])
const formattingSchema = z.enum(["plain", "structured", "markdown"])
const responseStructureSchema = z.string().trim().max(2_000)
const labelsSchema = z.array(z.string().trim().min(1).max(80)).max(16)
const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .nullable()
export const agentPersonalityTraitsSchema = z
  .object({
    tone: toneSchema,
    verbosity: verbositySchema,
    formatting: formattingSchema,
    responseStructure: responseStructureSchema,
    labels: labelsSchema,
    color: colorSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.labels.map((label) => label.toLocaleLowerCase())).size !== value.labels.length
    ) {
      context.addIssue({ code: "custom", path: ["labels"], message: "Labels must be unique." })
    }
  })
export const agentPersonalityMetadataSchema = z
  .object({
    schemaVersion: z.literal(AGENT_PERSONALITY_SCHEMA_VERSION),
    id: idSchema,
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(160),
    scope: scopeSchema,
    base: agentPersonalityVersionRefSchema.nullable(),
    traits: agentPersonalityTraitsSchema,
  })
  .strict()

export type AgentPersonalityVersionRef = z.infer<typeof agentPersonalityVersionRefSchema>
export type AgentPersonalityMetadata = z.infer<typeof agentPersonalityMetadataSchema>
export type AgentPersonalityDocument = {
  metadata: AgentPersonalityMetadata
  body: string
  digest: string
}

export type ResolvedAgentPersonalityDocument = AgentPersonalityDocument & {
  chain: Array<{
    ref: AgentPersonalityVersionRef
    digest: string
  }>
}
