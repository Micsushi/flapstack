import type Database from "better-sqlite3"
import type {
  UsageInsightCapacity,
  UsageInsightMetric,
  UsageInsightQuery,
  UsageInsightQueryInput,
  UsageInsightResetWindow,
  UsageInsightUnit,
} from "../../../shared/advanced-usage"
import { usageInsightQuerySchema } from "../../../shared/advanced-usage"
import { queryUsageRollups, type UsageRollupMetrics, type UsageRollupValue } from "./rollups"
import type { UsageDb } from "./store"

const DAY_MS = 24 * 60 * 60 * 1_000

type Sqlite = Database.Database

type InsightFact = {
  id: string
  providerId: string
  model: string | null
  quality: "exact" | "provider-reported" | "estimated" | "unknown"
  capturedAtMs: number
  costUsdEstimatedMicros: number | null
  quotaUsed: number | null
  quotaLimit: number | null
  quotaUnit: string | null
  windowStartMs: number | null
  windowEndMs: number | null
  resetAtMs: number | null
  pricingVersion: string | null
}

export type UsageInsightResult = {
  query: UsageInsightQuery
  metric: UsageInsightMetric
  unit: UsageInsightUnit
  window: { fromMs: number; toMs: number; nowMs: number }
  coverage: {
    status: "sufficient" | "insufficient"
    sampleCount: number
    observedBuckets: number
    expectedBuckets: number
    ratio: number
    thresholds: UsageInsightQuery["coverage"]
    reasons: string[]
  }
  headroom: {
    status: "available" | "estimated" | "unavailable"
    limit: number | null
    used: number | null
    remaining: number | null
    remainingRange: { lower: number; upper: number } | null
    source: UsageInsightCapacity["source"] | null
    quality: UsageRollupValue["quality"]
    reason: string | null
  }
  burnRate: {
    status: "available" | "range" | "unavailable"
    perHour: number | null
    perDay: number | null
    perDayRange: { lower: number; upper: number } | null
    quality: UsageRollupValue["quality"]
    reason: string | null
  }
  resetAwarePace: {
    status: "ahead" | "on-pace" | "behind" | "uncertain" | "unavailable"
    resetWindow: UsageInsightResetWindow | null
    elapsedRatio: number | null
    usedRatio: number | null
    paceRatio: number | null
    paceRatioRange: { lower: number; upper: number } | null
    reason: string | null
  }
  forecast: {
    status: "range" | "unavailable"
    throughMs: number | null
    central: number | null
    lower: number | null
    upper: number | null
    quality: UsageRollupValue["quality"]
    reason: string | null
  }
  anomaly: {
    status: "normal" | "spike" | "possible-spike" | "unavailable"
    observed: number | null
    baselineMedian: number | null
    multiplier: number | null
    threshold: number | null
    bucketStartMs: number | null
    quality: UsageRollupValue["quality"]
    reason: string | null
  }
  pricing: {
    status: "not-applicable" | "single" | "mixed" | "unavailable"
    versions: Array<{
      version: string
      providerIds: string[]
      models: string[]
      firstSeenMs: number
      lastSeenMs: number
      factIds: string[]
    }>
    missingFactIds: string[]
  }
  provenance: {
    factIds: string[]
    sourceClasses: string[]
    rollupRevision: string
  }
}

export function queryUsageInsights(db: UsageDb, input: UsageInsightQueryInput): UsageInsightResult {
  const query = usageInsightQuerySchema.parse(input)
  const nowMs = query.nowMs ?? Date.now()
  const requestedToMs = query.rollup.toMs ?? nowMs
  const toMs = Math.min(requestedToMs, nowMs)
  const resetStartMs = query.capacity?.resetWindow?.startMs
  const fromMs = Math.max(query.rollup.fromMs ?? toMs - query.lookbackMs, resetStartMs ?? 0)
  if (toMs <= fromMs) throw new Error("Usage insight window must end after it starts.")

  const rollup = queryUsageRollups(db, {
    ...query.rollup,
    fromMs,
    toMs,
    bucket: "day",
    groupBy: "none",
    limit: 500,
    cursor: null,
  })
  const series = rollup.items
    .map((item) => ({ item, value: metricValue(item.metrics, query.metric) }))
    .filter((entry): entry is { item: UsageRollupValue; value: number } => entry.value !== null)
  const totalValue = metricValue(rollup.totals.metrics, query.metric)
  const facts = readInsightFacts(rawClient(db), rollup.totals.factIds)
  const autoCapacity = providerCapacity(query.metric, facts)
  const capacity = query.capacity ?? autoCapacity
  const capacityUsed = query.capacity ? totalValue : (autoCapacity?.observedUsed ?? null)
  const resetWindow = capacity?.resetWindow ?? null
  const quality = rollup.totals.quality
  const coverage = coverageResult(query, rollup.totals.factIds.length, series.length, fromMs, toMs)
  const pricing = pricingResult(query.metric, facts)
  const burnRate = burnRateResult(totalValue, quality, coverage, fromMs, toMs)
  const headroom = headroomResult(capacity, capacityUsed, quality)
  const resetAwarePace = paceResult(capacity, capacityUsed, resetWindow, quality, nowMs)
  const forecast = forecastResult({
    query,
    quality,
    coverage,
    pricing,
    burnRate,
    used: capacityUsed ?? totalValue,
    resetWindow,
    nowMs,
    series: series.map((entry) => entry.value),
  })

  return {
    query,
    metric: query.metric,
    unit: metricUnit(query.metric),
    window: { fromMs, toMs, nowMs },
    coverage,
    headroom,
    burnRate,
    resetAwarePace,
    forecast,
    anomaly: anomalyResult(series, query, quality),
    pricing,
    provenance: {
      factIds: rollup.totals.factIds,
      sourceClasses: rollup.totals.sourceClasses,
      rollupRevision: rollup.cache.revision,
    },
  }
}

function coverageResult(
  query: UsageInsightQuery,
  sampleCount: number,
  observedBuckets: number,
  fromMs: number,
  toMs: number,
): UsageInsightResult["coverage"] {
  const expectedBuckets = Math.max(1, Math.ceil((toMs - fromMs) / DAY_MS))
  const ratio = round(Math.min(1, observedBuckets / expectedBuckets), 6)
  const reasons: string[] = []
  if (sampleCount < query.coverage.minSamples) reasons.push("too-few-samples")
  if (observedBuckets < query.coverage.minBuckets) reasons.push("too-few-buckets")
  if (ratio < query.coverage.minRatio) reasons.push("insufficient-time-coverage")
  return {
    status: reasons.length ? "insufficient" : "sufficient",
    sampleCount,
    observedBuckets,
    expectedBuckets,
    ratio,
    thresholds: query.coverage,
    reasons,
  }
}

function burnRateResult(
  total: number | null,
  quality: UsageRollupValue["quality"],
  coverage: UsageInsightResult["coverage"],
  fromMs: number,
  toMs: number,
): UsageInsightResult["burnRate"] {
  if (total === null) return unavailableBurn(quality, "metric-unavailable")
  if (quality === "unknown") return unavailableBurn(quality, "quality-unknown")
  if (coverage.status === "insufficient") return unavailableBurn(quality, "insufficient-coverage")
  const hours = (toMs - fromMs) / (60 * 60 * 1_000)
  const perHour = total / hours
  const perDay = perHour * 24
  if (quality === "estimated") {
    return {
      status: "range",
      perHour: null,
      perDay: null,
      perDayRange: estimateRange(perDay, 0.25),
      quality,
      reason: "estimated-source",
    }
  }
  return {
    status: "available",
    perHour: round(perHour),
    perDay: round(perDay),
    perDayRange: null,
    quality,
    reason: null,
  }
}

function unavailableBurn(
  quality: UsageRollupValue["quality"],
  reason: string,
): UsageInsightResult["burnRate"] {
  return {
    status: "unavailable",
    perHour: null,
    perDay: null,
    perDayRange: null,
    quality,
    reason,
  }
}

function headroomResult(
  capacity: UsageInsightCapacity | null | undefined,
  used: number | null,
  quality: UsageRollupValue["quality"],
): UsageInsightResult["headroom"] {
  if (!capacity) return unavailableHeadroom(quality, "capacity-unavailable")
  if (used === null) return unavailableHeadroom(quality, "usage-unavailable")
  if (quality === "estimated") {
    const usedRange = estimateRange(used, 0.25)
    return {
      status: "estimated",
      limit: capacity.value,
      used: null,
      remaining: null,
      remainingRange: {
        lower: round(Math.max(0, capacity.value - usedRange.upper)),
        upper: round(Math.max(0, capacity.value - usedRange.lower)),
      },
      source: capacity.source,
      quality,
      reason: "estimated-source",
    }
  }
  return {
    status: "available",
    limit: capacity.value,
    used,
    remaining: round(Math.max(0, capacity.value - used)),
    remainingRange: null,
    source: capacity.source,
    quality,
    reason: null,
  }
}

function unavailableHeadroom(
  quality: UsageRollupValue["quality"],
  reason: string,
): UsageInsightResult["headroom"] {
  return {
    status: "unavailable",
    limit: null,
    used: null,
    remaining: null,
    remainingRange: null,
    source: null,
    quality,
    reason,
  }
}

function paceResult(
  capacity: UsageInsightCapacity | null | undefined,
  used: number | null,
  resetWindow: UsageInsightResetWindow | null,
  quality: UsageRollupValue["quality"],
  nowMs: number,
): UsageInsightResult["resetAwarePace"] {
  if (!capacity || used === null) return unavailablePace(resetWindow, "headroom-unavailable")
  if (!resetWindow) return unavailablePace(null, "reset-window-unavailable")
  if (nowMs < resetWindow.startMs || nowMs >= resetWindow.endMs) {
    return unavailablePace(resetWindow, "outside-reset-window")
  }
  const elapsedRatio = (nowMs - resetWindow.startMs) / (resetWindow.endMs - resetWindow.startMs)
  if (elapsedRatio <= 0) return unavailablePace(resetWindow, "reset-window-not-started")
  const usedRatio = used / capacity.value
  const paceRatio = usedRatio / elapsedRatio
  if (quality === "estimated") {
    return {
      status: "uncertain",
      resetWindow,
      elapsedRatio: round(elapsedRatio, 6),
      usedRatio: null,
      paceRatio: null,
      paceRatioRange: estimateRange(paceRatio, 0.25),
      reason: "estimated-source",
    }
  }
  return {
    status: paceRatio > 1.1 ? "ahead" : paceRatio < 0.9 ? "behind" : "on-pace",
    resetWindow,
    elapsedRatio: round(elapsedRatio, 6),
    usedRatio: round(usedRatio, 6),
    paceRatio: round(paceRatio, 6),
    paceRatioRange: null,
    reason: null,
  }
}

function unavailablePace(
  resetWindow: UsageInsightResetWindow | null,
  reason: string,
): UsageInsightResult["resetAwarePace"] {
  return {
    status: "unavailable",
    resetWindow,
    elapsedRatio: null,
    usedRatio: null,
    paceRatio: null,
    paceRatioRange: null,
    reason,
  }
}

function forecastResult(params: {
  query: UsageInsightQuery
  quality: UsageRollupValue["quality"]
  coverage: UsageInsightResult["coverage"]
  pricing: UsageInsightResult["pricing"]
  burnRate: UsageInsightResult["burnRate"]
  used: number | null
  resetWindow: UsageInsightResetWindow | null
  nowMs: number
  series: number[]
}): UsageInsightResult["forecast"] {
  const unavailable = (reason: string): UsageInsightResult["forecast"] => ({
    status: "unavailable",
    throughMs: null,
    central: null,
    lower: null,
    upper: null,
    quality: params.quality,
    reason,
  })
  if (params.coverage.status === "insufficient") return unavailable("insufficient-coverage")
  if (params.quality === "unknown") return unavailable("quality-unknown")
  if (params.used === null) return unavailable("metric-unavailable")
  if (
    params.query.metric === "cost-usd-micros" &&
    params.quality === "estimated" &&
    params.pricing.status === "unavailable"
  ) {
    return unavailable("pricing-version-unavailable")
  }
  const throughMs = params.resetWindow?.endMs ?? params.nowMs + params.query.forecastHorizonMs
  if (throughMs <= params.nowMs) return unavailable("forecast-window-ended")
  const remainingDays = (throughMs - params.nowMs) / DAY_MS
  const daily =
    params.burnRate.perDay ??
    (params.burnRate.perDayRange
      ? (params.burnRate.perDayRange.lower + params.burnRate.perDayRange.upper) / 2
      : null)
  if (daily === null) return unavailable(params.burnRate.reason ?? "burn-rate-unavailable")
  const central = params.used + daily * remainingDays
  const medianValue = median(params.series)
  const deviation = median(params.series.map((value) => Math.abs(value - medianValue)))
  let uncertainty = Math.max(0.1, medianValue > 0 ? deviation / medianValue : 0.1)
  if (params.quality === "estimated") uncertainty += 0.25
  if (params.pricing.status === "mixed") uncertainty += 0.15
  uncertainty = Math.min(1, uncertainty)
  const projectedIncrement = daily * remainingDays
  return {
    status: "range",
    throughMs,
    central:
      params.quality === "estimated" || params.pricing.status === "mixed" ? null : round(central),
    lower: round(params.used + Math.max(0, projectedIncrement * (1 - uncertainty))),
    upper: round(params.used + projectedIncrement * (1 + uncertainty)),
    quality: params.quality,
    reason:
      params.quality === "estimated"
        ? "estimated-source"
        : params.pricing.status === "mixed"
          ? "pricing-version-change"
          : null,
  }
}

function anomalyResult(
  series: Array<{ item: UsageRollupValue; value: number }>,
  query: UsageInsightQuery,
  quality: UsageRollupValue["quality"],
): UsageInsightResult["anomaly"] {
  const unavailable = (reason: string): UsageInsightResult["anomaly"] => ({
    status: "unavailable",
    observed: null,
    baselineMedian: null,
    multiplier: null,
    threshold: null,
    bucketStartMs: null,
    quality,
    reason,
  })
  if (quality === "unknown") return unavailable("quality-unknown")
  if (series.length < query.anomaly.minBaselineBuckets + 1) {
    return unavailable("insufficient-anomaly-baseline")
  }
  const current = series.at(-1)!
  const baseline = series.slice(0, -1).map((entry) => entry.value)
  const baselineMedian = median(baseline)
  if (baselineMedian <= 0) return unavailable("zero-anomaly-baseline")
  const absoluteDeviations = baseline.map((value) => Math.abs(value - baselineMedian))
  const robustThreshold = baselineMedian + 3 * median(absoluteDeviations)
  const multiplierThreshold = baselineMedian * query.anomaly.spikeMultiplier
  const threshold = Math.max(robustThreshold, multiplierThreshold)
  const spiked = current.value >= threshold
  return {
    status: spiked ? (quality === "estimated" ? "possible-spike" : "spike") : "normal",
    observed: current.value,
    baselineMedian,
    multiplier: round(current.value / baselineMedian, 6),
    threshold: round(threshold),
    bucketStartMs: current.item.bucketStartMs,
    quality,
    reason: quality === "estimated" ? "estimated-source" : null,
  }
}

function pricingResult(
  metric: UsageInsightMetric,
  facts: InsightFact[],
): UsageInsightResult["pricing"] {
  const estimatedFacts = facts.filter(
    (fact) => fact.quality === "estimated" && fact.costUsdEstimatedMicros !== null,
  )
  if (metric !== "cost-usd-micros" || estimatedFacts.length === 0) {
    return { status: "not-applicable", versions: [], missingFactIds: [] }
  }
  const missingFactIds = estimatedFacts
    .filter((fact) => !fact.pricingVersion)
    .map((fact) => fact.id)
    .sort()
  const grouped = new Map<string, InsightFact[]>()
  for (const fact of estimatedFacts) {
    if (!fact.pricingVersion) continue
    const values = grouped.get(fact.pricingVersion) ?? []
    values.push(fact)
    grouped.set(fact.pricingVersion, values)
  }
  const versions = [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([version, values]) => ({
      version,
      providerIds: [...new Set(values.map((fact) => fact.providerId))].sort(),
      models: [...new Set(values.flatMap((fact) => (fact.model ? [fact.model] : [])))].sort(),
      firstSeenMs: Math.min(...values.map((fact) => fact.capturedAtMs)),
      lastSeenMs: Math.max(...values.map((fact) => fact.capturedAtMs)),
      factIds: values.map((fact) => fact.id).sort(),
    }))
  return {
    status: missingFactIds.length ? "unavailable" : versions.length > 1 ? "mixed" : "single",
    versions,
    missingFactIds,
  }
}

function providerCapacity(
  metric: UsageInsightMetric,
  facts: InsightFact[],
): (UsageInsightCapacity & { observedUsed: number }) | null {
  if (metric !== "cost-usd-micros") return null
  const latest = facts
    .filter(
      (fact) =>
        fact.quotaUnit === "usd-micros" && fact.quotaUsed !== null && fact.quotaLimit !== null,
    )
    .sort(
      (left, right) => right.capturedAtMs - left.capturedAtMs || right.id.localeCompare(left.id),
    )[0]
  if (!latest || latest.quotaLimit! <= 0) return null
  const resetEndMs = latest.resetAtMs ?? latest.windowEndMs
  const resetWindow =
    latest.windowStartMs !== null && resetEndMs !== null && resetEndMs > latest.windowStartMs
      ? {
          startMs: latest.windowStartMs,
          endMs: resetEndMs,
          source: "provider" as const,
        }
      : null
  return {
    value: latest.quotaLimit!,
    unit: "usd-micros",
    source: "provider-quota",
    resetWindow,
    observedUsed: latest.quotaUsed!,
  }
}

function metricValue(metrics: UsageRollupMetrics, metric: UsageInsightMetric): number | null {
  if (metric === "total-tokens") return metrics.totalTokens
  if (metric === "request-count") return metrics.requestCount
  const values = [metrics.costUsdMicros, metrics.costUsdEstimatedMicros].filter(
    (value): value is number => value !== null,
  )
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}

function metricUnit(metric: UsageInsightMetric): UsageInsightUnit {
  if (metric === "cost-usd-micros") return "usd-micros"
  if (metric === "total-tokens") return "tokens"
  return "requests"
}

function readInsightFacts(sqlite: Sqlite, factIds: string[]): InsightFact[] {
  const rows: Array<Record<string, unknown>> = []
  for (let offset = 0; offset < factIds.length; offset += 400) {
    const ids = factIds.slice(offset, offset + 400)
    const placeholders = ids.map(() => "?").join(", ")
    rows.push(
      ...(sqlite
        .prepare(
          `SELECT id, provider_id, model, cost_quality, captured_at,
                  cost_usd_estimated_micros, quota_used, quota_limit, quota_unit,
                  window_start, window_end, reset_at, raw_payload
           FROM usage_samples
           WHERE id IN (${placeholders})`,
        )
        .all(...ids) as Array<Record<string, unknown>>),
    )
  }
  return rows
    .map((row) => ({
      id: String(row.id),
      providerId: String(row.provider_id),
      model: stringOrNull(row.model),
      quality: quality(row.cost_quality),
      capturedAtMs: epochMs(row.captured_at) ?? 0,
      costUsdEstimatedMicros: finiteNumber(row.cost_usd_estimated_micros),
      quotaUsed: finiteNumber(row.quota_used),
      quotaLimit: finiteNumber(row.quota_limit),
      quotaUnit: stringOrNull(row.quota_unit),
      windowStartMs: epochMs(row.window_start),
      windowEndMs: epochMs(row.window_end),
      resetAtMs: epochMs(row.reset_at),
      pricingVersion: pricingVersion(row.raw_payload),
    }))
    .sort(
      (left, right) => left.capturedAtMs - right.capturedAtMs || left.id.localeCompare(right.id),
    )
}

function rawClient(db: UsageDb): Sqlite {
  return (db as unknown as { $client: Sqlite }).$client
}

function pricingVersion(rawPayload: unknown): string | null {
  if (typeof rawPayload !== "string" || rawPayload.length === 0) return null
  try {
    const parsed = JSON.parse(rawPayload) as unknown
    if (!parsed || typeof parsed !== "object") return null
    const provenance = (parsed as { flapstackProvenance?: unknown }).flapstackProvenance
    if (!provenance || typeof provenance !== "object") return null
    return stringOrNull((provenance as { pricingVersion?: unknown }).pricingVersion)
  } catch {
    return null
  }
}

function quality(value: unknown): InsightFact["quality"] {
  return value === "exact" || value === "provider-reported" || value === "estimated"
    ? value
    : "unknown"
}

function epochMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime()
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value < 10_000_000_000 ? value * 1_000 : value
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function estimateRange(value: number, uncertainty: number): { lower: number; upper: number } {
  return {
    lower: round(Math.max(0, value * (1 - uncertainty))),
    upper: round(value * (1 + uncertainty)),
  }
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right)
  if (!ordered.length) return 0
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
