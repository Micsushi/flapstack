import { z } from "zod"

export const PROVIDER_EXTENSION_SCHEMA_VERSION = 1 as const

export const providerExtensionProviders = ["claude", "codex", "cursor", "opencode"] as const
export const providerExtensionKinds = ["skill", "command", "plugin", "custom-agent", "mcp"] as const
export const providerExtensionScopes = ["user", "project", "plugin"] as const

export const providerExtensionProviderSchema = z.enum(providerExtensionProviders)
export const providerExtensionKindSchema = z.enum(providerExtensionKinds)
export const providerExtensionScopeSchema = z.enum(providerExtensionScopes)

export type ProviderExtensionProvider = (typeof providerExtensionProviders)[number]
export type ProviderExtensionKind = (typeof providerExtensionKinds)[number]
export type ProviderExtensionScope = (typeof providerExtensionScopes)[number]

export type ProviderExtensionCapabilities = {
  discovery: "supported" | "compatibility" | "unknown"
  create: boolean
  update: boolean
  delete: boolean
  runtime: "next-run" | "restart-required" | "read-only" | "unknown"
}

export type ProviderExtensionManifest = {
  schemaVersion: typeof PROVIDER_EXTENSION_SCHEMA_VERSION
  id: string
  provider: ProviderExtensionProvider
  kind: ProviderExtensionKind
  sourceId: string
  source: ProviderExtensionScope
  name: string
  description: string
  path: string
  content?: string
  updatedAt?: number
  capabilities: ProviderExtensionCapabilities
  limitations: string[]
}

export function providerExtensionId(
  provider: ProviderExtensionProvider,
  kind: ProviderExtensionKind,
  sourceId: string,
): string {
  return [provider, kind, sourceId].map(encodeURIComponent).join(":")
}

export function createProviderExtensionManifest(
  input: Omit<ProviderExtensionManifest, "schemaVersion" | "id">,
): ProviderExtensionManifest {
  if (!input.sourceId.trim()) throw new Error("Provider extension source identity is required")
  return {
    ...input,
    schemaVersion: PROVIDER_EXTENSION_SCHEMA_VERSION,
    id: providerExtensionId(input.provider, input.kind, input.sourceId),
  }
}

export const providerExtensionMutationSchema = z.object({
  operation: z.enum(["create", "update", "delete"]),
  provider: providerExtensionProviderSchema,
  kind: providerExtensionKindSchema,
  source: z.enum(["user", "project"]),
  sourceId: z.string().min(1).optional(),
  name: z.string().min(1).max(64),
  description: z.string().max(1024).default(""),
  content: z.string().max(1_000_000).default(""),
  cwd: z.string().optional(),
})

export type ProviderExtensionMutation = z.infer<typeof providerExtensionMutationSchema>

export type ProviderExtensionMutationResult = {
  operation: ProviderExtensionMutation["operation"]
  provider: ProviderExtensionProvider
  kind: ProviderExtensionKind
  sourceId: string
  id: string
  runtimeReload: ProviderExtensionCapabilities["runtime"]
}
