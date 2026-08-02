import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { homedir, userInfo } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fetchProviderResponse, readProviderJson } from "./http"
import { UsageProviderError, type UsageProviderContext, type UsageSampleInput } from "../types"

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const KNOWN_QUOTAS = new Set([
  "five_hour",
  "seven_day",
  "seven_day_sonnet",
  "monthly_limit",
  "extra_usage",
])

interface ClaudeCredentialsFile {
  claudeAiOauth?: {
    accessToken?: string
    refreshToken?: string
  }
}

interface AnthropicPersonalCredentials {
  accessToken: string
  identity: string
}

interface AnthropicQuotaEntry {
  utilization?: number | null
  resets_at?: string | null
  is_enabled?: boolean | null
  monthly_limit?: number | null
  used_credits?: number | null
}

export function detectAnthropicPersonalToken(): string | null {
  return detectAnthropicPersonalCredentials()?.accessToken ?? null
}

function detectAnthropicPersonalCredentials(): AnthropicPersonalCredentials | null {
  if (process.env.FLAPSTACK_DISABLE_LOCAL_USAGE_CREDENTIALS === "1") return null
  const keychain = process.platform === "darwin" ? readMacKeychainCredentials() : null
  if (keychain) return keychain
  const path = join(homedir(), ".claude", ".credentials.json")
  if (!existsSync(path)) return null
  try {
    return parseCredentials(readFileSync(path, "utf8"))
  } catch {
    return null
  }
}

export async function pollAnthropicPersonal(
  ctx: UsageProviderContext,
  credentials: string | AnthropicPersonalCredentials | null = detectAnthropicPersonalCredentials(),
): Promise<UsageSampleInput[]> {
  if (!credentials) return []
  const token = typeof credentials === "string" ? credentials : credentials.accessToken
  const response = await fetchProviderResponse({
    providerId: "anthropic",
    url: USAGE_URL,
    init: {
      headers: {
        authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "user-agent": "claude-code/2.1.69",
      },
    },
  })
  if (response.status === 401 || response.status === 403) {
    throw new UsageProviderError(
      "anthropic",
      "auth-failed",
      "Claude Code local OAuth usage access failed",
    )
  }
  if (response.status === 429) {
    throw new UsageProviderError("anthropic", "rate-limited", "Claude usage endpoint rate limited")
  }
  if (!response.ok) {
    throw new UsageProviderError(
      "anthropic",
      "source-unavailable",
      `Claude local usage endpoint returned HTTP ${response.status}`,
    )
  }
  const payload = await readProviderJson<Record<string, unknown>>(response, "anthropic")
  const identity = typeof credentials === "string" ? credentials : credentials.identity
  const accountTag = `claude-${createHash("sha256").update(identity).digest("hex").slice(0, 12)}`
  return Object.entries(payload).flatMap(([metricKey, raw]) => {
    if (!KNOWN_QUOTAS.has(metricKey) || !isQuotaEntry(raw)) return []
    if (raw.is_enabled === false || typeof raw.utilization !== "number") return []
    const resetAt = raw.resets_at ? dateOrNull(raw.resets_at) : null
    return [
      {
        providerId: "anthropic" as const,
        billingKind: "subscription-quota" as const,
        accountTag,
        source: ctx.source,
        sourceTag: "personal-oauth",
        metricKey,
        costQuality: "provider-reported" as const,
        capturedAt: ctx.now,
        windowEnd: resetAt,
        percentUsed: Math.max(0, Math.min(100, Math.round(raw.utilization))),
        quotaUsed: numberOrNull(raw.used_credits),
        quotaLimit: numberOrNull(raw.monthly_limit),
        quotaUnit: "provider-native" as const,
        resetAt,
        rawPayload: { [metricKey]: raw },
      },
    ]
  })
}

function readMacKeychainCredentials(): AnthropicPersonalCredentials | null {
  const result = spawnSync(
    "/usr/bin/security",
    ["find-generic-password", "-s", "Claude Code-credentials", "-a", userInfo().username, "-w"],
    { encoding: "utf8", windowsHide: true },
  )
  return result.status === 0 ? parseCredentials(result.stdout) : null
}

function parseCredentials(raw: string): AnthropicPersonalCredentials | null {
  try {
    const parsed = JSON.parse(raw) as ClaudeCredentialsFile
    const accessToken = parsed.claudeAiOauth?.accessToken?.trim()
    if (!accessToken) return null
    return {
      accessToken,
      // Refresh tokens outlive access-token rotation, keeping history under one
      // opaque account tag without persisting either secret.
      identity: parsed.claudeAiOauth?.refreshToken?.trim() || accessToken,
    }
  } catch {
    return null
  }
}

function isQuotaEntry(value: unknown): value is AnthropicQuotaEntry {
  return typeof value === "object" && value != null && !Array.isArray(value)
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function dateOrNull(value: string): Date | null {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
