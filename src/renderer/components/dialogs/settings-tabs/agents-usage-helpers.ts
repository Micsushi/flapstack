export interface UsageSummaryRow {
  providerId: string
  accountTag?: string | null
  capturedAt?: Date | string | number | null
  source?: string | null
  sourceTag?: string | null
  metricKey?: string | null
  costQuality?: string | null
  costUsd?: number | null
  costUsdEstimated?: number | null
  totalTokens?: number | null
  percentUsed?: number | null
  quotaUsed?: number | null
  quotaLimit?: number | null
  quotaUnit?: string | null
  resetAt?: Date | string | number | null
}

export type UsageHistoryMetric = "quota" | "cost" | "tokens"

export interface UsageHistorySeries {
  key: string
  label: string
  points: Array<{ at: number; value: number }>
}

export interface CurrentUsageSummary {
  providerId: string
  accountTag: string
  capturedAt: UsageSummaryRow["capturedAt"]
  source: string | null
  sourceTag: string | null
  metricKey: string | null
  costQuality: string | null
  costUsd: number | null
  costUsdEstimated: number | null
  totalTokens: number | null
  percentUsed: number | null
  quotaUsed: number | null
  quotaLimit: number | null
  quotaUnit: UsageSummaryRow["quotaUnit"]
  resetAt: UsageSummaryRow["resetAt"]
}

function timestamp(value: UsageSummaryRow["capturedAt"]): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/** Build one honest current card per provider/account from the currently loaded
 * samples. Metrics can arrive in separate provider rows (for example, one cost
 * bucket and one token bucket), so each field uses its newest non-null value
 * rather than inventing totals or treating missing data as zero. */
export function buildCurrentUsageSummaries(rows: UsageSummaryRow[]): CurrentUsageSummary[] {
  const summaries = new Map<string, CurrentUsageSummary>()
  const sorted = [...rows].sort(
    (left, right) => timestamp(right.capturedAt) - timestamp(left.capturedAt),
  )

  for (const row of sorted) {
    const accountTag = row.accountTag ?? ""
    const metricKey = row.metricKey ?? ""
    const key = JSON.stringify([row.providerId, accountTag, metricKey])
    let summary = summaries.get(key)
    if (!summary) {
      summary = {
        providerId: row.providerId,
        accountTag,
        capturedAt: row.capturedAt ?? null,
        source: row.source ?? null,
        sourceTag: row.sourceTag ?? null,
        metricKey: row.metricKey ?? null,
        costQuality: null,
        costUsd: null,
        costUsdEstimated: null,
        totalTokens: null,
        percentUsed: null,
        quotaUsed: null,
        quotaLimit: null,
        quotaUnit: null,
        resetAt: null,
      }
      summaries.set(key, summary)
    }

    if (
      summary.costUsd == null &&
      summary.costUsdEstimated == null &&
      (row.costUsd != null || row.costUsdEstimated != null)
    ) {
      summary.costUsd = row.costUsd ?? null
      summary.costUsdEstimated = row.costUsdEstimated ?? null
      summary.costQuality = row.costQuality ?? null
    }
    if (summary.totalTokens == null && row.totalTokens != null)
      summary.totalTokens = row.totalTokens
    if (summary.percentUsed == null && row.percentUsed != null)
      summary.percentUsed = row.percentUsed
    if (summary.quotaUsed == null && row.quotaUsed != null) summary.quotaUsed = row.quotaUsed
    if (summary.quotaLimit == null && row.quotaLimit != null) summary.quotaLimit = row.quotaLimit
    if (
      summary.quotaUnit == null &&
      row.quotaUnit != null &&
      (row.quotaUsed != null || row.quotaLimit != null)
    )
      summary.quotaUnit = row.quotaUnit
    if (summary.resetAt == null && row.resetAt != null) summary.resetAt = row.resetAt
  }

  return [...summaries.values()]
}

export function accountLabel(accountTag: string | null | undefined): string {
  return accountTag ? accountTag : "Default account"
}

export function formatQuotaUsage(
  usage: Pick<UsageSummaryRow, "percentUsed" | "quotaUsed" | "quotaLimit" | "quotaUnit">,
  missing = "Not reported",
): string {
  if (usage.percentUsed != null) return `${usage.percentUsed}% used`
  if (usage.quotaUsed == null || usage.quotaLimit == null) return missing
  if (usage.quotaUnit === "usd-micros") {
    const formatMicros = (value: number) =>
      `$${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })}`
    return `${formatMicros(usage.quotaUsed)} / ${formatMicros(usage.quotaLimit)}`
  }
  return `${usage.quotaUsed.toLocaleString()} / ${usage.quotaLimit.toLocaleString()}`
}

export function buildUsageHistorySeries(
  rows: UsageSummaryRow[],
  metric: UsageHistoryMetric,
): UsageHistorySeries[] {
  const grouped = new Map<string, UsageHistorySeries>()
  for (const row of rows) {
    const at = timestamp(row.capturedAt)
    if (!at) continue
    const value =
      metric === "quota"
        ? row.percentUsed
        : metric === "cost"
          ? (row.costUsd ?? row.costUsdEstimated)
          : row.totalTokens
    if (value == null || !Number.isFinite(value)) continue
    const account = row.accountTag ?? ""
    const metricKey = row.metricKey ?? ""
    const key = JSON.stringify([row.providerId, account, metricKey])
    let series = grouped.get(key)
    if (!series) {
      series = {
        key,
        label: [row.providerId, account || "default", metricKey].filter(Boolean).join(" · "),
        points: [],
      }
      grouped.set(key, series)
    }
    series.points.push({ at, value })
  }
  return [...grouped.values()]
    .map((series) => ({ ...series, points: series.points.sort((a, b) => a.at - b.at).slice(-100) }))
    .filter((series) => series.points.length > 0)
    .sort((a, b) => b.points[b.points.length - 1]!.at - a.points[a.points.length - 1]!.at)
    .slice(0, 8)
}
