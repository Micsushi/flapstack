export interface UsageSummaryRow {
  providerId: string
  accountTag?: string | null
  capturedAt?: Date | string | number | null
  windowStart?: Date | string | number | null
  windowEnd?: Date | string | number | null
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
export type UsageStatus =
  "healthy" | "underuse" | "very_underuse" | "warning" | "danger" | "critical"
export type UsageHistoryRange = "1h" | "6h" | "24h" | "7d" | "30d" | "all"
export type UsageHistoryGraphMode = "cumulative" | "period"

export interface UsageHistoryPoint {
  at: number
  value: number
}

export interface UsagePaceResult {
  status: UsageStatus
  label: string
  shortLabel: string
  paceApplied: boolean
  expectedUsed: number | null
  delta: number | null
}

export interface UsageHistorySeries {
  key: string
  label: string
  points: UsageHistoryPoint[]
  periodStrategy: "delta" | "sum"
}

const HISTORY_RANGE_MS: Record<Exclude<UsageHistoryRange, "all">, number> = {
  "1h": 60 * 60 * 1_000,
  "6h": 6 * 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
}

const PERIOD_BUCKET_MS: Record<Exclude<UsageHistoryRange, "all">, number> = {
  "1h": 5 * 60 * 1_000,
  "6h": 30 * 60 * 1_000,
  "24h": 2 * 60 * 60 * 1_000,
  "7d": 12 * 60 * 60 * 1_000,
  "30d": 24 * 60 * 60 * 1_000,
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

export function quotaPercentUsed(
  usage: Pick<UsageSummaryRow, "percentUsed" | "quotaUsed" | "quotaLimit">,
): number | null {
  const percent =
    usage.percentUsed ??
    (usage.quotaUsed != null && usage.quotaLimit != null && usage.quotaLimit > 0
      ? (usage.quotaUsed / usage.quotaLimit) * 100
      : null)
  return percent == null || !Number.isFinite(percent) ? null : Math.max(0, Math.min(100, percent))
}

export function quotaPercentRemaining(
  usage: Pick<UsageSummaryRow, "percentUsed" | "quotaUsed" | "quotaLimit">,
): number | null {
  const used = quotaPercentUsed(usage)
  return used == null ? null : Math.max(0, 100 - used)
}

export function usageSeverity(percentUsed: number): UsageStatus {
  if (percentUsed >= 95) return "critical"
  if (percentUsed >= 80) return "danger"
  if (percentUsed >= 50) return "warning"
  return "healthy"
}

const WEEKLY_PACE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000

function isWeeklyPaceQuota(metricKey: string | null | undefined): boolean {
  const normalized = metricKey?.trim().toLowerCase() ?? ""
  return (
    normalized === "seven_day" ||
    normalized === "seven_day_sonnet" ||
    normalized.includes("weekly") ||
    normalized.startsWith("wkly_")
  )
}

function roundedPercent(value: number): string {
  return Math.round(value).toString()
}

/** Exact OnWatch weekly pace classification. Weekly quotas compare usage with
 * the share of the reset cycle already elapsed; shorter quotas keep the raw
 * utilization thresholds above. */
export function usagePaceStatus(
  percentUsed: number,
  metricKey: string | null | undefined,
  resetAt: UsageSummaryRow["resetAt"],
  now = Date.now(),
): UsagePaceResult {
  const rawStatus = usageSeverity(percentUsed)
  const rawLabel =
    rawStatus === "critical"
      ? "Critical"
      : rawStatus === "danger"
        ? "Danger"
        : rawStatus === "warning"
          ? "Warning"
          : "Healthy"
  const resetTime = timestamp(resetAt)
  if (!isWeeklyPaceQuota(metricKey) || !resetTime) {
    return {
      status: rawStatus,
      label: rawLabel,
      shortLabel: rawLabel,
      paceApplied: false,
      expectedUsed: null,
      delta: null,
    }
  }

  const timeLeft = Math.max(0, Math.min(WEEKLY_PACE_WINDOW_MS, resetTime - now))
  const expectedUsed = Math.max(0, Math.min(100, 100 - (timeLeft / WEEKLY_PACE_WINDOW_MS) * 100))
  const delta = percentUsed - expectedUsed
  const remainingExpected = 100 - expectedUsed
  const overTimeThreshold = remainingExpected * 0.2
  const veryOverTimeThreshold = remainingExpected * 0.3
  const underTimeThreshold = expectedUsed * 0.2
  const veryUnderTimeThreshold = expectedUsed * 0.3

  const veryOver = delta > 0 && (delta >= 15 || delta >= veryOverTimeThreshold)
  const over = delta > 0 && (delta >= 10 || delta >= overTimeThreshold)
  if (veryOver || over) {
    const status = veryOver ? "critical" : "warning"
    const shortLabel = veryOver ? "Very overpace" : "Overpace"
    const timeLeftPercent = remainingExpected <= 0 ? 100 : (delta / remainingExpected) * 100
    return {
      status,
      shortLabel,
      label: `${shortLabel}: extra +${roundedPercent(delta)}% | time-left +${roundedPercent(timeLeftPercent)}%`,
      paceApplied: true,
      expectedUsed,
      delta,
    }
  }

  const reserve = -delta
  const veryUnder = delta < 0 && (reserve >= 15 || reserve >= veryUnderTimeThreshold)
  const under = delta < 0 && (reserve >= 10 || reserve >= underTimeThreshold)
  if (veryUnder || under) {
    const status = veryUnder ? "very_underuse" : "underuse"
    const shortLabel = veryUnder ? "Very under pace" : "Under pace"
    const elapsedPercent = expectedUsed <= 0 ? 100 : (reserve / expectedUsed) * 100
    return {
      status,
      shortLabel,
      label: `${shortLabel}: reserve +${roundedPercent(reserve)}% | elapsed +${roundedPercent(elapsedPercent)}%`,
      paceApplied: true,
      expectedUsed,
      delta,
    }
  }

  return {
    status: "healthy",
    label: "On pace",
    shortLabel: "On pace",
    paceApplied: true,
    expectedUsed,
    delta,
  }
}

/** Keep the complete time span while bounding SVG complexity. Each time bucket
 * retains both its minimum and maximum so quota resets and utilization peaks
 * survive compaction instead of silently dropping the oldest history. */
export function compactHistoryPoints(points: UsageHistoryPoint[], limit = 24): UsageHistoryPoint[] {
  if (points.length <= limit || limit < 4) return points
  const first = points[0]!
  const last = points.at(-1)!
  const interior = points.slice(1, -1)
  const bucketCount = Math.max(1, Math.floor((limit - 2) / 2))
  const compacted: UsageHistoryPoint[] = [first]
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket * interior.length) / bucketCount)
    const end = Math.floor(((bucket + 1) * interior.length) / bucketCount)
    const candidates = interior.slice(start, Math.max(start + 1, end))
    if (candidates.length === 0) continue
    let minimum = candidates[0]!
    let maximum = candidates[0]!
    for (const point of candidates.slice(1)) {
      if (point.value < minimum.value) minimum = point
      if (point.value > maximum.value) maximum = point
    }
    if (minimum.at <= maximum.at) {
      compacted.push(minimum)
      if (maximum !== minimum) compacted.push(maximum)
    } else {
      compacted.push(maximum, minimum)
    }
  }
  compacted.push(last)
  return compacted
}

export function buildUsageHistorySeries(
  rows: UsageSummaryRow[],
  metric: UsageHistoryMetric,
): UsageHistorySeries[] {
  const grouped = new Map<string, UsageHistorySeries>()
  for (const row of rows) {
    const isHistoricalBucket = row.sourceTag?.startsWith("organization-") === true
    const at = timestamp(isHistoricalBucket ? (row.windowStart ?? row.capturedAt) : row.capturedAt)
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
    const sourceTag = row.sourceTag ?? ""
    const key = JSON.stringify([row.providerId, account, metricKey, sourceTag])
    let series = grouped.get(key)
    if (!series) {
      series = {
        key,
        label: [row.providerId, account || "default", metricKey, sourceTag]
          .filter(Boolean)
          .join(" · "),
        points: [],
        periodStrategy: metric === "quota" || sourceTag === "key-limits" ? "delta" : "sum",
      }
      grouped.set(key, series)
    }
    series.points.push({ at, value })
  }
  return [...grouped.values()]
    .map((series) => ({
      ...series,
      points: series.points.sort((a, b) => a.at - b.at),
    }))
    .filter((series) => series.points.length > 0)
    .sort((a, b) => b.points[b.points.length - 1]!.at - a.points[a.points.length - 1]!.at)
    .slice(0, 8)
}

/** Apply the same range and cumulative/per-period choices exposed by OnWatch.
 * Quota percentages are cumulative snapshots, so period mode graphs positive
 * deltas. Token and cost rows are activity observations, so period mode sums
 * the values observed inside each bucket. Empty buckets remain absent. */
export function prepareUsageHistorySeries(
  series: UsageHistorySeries[],
  metric: UsageHistoryMetric,
  range: UsageHistoryRange,
  mode: UsageHistoryGraphMode,
  now = Date.now(),
): UsageHistorySeries[] {
  const since = range === "all" ? Number.NEGATIVE_INFINITY : now - HISTORY_RANGE_MS[range]
  const ranged = series
    .map((item) => ({
      ...item,
      points: item.points.filter((point) => point.at >= since && point.at <= now),
    }))
    .filter((item) => item.points.length > 0)

  if (mode === "cumulative") {
    return ranged.map((item) => {
      if (metric === "quota") {
        return { ...item, points: compactHistoryPoints(item.points) }
      }
      let cumulative = 0
      return {
        ...item,
        points: compactHistoryPoints(
          item.points.map((point) => {
            cumulative += point.value
            return { ...point, value: cumulative }
          }),
        ),
      }
    })
  }

  const allTimes = ranged.flatMap((item) => item.points.map((point) => point.at))
  const span = allTimes.length > 0 ? Math.max(...allTimes) - Math.min(...allTimes) : 0
  const bucketMs =
    range === "all" ? Math.max(60_000, Math.ceil(Math.max(span, 1) / 30)) : PERIOD_BUCKET_MS[range]

  return ranged
    .map((item) => {
      const buckets = new Map<number, number>()
      let previous: number | null = null
      for (const point of item.points) {
        const bucket = Math.floor(point.at / bucketMs) * bucketMs + bucketMs / 2
        const value =
          item.periodStrategy === "delta"
            ? previous == null
              ? 0
              : Math.max(0, point.value - previous)
            : point.value
        previous = point.value
        buckets.set(bucket, (buckets.get(bucket) ?? 0) + value)
      }
      return {
        ...item,
        points: [...buckets].map(([at, value]) => ({ at, value })).sort((a, b) => a.at - b.at),
      }
    })
    .filter((item) => item.points.length > 0)
}
