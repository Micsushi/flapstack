// Stage 2 Track B - model pricing cache used to estimate cost when a provider
// does not return an exact figure (OpenRouter U8, NanoGPT U9). Estimates derived
// here are always tagged costQuality: "estimated" by the caller.
//
// Provider adapters refresh this process-local cache from their /models endpoints.
// A zero-price wildcard remains only as an honest "pricing unknown" sentinel.

import type { UsageProviderId } from "./types"

/** Per-million-token prices in USD. reasoning defaults to output price. */
export interface ModelPricing {
  providerId: UsageProviderId
  model: string
  inputPerMTok: number
  outputPerMTok: number
  reasoningPerMTok?: number
}

export interface TokenCounts {
  inputTokens?: number | null
  outputTokens?: number | null
  reasoningTokens?: number | null
}

// Seed table only. Replaced/augmented by live provider model metadata in U8/U9.
const SEED_PRICING: ModelPricing[] = [
  // OpenRouter and NanoGPT proxy many models; these are placeholders.
  { providerId: "openrouter", model: "*", inputPerMTok: 0, outputPerMTok: 0 },
  { providerId: "nanogpt", model: "*", inputPerMTok: 0, outputPerMTok: 0 },
]

const cache = new Map<string, ModelPricing>()
for (const p of SEED_PRICING) cache.set(cacheKey(p.providerId, p.model), p)

function cacheKey(providerId: UsageProviderId, model: string): string {
  return `${providerId}:${model}`
}

/** Look up pricing, falling back to a provider wildcard entry. Returns null when
 * no pricing is known (caller must then leave cost as unknown, not zero). */
export function getModelPricing(
  providerId: UsageProviderId,
  model: string | null | undefined,
): ModelPricing | null {
  if (model) {
    const exact = cache.get(cacheKey(providerId, model))
    if (exact) return exact
    // OpenCode addresses models as `providerID/modelID`, while provider model
    // catalogs return the native model id. Accept both without changing the
    // model string persisted on the run.
    const providerPrefix = `${providerId}/`
    if (model.startsWith(providerPrefix)) {
      const native = cache.get(cacheKey(providerId, model.slice(providerPrefix.length)))
      if (native) return native
    }
  }
  return cache.get(cacheKey(providerId, "*")) ?? null
}

/** Store/refresh pricing pulled from a provider's models endpoint (U8/U9). */
export function upsertModelPricing(pricing: ModelPricing): void {
  cache.set(cacheKey(pricing.providerId, pricing.model), pricing)
}

/**
 * Estimate USD cost from token counts + pricing. Returns null when pricing is
 * unknown or a wildcard zero-price placeholder - callers must not treat null as
 * $0 usage. Reasoning tokens are priced separately because they can materially
 * change NanoGPT/OpenRouter output cost.
 */
export function estimateCostUsd(
  providerId: UsageProviderId,
  model: string | null | undefined,
  tokens: TokenCounts,
): number | null {
  const pricing = getModelPricing(providerId, model)
  if (!pricing) return null
  if (pricing.model === "*" && pricing.inputPerMTok === 0 && pricing.outputPerMTok === 0) {
    // Placeholder wildcard - no real pricing loaded yet.
    return null
  }
  const input = ((tokens.inputTokens ?? 0) / 1_000_000) * pricing.inputPerMTok
  const output = ((tokens.outputTokens ?? 0) / 1_000_000) * pricing.outputPerMTok
  const reasoning =
    ((tokens.reasoningTokens ?? 0) / 1_000_000) *
    (pricing.reasoningPerMTok ?? pricing.outputPerMTok)
  return input + output + reasoning
}
