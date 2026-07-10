import { getProviderJson, startOfUtcDay } from "./http"
import type {
  ProviderStatus,
  UsageProvider,
  UsageProviderContext,
  UsageSampleInput,
} from "../types"

const SECRET_KEY = "openai.api_key"
const COSTS_URL = "https://api.openai.com/v1/organization/costs"
const USAGE_URL = "https://api.openai.com/v1/organization/usage/completions"

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
          ? "OpenAI organization usage and cost reports are collected with the configured admin key."
          : "Add an OpenAI Admin API key with usage/cost access.",
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
  const apiKey = await ctx.getSecret(SECRET_KEY)
  if (!apiKey) return []
  const buckets = await fetchOpenAiPages<OpenAiCostBucket>(ctx, apiKey, COSTS_URL, start)
  return buckets.flatMap((bucket) => {
    if (!bucket.results?.length) return []
    const cost = bucket.results.reduce((sum, result) => sum + numberOrZero(result.amount?.value), 0)
    return [
      {
        providerId: "codex" as const,
        source: ctx.source,
        sourceTag: "organization-cost",
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

async function collectUsage(ctx: UsageProviderContext, start: Date): Promise<UsageSampleInput[]> {
  const apiKey = await ctx.getSecret(SECRET_KEY)
  if (!apiKey) return []
  const buckets = await fetchOpenAiPages<OpenAiUsageBucket>(ctx, apiKey, USAGE_URL, start)
  return buckets.flatMap((bucket) => {
    if (!bucket.results?.length) return []
    const inputTokens = sum(bucket.results, "input_tokens")
    const outputTokens = sum(bucket.results, "output_tokens")
    return [
      {
        providerId: "codex" as const,
        source: ctx.source,
        sourceTag: "organization-usage",
        costQuality: "unknown" as const,
        capturedAt: ctx.now,
        windowStart: unixDate(bucket.start_time),
        windowEnd: unixDate(bucket.end_time),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        requestCount: sum(bucket.results, "num_model_requests"),
        rawPayload: bucket,
        dedupeKey: `codex|usage|${bucket.start_time ?? start.toISOString().slice(0, 10)}`,
      },
    ]
  })
}

async function fetchOpenAiPages<T>(
  ctx: UsageProviderContext,
  apiKey: string,
  endpoint: string,
  start: Date,
): Promise<T[]> {
  const rows: T[] = []
  let page: string | null = null
  do {
    const url = new URL(endpoint)
    url.searchParams.set("start_time", String(Math.floor(start.getTime() / 1000)))
    url.searchParams.set("end_time", String(Math.floor((ctx.now.getTime() + 1_000) / 1000)))
    url.searchParams.set("bucket_width", "1d")
    url.searchParams.set("limit", "31")
    if (page) url.searchParams.set("page", page)
    const payload = await getProviderJson<OpenAiPage<T>>({
      providerId: "codex",
      url: url.toString(),
      apiKey,
    })
    rows.push(...(payload.data ?? []))
    page = payload.next_page ?? null
  } while (page)
  return rows
}

interface OpenAiPage<T> {
  data?: T[]
  next_page?: string | null
}
interface OpenAiCostBucket {
  start_time?: number
  end_time?: number
  results?: Array<{ amount?: { value?: number | string | null } }>
}
interface OpenAiUsageBucket {
  start_time?: number
  end_time?: number
  results?: Array<{
    input_tokens?: number
    output_tokens?: number
    num_model_requests?: number
  }>
}
function sum<T extends Record<string, unknown>>(rows: T[], key: keyof T): number {
  return rows.reduce((total, row) => total + numberOrZero(row[key]), 0)
}
function numberOrZero(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(number) ? number : 0
}
function unixDate(value: unknown): Date | null {
  return typeof value === "number" && value > 0 ? new Date(value * 1000) : null
}
