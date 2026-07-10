// Stage 2 Track B — U7: Cursor usage source #1 (internal app endpoints).
//
// Ports onWatch `internal/api/cursor_client.go` + `cursor_types.go`. Uses the
// undocumented internal endpoints that Cursor's own app calls:
//   GET  https://cursor.com/api/usage
//   GET  https://cursor.com/api/auth/stripe
//   POST https://api2.cursor.sh/oauth/token   (refresh)
// Token comes from ./token.ts auto-detect (source "sqlite"). This is the only
// source implemented this stage; sources #2/#3 are stubbed fallback slots.
//
// Uses the undocumented endpoint best-effort. Endpoint drift and local-token
// failures remain explicit provider states.

import { detectCursorToken } from "./token"
import { UsageProviderError, type UsageProviderContext, type UsageSampleInput } from "../../types"

export const CURSOR_USAGE_URL = "https://cursor.com/api/usage"
export const CURSOR_STRIPE_URL = "https://cursor.com/api/auth/stripe"
const CURSOR_API_BASE_URL = "https://api2.cursor.sh"

interface CursorPlanUsage {
  totalSpend?: number
  limit?: number
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

export interface CursorSourceResult {
  available: boolean
  status: "ok" | "not-logged-in" | "not-installed" | "auth-failed" | "source-unavailable"
  detail?: string
  samples: UsageSampleInput[]
}

/** Probe whether source #1 can run right now (local token present). */
export function probeInternalSource(): CursorSourceResult {
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
  const token = accessToken ?? detectCursorToken().token
  if (!token) {
    throw new UsageProviderError("cursor", "auth-failed", "Cursor access token is unavailable")
  }

  const response = await fetch(
    `${CURSOR_API_BASE_URL}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "connect-protocol-version": "1",
      },
      body: "{}",
    },
  )
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

  let payload: CursorUsageResponse
  try {
    payload = (await response.json()) as CursorUsageResponse
  } catch {
    throw new UsageProviderError(
      "cursor",
      "source-unavailable",
      "Cursor usage endpoint returned invalid JSON",
    )
  }
  if (payload.enabled === false) return []

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
  return [
    {
      providerId: "cursor",
      source: ctx.source,
      sourceTag: "internal",
      costQuality: "provider-reported",
      capturedAt: ctx.now,
      windowStart: parseCursorTimestamp(payload.billingCycleStart),
      windowEnd: parseCursorTimestamp(payload.billingCycleEnd),
      quotaUsed,
      quotaLimit,
      percentUsed,
      resetAt: parseCursorTimestamp(payload.billingCycleEnd),
      rawPayload: payload,
    },
  ]
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

function parseCursorTimestamp(value: string | undefined): Date | null {
  if (!value) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
