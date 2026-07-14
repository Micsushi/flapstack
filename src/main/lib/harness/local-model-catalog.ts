import {
  DEFAULT_OLLAMA_BASE_URL,
  LOCAL_MODEL_CATALOG_CACHE_VERSION,
  LOCAL_MODEL_LIMITATION_CODES,
  validateLocalModelEndpoint,
  type LocalModelCapabilities,
  type LocalModelCapability,
  type LocalModelCatalogEntry,
  type LocalModelCatalogSnapshot,
  type LocalModelIdentity,
  type LocalModelLimitation,
  type LocalModelProviderIdentity,
} from "../../../shared/local-model-contract"

export { DEFAULT_OLLAMA_BASE_URL }
export const DEFAULT_LOCAL_MODEL_CACHE_TTL_MS = 5 * 60 * 1000

export type OllamaEndpointConfig = {
  provider: "ollama"
  baseUrl: string
  requestTimeoutMs: number
  cacheTtlMs: number
  allowRemote: false
}

export type LocalModelCatalogCacheResult =
  | { state: "miss" | "incompatible"; snapshot: null }
  | { state: "fresh" | "stale"; snapshot: LocalModelCatalogSnapshot }

export type ProbeLocalModelCatalogOptions = {
  config?: OllamaEndpointConfig
  fetchImpl?: typeof fetch
  now?: () => number
}

type ProbeFailureKind = "unavailable" | "endpoint" | "timeout" | "invalid"

class ProbeFailure extends Error {
  constructor(
    readonly kind: ProbeFailureKind,
    readonly status?: number,
  ) {
    super(kind)
  }
}

export function getOllamaEndpointConfig(
  input: {
    baseUrl?: string
    requestTimeoutMs?: number
    cacheTtlMs?: number
  } = {},
): OllamaEndpointConfig {
  const requested = input.baseUrl?.trim() || process.env.FLAPSTACK_OLLAMA_BASE_URL?.trim()
  const validation = validateLocalModelEndpoint(requested || DEFAULT_OLLAMA_BASE_URL)
  if (!validation.valid) throw new Error(validation.message)

  return {
    provider: "ollama",
    baseUrl: validation.endpoint,
    requestTimeoutMs: boundedPositive(input.requestTimeoutMs, 5_000, 100, 30_000),
    cacheTtlMs: boundedPositive(
      input.cacheTtlMs,
      DEFAULT_LOCAL_MODEL_CACHE_TTL_MS,
      1_000,
      24 * 60 * 60 * 1000,
    ),
    allowRemote: false,
  }
}

export async function probeLocalModelCatalog(
  options: ProbeLocalModelCatalogOptions = {},
): Promise<LocalModelCatalogSnapshot> {
  const config = options.config ?? getOllamaEndpointConfig()
  const fetchImpl = options.fetchImpl ?? fetch
  const nowMs = (options.now ?? Date.now)()
  const capturedAt = new Date(nowMs).toISOString()
  const expiresAt = new Date(nowMs + config.cacheTtlMs).toISOString()
  const baseProvider: LocalModelProviderIdentity = {
    harness: "local",
    provider: "ollama",
    endpoint: config.baseUrl,
    version: null,
  }

  let tagsPayload: unknown
  try {
    tagsPayload = await requestJson(fetchImpl, config, "/api/tags")
  } catch (error) {
    const failure = asProbeFailure(error)
    return failureSnapshot(baseProvider, capturedAt, expiresAt, failure)
  }

  const tags = parseTags(tagsPayload)
  if (!tags) {
    return failureSnapshot(baseProvider, capturedAt, expiresAt, new ProbeFailure("invalid"))
  }

  const limitations: LocalModelLimitation[] = []
  let version: string | null = null
  try {
    version = parseVersion(await requestJson(fetchImpl, config, "/api/version"))
    if (!version) throw new ProbeFailure("invalid")
  } catch {
    limitations.push({
      code: "provider-version-unavailable",
      message: "Ollama responded, but its version could not be verified.",
    })
  }

  const provider = { ...baseProvider, version }
  if (tags.length === 0) {
    return {
      schemaVersion: LOCAL_MODEL_CATALOG_CACHE_VERSION,
      provider,
      state: "empty",
      capturedAt,
      expiresAt,
      models: [],
      limitations: [
        ...limitations,
        { code: "catalog-empty", message: "Ollama is available but has no installed models." },
      ],
    }
  }

  const models = await Promise.all(tags.map((tag) => probeModel(fetchImpl, config, tag)))
  return {
    schemaVersion: LOCAL_MODEL_CATALOG_CACHE_VERSION,
    provider,
    state: "ready",
    capturedAt,
    expiresAt,
    models: models.sort((left, right) =>
      left.identity.modelId.localeCompare(right.identity.modelId),
    ),
    limitations,
  }
}

export function readLocalModelCatalogCache(
  value: unknown,
  nowMs = Date.now(),
): LocalModelCatalogCacheResult {
  if (!isCatalogSnapshot(value)) {
    return {
      state:
        isRecord(value) && "schemaVersion" in value && value.schemaVersion !== undefined
          ? "incompatible"
          : "miss",
      snapshot: null,
    }
  }

  const stale = Date.parse(value.expiresAt) <= nowMs || value.state === "stale"
  if (!stale) return { state: "fresh", snapshot: value }
  return {
    state: "stale",
    snapshot: {
      ...value,
      state: "stale",
      limitations: appendLimitation(value.limitations, {
        code: "catalog-cache-stale",
        message: "The cached Ollama catalog is stale and cannot authorize a run.",
      }),
    },
  }
}

export function fallbackToCachedLocalModelCatalog(
  live: LocalModelCatalogSnapshot,
  cached: LocalModelCatalogCacheResult,
): LocalModelCatalogSnapshot {
  if (live.state === "ready" || live.state === "empty" || !cached.snapshot) return live
  if (cached.snapshot.models.length === 0) return live
  if (cached.snapshot.provider.endpoint !== live.provider.endpoint) return live
  return {
    ...cached.snapshot,
    state: "stale",
    limitations: appendLimitation([...cached.snapshot.limitations, ...live.limitations], {
      code: "catalog-cache-stale",
      message: "Ollama could not be refreshed; cached models are display-only.",
    }),
  }
}

async function probeModel(
  fetchImpl: typeof fetch,
  config: OllamaEndpointConfig,
  tag: OllamaTag,
): Promise<LocalModelCatalogEntry> {
  let payload: unknown
  try {
    payload = await requestJson(fetchImpl, config, "/api/show", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: tag.name, verbose: false }),
    })
  } catch {
    const limitation: LocalModelLimitation = {
      code: "model-metadata-unavailable",
      message: "Ollama model metadata could not be verified.",
      modelId: tag.name,
    }
    return {
      identity: modelIdentity(tag, null),
      capabilities: unknownCapabilities(),
      limitations: [limitation],
    }
  }

  if (!isRecord(payload)) {
    const limitation: LocalModelLimitation = {
      code: "model-metadata-unavailable",
      message: "Ollama returned invalid model metadata.",
      modelId: tag.name,
    }
    return {
      identity: modelIdentity(tag, null),
      capabilities: unknownCapabilities(),
      limitations: [limitation],
    }
  }

  const declared = stringArray(payload.capabilities)
  const hasDeclaration = Array.isArray(payload.capabilities)
  const chat = declaredCapability(declared, hasDeclaration, ["chat", "completion"])
  const capabilities: LocalModelCapabilities = {
    chat,
    streaming:
      chat.state === "supported"
        ? { state: "supported", source: "provider-contract", evidence: "ollama-api-chat" }
        : chat,
    tools: declaredCapability(declared, hasDeclaration, ["tools", "tool", "tool-calling"]),
    vision: declaredCapability(declared, hasDeclaration, ["vision"]),
  }
  const limitations = capabilityLimitations(tag.name, capabilities)
  return {
    identity: modelIdentity(tag, payload),
    capabilities,
    limitations,
  }
}

type OllamaTag = {
  name: string
  digest: string | null
  modifiedAt: string | null
  family: string | null
  parameterSize: string | null
  quantizationLevel: string | null
}

function parseTags(payload: unknown): OllamaTag[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.models)) return null
  const tags = new Map<string, OllamaTag>()
  for (const item of payload.models) {
    if (!isRecord(item)) continue
    const name = stringValue(item.name) ?? stringValue(item.model)
    if (!name || tags.has(name)) continue
    const details = isRecord(item.details) ? item.details : {}
    tags.set(name, {
      name,
      digest: stringValue(item.digest),
      modifiedAt: stringValue(item.modified_at),
      family: stringValue(details.family),
      parameterSize: stringValue(details.parameter_size),
      quantizationLevel: stringValue(details.quantization_level),
    })
  }
  return [...tags.values()]
}

function parseVersion(payload: unknown): string | null {
  return isRecord(payload) ? stringValue(payload.version) : null
}

function modelIdentity(tag: OllamaTag, show: Record<string, unknown> | null): LocalModelIdentity {
  const details = show && isRecord(show.details) ? show.details : {}
  const modelInfo = show && isRecord(show.model_info) ? show.model_info : {}
  const contextWindow = Object.entries(modelInfo).find(
    ([key, value]) => key.endsWith(".context_length") && finitePositive(value) !== null,
  )?.[1]
  return {
    provider: "ollama",
    modelId: tag.name,
    digest: tag.digest,
    modifiedAt: tag.modifiedAt,
    family: stringValue(details.family) ?? tag.family,
    parameterSize: stringValue(details.parameter_size) ?? tag.parameterSize,
    quantizationLevel: stringValue(details.quantization_level) ?? tag.quantizationLevel,
    contextWindow: finitePositive(contextWindow),
  }
}

function declaredCapability(
  declared: string[],
  hasDeclaration: boolean,
  accepted: string[],
): LocalModelCapability {
  if (!hasDeclaration) return { state: "unknown", source: "unknown", evidence: null }
  const match = declared.find((capability) => accepted.includes(capability))
  return match
    ? { state: "supported", source: "provider-declared", evidence: match }
    : { state: "unsupported", source: "provider-declared", evidence: "absent" }
}

function unknownCapabilities(): LocalModelCapabilities {
  const unknown = (): LocalModelCapability => ({
    state: "unknown",
    source: "unknown",
    evidence: null,
  })
  return { chat: unknown(), streaming: unknown(), tools: unknown(), vision: unknown() }
}

function capabilityLimitations(
  modelId: string,
  capabilities: LocalModelCapabilities,
): LocalModelLimitation[] {
  const definitions: Array<{
    capability: keyof LocalModelCapabilities
    code: LocalModelLimitation["code"]
    message: string
  }> = [
    {
      capability: "chat",
      code: "chat-unsupported",
      message: "Ollama did not declare chat support for this model.",
    },
    {
      capability: "streaming",
      code: "streaming-unsupported",
      message: "Ollama did not declare streaming support for this model.",
    },
    {
      capability: "tools",
      code: "tools-unsupported",
      message: "Ollama did not declare tool support for this model.",
    },
    {
      capability: "vision",
      code: "vision-unsupported",
      message: "Ollama did not declare vision support for this model.",
    },
  ]
  return definitions.flatMap(({ capability, code, message }) =>
    capabilities[capability].state === "supported" ? [] : [{ code, message, modelId }],
  )
}

async function requestJson(
  fetchImpl: typeof fetch,
  config: OllamaEndpointConfig,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)
  try {
    const response = await fetchImpl(new URL(path, `${config.baseUrl}/`), {
      ...init,
      signal: controller.signal,
    })
    if (!response.ok) throw new ProbeFailure("endpoint", response.status)
    try {
      return (await response.json()) as unknown
    } catch {
      throw new ProbeFailure("invalid")
    }
  } catch (error) {
    if (error instanceof ProbeFailure) throw error
    if (controller.signal.aborted) throw new ProbeFailure("timeout")
    throw new ProbeFailure("unavailable")
  } finally {
    clearTimeout(timeout)
  }
}

function failureSnapshot(
  provider: LocalModelProviderIdentity,
  capturedAt: string,
  expiresAt: string,
  failure: ProbeFailure,
): LocalModelCatalogSnapshot {
  const limitation = failureLimitation(failure)
  return {
    schemaVersion: LOCAL_MODEL_CATALOG_CACHE_VERSION,
    provider,
    state: failure.kind === "unavailable" ? "unavailable" : "error",
    capturedAt,
    expiresAt,
    models: [],
    limitations: [limitation],
  }
}

function failureLimitation(failure: ProbeFailure): LocalModelLimitation {
  if (failure.kind === "unavailable") {
    return {
      code: "provider-unavailable",
      message: "Ollama is not reachable on the configured loopback endpoint.",
    }
  }
  if (failure.kind === "timeout") {
    return { code: "provider-timeout", message: "The Ollama catalog request timed out." }
  }
  if (failure.kind === "invalid") {
    return {
      code: "provider-response-invalid",
      message: "Ollama returned an invalid catalog response.",
    }
  }
  return {
    code: "provider-endpoint-error",
    message: "The Ollama catalog endpoint returned an error.",
    ...(failure.status === undefined ? {} : { status: failure.status }),
  }
}

function asProbeFailure(error: unknown): ProbeFailure {
  return error instanceof ProbeFailure ? error : new ProbeFailure("unavailable")
}

function isCatalogSnapshot(value: unknown): value is LocalModelCatalogSnapshot {
  if (!isRecord(value) || value.schemaVersion !== LOCAL_MODEL_CATALOG_CACHE_VERSION) return false
  if (!isRecord(value.provider)) return false
  if (
    value.provider.harness !== "local" ||
    value.provider.provider !== "ollama" ||
    typeof value.provider.endpoint !== "string" ||
    !(typeof value.provider.version === "string" || value.provider.version === null)
  ) {
    return false
  }
  if (!(["ready", "empty", "stale", "unavailable", "error"] as unknown[]).includes(value.state)) {
    return false
  }
  if (
    typeof value.capturedAt !== "string" ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.capturedAt)) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    !Array.isArray(value.models) ||
    !Array.isArray(value.limitations)
  ) {
    return false
  }
  return value.models.every(isCatalogEntry) && value.limitations.every(isLimitation)
}

function isCatalogEntry(value: unknown): value is LocalModelCatalogEntry {
  if (!isRecord(value) || !isRecord(value.identity) || !isRecord(value.capabilities)) return false
  const identity = value.identity
  const capabilities = value.capabilities
  if (
    identity.provider !== "ollama" ||
    typeof identity.modelId !== "string" ||
    !["digest", "modifiedAt", "family", "parameterSize", "quantizationLevel"].every(
      (key) => typeof identity[key] === "string" || identity[key] === null,
    ) ||
    !(
      identity.contextWindow === null ||
      (typeof identity.contextWindow === "number" && identity.contextWindow > 0)
    )
  )
    return false
  if (!Array.isArray(value.limitations) || !value.limitations.every(isLimitation)) return false
  return ["chat", "streaming", "tools", "vision"].every((key) => isCapability(capabilities[key]))
}

function isCapability(value: unknown): value is LocalModelCapability {
  if (!isRecord(value)) return false
  return (
    ["supported", "unsupported", "unknown"].includes(String(value.state)) &&
    ["provider-declared", "provider-contract", "unknown"].includes(String(value.source)) &&
    (typeof value.evidence === "string" || value.evidence === null)
  )
}

function isLimitation(value: unknown): value is LocalModelLimitation {
  return (
    isRecord(value) &&
    LOCAL_MODEL_LIMITATION_CODES.includes(value.code as LocalModelLimitation["code"]) &&
    typeof value.message === "string" &&
    (value.modelId === undefined || typeof value.modelId === "string") &&
    (value.status === undefined || typeof value.status === "number")
  )
}

function appendLimitation(
  limitations: LocalModelLimitation[],
  limitation: LocalModelLimitation,
): LocalModelLimitation[] {
  return limitations.some((entry) => entry.code === limitation.code)
    ? limitations
    : [...limitations, limitation]
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim().toLowerCase())
            .filter(Boolean),
        ),
      ]
    : []
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

function boundedPositive(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Value must be between ${min} and ${max}`)
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
