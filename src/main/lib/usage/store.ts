// Stage 2 Track B - U4: shared SQLite usage store helpers.
//
// One local SQLite DB is written by the daemon and read by the app. These
// helpers take the drizzle db instance so the same code runs in both processes
// (the daemon opens its own connection to the same file). Dedupe keys prevent
// double-counting across daemon/app overlap. Credentials must never reach the
// raw payload column.
//
// Locking: the DB is opened WAL + `foreign_keys=ON` + `busy_timeout` so app
// reads and daemon writes coexist. On SQLITE_BUSY the writer retries with
// backoff (see withWriteRetry); samples are never silently discarded.

import { and, desc, eq, gte, isNotNull, ne, sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "../db/schema"
import { redactUsageDiagnostic } from "./diagnostics"
import { deriveDedupeKey, microsToUsd, usdToMicros } from "./source-tags"
import type {
  CostQuality,
  ProviderStatus,
  SampleSource,
  UsageProviderId,
  UsageSampleInput,
} from "./types"

export type UsageDb = BetterSQLite3Database<typeof schema>

const DEFAULT_BUSY_TIMEOUT_MS = 5_000

function costQualityRank(quality: CostQuality): number {
  return quality === "exact"
    ? 3
    : quality === "provider-reported"
      ? 2
      : quality === "estimated"
        ? 1
        : 0
}

/** Apply the pragmas both app and daemon need for safe coexistence. Call once
 * per connection right after open. */
export function applyUsageStorePragmas(sqlite: { pragma: (source: string) => unknown }): void {
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma(`busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`)
}

/** Retry a write on transient SQLITE_BUSY/locked errors. Never drops the write. */
export async function withWriteRetry<T>(fn: () => T, attempts = 5): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return fn()
    } catch (err) {
      lastErr = err
      const msg = String((err as Error)?.message ?? err)
      if (!/SQLITE_BUSY|database is locked/i.test(msg)) throw err
      if (i === attempts - 1) break
      await new Promise((r) => setTimeout(r, 50 * 2 ** i))
    }
  }
  throw lastErr
}

/** Insert or refresh samples by dedupe key. Current provider buckets can change
 * during a billing window, so conflicts update the observation instead of
 * freezing the first value seen. Returns changed row count. */
export async function insertSamples(db: UsageDb, samples: UsageSampleInput[]): Promise<number> {
  if (samples.length === 0) return 0
  let inserted = 0
  for (const sample of samples) {
    const dedupeKey = deriveDedupeKey(sample)
    const row: schema.NewUsageSample = {
      providerId: sample.providerId,
      accountTag: sample.accountTag ?? "",
      source: sample.source,
      costQuality: sample.costQuality,
      sourceTag: sample.sourceTag ?? null,
      metricKey: sample.metricKey ?? null,
      capturedAt: sample.capturedAt ?? new Date(),
      windowStart: sample.windowStart ?? null,
      windowEnd: sample.windowEnd ?? null,
      inputTokens: sample.inputTokens ?? null,
      outputTokens: sample.outputTokens ?? null,
      reasoningTokens: sample.reasoningTokens ?? null,
      totalTokens: sample.totalTokens ?? null,
      requestCount: sample.requestCount ?? null,
      costUsd: usdToMicros(sample.costUsd),
      costUsdEstimated: usdToMicros(sample.costUsdEstimated),
      currency: sample.currency ?? "USD",
      percentUsed: sample.percentUsed ?? null,
      quotaUsed: sample.quotaUsed ?? null,
      quotaLimit: sample.quotaLimit ?? null,
      quotaUnit: sample.quotaUnit ?? null,
      resetAt: sample.resetAt ?? null,
      model: sample.model ?? null,
      generationId: sample.generationId ?? null,
      runId: sample.runId ?? null,
      rawPayload: serializeRawPayload(sample.rawPayload),
      dedupeKey,
    }
    const incomingQualityRank = costQualityRank(sample.costQuality)
    const hasIncomingCost = row.costUsd != null || row.costUsdEstimated != null
    const currentQualityRank = sql<number>`CASE ${schema.usageSamples.costQuality}
      WHEN 'exact' THEN 3
      WHEN 'provider-reported' THEN 2
      WHEN 'estimated' THEN 1
      ELSE 0
    END`
    const updateValues = {
      providerId: row.providerId,
      accountTag: row.accountTag,
      source: row.source,
      capturedAt: row.capturedAt,
      currency: row.currency,
      dedupeKey: row.dedupeKey,
      ...(row.sourceTag != null ? { sourceTag: row.sourceTag } : {}),
      ...(row.metricKey != null ? { metricKey: row.metricKey } : {}),
      ...(row.windowStart != null ? { windowStart: row.windowStart } : {}),
      ...(row.windowEnd != null ? { windowEnd: row.windowEnd } : {}),
      ...(row.inputTokens != null ? { inputTokens: row.inputTokens } : {}),
      ...(row.outputTokens != null ? { outputTokens: row.outputTokens } : {}),
      ...(row.reasoningTokens != null ? { reasoningTokens: row.reasoningTokens } : {}),
      ...(row.totalTokens != null ? { totalTokens: row.totalTokens } : {}),
      ...(row.requestCount != null ? { requestCount: row.requestCount } : {}),
      ...(row.percentUsed != null ? { percentUsed: row.percentUsed } : {}),
      ...(row.quotaUsed != null ? { quotaUsed: row.quotaUsed } : {}),
      ...(row.quotaLimit != null ? { quotaLimit: row.quotaLimit } : {}),
      ...(row.quotaUnit != null ? { quotaUnit: row.quotaUnit } : {}),
      ...(row.resetAt != null ? { resetAt: row.resetAt } : {}),
      ...(row.model != null ? { model: row.model } : {}),
      ...(row.generationId != null ? { generationId: row.generationId } : {}),
      ...(row.rawPayload != null ? { rawPayload: row.rawPayload } : {}),
      // A retry or later estimate may add token/raw metadata, but it must never
      // replace stronger provider-reported/exact cost data already stored.
      costQuality: sql<string>`CASE
        WHEN ${hasIncomingCost ? 0 : 1} = 1
          THEN ${schema.usageSamples.costQuality}
        WHEN ${currentQualityRank} > ${incomingQualityRank}
          THEN ${schema.usageSamples.costQuality}
        ELSE ${sample.costQuality}
      END`,
      costUsd: sql<number | null>`CASE
        WHEN ${hasIncomingCost ? 0 : 1} = 1
          THEN ${schema.usageSamples.costUsd}
        WHEN ${currentQualityRank} > ${incomingQualityRank}
          THEN ${schema.usageSamples.costUsd}
        ELSE ${row.costUsd}
      END`,
      costUsdEstimated: sql<number | null>`CASE
        WHEN ${hasIncomingCost ? 0 : 1} = 1
          THEN ${schema.usageSamples.costUsdEstimated}
        WHEN ${currentQualityRank} > ${incomingQualityRank}
          THEN ${schema.usageSamples.costUsdEstimated}
        ELSE ${row.costUsdEstimated}
      END`,
      // Provider reconciliation identifies a stored run by generation id and
      // does not know the run id itself. Never erase that existing link.
      runId: sql<string | null>`COALESCE(${row.runId}, ${schema.usageSamples.runId})`,
    }
    const result = await withWriteRetry(() =>
      db
        .insert(schema.usageSamples)
        .values(row)
        .onConflictDoUpdate({ target: schema.usageSamples.dedupeKey, set: updateValues })
        .run(),
    )
    inserted += result.changes
    await upsertUsageCycle(db, sample)
  }
  return inserted
}

/** Roll windowed samples into the historical cycle table. Cost and token
 * observations often arrive from separate provider endpoints, so only fields
 * present on the new sample are updated. */
async function upsertUsageCycle(db: UsageDb, sample: UsageSampleInput): Promise<void> {
  if (!sample.windowStart && !sample.windowEnd && !sample.resetAt) return
  const accountTag = sample.accountTag ?? ""
  const cycleStart = sample.windowStart ?? null
  const cycleEnd = sample.windowEnd ?? null
  const dedupeKey = [
    sample.providerId,
    accountTag || "default",
    sample.metricKey ?? "-",
    cycleStart?.toISOString() ?? "open",
    cycleEnd?.toISOString() ?? sample.resetAt?.toISOString() ?? "current",
  ].join("|")
  const values: schema.NewUsageCycle = {
    providerId: sample.providerId,
    accountTag,
    cycleStart,
    cycleEnd,
    resetAt: sample.resetAt ?? null,
    totalCostUsd: usdToMicros(sample.costUsd),
    totalCostUsdEstimated: usdToMicros(sample.costUsdEstimated),
    totalTokens: sample.totalTokens ?? null,
    costQuality: sample.costQuality,
    rawPayload: serializeRawPayload(sample.rawPayload),
    dedupeKey,
    updatedAt: new Date(),
  }
  const currentQualityRank = sql<number>`CASE ${schema.usageCycles.costQuality}
    WHEN 'exact' THEN 3
    WHEN 'provider-reported' THEN 2
    WHEN 'estimated' THEN 1
    ELSE 0
  END`
  const incomingQualityRank = costQualityRank(sample.costQuality)
  const hasIncomingCost = values.totalCostUsd != null || values.totalCostUsdEstimated != null
  const set = {
    cycleStart,
    cycleEnd,
    resetAt: sample.resetAt ?? null,
    rawPayload: serializeRawPayload(sample.rawPayload),
    updatedAt: new Date(),
    ...(hasIncomingCost
      ? {
          totalCostUsd: sql<number | null>`CASE
            WHEN ${currentQualityRank} > ${incomingQualityRank}
              THEN ${schema.usageCycles.totalCostUsd}
            ELSE ${values.totalCostUsd}
          END`,
          totalCostUsdEstimated: sql<number | null>`CASE
            WHEN ${currentQualityRank} > ${incomingQualityRank}
              THEN ${schema.usageCycles.totalCostUsdEstimated}
            ELSE ${values.totalCostUsdEstimated}
          END`,
          costQuality: sql<string>`CASE
            WHEN ${currentQualityRank} > ${incomingQualityRank}
              THEN ${schema.usageCycles.costQuality}
            ELSE ${sample.costQuality}
          END`,
        }
      : {}),
    ...(sample.totalTokens != null ? { totalTokens: sample.totalTokens } : {}),
  }
  await withWriteRetry(() =>
    db
      .insert(schema.usageCycles)
      .values(values)
      .onConflictDoUpdate({ target: schema.usageCycles.dedupeKey, set })
      .run(),
  )
}

/** Latest captured-at timestamp for a provider - the reconcile watermark. */
export async function getLatestSampleAt(
  db: UsageDb,
  providerId: UsageProviderId,
): Promise<Date | null> {
  const rows = await db
    .select({ capturedAt: schema.usageSamples.capturedAt })
    .from(schema.usageSamples)
    .where(eq(schema.usageSamples.providerId, providerId))
    .orderBy(desc(schema.usageSamples.capturedAt))
    .limit(1)
  return rows[0]?.capturedAt ?? null
}

/** Generation ids that have run metadata but still lack exact provider cost.
 * Newest first prevents an old permanently unavailable id from starving newer
 * runs. This is not an account-history query: ids only come from stored
 * Flapstack run samples. */
export async function listPendingGenerationIds(
  db: UsageDb,
  providerId: UsageProviderId,
  limit = 100,
): Promise<string[]> {
  // Schema uses SQLite timestamp seconds, not JavaScript milliseconds.
  const nowSeconds = Math.floor(Date.now() / 1_000)
  const rows = await db
    .selectDistinct({ generationId: schema.usageSamples.generationId })
    .from(schema.usageSamples)
    .where(
      and(
        eq(schema.usageSamples.providerId, providerId),
        isNotNull(schema.usageSamples.generationId),
        ne(schema.usageSamples.costQuality, "exact"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.usageGenerationReconciliation}
          WHERE ${schema.usageGenerationReconciliation.providerId} = ${schema.usageSamples.providerId}
            AND ${schema.usageGenerationReconciliation.generationId} = ${schema.usageSamples.generationId}
            AND (
              ${schema.usageGenerationReconciliation.state} IN ('unavailable', 'resolved')
              OR (${schema.usageGenerationReconciliation.state} = 'retry'
                AND ${schema.usageGenerationReconciliation.nextAttemptAt} > ${nowSeconds})
            )
        )`,
      ),
    )
    .orderBy(desc(schema.usageSamples.capturedAt))
    .limit(Math.max(1, Math.min(limit, 500)))
  return rows.flatMap((row) => (row.generationId ? [row.generationId] : []))
}

export async function markGenerationReconciliation(
  db: UsageDb,
  providerId: UsageProviderId,
  generationId: string,
  state: "retry" | "unavailable" | "resolved",
  detail?: string,
): Promise<void> {
  const existing = await db
    .select({ attemptCount: schema.usageGenerationReconciliation.attemptCount })
    .from(schema.usageGenerationReconciliation)
    .where(
      and(
        eq(schema.usageGenerationReconciliation.providerId, providerId),
        eq(schema.usageGenerationReconciliation.generationId, generationId),
      ),
    )
    .limit(1)
  const attemptCount = (existing[0]?.attemptCount ?? 0) + 1
  const effectiveState = state === "retry" && attemptCount >= 10 ? "unavailable" : state
  const backoffMs = Math.min(24 * 60 * 60_000, 60_000 * 2 ** Math.min(attemptCount - 1, 10))
  const values = {
    providerId,
    generationId,
    state: effectiveState,
    attemptCount,
    lastAttemptAt: new Date(),
    nextAttemptAt: effectiveState === "retry" ? new Date(Date.now() + backoffMs) : null,
    detail: detail ?? null,
    updatedAt: new Date(),
  }
  await withWriteRetry(() =>
    db
      .insert(schema.usageGenerationReconciliation)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.usageGenerationReconciliation.providerId,
          schema.usageGenerationReconciliation.generationId,
        ],
        set: values,
      })
      .run(),
  )
}

export async function resetGenerationReconciliation(
  db: UsageDb,
  providerId: UsageProviderId,
  generationId?: string,
): Promise<void> {
  await withWriteRetry(() =>
    db
      .delete(schema.usageGenerationReconciliation)
      .where(
        generationId
          ? and(
              eq(schema.usageGenerationReconciliation.providerId, providerId),
              eq(schema.usageGenerationReconciliation.generationId, generationId),
            )
          : eq(schema.usageGenerationReconciliation.providerId, providerId),
      )
      .run(),
  )
}

/** Recent samples for the dashboard, newest first. */
export async function listRecentSamples(
  db: UsageDb,
  opts: {
    providerId?: UsageProviderId
    accountTag?: string
    source?: SampleSource
    flapstackOnly?: boolean
    since?: Date
    limit?: number
  } = {},
): Promise<schema.UsageSample[]> {
  const conds = []
  if (opts.providerId) conds.push(eq(schema.usageSamples.providerId, opts.providerId))
  if (opts.accountTag !== undefined) conds.push(eq(schema.usageSamples.accountTag, opts.accountTag))
  if (opts.source) conds.push(eq(schema.usageSamples.source, opts.source))
  if (opts.flapstackOnly) conds.push(isNotNull(schema.usageSamples.runId))
  if (opts.since) conds.push(gte(schema.usageSamples.capturedAt, opts.since))
  return db
    .select()
    .from(schema.usageSamples)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.usageSamples.capturedAt))
    .limit(opts.limit ?? 200)
}

/** Recent rows per provider/account for current cards. A noisy provider cannot
 * evict every row for another provider from one global LIMIT. */
export async function listCurrentSamples(
  db: UsageDb,
  opts: {
    providerId?: UsageProviderId
    accountTag?: string
    source?: SampleSource
    flapstackOnly?: boolean
    limitPerAccount?: number
  } = {},
): Promise<schema.UsageSample[]> {
  const conds = []
  if (opts.providerId) conds.push(eq(schema.usageSamples.providerId, opts.providerId))
  if (opts.accountTag !== undefined) conds.push(eq(schema.usageSamples.accountTag, opts.accountTag))
  if (opts.source) conds.push(eq(schema.usageSamples.source, opts.source))
  if (opts.flapstackOnly) conds.push(isNotNull(schema.usageSamples.runId))
  const groups = await db
    .selectDistinct({
      providerId: schema.usageSamples.providerId,
      accountTag: schema.usageSamples.accountTag,
    })
    .from(schema.usageSamples)
    .where(conds.length ? and(...conds) : undefined)
  const rows = await Promise.all(
    groups.map((group) =>
      listRecentSamples(db, {
        providerId: group.providerId as UsageProviderId,
        accountTag: group.accountTag,
        source: opts.source,
        flapstackOnly: opts.flapstackOnly,
        limit: opts.limitPerAccount ?? 25,
      }),
    ),
  )
  return rows
    .flat()
    .sort((left, right) => (right.capturedAt?.getTime() ?? 0) - (left.capturedAt?.getTime() ?? 0))
}

/** Historical billing/reset cycles, newest first. */
export async function listRecentCycles(
  db: UsageDb,
  opts: { providerId?: UsageProviderId; accountTag?: string; limit?: number } = {},
): Promise<schema.UsageCycle[]> {
  const conds = []
  if (opts.providerId) conds.push(eq(schema.usageCycles.providerId, opts.providerId))
  if (opts.accountTag !== undefined) conds.push(eq(schema.usageCycles.accountTag, opts.accountTag))
  return db
    .select()
    .from(schema.usageCycles)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.usageCycles.cycleStart), desc(schema.usageCycles.updatedAt))
    .limit(opts.limit ?? 100)
}

/** Upsert the current status row for a provider/account. */
export async function upsertProviderState(
  db: UsageDb,
  status: ProviderStatus,
  outcome?: { kind: "success" } | { kind: "error"; message: string },
): Promise<void> {
  const now = new Date()
  const values = {
    providerId: status.providerId,
    accountTag: status.accountTag ?? "",
    status: status.status,
    statusDetail: status.detail ? redactUsageDiagnostic(status.detail) : null,
    configured: status.configured,
    supportsDaemon: status.supportsDaemon,
    supportsHistorical: status.supportsHistorical,
    lastPollAt: now,
    ...(outcome?.kind === "success"
      ? { lastSuccessAt: now, lastError: null }
      : outcome?.kind === "error"
        ? { lastErrorAt: now, lastError: redactUsageDiagnostic(outcome.message) }
        : {}),
    updatedAt: now,
  }
  await withWriteRetry(() =>
    db
      .insert(schema.usageProviderStates)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.usageProviderStates.providerId, schema.usageProviderStates.accountTag],
        set: values,
      })
      .run(),
  )
}

/** Serialize provider diagnostics without allowing malformed/circular payloads
 * or common credential fields into the shared DB. */
function serializeRawPayload(payload: unknown): string | null {
  if (payload == null) return null
  try {
    return JSON.stringify(payload, (key, value) =>
      /^(authorization|credential|password|secret|api.?key|access.?token|refresh.?token|id.?token)$/i.test(
        key,
      )
        ? "[redacted]"
        : value,
    )
  } catch {
    return "[unserializable payload omitted]"
  }
}

export async function listProviderStates(db: UsageDb): Promise<schema.UsageProviderState[]> {
  return db.select().from(schema.usageProviderStates)
}

export async function getProviderLastPollAt(
  db: UsageDb,
  providerId: UsageProviderId,
): Promise<Date | null> {
  const rows = await db
    .select({ lastPollAt: schema.usageProviderStates.lastPollAt })
    .from(schema.usageProviderStates)
    .where(eq(schema.usageProviderStates.providerId, providerId))
    .orderBy(desc(schema.usageProviderStates.lastPollAt))
    .limit(1)
  return rows[0]?.lastPollAt ?? null
}

/** Record an alert event + its delivery outcome. */
export async function recordAlertEvent(
  db: UsageDb,
  event: schema.NewUsageAlertEvent,
): Promise<void> {
  await withWriteRetry(() => db.insert(schema.usageAlertEvents).values(event).run())
}

export async function listRecentAlertEvents(
  db: UsageDb,
  opts: number | { providerId?: UsageProviderId; accountTag?: string; limit?: number } = {},
): Promise<schema.UsageAlertEvent[]> {
  const normalized = typeof opts === "number" ? { limit: opts } : opts
  const conds = []
  if (normalized.providerId)
    conds.push(eq(schema.usageAlertEvents.providerId, normalized.providerId))
  if (normalized.accountTag !== undefined)
    conds.push(eq(schema.usageAlertEvents.accountTag, normalized.accountTag))
  return db
    .select()
    .from(schema.usageAlertEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.usageAlertEvents.createdAt))
    .limit(normalized.limit ?? 50)
}

export async function listAlertArmStates(db: UsageDb): Promise<schema.UsageAlertArmState[]> {
  const rows = await db.select().from(schema.usageAlertArmStates)
  return rows.map((row) => ({
    ...row,
    thresholdValue: row.thresholdValue == null ? null : microsToUsd(row.thresholdValue),
  }))
}

export async function upsertAlertArmStates(
  db: UsageDb,
  states: Array<{
    providerId: UsageProviderId
    accountTag?: string | null
    alertType: string
    thresholdValue: number
    armed: boolean
  }>,
): Promise<void> {
  for (const state of states) {
    await withWriteRetry(() =>
      db
        .insert(schema.usageAlertArmStates)
        .values({
          providerId: state.providerId,
          accountTag: state.accountTag ?? "",
          alertType: state.alertType,
          thresholdValue: usdToMicros(state.thresholdValue),
          armed: state.armed,
          lastFiredAt: state.armed ? null : new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            schema.usageAlertArmStates.providerId,
            schema.usageAlertArmStates.accountTag,
            schema.usageAlertArmStates.alertType,
            schema.usageAlertArmStates.thresholdValue,
          ],
          set: {
            armed: state.armed,
            lastFiredAt: state.armed ? null : new Date(),
            updatedAt: new Date(),
          },
        })
        .run(),
    )
  }
}

/** Atomically claim an armed threshold before external delivery. This closes
 * the daemon/app race and makes a crash after HTTP success at-most-once. */
export async function claimAlertArmState(
  db: UsageDb,
  state: {
    providerId: UsageProviderId
    accountTag?: string | null
    alertType: string
    thresholdValue: number
  },
): Promise<boolean> {
  const thresholdValue = usdToMicros(state.thresholdValue)
  if (thresholdValue == null) return false
  return withWriteRetry(() =>
    db.transaction((tx) => {
      const key = {
        providerId: state.providerId,
        accountTag: state.accountTag ?? "",
        alertType: state.alertType,
        thresholdValue,
      }
      tx.insert(schema.usageAlertArmStates)
        .values({ ...key, armed: true, updatedAt: new Date() })
        .onConflictDoNothing()
        .run()
      const result = tx
        .update(schema.usageAlertArmStates)
        .set({ armed: false, lastFiredAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.usageAlertArmStates.providerId, key.providerId),
            eq(schema.usageAlertArmStates.accountTag, key.accountTag),
            eq(schema.usageAlertArmStates.alertType, key.alertType),
            eq(schema.usageAlertArmStates.thresholdValue, key.thresholdValue),
            eq(schema.usageAlertArmStates.armed, true),
          ),
        )
        .run()
      return result.changes === 1
    }),
  )
}

// ---- Daemon heartbeat/status --------------------------------------------

export async function getDaemonStatus(db: UsageDb): Promise<schema.UsageDaemonStatus | null> {
  const rows = await db
    .select()
    .from(schema.usageDaemonStatus)
    .where(eq(schema.usageDaemonStatus.id, "singleton"))
    .limit(1)
  return rows[0] ?? null
}

export async function updateDaemonStatus(
  db: UsageDb,
  patch: Partial<schema.NewUsageDaemonStatus>,
): Promise<void> {
  const now = new Date()
  await withWriteRetry(() =>
    db
      .insert(schema.usageDaemonStatus)
      .values({ id: "singleton", ...patch, updatedAt: now })
      .onConflictDoUpdate({
        target: schema.usageDaemonStatus.id,
        set: { ...patch, updatedAt: now },
      })
      .run(),
  )
}
