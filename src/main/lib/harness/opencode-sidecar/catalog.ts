/**
 * OpenRouter + NanoGPT provider/model catalog for the OpenCode sidecar
 * (Track E - E1/E3, catalog side).
 *
 * Scaffolding stage: ships static provider definitions and a small seed model
 * list so the UI can render selectors before any live `GET /api/v1/models`
 * refresh exists. Live model refresh (E3/E7) will replace `seedModels` with a
 * cached provider fetch; the shape here is the cache contract.
 */

import type { OpencodeProviderId } from "./contract"
import { DEFAULT_OPENCODE_MODELS } from "../../../../shared/model-catalog"

export type OpencodeProviderChip = "purple" | "rose"

export type OpencodeProviderDefinition = {
  id: OpencodeProviderId
  label: string
  /** OpenCode provider id used in `providerID/modelID`. */
  opencodeProviderId: string
  baseUrl: string
  /** Allow the user to override the base URL (NanoGPT self-host, proxies). */
  allowsCustomBaseUrl: boolean
  chip: OpencodeProviderChip
  /** Provider docs surface for onboarding help text. */
  docsUrl: string
  /** Endpoint used to refresh the live model catalog (E7). */
  modelsEndpoint: string
}

export const OPENCODE_PROVIDERS: Record<OpencodeProviderId, OpencodeProviderDefinition> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    opencodeProviderId: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    allowsCustomBaseUrl: false,
    chip: "purple",
    docsUrl: "https://openrouter.ai/docs",
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
  },
  nanogpt: {
    id: "nanogpt",
    label: "NanoGPT",
    // NanoGPT rides OpenCode's generic OpenAI-compatible provider support.
    opencodeProviderId: "nanogpt",
    baseUrl: "https://nano-gpt.com/api/v1",
    allowsCustomBaseUrl: true,
    chip: "rose",
    docsUrl: "https://docs.nano-gpt.com",
    modelsEndpoint: "https://nano-gpt.com/api/v1/models",
  },
}

export type OpencodeModelInfo = {
  /** Provider-native model id, e.g. `anthropic/claude-opus-4-8`. */
  id: string
  label: string
  /** Whether the model is known to expose visible reasoning output. */
  supportsReasoning?: boolean
  /** Whether provider metadata explicitly reports tool/function calling. */
  supportsTools?: boolean
  supportedParameters?: string[]
  inputModalities?: string[]
  outputModalities?: string[]
  contextWindow?: number
  /** Normalized USD per million tokens; safe to persist with catalog metadata. */
  pricing?: {
    inputPerMTok: number
    outputPerMTok: number
    reasoningPerMTok?: number
  }
}

/**
 * Minimal seed lists so selectors render before a live refresh. Kept short and
 * conservative on purpose - the authoritative list comes from the provider's
 * models endpoint at refresh time (E7).
 */
export const OPENCODE_SEED_MODELS: Record<OpencodeProviderId, OpencodeModelInfo[]> = {
  openrouter: DEFAULT_OPENCODE_MODELS.openrouter.map((model) => ({
    id: model.id.replace(/^openrouter\//, ""),
    label: model.name,
    supportsReasoning: true,
    supportsTools: true,
  })),
  nanogpt: DEFAULT_OPENCODE_MODELS.nanogpt.map((model) => ({
    id: model.id.replace(/^nanogpt\//, ""),
    label: model.name,
    supportsReasoning: true,
    supportsTools: true,
  })),
}

/**
 * Build the OpenCode `providerID/modelID` string for a Flapstack provider +
 * provider-native model id.
 */
export function toOpencodeModelString(provider: OpencodeProviderId, modelId: string): string {
  return `${OPENCODE_PROVIDERS[provider].opencodeProviderId}/${modelId}`
}

/** Split an OpenCode model string back into provider + model id. */
export function parseOpencodeModelString(model: string): { providerId: string; modelId: string } {
  const slash = model.indexOf("/")
  if (slash === -1) {
    return { providerId: model, modelId: "" }
  }
  return { providerId: model.slice(0, slash), modelId: model.slice(slash + 1) }
}

export function getProviderDefinition(provider: OpencodeProviderId): OpencodeProviderDefinition {
  return OPENCODE_PROVIDERS[provider]
}
