import type Database from "better-sqlite3"
import type {
  UsageRollupBucketUnit,
  UsageRollupGroupDimension,
  UsageRollupQuality,
  UsageRollupQuery,
  UsageRollupQueryInput,
  UsageRollupScope,
  UsageSourceClass,
} from "../../../shared/advanced-usage"
import { usageRollupQuerySchema } from "../../../shared/advanced-usage"
import { backfillUsageAttribution } from "./attribution"
import type { UsageDb } from "./store"
import {
  epochMs,
  finiteNumber,
  normalizeLocal,
  stringOrNull,
  zonedLocalToUtc,
  zonedParts,
} from "./time"

type Sqlite = Database.Database

const METRIC_FIELDS = [
  "inputTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
  "requestCount",
  "costUsdMicros",
  "costUsdEstimatedMicros",
] as const

type MetricField = (typeof METRIC_FIELDS)[number]
export type UsageRollupMetrics = Record<MetricField, number | null>

export type UsageRollupValue = {
  key: string
  dimension: UsageRollupGroupDimension
  value: string
  label: string | null
  bucketStartMs: number | null
  bucketEndMs: number | null
  quality: UsageRollupQuality
  metrics: UsageRollupMetrics
  sourceClasses: UsageSourceClass[]
  factIds: string[]
}

export type UsageRollupResult = {
  query: UsageRollupQuery
  totals: Omit<UsageRollupValue, "key" | "dimension" | "value" | "label">
  items: UsageRollupValue[]
  page: {
    totalItems: number
    nextCursor: string | null
  }
  reconciliation: {
    rawFactCount: number
    selectedFactCount: number
    contributingFactCount: number
    suppressedMetricCount: number
  }
  cache: {
    revision: string
    rebuiltAtMs: number
  }
}

export type UsageRollupCacheStatus = {
  revision: string
  rebuiltAtMs: number
  rawFactCount: number
  selectedFactCount: number
}

type RawFact = {
  id: string
  providerId: string
  accountTag: string
  source: string
  sourceClass: UsageSourceClass
  quality: UsageRollupQuality
  capturedAtMs: number
  windowStartMs: number | null
  windowEndMs: number | null
  model: string | null
  harness: string | null
  projectId: string | null
  projectName: string | null
  taskId: string | null
  taskName: string | null
  chatId: string | null
  chatName: string | null
  automationId: string | null
  automationName: string | null
  orchestrationId: string | null
  orchestrationName: string | null
  runId: string | null
  dedupeStrategy: string
  dedupeGroupKey: string | null
  metrics: UsageRollupMetrics
}

type Contribution = {
  fact: RawFact
  metrics: UsageRollupMetrics
}

type FactCache = UsageRollupCacheStatus & {
  rawFacts: RawFact[]
  selectedFacts: RawFact[]
}

const factCaches = new WeakMap<Sqlite, FactCache>()
export function queryUsageRollups(db: UsageDb, input: UsageRollupQueryInput): UsageRollupResult {
  const query = usageRollupQuerySchema.parse(input)
  const cache = readFactCache(db)
  const rawFacts = cache.rawFacts.filter((fact) => matchesQuery(fact, query))
  const selectedFacts = cache.selectedFacts.filter((fact) => matchesQuery(fact, query))
  const { contributions, suppressedMetricCount } = reconcileFacts(selectedFacts, query)
  const totals = aggregate(contributions, null, null)
  const grouped = groupContributions(contributions, query)
  const allItems = [...grouped.values()]
    .map(({ contributions: groupFacts, ...identity }) => ({
      ...identity,
      ...aggregate(groupFacts, identity.bucketStartMs, identity.bucketEndMs),
    }))
    .sort(
      (left, right) =>
        (left.bucketStartMs ?? -1) - (right.bucketStartMs ?? -1) ||
        left.dimension.localeCompare(right.dimension) ||
        left.value.localeCompare(right.value),
    )
  const startIndex = cursorStart(query.cursor, allItems)
  const items = allItems.slice(startIndex, startIndex + query.limit)
  const hasMore = startIndex + items.length < allItems.length

  return {
    query,
    totals,
    items,
    page: {
      totalItems: allItems.length,
      nextCursor: hasMore && items.length ? encodeCursor(items.at(-1)!.key) : null,
    },
    reconciliation: {
      rawFactCount: rawFacts.length,
      selectedFactCount: selectedFacts.length,
      contributingFactCount: contributions.length,
      suppressedMetricCount,
    },
    cache: { revision: cache.revision, rebuiltAtMs: cache.rebuiltAtMs },
  }
}

/** Raw facts stay authoritative. This discards and reconstructs the optimization cache. */
export function rebuildUsageRollupCache(db: UsageDb): UsageRollupCacheStatus {
  const cache = readFactCache(db, true)
  return {
    revision: cache.revision,
    rebuiltAtMs: cache.rebuiltAtMs,
    rawFactCount: cache.rawFactCount,
    selectedFactCount: cache.selectedFactCount,
  }
}

function readFactCache(db: UsageDb, force = false): FactCache {
  backfillUsageAttribution(db)
  const sqlite = rawClient(db)
  const revision = databaseRevision(sqlite)
  const current = factCaches.get(sqlite)
  if (!force && current?.revision === revision) return current

  const rawFacts = readRawFacts(sqlite)
  const selectedFacts = selectLatestOverlapFacts(rawFacts)
  const cache: FactCache = {
    revision,
    rebuiltAtMs: Date.now(),
    rawFactCount: rawFacts.length,
    selectedFactCount: selectedFacts.length,
    rawFacts,
    selectedFacts,
  }
  factCaches.set(sqlite, cache)
  return cache
}

function rawClient(db: UsageDb): Sqlite {
  return (db as unknown as { $client: Sqlite }).$client
}

function databaseRevision(sqlite: Sqlite): string {
  const dataVersion = sqlite.pragma("data_version", { simple: true })
  const changes = sqlite.prepare("SELECT total_changes() AS value").get() as { value: number }
  return `${String(dataVersion)}:${changes.value}`
}

function readRawFacts(sqlite: Sqlite): RawFact[] {
  const rows = sqlite
    .prepare(
      `SELECT id, provider_id, account_tag, source, source_class, cost_quality,
              captured_at, window_start, window_end,
              input_tokens, output_tokens, reasoning_tokens, total_tokens, request_count,
              cost_usd_micros, cost_usd_estimated_micros, model,
              attribution_harness,
              attribution_project_id, attribution_project_name,
              attribution_task_id, attribution_task_name,
              attribution_chat_id, attribution_chat_name,
              attribution_automation_id, attribution_automation_name,
              attribution_orchestration_id, attribution_orchestration_name,
              attribution_run_id, dedupe_strategy, dedupe_group_key
       FROM usage_samples
       ORDER BY id`,
    )
    .all() as Array<Record<string, unknown>>

  return rows.flatMap((row) => {
    const capturedAtMs = epochMs(row.captured_at)
    if (capturedAtMs === null) return []
    return [
      {
        id: String(row.id),
        providerId: String(row.provider_id),
        accountTag: typeof row.account_tag === "string" ? row.account_tag : "",
        source: String(row.source),
        sourceClass: sourceClass(row.source_class),
        quality: quality(row.cost_quality),
        capturedAtMs,
        windowStartMs: epochMs(row.window_start),
        windowEndMs: epochMs(row.window_end),
        model: stringOrNull(row.model),
        harness: stringOrNull(row.attribution_harness),
        projectId: stringOrNull(row.attribution_project_id),
        projectName: stringOrNull(row.attribution_project_name),
        taskId: stringOrNull(row.attribution_task_id),
        taskName: stringOrNull(row.attribution_task_name),
        chatId: stringOrNull(row.attribution_chat_id),
        chatName: stringOrNull(row.attribution_chat_name),
        automationId: stringOrNull(row.attribution_automation_id),
        automationName: stringOrNull(row.attribution_automation_name),
        orchestrationId: stringOrNull(row.attribution_orchestration_id),
        orchestrationName: stringOrNull(row.attribution_orchestration_name),
        runId: stringOrNull(row.attribution_run_id),
        dedupeStrategy: String(row.dedupe_strategy),
        dedupeGroupKey: stringOrNull(row.dedupe_group_key),
        metrics: {
          inputTokens: finiteNumber(row.input_tokens),
          outputTokens: finiteNumber(row.output_tokens),
          reasoningTokens: finiteNumber(row.reasoning_tokens),
          totalTokens: finiteNumber(row.total_tokens),
          requestCount: finiteNumber(row.request_count),
          costUsdMicros: finiteNumber(row.cost_usd_micros),
          costUsdEstimatedMicros: finiteNumber(row.cost_usd_estimated_micros),
        },
      },
    ]
  })
}

function selectLatestOverlapFacts(facts: RawFact[]): RawFact[] {
  const selected = new Map<string, RawFact>()
  for (const fact of facts) {
    const key =
      fact.dedupeStrategy === "overlap-group" && fact.dedupeGroupKey
        ? `group:${fact.sourceClass}:${fact.dedupeGroupKey}`
        : `fact:${fact.id}`
    const current = selected.get(key)
    if (
      !current ||
      fact.capturedAtMs > current.capturedAtMs ||
      (fact.capturedAtMs === current.capturedAtMs && fact.id.localeCompare(current.id) > 0)
    ) {
      selected.set(key, fact)
    }
  }
  return [...selected.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function matchesQuery(fact: RawFact, query: UsageRollupQuery): boolean {
  if (!matchesScope(fact, query.scope)) return false
  if (query.fromMs !== undefined && fact.capturedAtMs < query.fromMs) return false
  if (query.toMs !== undefined && fact.capturedAtMs >= query.toMs) return false
  if (query.providerIds && !query.providerIds.includes(fact.providerId)) return false
  if (query.accountTags && !query.accountTags.includes(fact.accountTag)) return false
  if (query.harnesses && (!fact.harness || !query.harnesses.includes(fact.harness as never))) {
    return false
  }
  if (query.models && (!fact.model || !query.models.includes(fact.model))) return false
  if (query.sources && !query.sources.includes(fact.source)) return false
  if (query.sourceClasses && !query.sourceClasses.includes(fact.sourceClass)) return false
  if (query.qualities && !query.qualities.includes(fact.quality)) return false
  return query.groupBy === "none" || groupIdentity(fact, query.groupBy) !== null
}

function matchesScope(fact: RawFact, scope: UsageRollupScope): boolean {
  switch (scope.type) {
    case "global":
      return true
    case "provider-account":
      return fact.providerId === scope.providerId && fact.accountTag === scope.accountTag
    case "project":
      return fact.projectId === scope.id
    case "task":
      return fact.taskId === scope.id
    case "chat":
      return fact.chatId === scope.id
    case "automation":
      return fact.automationId === scope.id
    case "orchestration":
      return fact.orchestrationId === scope.id
    case "run":
      return fact.runId === scope.id
  }
}

function reconcileFacts(
  facts: RawFact[],
  query: UsageRollupQuery,
): { contributions: Contribution[]; suppressedMetricCount: number } {
  const providerTotals = facts.filter((fact) => fact.sourceClass === "provider-account-total")
  const isolateOneClass = query.sourceClasses?.length === 1
  let suppressedMetricCount = 0
  const contributions = facts.flatMap((fact): Contribution[] => {
    const metrics = { ...fact.metrics }
    if (!isolateOneClass && fact.sourceClass !== "provider-account-total") {
      const coveringTotals = providerTotals.filter(
        (providerFact) =>
          providerFact.providerId === fact.providerId &&
          providerFact.accountTag === fact.accountTag &&
          factsOverlap(providerFact, fact),
      )
      for (const field of METRIC_FIELDS) {
        if (
          metrics[field] !== null &&
          coveringTotals.some((providerFact) =>
            coveredMetricFields(field).some(
              (coveredField) => providerFact.metrics[coveredField] !== null,
            ),
          )
        ) {
          metrics[field] = null
          suppressedMetricCount += 1
        }
      }
    }
    return hasMetric(metrics) ? [{ fact, metrics }] : []
  })
  return { contributions, suppressedMetricCount }
}

function coveredMetricFields(field: MetricField): MetricField[] {
  return field === "costUsdMicros" || field === "costUsdEstimatedMicros"
    ? ["costUsdMicros", "costUsdEstimatedMicros"]
    : [field]
}

function factsOverlap(left: RawFact, right: RawFact): boolean {
  const leftStart = left.windowStartMs ?? left.capturedAtMs
  const leftEnd = left.windowEndMs ?? left.capturedAtMs + 1
  const rightStart = right.windowStartMs ?? right.capturedAtMs
  const rightEnd = right.windowEndMs ?? right.capturedAtMs + 1
  return leftStart < rightEnd && rightStart < leftEnd
}

function groupContributions(contributions: Contribution[], query: UsageRollupQuery) {
  const groups = new Map<
    string,
    {
      key: string
      dimension: UsageRollupGroupDimension
      value: string
      label: string | null
      bucketStartMs: number | null
      bucketEndMs: number | null
      contributions: Contribution[]
    }
  >()
  for (const contribution of contributions) {
    const identity = groupIdentity(contribution.fact, query.groupBy)
    if (!identity) continue
    const bucket = timeBucket(contribution.fact.capturedAtMs, query.bucket, query.timezone)
    const key = JSON.stringify([bucket.startMs ?? -1, query.groupBy, identity.value])
    const group = groups.get(key) ?? {
      key,
      dimension: query.groupBy,
      value: identity.value,
      label: identity.label,
      bucketStartMs: bucket.startMs,
      bucketEndMs: bucket.endMs,
      contributions: [],
    }
    group.contributions.push(contribution)
    groups.set(key, group)
  }
  return groups
}

function groupIdentity(
  fact: RawFact,
  dimension: UsageRollupGroupDimension,
): { value: string; label: string | null } | null {
  switch (dimension) {
    case "none":
      return { value: "all", label: null }
    case "provider-account":
      return { value: JSON.stringify([fact.providerId, fact.accountTag]), label: null }
    case "project":
      return fact.projectId ? { value: fact.projectId, label: fact.projectName } : null
    case "task":
      return fact.taskId ? { value: fact.taskId, label: fact.taskName } : null
    case "chat":
      return fact.chatId ? { value: fact.chatId, label: fact.chatName } : null
    case "automation":
      return fact.automationId ? { value: fact.automationId, label: fact.automationName } : null
    case "orchestration":
      return fact.orchestrationId
        ? { value: fact.orchestrationId, label: fact.orchestrationName }
        : null
    case "run":
      return fact.runId ? { value: fact.runId, label: null } : null
    case "harness":
      return fact.harness ? { value: fact.harness, label: null } : null
    case "model":
      return fact.model ? { value: fact.model, label: null } : null
    case "source":
      return { value: fact.source, label: null }
    case "source-class":
      return { value: fact.sourceClass, label: null }
    case "quality":
      return { value: fact.quality, label: null }
  }
}

function aggregate(
  contributions: Contribution[],
  bucketStartMs: number | null,
  bucketEndMs: number | null,
) {
  const metrics = emptyMetrics()
  for (const field of METRIC_FIELDS) {
    const values = contributions.flatMap(({ metrics: factMetrics }) =>
      factMetrics[field] === null ? [] : [factMetrics[field]],
    )
    metrics[field] = values.length ? values.reduce((sum, value) => sum + value, 0) : null
  }
  return {
    bucketStartMs,
    bucketEndMs,
    quality: weakestQuality(contributions.map(({ fact }) => fact.quality)),
    metrics,
    sourceClasses: [...new Set(contributions.map(({ fact }) => fact.sourceClass))].sort(),
    factIds: [...new Set(contributions.map(({ fact }) => fact.id))].sort(),
  }
}

function timeBucket(
  timestampMs: number,
  unit: UsageRollupBucketUnit,
  timezone: string,
): { startMs: number | null; endMs: number | null } {
  if (unit === "none") return { startMs: null, endMs: null }
  const parts = zonedParts(timestampMs, timezone)
  if (unit === "hour") {
    const startMs = timestampMs - (parts.minute * 60 + parts.second) * 1_000 - (timestampMs % 1_000)
    return { startMs, endMs: startMs + 60 * 60 * 1_000 }
  }

  const local = { year: parts.year, month: parts.month, day: parts.day, hour: 0 }
  if (unit === "week") {
    const weekday = (new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay() + 6) % 7
    local.day -= weekday
  } else if (unit === "month") {
    local.day = 1
  }
  const start = normalizeLocal(local)
  const next = { ...start }
  if (unit === "day") next.day += 1
  if (unit === "week") next.day += 7
  if (unit === "month") next.month += 1
  return {
    startMs: zonedLocalToUtc(normalizeLocal(start), timezone),
    endMs: zonedLocalToUtc(normalizeLocal(next), timezone),
  }
}

function cursorStart(cursor: string | null | undefined, items: UsageRollupValue[]): number {
  if (!cursor) return 0
  let key: string
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown
    if (
      !decoded ||
      typeof decoded !== "object" ||
      (decoded as { version?: unknown }).version !== 1 ||
      typeof (decoded as { key?: unknown }).key !== "string"
    ) {
      throw new Error("invalid payload")
    }
    key = (decoded as { key: string }).key
  } catch {
    throw new Error("Invalid usage rollup cursor.")
  }
  const index = items.findIndex((item) => item.key === key)
  if (index < 0) throw new Error("Usage rollup cursor is stale or does not match this query.")
  return index + 1
}

function encodeCursor(key: string): string {
  return Buffer.from(JSON.stringify({ version: 1, key }), "utf8").toString("base64url")
}

function emptyMetrics(): UsageRollupMetrics {
  return {
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    requestCount: null,
    costUsdMicros: null,
    costUsdEstimatedMicros: null,
  }
}

function hasMetric(metrics: UsageRollupMetrics): boolean {
  return METRIC_FIELDS.some((field) => metrics[field] !== null)
}

function weakestQuality(qualities: UsageRollupQuality[]): UsageRollupQuality {
  if (!qualities.length) return "unknown"
  const rank: Record<UsageRollupQuality, number> = {
    exact: 3,
    "provider-reported": 2,
    estimated: 1,
    unknown: 0,
  }
  return qualities.reduce((weakest, value) => (rank[value] < rank[weakest] ? value : weakest))
}

function sourceClass(value: unknown): UsageSourceClass {
  return value === "provider-account-total" ||
    value === "flapstack-run" ||
    value === "external-provider"
    ? value
    : "unknown"
}

function quality(value: unknown): UsageRollupQuality {
  return value === "exact" || value === "provider-reported" || value === "estimated"
    ? value
    : "unknown"
}
