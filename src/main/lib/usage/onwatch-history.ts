import Database from "better-sqlite3"
import { existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { UsageProviderId } from "./types"

type SupportedProvider = Extract<UsageProviderId, "codex" | "anthropic">

interface OnWatchHistoryRow {
  snapshotId: number
  capturedAt: string
  metricKey: string
  percentUsed: number
  resetAt: string | null
}

interface OnWatchCostHistoryRow {
  capturedAt: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd: number
}

export interface OnWatchHistorySyncResult {
  available: boolean
  imported: number
  sourcePath: string
}

let completedSignature = ""
let lastSyncAttemptAt = 0
let pendingSync: Promise<OnWatchHistorySyncResult> | null = null
const SYNC_DEBOUNCE_MS = 60 * 60 * 1_000

function onWatchDatabasePath(): string {
  return process.env.ONWATCH_DB_PATH ?? join(homedir(), ".onwatch", "data", "onwatch.db")
}

function currentPersonalAccountTag(db: Database.Database, providerId: SupportedProvider): string {
  const row = db
    .prepare(
      `SELECT account_tag AS accountTag
       FROM usage_samples
       WHERE provider_id = ? AND source_tag = 'personal-oauth'
       ORDER BY captured_at DESC
       LIMIT 1`,
    )
    .get(providerId) as { accountTag?: string } | undefined
  return row?.accountTag ?? ""
}

function readHistoryRows(
  db: Database.Database,
  providerId: SupportedProvider,
): OnWatchHistoryRow[] {
  const snapshotsTable = providerId === "codex" ? "codex_snapshots" : "anthropic_snapshots"
  const quotaTable = providerId === "codex" ? "codex_quota_values" : "anthropic_quota_values"
  return db
    .prepare(
      `SELECT
         snapshots.id AS snapshotId,
         snapshots.captured_at AS capturedAt,
         quotas.quota_name AS metricKey,
         quotas.utilization AS percentUsed,
         quotas.resets_at AS resetAt
       FROM ${snapshotsTable} snapshots
       INNER JOIN ${quotaTable} quotas ON quotas.snapshot_id = snapshots.id
       WHERE quotas.quota_name IN ('five_hour', 'seven_day')
       ORDER BY snapshots.id ASC`,
    )
    .all() as OnWatchHistoryRow[]
}

function readCostHistoryRows(
  db: Database.Database,
  providerId: SupportedProvider,
): OnWatchCostHistoryRow[] {
  const provider = providerId === "codex" ? "openai" : "anthropic"
  return db
    .prepare(
      `SELECT
         CAST(strftime('%s', captured_at) / 600 AS INTEGER) * 600 AS capturedAt,
         SUM(prompt_tokens) AS inputTokens,
         SUM(completion_tokens) AS outputTokens,
         SUM(total_tokens) AS totalTokens,
         SUM(COALESCE(cost_usd, 0)) AS costUsd
       FROM api_integration_usage_events
       WHERE provider = ?
       GROUP BY CAST(strftime('%s', captured_at) / 600 AS INTEGER)
       ORDER BY capturedAt ASC`,
    )
    .all(provider) as OnWatchCostHistoryRow[]
}

function toSqliteTimestamp(value: string | null): number | null {
  if (!value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1_000) : null
}

function syncHistory(destinationPath: string, sourcePath: string): OnWatchHistorySyncResult {
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
  const destination = new Database(destinationPath, { fileMustExist: true })
  destination.pragma("busy_timeout = 5000")

  try {
    const insert = destination.prepare(
      `INSERT INTO usage_samples (
         id, provider_id, account_tag, source, cost_quality, source_tag, metric_key,
         captured_at, currency, percent_used, reset_at, dedupe_key, created_at
       ) VALUES (
         @id, @providerId, @accountTag, 'external-provider', 'unknown', 'personal-oauth',
         @metricKey, @capturedAt, 'USD', @percentUsed, @resetAt, @dedupeKey, @createdAt
       )
       ON CONFLICT(dedupe_key) DO NOTHING`,
    )
    const insertCost = destination.prepare(
      `INSERT INTO usage_samples (
         id, provider_id, account_tag, source, cost_quality, source_tag, metric_key,
         captured_at, input_tokens, output_tokens, total_tokens,
         cost_usd_estimated_micros, currency, dedupe_key, created_at
       ) VALUES (
         @id, @providerId, @accountTag, 'external-provider', 'estimated',
         'onwatch-cost-history', 'local-token-cost', @capturedAt, @inputTokens,
         @outputTokens, @totalTokens, @costUsdEstimated, 'USD', @dedupeKey, @createdAt
       )
       ON CONFLICT(dedupe_key) DO UPDATE SET
         captured_at = excluded.captured_at,
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens,
         total_tokens = excluded.total_tokens,
         cost_usd_estimated_micros = excluded.cost_usd_estimated_micros`,
    )
    const now = Math.floor(Date.now() / 1_000)
    let imported = 0
    const importProvider = destination.transaction((providerId: SupportedProvider) => {
      const accountTag = currentPersonalAccountTag(destination, providerId)
      for (const row of readHistoryRows(source, providerId)) {
        const capturedAt = toSqliteTimestamp(row.capturedAt)
        if (capturedAt == null || !Number.isFinite(row.percentUsed)) continue
        const dedupeKey = `onwatch|${providerId}|${row.snapshotId}|${row.metricKey}`
        const result = insert.run({
          id: dedupeKey,
          providerId,
          accountTag,
          metricKey: row.metricKey,
          capturedAt,
          percentUsed: row.percentUsed,
          resetAt: toSqliteTimestamp(row.resetAt),
          dedupeKey,
          createdAt: now,
        })
        imported += result.changes
      }
      for (const row of readCostHistoryRows(source, providerId)) {
        if (!Number.isFinite(row.capturedAt) || !Number.isFinite(row.costUsd)) continue
        const dedupeKey = `onwatch-cost|${providerId}|${row.capturedAt}`
        const result = insertCost.run({
          id: dedupeKey,
          providerId,
          accountTag,
          capturedAt: row.capturedAt,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          totalTokens: row.totalTokens,
          costUsdEstimated: Math.round(row.costUsd * 1_000_000),
          dedupeKey,
          createdAt: now,
        })
        imported += result.changes
      }
    })
    importProvider("codex")
    importProvider("anthropic")
    return { available: true, imported, sourcePath }
  } finally {
    destination.close()
    source.close()
  }
}

/**
 * Seed Flapstack's general-usage history from an existing local OnWatch store.
 * The source is opened read-only, imported rows are immutable/deduplicated, and
 * Flapstack's own poller continues the same series after the migration point.
 */
export async function syncOnWatchUsageHistory(
  destinationPath: string,
): Promise<OnWatchHistorySyncResult> {
  const sourcePath = onWatchDatabasePath()
  if (!existsSync(sourcePath) || !existsSync(destinationPath)) {
    return { available: false, imported: 0, sourcePath }
  }

  if (pendingSync) return pendingSync
  if (Date.now() - lastSyncAttemptAt < SYNC_DEBOUNCE_MS) {
    return { available: true, imported: 0, sourcePath }
  }

  const stat = statSync(sourcePath)
  const walPath = `${sourcePath}-wal`
  const walStat = existsSync(walPath) ? statSync(walPath) : null
  const signature = `${sourcePath}|${destinationPath}|${stat.size}|${stat.mtimeMs}|${walStat?.size ?? 0}|${walStat?.mtimeMs ?? 0}`
  if (signature === completedSignature) {
    return { available: true, imported: 0, sourcePath }
  }
  lastSyncAttemptAt = Date.now()
  pendingSync = Promise.resolve().then(() => syncHistory(destinationPath, sourcePath))
  try {
    const result = await pendingSync
    completedSignature = signature
    return result
  } catch (error) {
    console.warn(
      `[usage] Could not import local OnWatch history: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { available: false, imported: 0, sourcePath }
  } finally {
    pendingSync = null
  }
}
