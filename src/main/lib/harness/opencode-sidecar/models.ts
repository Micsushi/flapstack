/**
 * Local cache and refresh boundary for OpenCode-backed provider models (E7).
 *
 * A provider refresh is explicit. The renderer can still search the last known
 * list while offline, and never has to start an OpenCode sidecar just to choose
 * a model.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getProviderBaseUrl, getProviderKey, getOpencodeStorageDir } from "./credentials"
import { getProviderDefinition, OPENCODE_SEED_MODELS, type OpencodeModelInfo } from "./catalog"
import type { OpencodeProviderId } from "./contract"
import { upsertModelPricing } from "../../usage/pricing"

const cacheFileName = "opencode-provider-models.json"

export type CachedProviderModels = {
  provider: OpencodeProviderId
  models: OpencodeModelInfo[]
  updatedAt: number
}

type ModelCacheFile = Partial<Record<OpencodeProviderId, CachedProviderModels>>

export type ProviderModelRefreshResult = CachedProviderModels & {
  source: "live"
}

export function getCachedProviderModels(provider: OpencodeProviderId): CachedProviderModels | null {
  const cached = readModelCache()[provider]
  return isCachedProviderModels(provider, cached) ? cached : null
}

export function getAvailableProviderModels(provider: OpencodeProviderId): {
  models: OpencodeModelInfo[]
  source: "cache" | "seed"
  updatedAt?: number
} {
  const cached = getCachedProviderModels(provider)
  if (cached) {
    hydrateUsagePricing(provider, cached.models)
    return { models: cached.models, source: "cache", updatedAt: cached.updatedAt }
  }
  return { models: OPENCODE_SEED_MODELS[provider], source: "seed" }
}

/** Load persisted model prices into the process-local usage cache. */
export function hydrateCachedProviderPricing(provider: OpencodeProviderId): boolean {
  try {
    const cached = getCachedProviderModels(provider)
    if (!cached) return false
    hydrateUsagePricing(provider, cached.models)
    return true
  } catch {
    // Usage capture must still persist token-only data when the local catalog
    // is corrupt or from an incompatible older shape.
    return false
  }
}

export async function refreshProviderModels(
  provider: OpencodeProviderId,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderModelRefreshResult> {
  const key = getProviderKey(provider)
  if (!key) throw new Error(`No API key configured for ${getProviderDefinition(provider).label}`)

  const endpoint = getModelsEndpoint(provider)
  const response = await fetchImpl(endpoint, {
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json",
    },
  })
  if (!response.ok) {
    throw new Error(`Model refresh failed: HTTP ${response.status}`)
  }

  const models = parseProviderModels(provider, await response.json())
  if (models.length === 0) {
    throw new Error("Model refresh returned no usable models")
  }

  const entry: CachedProviderModels = { provider, models, updatedAt: Date.now() }
  hydrateUsagePricing(provider, models)
  const cache = readModelCache()
  cache[provider] = entry
  writeModelCache(cache)
  return { ...entry, source: "live" }
}

function getModelsEndpoint(provider: OpencodeProviderId): string {
  const definition = getProviderDefinition(provider)
  const baseUrl =
    (definition.allowsCustomBaseUrl && getProviderBaseUrl(provider)) || definition.baseUrl
  const endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/models`)
  if (provider === "nanogpt") endpoint.searchParams.set("detailed", "true")
  return endpoint.toString()
}

function parseProviderModels(provider: OpencodeProviderId, payload: unknown): OpencodeModelInfo[] {
  const raw =
    payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : []
  const seen = new Set<string>()
  const models: OpencodeModelInfo[] = []

  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const value = item as Record<string, unknown>
    const id = typeof value.id === "string" ? value.id.trim() : ""
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name =
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim()
        : typeof value.label === "string" && value.label.trim()
          ? value.label.trim()
          : id
    const contextWindow =
      typeof value.context_length === "number"
        ? value.context_length
        : typeof value.contextWindow === "number"
          ? value.contextWindow
          : undefined
    const supportedParameters = stringArray(
      value.supported_parameters ?? value.supportedParameters ?? value.capabilities,
    )
    const supportsReasoning =
      value.reasoning === true ||
      value.supports_reasoning === true ||
      value.supportsReasoning === true ||
      supportedParameters.some((parameter) =>
        ["reasoning", "include_reasoning", "reasoning_effort"].includes(parameter),
      )
    const supportsTools =
      value.supports_tools === true ||
      value.supportsTools === true ||
      supportedParameters.some((parameter) => ["tools", "tool_choice"].includes(parameter))
    const architecture =
      value.architecture && typeof value.architecture === "object"
        ? (value.architecture as Record<string, unknown>)
        : {}
    const inputModalities = stringArray(
      architecture.input_modalities ?? value.input_modalities ?? value.inputModalities,
    )
    const outputModalities = stringArray(
      architecture.output_modalities ?? value.output_modalities ?? value.outputModalities,
    )
    const pricing = normalizePricing(provider, value.pricing)
    models.push({
      id,
      label: name,
      ...(contextWindow ? { contextWindow } : {}),
      ...(supportsReasoning ? { supportsReasoning: true } : {}),
      ...(supportsTools ? { supportsTools: true } : {}),
      ...(supportedParameters.length ? { supportedParameters } : {}),
      ...(inputModalities.length ? { inputModalities } : {}),
      ...(outputModalities.length ? { outputModalities } : {}),
      ...(pricing ? { pricing } : {}),
    })
  }

  return models.sort((a, b) => a.label.localeCompare(b.label))
}

function normalizePricing(
  provider: OpencodeProviderId,
  value: unknown,
): OpencodeModelInfo["pricing"] | undefined {
  if (!value || typeof value !== "object") return undefined
  const raw = value as Record<string, unknown>
  const multiplier = provider === "openrouter" ? 1_000_000 : 1
  if (provider === "nanogpt" && raw.unit !== "per_million_tokens") return undefined
  const input = finiteNonNegative(raw.prompt)
  const output = finiteNonNegative(raw.completion)
  if (input == null || output == null) return undefined
  const reasoning = finiteNonNegative(raw.internal_reasoning)
  return {
    inputPerMTok: input * multiplier,
    outputPerMTok: output * multiplier,
    ...(reasoning == null ? {} : { reasoningPerMTok: reasoning * multiplier }),
  }
}

function finiteNonNegative(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.filter((item): item is string => typeof item === "string"))]
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, enabled]) =>
      enabled === true ? [key] : [],
    )
  }
  return []
}

function hydrateUsagePricing(provider: OpencodeProviderId, models: OpencodeModelInfo[]): void {
  for (const model of models) {
    if (!model.pricing) continue
    upsertModelPricing({ providerId: provider, model: model.id, ...model.pricing })
  }
}

function isCachedProviderModels(
  provider: OpencodeProviderId,
  value: unknown,
): value is CachedProviderModels {
  if (!value || typeof value !== "object") return false
  const cached = value as Partial<CachedProviderModels>
  if (cached.provider !== provider || !Number.isFinite(cached.updatedAt)) return false
  if (!Array.isArray(cached.models)) return false
  return cached.models.every((model) => {
    if (!model || typeof model !== "object") return false
    if (typeof model.id !== "string" || typeof model.label !== "string") return false
    if (model.supportsReasoning !== undefined && typeof model.supportsReasoning !== "boolean")
      return false
    if (model.supportsTools !== undefined && typeof model.supportsTools !== "boolean") return false
    for (const value of [
      model.supportedParameters,
      model.inputModalities,
      model.outputModalities,
    ]) {
      if (
        value !== undefined &&
        (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
      )
        return false
    }
    if (model.pricing === undefined) return true
    return (
      model.pricing !== null &&
      typeof model.pricing === "object" &&
      Number.isFinite(model.pricing.inputPerMTok) &&
      Number.isFinite(model.pricing.outputPerMTok) &&
      (model.pricing.reasoningPerMTok === undefined ||
        Number.isFinite(model.pricing.reasoningPerMTok))
    )
  })
}

function readModelCache(): ModelCacheFile {
  const path = getModelCachePath()
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ModelCacheFile)
      : {}
  } catch {
    return {}
  }
}

function writeModelCache(cache: ModelCacheFile): void {
  const path = getModelCachePath()
  mkdirSync(getOpencodeStorageDir(), { recursive: true })
  writeFileSync(path, JSON.stringify(cache, null, 2), { mode: 0o600 })
}

function getModelCachePath(): string {
  return join(getOpencodeStorageDir(), cacheFileName)
}
