import type { inferRouterOutputs } from "@trpc/server"
import type { AppRouter } from "../../../../main/lib/trpc/routers"
import { trpc } from "../../../lib/trpc"

type UsageQueries = inferRouterOutputs<AppRouter>["usage"]
type Sample = UsageQueries["listCurrentSamples"][number]
type CapturedSample = Sample & { capturedAt: Date }
type ProviderState = UsageQueries["listProviderStates"][number]
type Settings = UsageQueries["getSettings"]
type QuotaProvider = "codex" | "anthropic" | "cursor" | "openrouter"

const providers: Partial<Record<string, QuotaProvider>> = {
  codex: "codex",
  "claude-code": "anthropic",
  "cursor-agent": "cursor",
  openrouter: "openrouter",
}

const sharedWindows: Record<string, string> = {
  five_hour: "5h",
  seven_day: "7d",
  total_usage: "Plan",
  credits: "Credits",
}

export type RemainingQuotaWindow = {
  key: string
  displayValue: string
  scope: "model-specific" | "shared-provider"
  windowLabel: string
  resetAt: Date | null
  capturedAt: Date
  stale: boolean
  severity: "neutral" | "warning" | "critical"
  percentLeft: number | null
}

export type RemainingQuota = { effective: RemainingQuotaWindow; windows: RemainingQuotaWindow[] }

export const quotaSeverityClass = {
  neutral: "text-muted-foreground",
  warning: "text-amber-700 dark:text-amber-300",
  critical: "text-red-700 dark:text-red-300",
}

export function useRemainingQuota(enabled: boolean) {
  const options = { enabled, staleTime: 30_000, refetchInterval: 60_000 }
  const samples = trpc.usage.listCurrentSamples.useQuery(
    { quotaOnly: true, limitPerAccount: 100 },
    options,
  )
  const states = trpc.usage.listProviderStates.useQuery(undefined, options)
  const settings = trpc.usage.getSettings.useQuery(undefined, options)
  const now = Math.max(Date.now(), samples.dataUpdatedAt)
  return (provider: string, model?: string | null) =>
    selectRemainingQuota(samples.data ?? [], states.data ?? [], settings.data, provider, model, now)
}

export function selectRemainingQuota(
  samples: readonly Sample[],
  states: readonly ProviderState[],
  settings: Settings | undefined,
  harness: string,
  modelId: string | null | undefined,
  now = Date.now(),
): RemainingQuota | null {
  const provider = providers[harness]
  if (!provider || !settings?.providers[provider]?.enabled) return null
  const cadence = settings.providers[provider].cadenceSecondsOverride ?? settings.cadenceSeconds
  const rows = samples.filter(
    (row): row is CapturedSample => row.providerId === provider && row.capturedAt != null,
  )
  const newest = rows.reduce<CapturedSample | undefined>(
    (latest, row) => (!latest || row.capturedAt > latest.capturedAt ? row : latest),
    undefined,
  )
  if (!newest) return null
  const state =
    states.find(
      (state) => state.providerId === provider && state.accountTag === newest.accountTag,
    ) ??
    states.find((state) => state.providerId === provider && !state.accountTag) ??
    states.find((state) => state.providerId === provider)
  if (state && !state.configured) return null

  const normalizedModel = modelId?.trim().toLowerCase()
  const windows = new Map<string, RemainingQuotaWindow>()
  for (const row of rows) {
    // Each poll publishes one snapshot. A bucket omitted by a newer response
    // must not remain active until the old reset date.
    if (
      row.accountTag !== newest.accountTag ||
      +row.capturedAt !== +newest.capturedAt ||
      (row.resetAt && +row.resetAt <= now)
    )
      continue
    const key = row.metricKey ?? ""
    const family =
      provider === "anthropic" && /^seven_day_(opus|sonnet|haiku|fable)$/.exec(key)?.[1]
    const scoped = Boolean(family || row.model)
    let windowLabel = sharedWindows[key]
    if (scoped) {
      if (!normalizedModel) continue
      if (family) {
        if (normalizedModel.match(/^claude-(opus|sonnet|haiku|fable)(?:-|$)/)?.[1] !== family)
          continue
        windowLabel = family[0]!.toUpperCase() + family.slice(1) + " 7d"
      } else {
        if (row.model?.trim().toLowerCase() !== normalizedModel) continue
        windowLabel =
          provider === "cursor" ? "Requests" : provider === "anthropic" ? "7d" : durationLabel(row)
      }
    } else if (provider === "openrouter" && row.sourceTag === "key-limits") {
      windowLabel = "Credits"
    } else if (!windowLabel) {
      continue
    } else if (provider === "codex" && row.windowStart && row.resetAt) {
      windowLabel = durationLabel(row)
    }
    const limit = row.quotaLimit
    const used = row.quotaUsed
    const percentUsed =
      row.percentUsed ?? (limit != null && limit > 0 && used != null ? (used / limit) * 100 : null)
    const remaining =
      provider === "openrouter"
        ? openRouterRemaining(row)
        : key === "credits" && row.quotaUnit === "usd-micros" && limit != null && used != null
          ? (limit - used) / 1_000_000
          : null
    const dollars = remaining == null ? null : Math.max(0, remaining)
    if (dollars == null && (provider === "openrouter" || percentUsed == null)) continue
    const percentLeft =
      dollars != null && limit != null && limit > 0
        ? Math.max(0, Math.min(100, (dollars / (limit / 1_000_000)) * 100))
        : percentUsed == null
          ? null
          : Math.max(0, Math.min(100, 100 - percentUsed))
    const severity = (percentLeft != null ? percentLeft <= 5 : dollars! <= 1)
      ? "critical"
      : (percentLeft != null ? percentLeft <= 20 : dollars! <= 5)
        ? "warning"
        : "neutral"
    windows.set(key || "credits", {
      key: key || "credits",
      displayValue:
        dollars == null ? Math.round(percentLeft!) + "% left" : "$" + dollars.toFixed(2) + " left",
      scope: scoped ? "model-specific" : "shared-provider",
      windowLabel,
      resetAt: row.resetAt,
      capturedAt: row.capturedAt,
      stale:
        now - +row.capturedAt >= Math.max(30_000, cadence * 2_000) ||
        Boolean(state?.lastErrorAt && +state.lastErrorAt > +row.capturedAt),
      severity,
      percentLeft,
    })
  }
  const available = [...windows.values()]
  const effective = [...available].sort(
    (a, b) =>
      Number(b.scope === "model-specific") - Number(a.scope === "model-specific") ||
      (a.percentLeft ?? 101) - (b.percentLeft ?? 101),
  )[0]
  return effective ? { effective, windows: available } : null
}

function durationLabel(row: Sample): string {
  const seconds = row.windowStart && row.resetAt ? (+row.resetAt - +row.windowStart) / 1_000 : 0
  if (seconds > 0 && seconds % 86_400 === 0) return seconds / 86_400 + "d"
  if (seconds > 0 && seconds % 3_600 === 0) return seconds / 3_600 + "h"
  if (seconds > 0 && seconds % 60 === 0) return seconds / 60 + "m"
  return "Quota"
}

function openRouterRemaining(row: Sample): number | null {
  try {
    const remaining = JSON.parse(row.rawPayload ?? "null")?.data?.limit_remaining
    const value = typeof remaining === "string" && remaining.trim() ? Number(remaining) : remaining
    if (typeof value === "number" && Number.isFinite(value)) return value
  } catch {
    // Older samples may only have normalized key limits.
  }
  return row.quotaLimit != null && row.quotaUsed != null
    ? (row.quotaLimit - row.quotaUsed) / 1_000_000
    : null
}
