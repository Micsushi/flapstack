import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { fetchProviderResponse, readProviderJson } from "./http"
import { UsageProviderError, type UsageProviderContext, type UsageSampleInput } from "../types"

const PRIMARY_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const FALLBACK_USAGE_URL = "https://chatgpt.com/api/codex/usage"

export interface CodexPersonalCredentials {
  accessToken: string
  accountId: string | null
}

interface CodexWindow {
  used_percent?: number
  reset_at?: number
  limit_window_seconds?: number
}

interface CodexUsagePayload {
  plan_type?: string
  rate_limit?: { primary_window?: CodexWindow | null; secondary_window?: CodexWindow | null }
  code_review_rate_limit?: { primary_window?: CodexWindow | null }
  credits?: { balance?: number | string | null }
}

export function detectCodexPersonalCredentials(): CodexPersonalCredentials | null {
  if (process.env.FLAPSTACK_DISABLE_LOCAL_USAGE_CREDENTIALS === "1") return null
  const codexHome = process.env.CODEX_HOME?.trim() || join(homedir(), ".codex")
  const path = join(codexHome, "auth.json")
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      tokens?: { access_token?: string; account_id?: string }
    }
    const accessToken = raw.tokens?.access_token?.trim()
    if (!accessToken) return null
    return { accessToken, accountId: raw.tokens?.account_id?.trim() || null }
  } catch {
    return null
  }
}

export async function pollCodexPersonal(
  ctx: UsageProviderContext,
  credentials = detectCodexPersonalCredentials(),
): Promise<UsageSampleInput[]> {
  if (!credentials) return []
  const payload = await fetchCodexUsage(credentials)
  const accountTag = opaqueAccountTag("codex", credentials.accountId ?? credentials.accessToken)
  const samples: UsageSampleInput[] = []
  const primary = payload.rate_limit?.primary_window
  const secondary = payload.rate_limit?.secondary_window
  if (primary) {
    samples.push(
      windowSample(
        ctx,
        accountTag,
        secondary || payload.plan_type?.toLowerCase() !== "free" ? "five_hour" : "seven_day",
        primary,
        payload,
      ),
    )
  }
  if (secondary) samples.push(windowSample(ctx, accountTag, "seven_day", secondary, payload))
  const review = payload.code_review_rate_limit?.primary_window
  if (review) samples.push(windowSample(ctx, accountTag, "code_review", review, payload))
  return samples
}

async function fetchCodexUsage(credentials: CodexPersonalCredentials): Promise<CodexUsagePayload> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${credentials.accessToken}`,
    accept: "application/json",
    "user-agent": "flapstack/0.0.72",
  }
  if (credentials.accountId) {
    headers["x-account-id"] = credentials.accountId
    headers["chatgpt-account-id"] = credentials.accountId
  }
  let response = await fetchProviderResponse({
    providerId: "codex",
    url: PRIMARY_USAGE_URL,
    init: { headers },
  })
  if (response.status === 404) {
    response = await fetchProviderResponse({
      providerId: "codex",
      url: FALLBACK_USAGE_URL,
      init: { headers },
    })
  }
  if (response.status === 401 || response.status === 403) {
    throw new UsageProviderError("codex", "auth-failed", "Codex local OAuth usage access failed")
  }
  if (response.status === 429) {
    throw new UsageProviderError("codex", "rate-limited", "Codex usage endpoint rate limited")
  }
  if (!response.ok) {
    throw new UsageProviderError(
      "codex",
      "source-unavailable",
      `Codex local usage endpoint returned HTTP ${response.status}`,
    )
  }
  return await readProviderJson<CodexUsagePayload>(response, "codex")
}

function windowSample(
  ctx: UsageProviderContext,
  accountTag: string,
  metricKey: string,
  window: CodexWindow,
  rawPayload: CodexUsagePayload,
): UsageSampleInput {
  const resetAt = window.reset_at ? new Date(window.reset_at * 1_000) : null
  const windowStart =
    resetAt && window.limit_window_seconds
      ? new Date(resetAt.getTime() - window.limit_window_seconds * 1_000)
      : null
  return {
    providerId: "codex",
    billingKind: "subscription-quota",
    accountTag,
    source: ctx.source,
    sourceTag: "personal-oauth",
    metricKey,
    costQuality: "provider-reported",
    capturedAt: ctx.now,
    windowStart,
    windowEnd: resetAt,
    percentUsed: normalizePercent(window.used_percent),
    resetAt,
    rawPayload,
  }
}

function normalizePercent(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null
}

function opaqueAccountTag(provider: string, identity: string): string {
  return `${provider}-${createHash("sha256").update(identity).digest("hex").slice(0, 12)}`
}
