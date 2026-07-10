import { getProviderJson, iso, startOfUtcDay } from "./http"
import {
  type ProviderStatus,
  type UsageProvider,
  type UsageProviderContext,
  type UsageSampleInput,
} from "../types"

const ADMIN_KEY = "anthropic.admin_key"
const COSTS_URL = "https://api.anthropic.com/v1/organizations/cost_report"
const VERSION = "2023-06-01"

export function createAnthropicProvider(): UsageProvider {
  return {
    id: "anthropic",
    label: "Claude / Anthropic",
    billingKind: "api-spend",
    async isConfigured(ctx) {
      return (await ctx.getSecret(ADMIN_KEY)) != null
    },
    async getStatus(ctx): Promise<ProviderStatus> {
      const configured = (await ctx.getSecret(ADMIN_KEY)) != null
      return {
        providerId: "anthropic",
        status: configured ? "ok" : "not-configured",
        detail: configured
          ? "Anthropic organization cost reports are collected with the configured Admin API key."
          : "Add an Anthropic Admin API key for workspace usage and cost.",
        configured,
        supportsDaemon: true,
        supportsHistorical: true,
      }
    },
    async pollLatest(ctx) {
      return collectCosts(ctx, startOfUtcDay(ctx.now))
    },
    async reconcileSince(ctx, since) {
      return collectCosts(ctx, since ?? new Date(ctx.now.getTime() - 30 * 86_400_000))
    },
    supportsDaemon: () => true,
    supportsHistorical: () => true,
  }
}

async function collectCosts(ctx: UsageProviderContext, start: Date): Promise<UsageSampleInput[]> {
  const apiKey = await ctx.getSecret(ADMIN_KEY)
  if (!apiKey) return []
  const url = new URL(COSTS_URL)
  url.searchParams.set("starting_at", iso(start))
  url.searchParams.set("ending_at", iso(ctx.now))
  url.searchParams.set("bucket_width", "1d")
  const payload = await getProviderJson<AnthropicCostResponse>({
    providerId: "anthropic",
    url: url.toString(),
    apiKey,
    headers: { "anthropic-version": VERSION },
  })
  return (payload.data ?? []).flatMap((bucket) => {
    const cost = (bucket.results ?? []).reduce(
      (sum, result) => sum + numberOrZero(result.amount?.value ?? result.cost_usd),
      0,
    )
    if (!bucket.results?.length) return []
    return [
      {
        providerId: "anthropic" as const,
        source: ctx.source,
        costQuality: "provider-reported" as const,
        capturedAt: ctx.now,
        windowStart: dateOrNull(bucket.starting_at),
        windowEnd: dateOrNull(bucket.ending_at),
        costUsd: cost,
        rawPayload: bucket,
        dedupeKey: `anthropic|cost|${bucket.starting_at ?? start.toISOString().slice(0, 10)}`,
      },
    ]
  })
}
interface AnthropicCostResponse {
  data?: Array<{
    starting_at?: string
    ending_at?: string
    results?: Array<{
      amount?: { value?: number | string | null }
      cost_usd?: number | string | null
    }>
  }>
}
function numberOrZero(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) ? n : 0
}
function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
