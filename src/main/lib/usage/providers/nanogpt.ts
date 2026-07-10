// Stage 2 Track B — U9: NanoGPT usage provider.
//
// Blocked on harness-engine E4 for run-usage capture. Docs:
//   chat completion: https://docs.nano-gpt.com/api-reference/endpoint/chat-completion
//   models:          https://docs.nano-gpt.com/api-reference/endpoint/models
//
// Implementation-time research must verify whether NanoGPT exposes account-wide
// historical usage or balance APIs. If not, Stage 2 labels NanoGPT as
// "run-usage only" plus estimates. Reasoning tokens can materially change output
// cost, so they are preserved and priced separately. Do NOT implement NanoGPT
// x402/accountless payment or image/video usage in Stage 2.
//
// The model endpoint refreshes live pricing. NanoGPT does not document an
// account-wide usage/balance endpoint, so E6 records completed run usage here.

import { estimateCostUsd } from "../pricing"
import { getProviderJson } from "./http"
import { upsertModelPricing } from "../pricing"
import {
  type ProviderStatus,
  type UsageProvider,
  type UsageProviderContext,
  type UsageSampleInput,
} from "../types"

const SECRET_KEY = "nanogpt.api_key"

/** Build an estimated NanoGPT run sample from tokens when exact cost is missing.
 * Returns null when pricing is unknown. Called by the E6 run-usage hook. */
export function buildEstimatedNanoGptSample(params: {
  model: string
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  source: UsageSampleInput["source"]
}): UsageSampleInput | null {
  const estimated = estimateCostUsd("nanogpt", params.model, params)
  if (estimated == null) return null
  return {
    providerId: "nanogpt",
    source: params.source,
    costQuality: "estimated",
    model: params.model,
    inputTokens: params.inputTokens ?? null,
    outputTokens: params.outputTokens ?? null,
    reasoningTokens: params.reasoningTokens ?? null,
    costUsdEstimated: estimated,
  }
}

export function createNanoGptProvider(): UsageProvider {
  return {
    id: "nanogpt",
    label: "NanoGPT",
    billingKind: "api-spend",

    async isConfigured(ctx) {
      return (await ctx.getSecret(SECRET_KEY)) != null
    },

    async getStatus(ctx): Promise<ProviderStatus> {
      const configured = (await ctx.getSecret(SECRET_KEY)) != null
      return {
        providerId: "nanogpt",
        status: configured ? "run-usage-only" : "not-configured",
        detail: configured
          ? "NanoGPT run usage and estimates are available after Track E run capture; NanoGPT exposes no documented account-wide history."
          : "Add a NanoGPT API key.",
        configured,
        supportsDaemon: true,
        // Unknown until API research; scaffold assumes no history.
        supportsHistorical: false,
      }
    },

    async pollLatest(ctx: UsageProviderContext): Promise<UsageSampleInput[]> {
      const apiKey = await ctx.getSecret(SECRET_KEY)
      if (!apiKey) return []
      const payload = await getProviderJson<NanoGptModelsResponse>({
        providerId: "nanogpt",
        url: "https://nano-gpt.com/api/v1/models?detailed=true",
        apiKey,
      })
      for (const model of payload.data ?? []) {
        const input = pricePerMillion(model.pricing?.prompt)
        const output = pricePerMillion(model.pricing?.completion)
        if (input != null && output != null)
          upsertModelPricing({
            providerId: "nanogpt",
            model: model.id,
            inputPerMTok: input,
            outputPerMTok: output,
            reasoningPerMTok: pricePerMillion(model.pricing?.internal_reasoning) ?? undefined,
          })
      }
      // NanoGPT documents no account-wide usage/balance surface. This request only refreshes pricing.
      return []
    },

    async reconcileSince(
      ctx: UsageProviderContext,
      _since: Date | null,
    ): Promise<UsageSampleInput[]> {
      return this.pollLatest(ctx)
    },

    supportsDaemon: () => true,
    supportsHistorical: () => false,
  }
}

interface NanoGptModelsResponse {
  data?: Array<{
    id: string
    pricing?: {
      prompt?: string | number
      completion?: string | number
      internal_reasoning?: string | number
    }
  }>
}
function pricePerMillion(value: unknown): number | null {
  const perMillion =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(perMillion) ? perMillion : null
}
