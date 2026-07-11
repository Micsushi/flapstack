// Stage 2 Track B — U7: Cursor usage source #1 (internal app endpoints).
//
// Ports onWatch `internal/api/cursor_client.go` + `cursor_types.go`. Uses the
// undocumented Connect RPC endpoint that Cursor's own app calls, plus the OAuth
// refresh endpoint. Token rotation is persisted atomically to Cursor SQLite and
// a combined Flapstack Keychain fallback. Admin/CLI sources remain explicit
// fallback slots until their contracts are verified.
//
// Uses the undocumented endpoint best-effort. Endpoint drift and local-token
// failures remain explicit provider states.

import { detectCursorCredentials, detectCursorToken, persistCursorCredentials } from "./token"
import { UsageProviderError, type UsageProviderContext, type UsageSampleInput } from "../../types"
import { fetchProviderResponse, readProviderJson } from "../http"
import { createHash } from "node:crypto"

export const CURSOR_USAGE_URL = "https://cursor.com/api/usage"
export const CURSOR_STRIPE_URL = "https://cursor.com/api/auth/stripe"
const CURSOR_API_BASE_URL = "https://api2.cursor.sh"
const CURSOR_OAUTH_URL = "https://api2.cursor.sh/oauth/token"
const CURSOR_CLIENT_ID = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB"
const REFRESH_BUFFER_MS = 5 * 60_000

interface CursorPlanUsage {
  totalSpend?: number
  limit?: number
  remaining?: number
  totalPercentUsed?: number
}

interface CursorUsageResponse {
  billingCycleStart?: string
  billingCycleEnd?: string
  planUsage?: CursorPlanUsage
  spendLimitUsage?: {
    pooledUsed?: number
    pooledLimit?: number
    individualUsed?: number
    individualLimit?: number
  }
  enabled?: boolean
}

interface CursorPlanInfoResponse {
  planInfo?: {
    planName?: string
    includedAmountCents?: number
    price?: string
    billingCycleEnd?: string
  }
}

interface CursorCreditGrantsResponse {
  hasCreditGrants?: boolean
  totalCents?: string
  usedCents?: string
}

interface CursorStripeResponse {
  membershipType?: string
  subscriptionStatus?: string
  customerBalance?: number
}

interface CursorRequestUsageResponse {
  startOfMonth?: string
  [model: string]: unknown
}

interface CursorModelRequestUsage {
  numRequests?: number
  maxRequestUsage?: number
}

export interface CursorSourceResult {
  available: boolean
  status: "ok" | "not-logged-in" | "not-installed" | "auth-failed" | "source-unavailable"
  detail?: string
  samples: UsageSampleInput[]
}

/** Probe whether source #1 can run right now (local token present). */
export function probeInternalSource(manualToken?: string | null): CursorSourceResult {
  if (manualToken?.trim()) {
    return {
      available: true,
      status: "ok",
      detail: "Cursor usage access token configured manually.",
      samples: [],
    }
  }
  const detected = detectCursorToken()
  if (detected.reason === "unsupported-platform") {
    return {
      available: false,
      status: "source-unavailable",
      detail: "Unsupported platform",
      samples: [],
    }
  }
  if (detected.reason === "not-installed") {
    return {
      available: false,
      status: "not-installed",
      detail: "Cursor not found locally",
      samples: [],
    }
  }
  if (!detected.token) {
    return {
      available: false,
      status: "not-logged-in",
      detail: "Cursor not logged in",
      samples: [],
    }
  }
  return {
    available: true,
    status: "ok",
    detail: "Cursor local token detected; usage endpoint will be polled.",
    samples: [],
  }
}

export async function pollInternalSource(
  ctx: UsageProviderContext,
  accessToken?: string,
): Promise<UsageSampleInput[]> {
  const manualToken = accessToken ?? (await ctx.getSecret("cursor.access_token"))
  const token = manualToken ?? (await resolveCursorAccessToken())
  if (!token) {
    throw new UsageProviderError("cursor", "auth-failed", "Cursor access token is unavailable")
  }

  const response = await fetchProviderResponse({
    providerId: "cursor",
    url: `${CURSOR_API_BASE_URL}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "connect-protocol-version": "1",
      },
      body: "{}",
    },
  })
  if (response.status === 401 || response.status === 403) {
    throw new UsageProviderError("cursor", "auth-failed", "Cursor rejected the local access token")
  }
  if (response.status === 429) {
    throw new UsageProviderError(
      "cursor",
      "rate-limited",
      "Cursor usage endpoint rate limited the request",
    )
  }
  if (!response.ok) {
    throw new UsageProviderError(
      "cursor",
      "source-unavailable",
      `Cursor usage endpoint returned HTTP ${response.status}`,
    )
  }

  const payload = await readProviderJson<CursorUsageResponse>(response, "cursor")
  if (payload.enabled === false) return []

  const subject = extractJwtSubject(token)
  const accountTag = subject
    ? `cursor-${createHash("sha256").update(subject).digest("hex").slice(0, 12)}`
    : undefined
  const [planInfo, creditGrants, stripe, requestUsage] = await Promise.all([
    fetchOptionalConnect<CursorPlanInfoResponse>(ctx, token, "GetPlanInfo"),
    fetchOptionalConnect<CursorCreditGrantsResponse>(ctx, token, "GetCreditGrantsBalance"),
    subject
      ? fetchOptionalCookie<CursorStripeResponse>(ctx, token, subject, CURSOR_STRIPE_URL)
      : null,
    subject
      ? fetchOptionalCookie<CursorRequestUsageResponse>(
          ctx,
          token,
          subject,
          `${CURSOR_USAGE_URL}?user=${encodeURIComponent(subject)}`,
        )
      : null,
  ])

  const quotaUsed =
    payload.planUsage?.totalSpend ??
    payload.spendLimitUsage?.pooledUsed ??
    payload.spendLimitUsage?.individualUsed ??
    null
  const quotaLimit =
    payload.planUsage?.limit ??
    payload.spendLimitUsage?.pooledLimit ??
    payload.spendLimitUsage?.individualLimit ??
    null
  const percentUsed = normalizePercent(payload.planUsage?.totalPercentUsed, quotaUsed, quotaLimit)
  const samples: UsageSampleInput[] = [
    {
      providerId: "cursor",
      accountTag,
      source: ctx.source,
      sourceTag: "internal",
      metricKey: "total_usage",
      costQuality: "provider-reported",
      capturedAt: ctx.now,
      windowStart: parseCursorTimestamp(payload.billingCycleStart),
      windowEnd: parseCursorTimestamp(payload.billingCycleEnd),
      quotaUsed: centsToMicros(quotaUsed),
      quotaLimit: centsToMicros(quotaLimit),
      quotaUnit: quotaUsed != null || quotaLimit != null ? "usd-micros" : null,
      percentUsed,
      resetAt: parseCursorTimestamp(payload.billingCycleEnd),
      rawPayload: { usage: payload, planInfo },
    },
  ]

  const grantTotal = numberFromString(creditGrants?.totalCents)
  const grantUsed = numberFromString(creditGrants?.usedCents)
  const stripeBalance =
    typeof stripe?.customerBalance === "number" && stripe.customerBalance < 0
      ? -stripe.customerBalance
      : 0
  const creditLimit = (grantTotal ?? 0) + stripeBalance
  if (creditLimit > 0 || grantUsed != null) {
    samples.push({
      providerId: "cursor",
      accountTag,
      source: ctx.source,
      sourceTag: "internal",
      metricKey: "credits",
      costQuality: "provider-reported",
      capturedAt: ctx.now,
      windowStart: parseCursorTimestamp(payload.billingCycleStart),
      windowEnd: parseCursorTimestamp(payload.billingCycleEnd),
      quotaUsed: centsToMicros(grantUsed ?? 0),
      quotaLimit: centsToMicros(creditLimit),
      quotaUnit: "usd-micros",
      percentUsed: normalizePercent(undefined, grantUsed ?? 0, creditLimit),
      resetAt: parseCursorTimestamp(payload.billingCycleEnd),
      rawPayload: { creditGrants, stripe },
    })
  }

  for (const [model, value] of Object.entries(requestUsage ?? {})) {
    if (model === "startOfMonth" || !isModelRequestUsage(value)) continue
    if (value.numRequests == null && value.maxRequestUsage == null) continue
    samples.push({
      providerId: "cursor",
      accountTag,
      source: ctx.source,
      sourceTag: "internal",
      metricKey: `requests:${model}`,
      model,
      costQuality: "provider-reported",
      capturedAt: ctx.now,
      windowStart: parseCursorTimestamp(requestUsage?.startOfMonth),
      windowEnd: parseCursorTimestamp(payload.billingCycleEnd),
      requestCount: value.numRequests ?? null,
      quotaUsed: value.numRequests ?? null,
      quotaLimit: value.maxRequestUsage ?? null,
      quotaUnit: "provider-native",
      percentUsed: normalizePercent(
        undefined,
        value.numRequests ?? null,
        value.maxRequestUsage ?? null,
      ),
      resetAt: parseCursorTimestamp(payload.billingCycleEnd),
      rawPayload: { model, usage: value, planInfo },
    })
  }

  return samples
}

async function fetchOptionalConnect<T>(
  ctx: UsageProviderContext,
  token: string,
  method: string,
): Promise<T | null> {
  try {
    const response = await fetchProviderResponse({
      providerId: "cursor",
      url: `${CURSOR_API_BASE_URL}/aiserver.v1.DashboardService/${method}`,
      init: {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "connect-protocol-version": "1",
        },
        body: "{}",
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await readProviderJson<T>(response, "cursor")
  } catch (error) {
    ctx.log("warn", `Cursor ${method} endpoint unavailable`, {
      message: String((error as Error)?.message ?? error),
    })
    return null
  }
}

async function fetchOptionalCookie<T>(
  ctx: UsageProviderContext,
  token: string,
  subject: string,
  url: string,
): Promise<T | null> {
  try {
    const response = await fetchProviderResponse({
      providerId: "cursor",
      url,
      init: {
        headers: {
          cookie: `WorkosCursorSessionToken=${encodeURIComponent(subject)}%3A%3A${encodeURIComponent(token)}`,
        },
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await readProviderJson<T>(response, "cursor")
  } catch (error) {
    ctx.log("warn", "Cursor account detail endpoint unavailable", {
      message: String((error as Error)?.message ?? error),
    })
    return null
  }
}

function extractJwtSubject(token: string): string | null {
  const payload = token.split(".")[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: string
    }
    const subject = claims.sub?.trim()
    if (!subject) return null
    return subject.slice(subject.lastIndexOf("|") + 1)
  } catch {
    return null
  }
}

function centsToMicros(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 10_000)
}

function numberFromString(value: string | undefined): number | null {
  const parsed = value == null ? NaN : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isModelRequestUsage(value: unknown): value is CursorModelRequestUsage {
  return typeof value === "object" && value != null
}

async function resolveCursorAccessToken(): Promise<string | null> {
  const credentials = detectCursorCredentials()
  if (!credentials.token) return null
  if (!credentials.expiresAt || credentials.expiresAt.getTime() > Date.now() + REFRESH_BUFFER_MS) {
    return credentials.token
  }
  if (!credentials.refreshToken) return credentials.token
  const response = await fetchProviderResponse({
    providerId: "cursor",
    url: CURSOR_OAUTH_URL,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: CURSOR_CLIENT_ID,
        refresh_token: credentials.refreshToken,
      }),
    },
  })
  if (!response.ok) {
    throw new UsageProviderError("cursor", "auth-failed", "Cursor token refresh failed")
  }
  const payload = await readProviderJson<{
    access_token?: string
    refresh_token?: string
    shouldLogout?: boolean
  }>(response, "cursor")
  if (payload.shouldLogout || !payload.access_token) {
    throw new UsageProviderError("cursor", "auth-failed", "Cursor session expired")
  }
  persistCursorCredentials(payload.access_token, payload.refresh_token ?? credentials.refreshToken)
  return payload.access_token
}

function normalizePercent(
  reported: number | undefined,
  used: number | null,
  limit: number | null,
): number | null {
  const value =
    reported ?? (used != null && limit != null && limit > 0 ? (used / limit) * 100 : null)
  return value == null || !Number.isFinite(value)
    ? null
    : Math.max(0, Math.min(100, Math.round(value)))
}

export function parseCursorTimestamp(value: string | undefined): Date | null {
  if (!value) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0)
    return new Date(numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
