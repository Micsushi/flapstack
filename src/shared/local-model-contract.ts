import type { CustomPermissionCapabilities } from "./permission-capabilities"
import type { RunPermissionMode } from "./harness-types"

export const LOCAL_MODEL_CONTRACT_VERSION = 1 as const
export const LOCAL_MODEL_CATALOG_CACHE_VERSION = 1 as const
export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"

export type LocalModelEndpointValidation =
  | { valid: true; endpoint: string; message: null }
  | { valid: false; endpoint: null; message: string }

export function validateLocalModelEndpoint(value: string): LocalModelEndpointValidation {
  const requested = value.trim()
  if (!requested) {
    return { valid: false, endpoint: null, message: "Enter an Ollama loopback endpoint." }
  }

  let endpoint: URL
  try {
    endpoint = new URL(requested)
  } catch {
    return { valid: false, endpoint: null, message: "Enter a valid HTTP(S) URL." }
  }

  const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    !loopbackHosts.has(endpoint.hostname.toLowerCase()) ||
    endpoint.username ||
    endpoint.password ||
    (endpoint.pathname !== "/" && endpoint.pathname !== "") ||
    endpoint.search ||
    endpoint.hash
  ) {
    return {
      valid: false,
      endpoint: null,
      message: "Use an uncredentialed loopback HTTP(S) origin such as http://127.0.0.1:11434.",
    }
  }

  return { valid: true, endpoint: endpoint.origin, message: null }
}

export type LocalModelProviderId = "ollama"
export type LocalModelCapabilityName = "chat" | "streaming" | "tools" | "vision"
export type LocalModelCapabilityState = "supported" | "unsupported" | "unknown"
export type LocalModelCapabilitySource = "provider-declared" | "provider-contract" | "unknown"

export type LocalModelCapability = {
  state: LocalModelCapabilityState
  source: LocalModelCapabilitySource
  evidence: string | null
}

export type LocalModelCapabilities = Record<LocalModelCapabilityName, LocalModelCapability>

export const LOCAL_MODEL_LIMITATION_CODES = [
  "provider-unavailable",
  "provider-endpoint-error",
  "provider-timeout",
  "provider-response-invalid",
  "provider-version-unavailable",
  "catalog-empty",
  "catalog-cache-stale",
  "catalog-cache-incompatible",
  "model-metadata-unavailable",
  "model-not-found",
  "chat-unsupported",
  "streaming-unsupported",
  "tools-unsupported",
  "vision-unsupported",
  "permission-denied",
] as const

export type LocalModelLimitationCode = (typeof LOCAL_MODEL_LIMITATION_CODES)[number]

export type LocalModelLimitation = {
  code: LocalModelLimitationCode
  message: string
  modelId?: string
  status?: number
}

export type LocalModelProviderIdentity = {
  harness: "local"
  provider: LocalModelProviderId
  endpoint: string
  version: string | null
}

export type LocalModelIdentity = {
  provider: LocalModelProviderId
  modelId: string
  digest: string | null
  modifiedAt: string | null
  family: string | null
  parameterSize: string | null
  quantizationLevel: string | null
  contextWindow: number | null
}

export type LocalModelCatalogEntry = {
  identity: LocalModelIdentity
  capabilities: LocalModelCapabilities
  limitations: LocalModelLimitation[]
}

export type LocalModelCatalogState = "ready" | "empty" | "stale" | "unavailable" | "error"

export type LocalModelCatalogSnapshot = {
  schemaVersion: typeof LOCAL_MODEL_CATALOG_CACHE_VERSION
  provider: LocalModelProviderIdentity
  state: LocalModelCatalogState
  capturedAt: string
  expiresAt: string
  models: LocalModelCatalogEntry[]
  limitations: LocalModelLimitation[]
}

export type LocalModelToolTier = "chat" | "read" | "project-write" | "shell" | "git" | "network"

export type LocalModelToolTierDeclaration = {
  tier: LocalModelToolTier
  requiredCapability: "chat" | "tools"
  mutates: boolean
  customPermission: keyof Omit<CustomPermissionCapabilities, "schemaVersion"> | null
}

export const LOCAL_MODEL_TOOL_TIERS = [
  { tier: "chat", requiredCapability: "chat", mutates: false, customPermission: null },
  { tier: "read", requiredCapability: "tools", mutates: false, customPermission: null },
  {
    tier: "project-write",
    requiredCapability: "tools",
    mutates: true,
    customPermission: "projectWrite",
  },
  { tier: "shell", requiredCapability: "tools", mutates: true, customPermission: "shell" },
  { tier: "git", requiredCapability: "tools", mutates: true, customPermission: "git" },
  { tier: "network", requiredCapability: "tools", mutates: true, customPermission: "network" },
] as const satisfies readonly LocalModelToolTierDeclaration[]

export type LocalModelToolTierState = LocalModelToolTierDeclaration & {
  available: boolean
  limitation: LocalModelLimitation | null
}

export type LocalModelFallbackPolicy = {
  mode: "none"
  cloudAllowed: false
  reason: "cloud-fallback-disabled"
}

export const LOCAL_MODEL_FALLBACK_POLICY: LocalModelFallbackPolicy = {
  mode: "none",
  cloudAllowed: false,
  reason: "cloud-fallback-disabled",
}

export type LocalModelRunMetadata = {
  contractVersion: typeof LOCAL_MODEL_CONTRACT_VERSION
  harness: "local"
  provider: LocalModelProviderIdentity
  model: LocalModelIdentity
  capabilities: LocalModelCapabilities
  permission: {
    mode: RunPermissionMode
    customPermissions: CustomPermissionCapabilities | null
    toolTiers: LocalModelToolTierState[]
  }
  catalog: {
    schemaVersion: typeof LOCAL_MODEL_CATALOG_CACHE_VERSION
    capturedAt: string
    expiresAt: string
  }
  fallback: LocalModelFallbackPolicy
}

export function createLocalModelRunMetadata(input: {
  catalog: LocalModelCatalogSnapshot
  model: LocalModelCatalogEntry
  permissionMode: RunPermissionMode
  customPermissions?: CustomPermissionCapabilities | null
}): LocalModelRunMetadata {
  const customPermissions = input.customPermissions ?? null
  return {
    contractVersion: LOCAL_MODEL_CONTRACT_VERSION,
    harness: "local",
    provider: input.catalog.provider,
    model: input.model.identity,
    capabilities: input.model.capabilities,
    permission: {
      mode: input.permissionMode,
      customPermissions,
      toolTiers: resolveLocalModelToolTiers(
        input.model.capabilities,
        input.permissionMode,
        customPermissions,
      ),
    },
    catalog: {
      schemaVersion: input.catalog.schemaVersion,
      capturedAt: input.catalog.capturedAt,
      expiresAt: input.catalog.expiresAt,
    },
    fallback: LOCAL_MODEL_FALLBACK_POLICY,
  }
}

export type LocalModelSelectionState =
  | "ready"
  | "provider-unavailable"
  | "endpoint-error"
  | "catalog-empty"
  | "catalog-stale"
  | "model-not-found"
  | "chat-unsupported"

export type LocalModelSelection = {
  state: LocalModelSelectionState
  runnable: boolean
  model: LocalModelCatalogEntry | null
  limitations: LocalModelLimitation[]
  fallback: LocalModelFallbackPolicy
}

export function resolveLocalModelSelection(
  catalog: LocalModelCatalogSnapshot,
  modelId: string,
): LocalModelSelection {
  const fallback = LOCAL_MODEL_FALLBACK_POLICY
  if (catalog.state === "unavailable") {
    return {
      state: "provider-unavailable",
      runnable: false,
      model: null,
      limitations: catalog.limitations,
      fallback,
    }
  }
  if (catalog.state === "error") {
    return {
      state: "endpoint-error",
      runnable: false,
      model: null,
      limitations: catalog.limitations,
      fallback,
    }
  }
  if (catalog.state === "empty") {
    return {
      state: "catalog-empty",
      runnable: false,
      model: null,
      limitations: catalog.limitations,
      fallback,
    }
  }
  if (catalog.state === "stale") {
    return {
      state: "catalog-stale",
      runnable: false,
      model: catalog.models.find((entry) => entry.identity.modelId === modelId) ?? null,
      limitations: catalog.limitations,
      fallback,
    }
  }

  const model = catalog.models.find((entry) => entry.identity.modelId === modelId) ?? null
  if (!model) {
    return {
      state: "model-not-found",
      runnable: false,
      model: null,
      limitations: [
        ...catalog.limitations,
        { code: "model-not-found", message: "The selected local model is not in the catalog." },
      ],
      fallback,
    }
  }
  if (model.capabilities.chat.state !== "supported") {
    return {
      state: "chat-unsupported",
      runnable: false,
      model,
      limitations: model.limitations,
      fallback,
    }
  }
  return { state: "ready", runnable: true, model, limitations: model.limitations, fallback }
}

export function resolveLocalModelToolTiers(
  capabilities: LocalModelCapabilities,
  permissionMode: RunPermissionMode,
  customPermissions: CustomPermissionCapabilities | null = null,
): LocalModelToolTierState[] {
  return LOCAL_MODEL_TOOL_TIERS.map((declaration) => {
    const capability = capabilities[declaration.requiredCapability]
    if (capability.state !== "supported") {
      const code =
        declaration.requiredCapability === "chat" ? "chat-unsupported" : "tools-unsupported"
      return {
        ...declaration,
        available: false,
        limitation: {
          code,
          message:
            declaration.requiredCapability === "chat"
              ? "The provider did not declare chat support for this model."
              : "The provider did not declare tool support for this model.",
        },
      }
    }

    if (isTierAllowedByPermission(declaration, permissionMode, customPermissions)) {
      return { ...declaration, available: true, limitation: null }
    }
    return {
      ...declaration,
      available: false,
      limitation: {
        code: "permission-denied",
        message: `Permission mode ${permissionMode} does not authorize the ${declaration.tier} tier.`,
      },
    }
  })
}

export function findUnavailableLocalModelTier<T extends { tier: string; available: boolean }>(
  required: readonly string[],
  tiers: readonly T[],
): { requiredTier: string; state: T | null } | null {
  for (const requiredTier of required) {
    const state = tiers.find((candidate) => candidate.tier === requiredTier) ?? null
    if (!state?.available) return { requiredTier, state }
  }
  return null
}

function isTierAllowedByPermission(
  declaration: LocalModelToolTierDeclaration,
  mode: RunPermissionMode,
  customPermissions: CustomPermissionCapabilities | null,
): boolean {
  if (!declaration.mutates) return true
  if (mode === "full-access") return true
  if (mode === "ask-before-edits") return true
  if (declaration.tier === "project-write") {
    if (mode === "auto-edit-project-only") return true
  }
  if (mode !== "custom" || !declaration.customPermission || !customPermissions) return false
  return customPermissions[declaration.customPermission]
}
