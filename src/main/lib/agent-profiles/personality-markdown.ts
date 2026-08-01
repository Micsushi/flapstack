import { createHash } from "node:crypto"
import { z } from "zod"
import {
  AGENT_PERSONALITY_MAX_BYTES,
  agentPersonalityMetadataSchema,
  type AgentPersonalityDocument,
  type AgentPersonalityMetadata,
} from "../../../shared/agent-personalities"

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)

const flatFrontmatterSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: idSchema,
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(160),
    scope: z.enum(["user", "project"]),
    projectId: idSchema.nullable(),
    baseId: idSchema.nullable().default(null),
    baseVersion: z.number().int().min(1).nullable().default(null),
    tone: z.enum(["neutral", "direct", "warm", "formal", "playful"]),
    verbosity: z.enum(["terse", "balanced", "detailed"]),
    formatting: z.enum(["plain", "structured", "markdown"]),
    responseStructure: z.string().trim().max(2_000),
    labels: z.array(z.string().trim().min(1).max(80)).max(16),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.scope === "project") !== (value.projectId !== null)) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Project scope requires one projectId and user scope forbids it.",
      })
    }
    if ((value.baseId === null) !== (value.baseVersion === null)) {
      context.addIssue({
        code: "custom",
        path: ["baseId"],
        message: "Base personality ID and version must be supplied together.",
      })
    }
  })

type FlatFrontmatter = z.infer<typeof flatFrontmatterSchema>

export function parseAgentPersonalityMarkdown(sourceValue: string): AgentPersonalityDocument {
  if (sourceValue.includes("\0")) throw new Error("Personality Markdown contains a NUL byte.")
  const source = sourceValue.replace(/\r\n?/g, "\n")
  assertBounded(source)
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/.exec(source)
  if (!match) throw new Error("Personality Markdown requires bounded YAML frontmatter.")
  if (/!!|![A-Za-z]/.test(match[1]!)) {
    throw new Error("Custom YAML tags are forbidden in personality frontmatter.")
  }

  let flat: FlatFrontmatter
  try {
    flat = flatFrontmatterSchema.parse(parseRestrictedFrontmatter(match[1]!))
  } catch (error) {
    throw new Error(
      `Invalid personality frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const body = match[2]!.replace(/\n+$/, "")
  const metadata = agentPersonalityMetadataSchema.parse({
    schemaVersion: flat.schemaVersion,
    id: flat.id,
    version: flat.version,
    name: flat.name,
    scope:
      flat.scope === "project"
        ? { type: "project", projectId: flat.projectId }
        : { type: "user", projectId: null },
    base: flat.baseId === null ? null : { personalityId: flat.baseId, version: flat.baseVersion },
    traits: {
      tone: flat.tone,
      verbosity: flat.verbosity,
      formatting: flat.formatting,
      responseStructure: flat.responseStructure,
      labels: flat.labels,
      color: flat.color,
    },
  })
  const canonical = JSON.stringify({ metadata, body })
  return {
    metadata,
    body,
    digest: createHash("sha256").update(canonical, "utf8").digest("hex"),
  }
}

export function serializeAgentPersonalityMarkdown(input: {
  metadata: AgentPersonalityMetadata
  body: string
}): string {
  const metadata = agentPersonalityMetadataSchema.parse(input.metadata)
  const body = input.body.replace(/\r\n?/g, "\n").replace(/\n+$/, "")
  const flat = {
    schemaVersion: metadata.schemaVersion,
    id: metadata.id,
    version: metadata.version,
    name: metadata.name,
    scope: metadata.scope.type,
    projectId: metadata.scope.projectId,
    baseId: metadata.base?.personalityId ?? null,
    baseVersion: metadata.base?.version ?? null,
    tone: metadata.traits.tone,
    verbosity: metadata.traits.verbosity,
    formatting: metadata.traits.formatting,
    responseStructure: metadata.traits.responseStructure,
    labels: metadata.traits.labels,
    color: metadata.traits.color,
  }
  const source = `---\n${Object.entries(flat)
    .map(([key, item]) => `${key}: ${JSON.stringify(item)}`)
    .join("\n")}\n---\n${body}`
  assertBounded(source)
  return source
}

function parseRestrictedFrontmatter(source: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [index, line] of source.split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.+)$/.exec(line)
    if (!match) throw new Error(`Frontmatter line ${index + 1} is not a flat key/value pair.`)
    const key = match[1]!
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new Error(`Duplicate frontmatter key: ${key}.`)
    }
    try {
      result[key] = JSON.parse(match[2]!)
    } catch {
      const plain = match[2]!.trim()
      if (/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(plain)) {
        result[key] = plain
        continue
      }
      throw new Error(`Frontmatter value for ${key} must be a bounded plain or JSON scalar.`)
    }
  }
  return result
}

function assertBounded(source: string): void {
  if (Buffer.byteLength(source, "utf8") > AGENT_PERSONALITY_MAX_BYTES) {
    throw new Error(
      `Personality Markdown exceeds the ${AGENT_PERSONALITY_MAX_BYTES}-byte size limit.`,
    )
  }
}
