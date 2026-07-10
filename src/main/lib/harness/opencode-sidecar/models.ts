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
  return readModelCache()[provider] ?? null
}

export function getAvailableProviderModels(provider: OpencodeProviderId): {
  models: OpencodeModelInfo[]
  source: "cache" | "seed"
  updatedAt?: number
} {
  const cached = getCachedProviderModels(provider)
  if (cached) return { models: cached.models, source: "cache", updatedAt: cached.updatedAt }
  return { models: OPENCODE_SEED_MODELS[provider], source: "seed" }
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

  const models = parseProviderModels(await response.json())
  if (models.length === 0) {
    throw new Error("Model refresh returned no usable models")
  }

  const entry: CachedProviderModels = { provider, models, updatedAt: Date.now() }
  const cache = readModelCache()
  cache[provider] = entry
  writeModelCache(cache)
  return { ...entry, source: "live" }
}

function getModelsEndpoint(provider: OpencodeProviderId): string {
  const definition = getProviderDefinition(provider)
  const baseUrl =
    (definition.allowsCustomBaseUrl && getProviderBaseUrl(provider)) || definition.baseUrl
  return `${baseUrl.replace(/\/$/, "")}/models`
}

function parseProviderModels(payload: unknown): OpencodeModelInfo[] {
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
    const supportsReasoning =
      value.reasoning === true ||
      value.supports_reasoning === true ||
      value.supportsReasoning === true
    models.push({
      id,
      label: name,
      ...(contextWindow ? { contextWindow } : {}),
      ...(supportsReasoning ? { supportsReasoning: true } : {}),
    })
  }

  return models.sort((a, b) => a.label.localeCompare(b.label))
}

function readModelCache(): ModelCacheFile {
  const path = getModelCachePath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ModelCacheFile
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
