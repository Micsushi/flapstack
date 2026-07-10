// Stage 2 Track B — U4: shared SQLite usage store helpers.
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

import { and, desc, eq, gte } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "../db/schema"
import { deriveDedupeKey, usdToMicros } from "./source-tags"
import type { ProviderStatus, UsageProviderId, UsageSampleInput } from "./types"

export type UsageDb = BetterSQLite3Database<typeof schema>

const DEFAULT_BUSY_TIMEOUT_MS = 5_000

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
      resetAt: sample.resetAt ?? null,
      model: sample.model ?? null,
      generationId: sample.generationId ?? null,
      runId: sample.runId ?? null,
      rawPayload: serializeRawPayload(sample.rawPayload),
      dedupeKey,
    }
    const { id: _id, createdAt: _createdAt, ...updateValues } = row
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
  const set: Partial<schema.NewUsageCycle> = {
    cycleStart,
    cycleEnd,
    resetAt: sample.resetAt ?? null,
    rawPayload: serializeRawPayload(sample.rawPayload),
    updatedAt: new Date(),
  }
  if (sample.costUsd != null) {
    set.totalCostUsd = usdToMicros(sample.costUsd)
    set.costQuality = sample.costQuality
  }
  if (sample.costUsdEstimated != null) {
    set.totalCostUsdEstimated = usdToMicros(sample.costUsdEstimated)
    set.costQuality = sample.costQuality
  }
  if (sample.totalTokens != null) set.totalTokens = sample.totalTokens
  await withWriteRetry(() =>
    db
      .insert(schema.usageCycles)
      .values(values)
      .onConflictDoUpdate({ target: schema.usageCycles.dedupeKey, set })
      .run(),
  )
}

/** Latest captured-at timestamp for a provider — the reconcile watermark. */
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

/** Recent samples for the dashboard, newest first. */
export async function listRecentSamples(
  db: UsageDb,
  opts: { providerId?: UsageProviderId; since?: Date; limit?: number } = {},
): Promise<schema.UsageSample[]> {
  const conds = []
  if (opts.providerId) conds.push(eq(schema.usageSamples.providerId, opts.providerId))
  if (opts.since) conds.push(gte(schema.usageSamples.capturedAt, opts.since))
  return db
    .select()
    .from(schema.usageSamples)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.usageSamples.capturedAt))
    .limit(opts.limit ?? 200)
}

/** Historical billing/reset cycles, newest first. */
export async function listRecentCycles(
  db: UsageDb,
  opts: { providerId?: UsageProviderId; limit?: number } = {},
): Promise<schema.UsageCycle[]> {
  return db
    .select()
    .from(schema.usageCycles)
    .where(opts.providerId ? eq(schema.usageCycles.providerId, opts.providerId) : undefined)
    .orderBy(desc(schema.usageCycles.cycleStart), desc(schema.usageCycles.updatedAt))
    .limit(opts.limit ?? 100)
}

/** Upsert the current status row for a provider/account. */
export async function upsertProviderState(db: UsageDb, status: ProviderStatus): Promise<void> {
  const now = new Date()
  const values = {
    providerId: status.providerId,
    accountTag: status.accountTag ?? "",
    status: status.status,
    statusDetail: status.detail ?? null,
    configured: status.configured,
    supportsDaemon: status.supportsDaemon,
    supportsHistorical: status.supportsHistorical,
    lastPollAt: now,
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
      /authorization|credential|password|secret|token|api.?key/i.test(key) ? "[redacted]" : value,
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
  limit = 50,
): Promise<schema.UsageAlertEvent[]> {
  return db
    .select()
    .from(schema.usageAlertEvents)
    .orderBy(desc(schema.usageAlertEvents.createdAt))
    .limit(limit)
}

export async function listAlertArmStates(db: UsageDb): Promise<schema.UsageAlertArmState[]> {
  return db.select().from(schema.usageAlertArmStates)
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
          thresholdValue: state.thresholdValue,
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
