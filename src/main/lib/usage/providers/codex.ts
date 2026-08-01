import { getProviderJsonResponse, startOfUtcDay } from "./http"
import { credentialAccountTag } from "../provider-identity"
import {
  getUsageSettings,
  invalidateOpenAiOrganizationBinding,
  setUsageSettings,
  type OpenAiValidatedOrganizationBinding,
} from "../settings"
import { UsageProviderError, type UsageSourceFailure } from "../types"
import type {
  ProviderStatus,
  UsageProvider,
  UsageProviderContext,
  UsageSampleInput,
} from "../types"
import { detectCodexPersonalCredentials, pollCodexPersonal } from "./codex-personal"

const SECRET_KEY = "openai.api_key"
const COSTS_URL = "https://api.openai.com/v1/organization/costs"
const USAGE_URL = "https://api.openai.com/v1/organization/usage/completions"
const MAX_PROVIDER_PAGES = 200

export function createCodexProvider(): UsageProvider {
  return {
    id: "codex",
    label: "Codex / OpenAI",
    billingKind: "api-spend",
    async isConfigured(ctx) {
      const apiKey = await ctx.getSecret(SECRET_KEY)
      return (
        (apiKey != null && validatedBindingForCredential(apiKey) != null) ||
        detectCodexPersonalCredentials() != null
      )
    },
    async getStatus(ctx): Promise<ProviderStatus> {
      const apiKey = await ctx.getSecret(SECRET_KEY)
      const personal = detectCodexPersonalCredentials() != null
      const binding = apiKey ? validatedBindingForCredential(apiKey) : null
      const configured = binding != null || personal
      const adminNeedsValidation = apiKey != null && binding == null
      return {
        providerId: "codex",
        accountTag: binding ? `openai-org:${binding.organizationId}` : undefined,
        status: configured ? "ok" : adminNeedsValidation ? "source-unavailable" : "not-configured",
        detail: binding
          ? `Validated OpenAI organization reports${personal ? " and personal Codex quota" : ""} are available.`
          : personal
            ? adminNeedsValidation
              ? "Personal Codex quota is available. Validate the exact OpenAI organization before Admin polling can start."
              : "Personal Codex subscription quota is read from the local Codex OAuth session."
            : adminNeedsValidation
              ? "Validate the exact OpenAI organization before Admin polling can start."
              : "Log in with Codex locally or add an OpenAI Admin API key with usage/cost access.",
        configured,
        supportsDaemon: true,
        supportsHistorical: binding != null,
      }
    },
    async pollLatest(ctx) {
      return collectConfiguredSources(ctx, startOfUtcDay(ctx.now), false)
    },
    async reconcileSince(ctx, since) {
      return collectConfiguredSources(
        ctx,
        since ?? new Date(ctx.now.getTime() - 30 * 86_400_000),
        true,
      )
    },
    supportsDaemon: () => true,
    supportsHistorical: () => true,
  }
}

async function collectConfiguredSources(
  ctx: UsageProviderContext,
  start: Date,
  reconcile: boolean,
): Promise<UsageSampleInput[]> {
  const apiKey = await ctx.getSecret(SECRET_KEY)
  const binding = apiKey ? validatedBindingForCredential(apiKey) : null
  const hasPersonal = detectCodexPersonalCredentials() != null
  const jobs: Array<{
    source: UsageSourceFailure["source"]
    run: Promise<UsageSampleInput[]>
  }> = []
  if (apiKey && binding)
    jobs.push({ source: "admin", run: collectReports(ctx, start, apiKey, binding) })
  if (hasPersonal) jobs.push({ source: "personal", run: pollCodexPersonal(ctx) })
  const results = await Promise.allSettled(jobs.map((job) => job.run))
  const samples = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
  const failures = results.flatMap((result, index) =>
    result.status === "rejected" ? [{ ...jobs[index]!, reason: result.reason }] : [],
  )
  for (const failure of failures) {
    ctx.log("warn", "Codex usage source failed; preserving other source data", {
      message: String((failure.reason as Error)?.message ?? failure.reason),
      reconcile,
    })
  }
  const adminAuthFailure = failures.find(
    (failure) =>
      failure.source === "admin" &&
      failure.reason instanceof UsageProviderError &&
      failure.reason.status === "auth-failed",
  )
  if (adminAuthFailure && binding) {
    invalidateOpenAiOrganizationBinding(binding.credentialTag)
    ctx.reportSourceFailure?.({
      source: "admin",
      accountTag: `openai-org:${binding.organizationId}`,
      status: "auth-failed",
      detail: adminAuthFailure.reason.message,
    })
  }
  const fatalFailure = failures.find((failure) => failure !== adminAuthFailure)
  if (samples.length === 0 && failures.length === jobs.length && fatalFailure) {
    throw fatalFailure.reason
  }
  return samples
}

async function collectReports(
  ctx: UsageProviderContext,
  start: Date,
  apiKey: string,
  binding: OpenAiValidatedOrganizationBinding,
): Promise<UsageSampleInput[]> {
  const results = await Promise.allSettled([
    collectCosts(ctx, start, apiKey, binding),
    collectUsage(ctx, start, apiKey, binding),
  ])
  const samples = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  )
  for (const failure of failures) {
    ctx.log("warn", "OpenAI usage endpoint failed; preserving data from other endpoints", {
      message: String((failure.reason as Error)?.message ?? failure.reason),
    })
  }
  const authFailure = failures.find(
    (failure) =>
      failure.reason instanceof UsageProviderError && failure.reason.status === "auth-failed",
  )
  if (authFailure) throw authFailure.reason
  if (samples.length === 0 && failures.length === results.length) throw failures[0]!.reason
  return samples
}

async function collectCosts(
  ctx: UsageProviderContext,
  start: Date,
  apiKey: string,
  binding: OpenAiValidatedOrganizationBinding,
): Promise<UsageSampleInput[]> {
  const report = await fetchOpenAiPages<OpenAiCostBucket>(ctx, apiKey, COSTS_URL, start, binding)
  const organizationId = binding.organizationId
  return report.rows.flatMap((bucket) => {
    return (bucket.results ?? []).map((result) => {
      assertProjectCoverage(binding, result.project_id)
      const currency = normalizedCurrency(result.amount?.currency)
      const isUsd = currency === "usd"
      const accountTag = openAiAccountTag(
        organizationId,
        result.project_id,
        credentialAccountTag("openai", apiKey),
      )
      return {
        providerId: "codex" as const,
        source: ctx.source,
        sourceTag: "organization-cost",
        accountTag,
        costQuality: isUsd ? ("provider-reported" as const) : ("unknown" as const),
        capturedAt: ctx.now,
        windowStart: unixDate(bucket.start_time),
        windowEnd: unixDate(bucket.end_time),
        costUsd: isUsd ? numberOrNull(result.amount?.value) : null,
        currency,
        rawPayload: {
          object: bucket.object ?? null,
          projectId: result.project_id ?? null,
          currency,
          organizationId,
          endpoint: "organization/costs",
          retrievedAt: ctx.now.toISOString(),
          truthClass: isUsd ? "provider-reported" : "unknown",
          coverage: coverageProvenance(binding),
        },
        dedupeKey: `codex|${accountTag}|cost|${bucket.start_time ?? start.toISOString().slice(0, 10)}|${result.project_id ?? "default"}`,
      }
    })
  })
}

async function collectUsage(
  ctx: UsageProviderContext,
  start: Date,
  apiKey: string,
  binding: OpenAiValidatedOrganizationBinding,
): Promise<UsageSampleInput[]> {
  const report = await fetchOpenAiPages<OpenAiUsageBucket>(ctx, apiKey, USAGE_URL, start, binding)
  const organizationId = binding.organizationId
  const buckets = report.rows
  return buckets.flatMap((bucket) => {
    return (bucket.results ?? []).map((result) => {
      assertProjectCoverage(binding, result.project_id)
      const inputTokens = numberOrZero(result.input_tokens)
      const outputTokens = numberOrZero(result.output_tokens)
      const accountTag = openAiAccountTag(
        organizationId,
        result.project_id,
        credentialAccountTag("openai", apiKey),
      )
      return {
        providerId: "codex" as const,
        source: ctx.source,
        sourceTag: "organization-usage",
        accountTag,
        costQuality: "unknown" as const,
        capturedAt: ctx.now,
        windowStart: unixDate(bucket.start_time),
        windowEnd: unixDate(bucket.end_time),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        requestCount: numberOrZero(result.num_model_requests),
        rawPayload: {
          object: bucket.object ?? null,
          projectId: result.project_id ?? null,
          organizationId,
          endpoint: "organization/usage/completions",
          retrievedAt: ctx.now.toISOString(),
          truthClass: "provider-reported",
          coverage: coverageProvenance(binding),
        },
        dedupeKey: `codex|${accountTag}|usage|${bucket.start_time ?? start.toISOString().slice(0, 10)}|${result.project_id ?? "default"}`,
      }
    })
  })
}

async function fetchOpenAiPages<T>(
  ctx: UsageProviderContext,
  apiKey: string,
  endpoint: string,
  start: Date,
  binding: OpenAiValidatedOrganizationBinding,
): Promise<{ rows: T[] }> {
  const rows: T[] = []
  const seenCursors = new Set<string>()
  let page: string | null = null
  let pageCount = 0
  do {
    pageCount += 1
    if (pageCount > MAX_PROVIDER_PAGES) {
      throw new Error("OpenAI organization report exceeded the bounded pagination limit.")
    }
    const url = new URL(endpoint)
    url.searchParams.set("start_time", String(Math.floor(start.getTime() / 1000)))
    url.searchParams.set("end_time", String(Math.floor((ctx.now.getTime() + 1_000) / 1000)))
    url.searchParams.set("bucket_width", "1d")
    url.searchParams.set("limit", "31")
    url.searchParams.append("group_by", "project_id")
    for (const projectId of binding.coverage.projectIds) {
      url.searchParams.append("project_ids", projectId)
    }
    if (page) url.searchParams.set("page", page)
    const response = await getProviderJsonResponse<OpenAiPage<T>>({
      providerId: "codex",
      url: url.toString(),
      apiKey,
      headers: { "OpenAI-Organization": binding.organizationId },
    })
    const responseOrganization = response.headers.get("openai-organization")?.trim() || null
    if (responseOrganization !== binding.organizationId) {
      throw new Error(
        responseOrganization
          ? "Provider returned data for a different OpenAI organization than the validated identity."
          : "Provider did not prove the validated OpenAI organization identity.",
      )
    }
    const payload = response.payload
    rows.push(...(payload.data ?? []))
    const next = payload.has_more === false ? null : (payload.next_page ?? null)
    if (next && seenCursors.has(next)) {
      throw new Error("OpenAI organization report returned a repeated pagination cursor.")
    }
    if (next) seenCursors.add(next)
    page = next
  } while (page)
  return { rows }
}

export async function validateOpenAiOrganizationBinding(
  apiKey: string,
  organizationId: string,
  projectIds: string[],
  now = new Date(),
): Promise<OpenAiValidatedOrganizationBinding> {
  const normalizedOrganizationId = organizationId.trim()
  if (!normalizedOrganizationId) throw new Error("An exact OpenAI organization ID is required.")
  const normalizedProjectIds = [
    ...new Set(projectIds.map((id) => id.trim()).filter(Boolean)),
  ].sort()
  const response = await getProviderJsonResponse<OpenAiPage<OpenAiCostBucket>>({
    providerId: "codex",
    url: openAiValidationUrl(now, normalizedProjectIds),
    apiKey,
    headers: { "OpenAI-Organization": normalizedOrganizationId },
  })
  const provenOrganizationId = response.headers.get("openai-organization")?.trim() || null
  if (provenOrganizationId !== normalizedOrganizationId) {
    throw new Error(
      provenOrganizationId
        ? "Provider validated a different OpenAI organization than the selected identity."
        : "Provider did not prove the selected OpenAI organization identity.",
    )
  }
  const binding: OpenAiValidatedOrganizationBinding = {
    organizationId: normalizedOrganizationId,
    credentialTag: credentialAccountTag("openai", apiKey),
    validatedAt: now.toISOString(),
    coverage: {
      selection: normalizedProjectIds.length > 0 ? "selected-projects" : "all-projects",
      projectIds: normalizedProjectIds,
    },
  }
  const settings = getUsageSettings()
  if (
    settings.organization.openai.organizationId !== normalizedOrganizationId ||
    settings.organization.openai.projectIds.join("\0") !== normalizedProjectIds.join("\0")
  ) {
    throw new Error("OpenAI organization scope changed during validation; retry.")
  }
  setUsageSettings({
    organization: {
      ...settings.organization,
      openai: {
        ...settings.organization.openai,
        validatedBinding: binding,
      },
    },
  })
  return binding
}

interface OpenAiPage<T> {
  data?: T[]
  has_more?: boolean
  next_page?: string | null
}
interface OpenAiCostBucket {
  object?: string
  start_time?: number
  end_time?: number
  results?: Array<{
    amount?: { value?: number | string | null; currency?: string | null }
    project_id?: string | null
  }>
}
interface OpenAiUsageBucket {
  object?: string
  start_time?: number
  end_time?: number
  results?: Array<{
    input_tokens?: number
    output_tokens?: number
    num_model_requests?: number
    project_id?: string | null
  }>
}
function numberOrZero(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(number) ? number : 0
}
function numberOrNull(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(number) ? number : null
}
function unixDate(value: unknown): Date | null {
  return typeof value === "number" && value > 0 ? new Date(value * 1000) : null
}

function normalizedCurrency(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z]{3}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : "unknown"
}

function openAiAccountTag(
  organizationId: string | null,
  projectId: string | null | undefined,
  credentialFallback: string,
): string {
  if (!organizationId) return `${credentialFallback}:project:${projectId ?? "all"}`
  return `openai-org:${organizationId}:project:${projectId ?? "default"}`
}

function validatedBindingForCredential(apiKey: string): OpenAiValidatedOrganizationBinding | null {
  const binding = getUsageSettings().organization.openai.validatedBinding
  return binding?.credentialTag === credentialAccountTag("openai", apiKey) ? binding : null
}

function coverageProvenance(binding: OpenAiValidatedOrganizationBinding) {
  return {
    source: "validated-binding" as const,
    selection: binding.coverage.selection,
    projectIds: [...binding.coverage.projectIds],
  }
}

function assertProjectCoverage(
  binding: OpenAiValidatedOrganizationBinding,
  projectId: string | null | undefined,
): void {
  if (
    binding.coverage.selection === "selected-projects" &&
    (!projectId || !binding.coverage.projectIds.includes(projectId))
  ) {
    throw new Error("Provider returned a row outside the validated OpenAI project coverage.")
  }
}

function openAiValidationUrl(now: Date, projectIds: string[]): string {
  const url = new URL(COSTS_URL)
  url.searchParams.set("start_time", String(Math.floor(startOfUtcDay(now).getTime() / 1000)))
  url.searchParams.set("end_time", String(Math.floor((now.getTime() + 1_000) / 1000)))
  url.searchParams.set("bucket_width", "1d")
  url.searchParams.set("limit", "1")
  url.searchParams.append("group_by", "project_id")
  for (const projectId of projectIds) url.searchParams.append("project_ids", projectId)
  return url.toString()
}
