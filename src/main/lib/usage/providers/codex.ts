import { getProviderJson, startOfUtcDay } from "./http"
import {
  type ProviderStatus,
  type UsageProvider,
  type UsageProviderContext,
  type UsageSampleInput,
} from "../types"

const SECRET_KEY = "openai.api_key"
const COSTS_URL = "https://api.openai.com/v1/organization/costs"

export function createCodexProvider(): UsageProvider {
  return {
    id: "codex",
    label: "Codex / OpenAI",
    billingKind: "api-spend",
    async isConfigured(ctx) {
      return (await ctx.getSecret(SECRET_KEY)) != null
    },
    async getStatus(ctx): Promise<ProviderStatus> {
      const configured = (await ctx.getSecret(SECRET_KEY)) != null
      return {
        providerId: "codex",
        status: configured ? "ok" : "not-configured",
        detail: configured
          ? "OpenAI organization cost reports are collected with the configured admin key."
          : "Add an OpenAI Admin API key with usage/cost access.",
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
  const apiKey = await ctx.getSecret(SECRET_KEY)
  if (!apiKey) return []
  const end = new Date(ctx.now.getTime() + 1_000)
  const url = new URL(COSTS_URL)
  url.searchParams.set("start_time", String(Math.floor(start.getTime() / 1000)))
  url.searchParams.set("end_time", String(Math.floor(end.getTime() / 1000)))
  url.searchParams.set("bucket_width", "1d")
  const payload = await getProviderJson<OpenAiCostsResponse>({
    providerId: "codex",
    url: url.toString(),
    apiKey,
  })
  return (payload.data ?? []).flatMap((bucket) => {
    const cost =
      bucket.results?.reduce((sum, result) => sum + numberOrZero(result.amount?.value), 0) ?? 0
    if (!bucket.results?.length) return []
    return [
      {
        providerId: "codex" as const,
        source: ctx.source,
        costQuality: "provider-reported" as const,
        capturedAt: ctx.now,
        windowStart: unixDate(bucket.start_time),
        windowEnd: unixDate(bucket.end_time),
        costUsd: cost,
        rawPayload: bucket,
        dedupeKey: `codex|cost|${bucket.start_time ?? start.toISOString().slice(0, 10)}`,
      },
    ]
  })
}
interface OpenAiCostsResponse {
  data?: Array<{
    start_time?: number
    end_time?: number
    results?: Array<{ amount?: { value?: number | string | null } }>
  }>
}
function numberOrZero(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(n) ? n : 0
}
function unixDate(value: unknown): Date | null {
  return typeof value === "number" && value > 0 ? new Date(value * 1000) : null
}
