// Stage 2 Track B — U8: OpenRouter usage provider.
//
// Blocked on harness-engine E3 for run-usage capture. Reconciliation surfaces:
//   generation stats:   https://openrouter.ai/docs/api-reference/authentication/get-a-generation
//   key credits/limits: https://openrouter.ai/docs/api-reference/limits
//   usage accounting:   https://openrouter.ai/docs/use-cases/usage-accounting
//
// Flapstack stores an OpenRouter generation id for every OpenRouter run so exact
// cost can be reconciled later. When exact cost is absent, cost is estimated from
// normalized token counts + model pricing and tagged "estimated".
//
// The key endpoint supplies current credit/limit state. E6 calls the exported
// run-sample helper for exact per-generation usage after sidecar runs.

import { estimateCostUsd } from "../pricing"
import { getProviderJson } from "./http"
import {
  UsageProviderError,
  type ProviderStatus,
  type UsageProvider,
  type UsageProviderContext,
  type UsageSampleInput,
} from "../types"

const SECRET_KEY = "openrouter.api_key"

/** Build an estimated OpenRouter run sample from tokens when exact cost is
 * missing. Returns null when pricing is unknown (never a $0 sample). Called by
 * the E6 run-usage hook once run tokens are available. */
export function buildEstimatedOpenRouterSample(params: {
  model: string
  generationId?: string
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  source: UsageSampleInput["source"]
}): UsageSampleInput | null {
  const estimated = estimateCostUsd("openrouter", params.model, params)
  if (estimated == null) return null
  return {
    providerId: "openrouter",
    source: params.source,
    costQuality: "estimated",
    model: params.model,
    generationId: params.generationId ?? null,
    inputTokens: params.inputTokens ?? null,
    outputTokens: params.outputTokens ?? null,
    reasoningTokens: params.reasoningTokens ?? null,
    costUsdEstimated: estimated,
    // Generation id is the natural dedupe key when present.
    dedupeKey: params.generationId ? `openrouter|gen|${params.generationId}` : undefined,
  }
}

export function createOpenRouterProvider(): UsageProvider {
  return {
    id: "openrouter",
    label: "OpenRouter",
    billingKind: "api-spend",

    async isConfigured(ctx) {
      return (await ctx.getSecret(SECRET_KEY)) != null
    },

    async getStatus(ctx): Promise<ProviderStatus> {
      const configured = (await ctx.getSecret(SECRET_KEY)) != null
      return {
        providerId: "openrouter",
        // OpenRouter cannot expose full account-wide history for a key — label it
        // run-usage + balance rather than complete account history.
        status: configured ? "ok" : "not-configured",
        detail: configured
          ? "Key balance/credit usage is available. Historical account activity is limited to Flapstack run generation IDs."
          : "Add an OpenRouter API key.",
        configured,
        supportsDaemon: true,
        supportsHistorical: false,
      }
    },

    async pollLatest(ctx: UsageProviderContext): Promise<UsageSampleInput[]> {
      const apiKey = await ctx.getSecret(SECRET_KEY)
      if (!apiKey) return []
      const payload = await getProviderJson<OpenRouterKeyResponse>({
        providerId: "openrouter",
        url: "https://openrouter.ai/api/v1/key",
        apiKey,
      })
      const key = payload.data
      if (!key)
        throw new UsageProviderError(
          "openrouter",
          "source-unavailable",
          "OpenRouter key response omitted data",
        )
      const limit = numberOrNull(key.limit)
      const used = usageForResetWindow(key)
      const remaining = numberOrNull(key.limit_remaining)
      const totalLimit = limit ?? (used != null && remaining != null ? used + remaining : null)
      return [
        {
          providerId: "openrouter",
          source: ctx.source,
          sourceTag: "key-limits",
          costQuality: "provider-reported",
          capturedAt: ctx.now,
          accountTag: key.label ?? null,
          costUsd: used,
          quotaUsed: used == null ? null : Math.round(used * 1_000_000),
          quotaLimit: totalLimit == null ? null : Math.round(totalLimit * 1_000_000),
          percentUsed: totalLimit && used != null ? Math.round((used / totalLimit) * 100) : null,
          rawPayload: payload,
          dedupeKey: `openrouter|key|${key.label ?? "default"}|${ctx.now.toISOString().slice(0, 13)}`,
        },
      ]
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

interface OpenRouterKeyResponse {
  data?: {
    label?: string
    limit?: number | string | null
    limit_remaining?: number | string | null
    usage?: number | string | null
    usage_monthly?: number | string | null
    usage_daily?: number | string | null
    usage_weekly?: number | string | null
    limit_reset?: "daily" | "weekly" | "monthly" | null
  }
}
function usageForResetWindow(key: NonNullable<OpenRouterKeyResponse["data"]>): number | null {
  if (key.limit_reset === "daily") return numberOrNull(key.usage_daily ?? key.usage)
  if (key.limit_reset === "weekly") return numberOrNull(key.usage_weekly ?? key.usage)
  if (key.limit_reset === "monthly") return numberOrNull(key.usage_monthly ?? key.usage)
  return numberOrNull(key.usage ?? key.usage_monthly)
}
function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(number) ? number : null
}
