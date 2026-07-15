import type Database from "better-sqlite3"
import type {
  UsageExplorerExportInput,
  UsageExplorerMetric,
} from "../../../shared/advanced-usage-explorer"
import { usageExplorerExportSchema } from "../../../shared/advanced-usage-explorer"
import type { UsageRollupQuality, UsageRollupQueryInput } from "../../../shared/advanced-usage"
import { usageRollupQuerySchema } from "../../../shared/advanced-usage"
import { queryUsageRollups, type UsageRollupMetrics } from "./rollups"
import type { UsageDb } from "./store"
import { epochMs, finiteNumber, stringOrNull } from "./time"

type Sqlite = Database.Database

export type UsageExplorerFact = {
  id: string
  providerId: string
  accountTag: string
  harness: string | null
  model: string | null
  source: string
  sourceTag: string | null
  sourceClass: string
  quality: UsageRollupQuality
  capturedAtMs: number | null
  windowStartMs: number | null
  windowEndMs: number | null
  metrics: UsageRollupMetrics
  attribution: {
    state: "attributed" | "unknown"
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
  }
  provenance: {
    dedupeStrategy: string
    dedupeGroupKey: string | null
    pricingVersion: string | null
    rawPayload: "omitted" | "redacted"
  }
  redactedRawPayload?: unknown
}

export function queryAdvancedUsageExplorer(db: UsageDb, input: UsageRollupQueryInput) {
  const query = usageRollupQuerySchema.parse(input)
  const rollup = queryUsageRollups(db, query)
  const facts = readExplorerFacts(rawClient(db), rollup.totals.factIds, false)
  return {
    query,
    rollup,
    facts,
    provenance: {
      factCount: facts.length,
      factIds: facts.map((fact) => fact.id),
      rollupRevision: rollup.cache.revision,
      rawPayloadPolicy: "omitted" as const,
    },
  }
}

export function exportAdvancedUsage(
  db: UsageDb,
  rawInput: UsageExplorerExportInput,
  nowMs = Date.now(),
) {
  const input = usageExplorerExportSchema.parse(rawInput)
  const query = usageRollupQuerySchema.parse(input.query)
  const rollup = queryUsageRollups(db, query)
  const facts = readExplorerFacts(
    rawClient(db),
    rollup.totals.factIds,
    input.includeRedactedRawPayload,
  )
  const exportedAt = new Date(nowMs).toISOString()
  const baseName = `flapstack-usage-${exportedAt.replace(/[:.]/g, "-")}`

  if (input.format === "json") {
    const content = JSON.stringify(
      {
        schemaVersion: 1,
        exportedAt,
        query,
        reconciliation: rollup.reconciliation,
        totals: rollup.totals,
        aggregates: rollup.items,
        provenance: {
          rollupRevision: rollup.cache.revision,
          rawPayloadPolicy: input.includeRedactedRawPayload ? "redacted" : "omitted",
        },
        facts,
      },
      null,
      2,
    )
    return {
      filename: `${baseName}.json`,
      mimeType: "application/json",
      content,
      factCount: facts.length,
      rawPayloadPolicy: input.includeRedactedRawPayload
        ? ("redacted" as const)
        : ("omitted" as const),
    }
  }

  const aggregateKeysByFact = new Map<string, string[]>()
  for (const aggregate of rollup.items) {
    for (const factId of aggregate.factIds) {
      const keys = aggregateKeysByFact.get(factId) ?? []
      keys.push(aggregate.key)
      aggregateKeysByFact.set(factId, keys)
    }
  }
  const columns = [
    "fact_id",
    "provider_id",
    "account_tag",
    "harness",
    "model",
    "source",
    "source_tag",
    "source_class",
    "quality",
    "captured_at",
    "window_start",
    "window_end",
    "input_tokens",
    "output_tokens",
    "reasoning_tokens",
    "total_tokens",
    "request_count",
    "cost_usd_micros",
    "cost_usd_estimated_micros",
    "project_id",
    "project_name",
    "task_id",
    "task_name",
    "chat_id",
    "chat_name",
    "automation_id",
    "automation_name",
    "orchestration_id",
    "orchestration_name",
    "run_id",
    "dedupe_strategy",
    "dedupe_group_key",
    "pricing_version",
    "aggregate_keys",
    "redacted_raw_payload",
  ]
  const rows = facts.map((fact) => [
    fact.id,
    fact.providerId,
    fact.accountTag,
    fact.harness,
    fact.model,
    fact.source,
    fact.sourceTag,
    fact.sourceClass,
    fact.quality,
    isoTimestamp(fact.capturedAtMs),
    isoTimestamp(fact.windowStartMs),
    isoTimestamp(fact.windowEndMs),
    fact.metrics.inputTokens,
    fact.metrics.outputTokens,
    fact.metrics.reasoningTokens,
    fact.metrics.totalTokens,
    fact.metrics.requestCount,
    fact.metrics.costUsdMicros,
    fact.metrics.costUsdEstimatedMicros,
    fact.attribution.projectId,
    fact.attribution.projectName,
    fact.attribution.taskId,
    fact.attribution.taskName,
    fact.attribution.chatId,
    fact.attribution.chatName,
    fact.attribution.automationId,
    fact.attribution.automationName,
    fact.attribution.orchestrationId,
    fact.attribution.orchestrationName,
    fact.attribution.runId,
    fact.provenance.dedupeStrategy,
    fact.provenance.dedupeGroupKey,
    fact.provenance.pricingVersion,
    (aggregateKeysByFact.get(fact.id) ?? []).join("|"),
    input.includeRedactedRawPayload ? JSON.stringify(fact.redactedRawPayload ?? null) : null,
  ])
  const content = [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n"
  return {
    filename: `${baseName}.csv`,
    mimeType: "text/csv;charset=utf-8",
    content,
    factCount: facts.length,
    rawPayloadPolicy: input.includeRedactedRawPayload
      ? ("redacted" as const)
      : ("omitted" as const),
  }
}

export function redactUsageRawPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUsageRawPayload)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        isSecretKey(key) ? "[redacted]" : redactUsageRawPayload(field),
      ]),
    )
  }
  if (typeof value === "string") return redactSecretText(value)
  return value
}

export function usageExplorerMetricValue(
  metrics: UsageRollupMetrics,
  metric: UsageExplorerMetric,
): number | null {
  if (metric === "total-tokens") return metrics.totalTokens
  if (metric === "request-count") return metrics.requestCount
  const values = [metrics.costUsdMicros, metrics.costUsdEstimatedMicros].filter(
    (value): value is number => value !== null,
  )
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}

function readExplorerFacts(
  sqlite: Sqlite,
  factIds: string[],
  includeRedactedRawPayload: boolean,
): UsageExplorerFact[] {
  if (!factIds.length) return []
  const rows: Array<Record<string, unknown>> = []
  for (let offset = 0; offset < factIds.length; offset += 400) {
    const ids = factIds.slice(offset, offset + 400)
    const placeholders = ids.map(() => "?").join(", ")
    rows.push(
      ...(sqlite
        .prepare(
          `SELECT id, provider_id, account_tag, source, source_tag, source_class,
                  cost_quality, captured_at, window_start, window_end, model,
                  input_tokens, output_tokens, reasoning_tokens, total_tokens,
                  request_count, cost_usd_micros, cost_usd_estimated_micros,
                  attribution_state, attribution_harness,
                  attribution_project_id, attribution_project_name,
                  attribution_task_id, attribution_task_name,
                  attribution_chat_id, attribution_chat_name,
                  attribution_automation_id, attribution_automation_name,
                  attribution_orchestration_id, attribution_orchestration_name,
                  attribution_run_id, dedupe_strategy, dedupe_group_key, raw_payload
           FROM usage_samples
           WHERE id IN (${placeholders})`,
        )
        .all(...ids) as Array<Record<string, unknown>>),
    )
  }
  return rows
    .map((row) => {
      const rawPayload = parseRawPayload(row.raw_payload)
      return {
        id: String(row.id),
        providerId: String(row.provider_id),
        accountTag: typeof row.account_tag === "string" ? row.account_tag : "",
        harness: stringOrNull(row.attribution_harness),
        model: stringOrNull(row.model),
        source: String(row.source),
        sourceTag: stringOrNull(row.source_tag),
        sourceClass: String(row.source_class),
        quality: quality(row.cost_quality),
        capturedAtMs: epochMs(row.captured_at),
        windowStartMs: epochMs(row.window_start),
        windowEndMs: epochMs(row.window_end),
        metrics: {
          inputTokens: finiteNumber(row.input_tokens),
          outputTokens: finiteNumber(row.output_tokens),
          reasoningTokens: finiteNumber(row.reasoning_tokens),
          totalTokens: finiteNumber(row.total_tokens),
          requestCount: finiteNumber(row.request_count),
          costUsdMicros: finiteNumber(row.cost_usd_micros),
          costUsdEstimatedMicros: finiteNumber(row.cost_usd_estimated_micros),
        },
        attribution: {
          state:
            row.attribution_state === "attributed" ? ("attributed" as const) : ("unknown" as const),
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
        },
        provenance: {
          dedupeStrategy: String(row.dedupe_strategy),
          dedupeGroupKey: stringOrNull(row.dedupe_group_key),
          pricingVersion: pricingVersion(rawPayload),
          rawPayload: includeRedactedRawPayload ? ("redacted" as const) : ("omitted" as const),
        },
        ...(includeRedactedRawPayload
          ? { redactedRawPayload: redactUsageRawPayload(rawPayload) }
          : {}),
      }
    })
    .sort(
      (left, right) =>
        (left.capturedAtMs ?? 0) - (right.capturedAtMs ?? 0) || left.id.localeCompare(right.id),
    )
}

function parseRawPayload(value: unknown): unknown {
  if (typeof value !== "string" || !value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function pricingVersion(value: unknown): string | null {
  if (!value || typeof value !== "object") return null
  const provenance = (value as { flapstackProvenance?: unknown }).flapstackProvenance
  if (!provenance || typeof provenance !== "object") return null
  return stringOrNull((provenance as { pricingVersion?: unknown }).pricingVersion)
}

function isSecretKey(key: string): boolean {
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-z0-9]+/gi, "_")
  return /(^|_)(authorization|auth|credential|password|passwd|secret|api_?key|token|access_?token|refresh_?token|id_?token|cookie|session|webhook|private_?key)($|_)/i.test(
    normalized,
  )
}

function redactSecretText(value: string): string {
  if (/-----BEGIN [^-]*PRIVATE KEY-----/i.test(value)) return "[redacted-private-key]"
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[redacted]@")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/\b(?:sk|ghp|gho|github_pat|xox[baprs])[-_][-A-Za-z0-9_]{8,}\b/g, "[redacted]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted-aws-access-key]")
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted-google-api-key]")
    .replace(/\bnpm_[A-Za-z0-9]{36}\b/g, "[redacted-npm-token]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
    .replace(
      /([?&](?:authorization|auth|credential|password|passwd|secret|client[_-]?secret|api[_-]?key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|cookie|session|webhook|private[_-]?key)=)[^&#\s]+/gi,
      "$1[redacted]",
    )
    .replace(
      /\b(authorization|auth|credential|password|passwd|secret|client[_-]?secret|api[_-]?key|token|access[_-]?token|refresh[_-]?token|id[_-]?token|cookie|session|webhook|private[_-]?key)\s*[:=]\s*[^,;\s]+/gi,
      "$1=[redacted]",
    )
    .replace(
      /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/gi,
      "[redacted-webhook]",
    )
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const raw = String(value)
  const text = /^[=+@-]/.test(raw) ? `'${raw}` : raw
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function isoTimestamp(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

function rawClient(db: UsageDb): Sqlite {
  return (db as unknown as { $client: Sqlite }).$client
}

function quality(value: unknown): UsageRollupQuality {
  return value === "exact" || value === "provider-reported" || value === "estimated"
    ? value
    : "unknown"
}
