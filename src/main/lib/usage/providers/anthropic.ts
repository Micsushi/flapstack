import { getProviderJson, iso, startOfUtcDay } from "./http"
import type {
  ProviderStatus,
  UsageProvider,
  UsageProviderContext,
  UsageSampleInput,
} from "../types"

const ADMIN_KEY = "anthropic.admin_key"
const COSTS_URL = "https://api.anthropic.com/v1/organizations/cost_report"
const USAGE_URL = "https://api.anthropic.com/v1/organizations/usage_report/messages"
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
          ? "Anthropic organization usage and cost reports are collected with the configured Admin API key."
          : "Add an Anthropic Admin API key for workspace usage and cost.",
        configured,
        supportsDaemon: true,
        supportsHistorical: true,
      }
    },
    async pollLatest(ctx) {
      return collectReports(ctx, startOfUtcDay(ctx.now))
    },
    async reconcileSince(ctx, since) {
      return collectReports(ctx, since ?? new Date(ctx.now.getTime() - 30 * 86_400_000))
    },
    supportsDaemon: () => true,
    supportsHistorical: () => true,
  }
}

async function collectReports(ctx: UsageProviderContext, start: Date): Promise<UsageSampleInput[]> {
  const [costs, usage] = await Promise.all([collectCosts(ctx, start), collectUsage(ctx, start)])
  return [...costs, ...usage]
}

async function collectCosts(ctx: UsageProviderContext, start: Date): Promise<UsageSampleInput[]> {
  const buckets = await fetchAnthropicPages<AnthropicCostBucket>(ctx, COSTS_URL, start)
  return buckets.flatMap((bucket) => {
    if (!bucket.results?.length) return []
    // Anthropic reports fractional cents. Convert cents to USD before storage.
    const cost = bucket.results.reduce(
      (total, result) => total + centsToUsd(result.amount ?? result.cost_usd),
      0,
    )
    return [
      {
        providerId: "anthropic" as const,
        source: ctx.source,
        sourceTag: "organization-cost",
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

async function collectUsage(ctx: UsageProviderContext, start: Date): Promise<UsageSampleInput[]> {
  const buckets = await fetchAnthropicPages<AnthropicUsageBucket>(ctx, USAGE_URL, start)
  return buckets.flatMap((bucket) => {
    if (!bucket.results?.length) return []
    const inputTokens = bucket.results.reduce((total, result) => {
      const cacheCreation = result.cache_creation ?? {}
      return (
        total +
        numberOrZero(result.uncached_input_tokens) +
        numberOrZero(result.cache_read_input_tokens) +
        numberOrZero(cacheCreation.ephemeral_1h_input_tokens) +
        numberOrZero(cacheCreation.ephemeral_5m_input_tokens)
      )
    }, 0)
    const outputTokens = bucket.results.reduce(
      (total, result) => total + numberOrZero(result.output_tokens),
      0,
    )
    return [
      {
        providerId: "anthropic" as const,
        source: ctx.source,
        sourceTag: "organization-usage",
        costQuality: "unknown" as const,
        capturedAt: ctx.now,
        windowStart: dateOrNull(bucket.starting_at),
        windowEnd: dateOrNull(bucket.ending_at),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        rawPayload: bucket,
        dedupeKey: `anthropic|usage|${bucket.starting_at ?? start.toISOString().slice(0, 10)}`,
      },
    ]
  })
}

async function fetchAnthropicPages<T>(
  ctx: UsageProviderContext,
  endpoint: string,
  start: Date,
): Promise<T[]> {
  const apiKey = await ctx.getSecret(ADMIN_KEY)
  if (!apiKey) return []
  const rows: T[] = []
  let page: string | null = null
  do {
    const url = new URL(endpoint)
    url.searchParams.set("starting_at", iso(start))
    url.searchParams.set("ending_at", iso(ctx.now))
    url.searchParams.set("bucket_width", "1d")
    url.searchParams.set("limit", "31")
    if (page) url.searchParams.set("page", page)
    const payload = await getProviderJson<AnthropicPage<T>>({
      providerId: "anthropic",
      url: url.toString(),
      apiKey,
      auth: "x-api-key",
      headers: { "anthropic-version": VERSION },
    })
    rows.push(...(payload.data ?? []))
    page = payload.has_more ? (payload.next_page ?? null) : null
  } while (page)
  return rows
}

interface AnthropicPage<T> {
  data?: T[]
  has_more?: boolean
  next_page?: string | null
}
interface AnthropicCostBucket {
  starting_at?: string
  ending_at?: string
  results?: Array<{ amount?: number | string | null; cost_usd?: number | string | null }>
}
interface AnthropicUsageBucket {
  starting_at?: string
  ending_at?: string
  results?: Array<{
    uncached_input_tokens?: number
    cache_read_input_tokens?: number
    cache_creation?: {
      ephemeral_1h_input_tokens?: number
      ephemeral_5m_input_tokens?: number
    }
    output_tokens?: number
  }>
}
function centsToUsd(value: unknown): number {
  return numberOrZero(value) / 100
}
function numberOrZero(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(number) ? number : 0
}
function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
