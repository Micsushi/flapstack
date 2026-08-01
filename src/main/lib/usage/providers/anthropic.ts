import { getProviderJson, iso, startOfUtcDay } from "./http"
import { credentialAccountTag } from "../provider-identity"
import {
  getUsageSettings,
  invalidateAnthropicOrganizationBinding,
  setUsageSettings,
  type AnthropicValidatedOrganizationBinding,
} from "../settings"
import { UsageProviderError } from "../types"
import type {
  ProviderStatus,
  UsageProvider,
  UsageProviderContext,
  UsageSampleInput,
  UsageSourceFailure,
} from "../types"
import { detectAnthropicPersonalToken, pollAnthropicPersonal } from "./anthropic-personal"

const ADMIN_KEY = "anthropic.admin_key"
const COSTS_URL = "https://api.anthropic.com/v1/organizations/cost_report"
const USAGE_URL = "https://api.anthropic.com/v1/organizations/usage_report/messages"
const VERSION = "2023-06-01"
const ORGANIZATION_URL = "https://api.anthropic.com/v1/organizations/me"
const WORKSPACES_URL = "https://api.anthropic.com/v1/organizations/workspaces"
const MAX_PROVIDER_PAGES = 200

export function createAnthropicProvider(): UsageProvider {
  return {
    id: "anthropic",
    label: "Claude / Anthropic",
    billingKind: "api-spend",
    async isConfigured(ctx) {
      const apiKey = await ctx.getSecret(ADMIN_KEY)
      return (
        (apiKey != null && validatedBindingForCredential(apiKey) != null) ||
        detectAnthropicPersonalToken() != null
      )
    },
    async getStatus(ctx): Promise<ProviderStatus> {
      const apiKey = await ctx.getSecret(ADMIN_KEY)
      const personal = detectAnthropicPersonalToken() != null
      const binding = apiKey ? validatedBindingForCredential(apiKey) : null
      const configured = binding != null || personal
      const adminNeedsValidation = apiKey != null && binding == null
      return {
        providerId: "anthropic",
        accountTag: binding ? `anthropic-org:${binding.organizationId}` : undefined,
        status: configured ? "ok" : adminNeedsValidation ? "source-unavailable" : "not-configured",
        detail: binding
          ? `Validated Anthropic organization reports${personal ? " and personal Claude quota" : ""} are available.`
          : personal
            ? adminNeedsValidation
              ? "Personal Claude quota is available. Validate the exact Anthropic organization before Admin polling can start."
              : "Personal Claude subscription quota is read from the local Claude Code OAuth session."
            : adminNeedsValidation
              ? "Validate the exact Anthropic organization before Admin polling can start."
              : "Log in with Claude Code locally or add an Anthropic Admin API key.",
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
  const apiKey = await ctx.getSecret(ADMIN_KEY)
  const binding = apiKey ? validatedBindingForCredential(apiKey) : null
  const hasPersonal = detectAnthropicPersonalToken() != null
  const jobs: Array<{
    source: UsageSourceFailure["source"]
    run: Promise<UsageSampleInput[]>
  }> = []
  if (apiKey && binding)
    jobs.push({ source: "admin", run: collectReports(ctx, start, apiKey, binding) })
  if (hasPersonal) jobs.push({ source: "personal", run: pollAnthropicPersonal(ctx) })
  const results = await Promise.allSettled(jobs.map((job) => job.run))
  const samples = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []))
  const failures = results.flatMap((result, index) =>
    result.status === "rejected" ? [{ ...jobs[index]!, reason: result.reason }] : [],
  )
  for (const failure of failures) {
    ctx.log("warn", "Anthropic usage source failed; preserving other source data", {
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
    invalidateAnthropicOrganizationBinding(binding.credentialTag)
    ctx.reportSourceFailure?.({
      source: "admin",
      accountTag: `anthropic-org:${binding.organizationId}`,
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
  binding: AnthropicValidatedOrganizationBinding,
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
    ctx.log("warn", "Anthropic usage endpoint failed; preserving data from other endpoints", {
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
  binding: AnthropicValidatedOrganizationBinding,
): Promise<UsageSampleInput[]> {
  const buckets = await fetchAnthropicPages<AnthropicCostBucket>(
    ctx,
    apiKey,
    COSTS_URL,
    start,
    binding.coverage.workspaceIds,
  )
  return buckets.flatMap((bucket) => {
    return (bucket.results ?? []).map((result) => {
      assertWorkspaceCoverage(binding, result.workspace_id)
      const currency = normalizedCurrency(result.currency)
      const isUsd = currency === "usd"
      const accountTag = anthropicAccountTag(binding.organizationId, result.workspace_id)
      return {
        providerId: "anthropic" as const,
        source: ctx.source,
        sourceTag: "organization-cost",
        accountTag,
        costQuality: isUsd ? ("provider-reported" as const) : ("unknown" as const),
        capturedAt: ctx.now,
        windowStart: dateOrNull(bucket.starting_at),
        windowEnd: dateOrNull(bucket.ending_at),
        costUsd: isUsd ? centsToUsd(result.amount) : null,
        currency,
        rawPayload: {
          workspaceId: result.workspace_id ?? null,
          organizationId: binding.organizationId,
          currency,
          endpoint: "/v1/organizations/cost_report",
          retrievedAt: ctx.now.toISOString(),
          truthClass: isUsd ? "provider-reported" : "unknown",
          coverage: coverageProvenance(binding),
        },
        dedupeKey: `anthropic|${accountTag}|cost|${bucket.starting_at ?? start.toISOString().slice(0, 10)}`,
      }
    })
  })
}

async function collectUsage(
  ctx: UsageProviderContext,
  start: Date,
  apiKey: string,
  binding: AnthropicValidatedOrganizationBinding,
): Promise<UsageSampleInput[]> {
  const buckets = await fetchAnthropicPages<AnthropicUsageBucket>(
    ctx,
    apiKey,
    USAGE_URL,
    start,
    binding.coverage.workspaceIds,
  )
  return buckets.flatMap((bucket) => {
    return (bucket.results ?? []).map((result) => {
      assertWorkspaceCoverage(binding, result.workspace_id)
      const cacheCreation = result.cache_creation ?? {}
      const inputTokens =
        numberOrZero(result.uncached_input_tokens) +
        numberOrZero(result.cache_read_input_tokens) +
        numberOrZero(cacheCreation.ephemeral_1h_input_tokens) +
        numberOrZero(cacheCreation.ephemeral_5m_input_tokens)
      const outputTokens = numberOrZero(result.output_tokens)
      const accountTag = anthropicAccountTag(binding.organizationId, result.workspace_id)
      return {
        providerId: "anthropic" as const,
        source: ctx.source,
        sourceTag: "organization-usage",
        accountTag,
        costQuality: "unknown" as const,
        capturedAt: ctx.now,
        windowStart: dateOrNull(bucket.starting_at),
        windowEnd: dateOrNull(bucket.ending_at),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        rawPayload: {
          workspaceId: result.workspace_id ?? null,
          organizationId: binding.organizationId,
          endpoint: "/v1/organizations/usage_report/messages",
          retrievedAt: ctx.now.toISOString(),
          truthClass: "provider-reported",
          coverage: coverageProvenance(binding),
        },
        dedupeKey: `anthropic|${accountTag}|usage|${bucket.starting_at ?? start.toISOString().slice(0, 10)}`,
      }
    })
  })
}

export async function validateAnthropicOrganizationBinding(
  apiKey: string,
  organizationId: string,
  workspaceIds: string[],
  now = new Date(),
): Promise<AnthropicValidatedOrganizationBinding> {
  const normalizedOrganizationId = organizationId.trim()
  if (!normalizedOrganizationId) throw new Error("An exact Anthropic organization ID is required.")
  const normalizedWorkspaceIds = [
    ...new Set(workspaceIds.map((id) => id.trim()).filter(Boolean)),
  ].sort()
  const organization = await getProviderJson<{ id?: string }>({
    providerId: "anthropic",
    url: ORGANIZATION_URL,
    apiKey,
    auth: "x-api-key",
    headers: { "anthropic-version": VERSION },
  })
  if (normalizedIdentity(organization.id) !== normalizedOrganizationId) {
    throw new Error(
      "Provider validated a different Anthropic organization than the selected identity.",
    )
  }
  for (const workspaceId of normalizedWorkspaceIds) {
    const workspace = await getProviderJson<{ id?: string }>({
      providerId: "anthropic",
      url: `${WORKSPACES_URL}/${encodeURIComponent(workspaceId)}`,
      apiKey,
      auth: "x-api-key",
      headers: { "anthropic-version": VERSION },
    })
    if (normalizedIdentity(workspace.id) !== workspaceId) {
      throw new Error(
        "Provider validated a different Anthropic workspace than the selected identity.",
      )
    }
  }
  const binding: AnthropicValidatedOrganizationBinding = {
    organizationId: normalizedOrganizationId,
    credentialTag: credentialAccountTag("anthropic", apiKey),
    validatedAt: now.toISOString(),
    coverage: {
      selection: normalizedWorkspaceIds.length > 0 ? "selected-workspaces" : "all-workspaces",
      workspaceIds: normalizedWorkspaceIds,
    },
  }
  const settings = getUsageSettings()
  if (
    settings.organization.anthropic.organizationId !== normalizedOrganizationId ||
    settings.organization.anthropic.workspaceIds.join("\0") !== normalizedWorkspaceIds.join("\0")
  ) {
    throw new Error("Anthropic organization scope changed during validation; retry.")
  }
  setUsageSettings({
    organization: {
      ...settings.organization,
      anthropic: {
        ...settings.organization.anthropic,
        validatedBinding: binding,
      },
    },
  })
  return binding
}

async function fetchAnthropicPages<T>(
  ctx: UsageProviderContext,
  apiKey: string,
  endpoint: string,
  start: Date,
  workspaceIds: string[],
): Promise<T[]> {
  const rows: T[] = []
  const seenCursors = new Set<string>()
  let page: string | null = null
  let pageCount = 0
  do {
    pageCount += 1
    if (pageCount > MAX_PROVIDER_PAGES) {
      throw new Error("Anthropic organization report exceeded the bounded pagination limit.")
    }
    const url = new URL(endpoint)
    url.searchParams.set("starting_at", iso(start))
    url.searchParams.set("ending_at", iso(ctx.now))
    url.searchParams.set("bucket_width", "1d")
    url.searchParams.set("limit", "31")
    url.searchParams.append("group_by[]", "workspace_id")
    for (const workspaceId of workspaceIds) {
      url.searchParams.append("workspace_ids[]", workspaceId)
    }
    if (page) url.searchParams.set("page", page)
    const payload = await getProviderJson<AnthropicPage<T>>({
      providerId: "anthropic",
      url: url.toString(),
      apiKey,
      auth: "x-api-key",
      headers: { "anthropic-version": VERSION },
    })
    rows.push(...(payload.data ?? []))
    const next = payload.has_more ? (payload.next_page ?? null) : null
    if (next && seenCursors.has(next)) {
      throw new Error("Anthropic organization report returned a repeated pagination cursor.")
    }
    if (next) seenCursors.add(next)
    page = next
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
  results?: Array<{
    amount?: number | string | null
    currency?: string | null
    workspace_id?: string | null
  }>
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
    workspace_id?: string | null
  }>
}
function centsToUsd(value: unknown): number | null {
  const cents = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
  return Number.isFinite(cents) ? cents / 100 : null
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

function normalizedIdentity(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 200
    ? value.trim()
    : null
}

function normalizedCurrency(value: unknown): string {
  return typeof value === "string" && /^[a-zA-Z]{3}$/.test(value.trim())
    ? value.trim().toLowerCase()
    : "unknown"
}

function anthropicAccountTag(
  organizationId: string,
  workspaceId: string | null | undefined,
): string {
  return `anthropic-org:${organizationId}:workspace:${workspaceId ?? "default"}`
}

function validatedBindingForCredential(
  apiKey: string,
): AnthropicValidatedOrganizationBinding | null {
  const binding = getUsageSettings().organization.anthropic.validatedBinding
  return binding?.credentialTag === credentialAccountTag("anthropic", apiKey) ? binding : null
}

function coverageProvenance(binding: AnthropicValidatedOrganizationBinding) {
  return {
    source: "validated-binding" as const,
    selection: binding.coverage.selection,
    workspaceIds: [...binding.coverage.workspaceIds],
  }
}

function assertWorkspaceCoverage(
  binding: AnthropicValidatedOrganizationBinding,
  workspaceId: string | null | undefined,
): void {
  if (
    binding.coverage.selection === "selected-workspaces" &&
    (!workspaceId || !binding.coverage.workspaceIds.includes(workspaceId))
  ) {
    throw new Error("Provider returned a row outside the validated Anthropic workspace coverage.")
  }
}
