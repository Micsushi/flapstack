import type Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { AGENT_HARNESSES, type AgentHarness } from "../../../shared/harness-types"
import type {
  UsageAttributionSnapshot,
  UsageFactClassification,
  UsageSourceClass,
} from "../../../shared/advanced-usage"
import type { CostQuality, SampleSource, UsageSampleInput } from "./types"
import type { UsageDb } from "./store"
import { stringOrNull } from "./time"

type Sqlite = Database.Database
type Row = Record<string, unknown>

export type ResolvedUsageAttribution = {
  snapshot: UsageAttributionSnapshot
  model: string | null
}

export type UsageAttributionBackfillReport = {
  scanned: number
  attributed: number
  classified: number
  unresolved: number
}

export type UsageRollupQuality = CostQuality
export type UsageRollupDimension =
  | "provider-account"
  | "run"
  | "chat"
  | "task"
  | "project"
  | "automation"
  | "orchestration"
  | "harness"
  | "model"
  | "source"

export type UsageRollupProvenance = {
  factId: string
  dedupeKey: string
  source: string
  sourceClass: UsageSourceClass
  costQuality: string
  attributionState: "attributed" | "unknown"
}

export type UsageAttributionRollup = {
  key: string
  dimension: UsageRollupDimension
  value: string
  label: string | null
  sourceClass: UsageSourceClass
  quality: UsageRollupQuality
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  totalTokens: number | null
  requestCount: number | null
  costUsdMicros: number | null
  costUsdEstimatedMicros: number | null
  factIds: string[]
  provenance: UsageRollupProvenance[]
}

export type UsageAttributionRebuild = {
  rawFactCount: number
  selectedFactCount: number
  backfill: UsageAttributionBackfillReport
  rollups: UsageAttributionRollup[]
}

const UNKNOWN_ATTRIBUTION: UsageAttributionSnapshot = {
  state: "unknown",
  harness: null,
  projectId: null,
  projectName: null,
  taskId: null,
  taskName: null,
  chatId: null,
  chatName: null,
  automationId: null,
  automationName: null,
  orchestrationId: null,
  orchestrationName: null,
  runId: null,
}

const HARNESSES = new Set<string>(AGENT_HARNESSES)

/** Resolve only durable relational evidence. Missing or conflicting rows stay unknown. */
export function resolveUsageAttributionFromSqlite(
  sqlite: Sqlite,
  runId: string | null | undefined,
): ResolvedUsageAttribution {
  if (!runId) return { snapshot: { ...UNKNOWN_ATTRIBUTION }, model: null }

  try {
    const run = sqlite
      .prepare(
        `SELECT r.id AS run_id, r.harness, r.model,
                c.id AS chat_id, c.name AS chat_name, c.project_id AS chat_project_id,
                p_chat.name AS chat_project_name,
                t.id AS task_id, t.name AS task_name, t.project_id AS task_project_id,
                p_task.name AS task_project_name
         FROM agent_runs r
         LEFT JOIN chats c ON c.id = r.chat_id
         LEFT JOIN tasks t ON t.id = c.task_id
         LEFT JOIN projects p_chat ON p_chat.id = c.project_id
         LEFT JOIN projects p_task ON p_task.id = t.project_id
         WHERE r.id = ?`,
      )
      .get(runId) as Row | undefined
    if (!run) return { snapshot: { ...UNKNOWN_ATTRIBUTION }, model: null }

    const chatProjectId = stringOrNull(run.chat_project_id)
    const taskProjectId = stringOrNull(run.task_project_id)
    const projectConflict = Boolean(
      chatProjectId && taskProjectId && chatProjectId !== taskProjectId,
    )
    const projectId = projectConflict ? null : (taskProjectId ?? chatProjectId)
    const projectName = projectConflict
      ? null
      : taskProjectId
        ? normalizedName(run.task_project_name)
        : normalizedName(run.chat_project_name)
    const harnessValue = stringOrNull(run.harness)
    const harness =
      harnessValue && HARNESSES.has(harnessValue) ? (harnessValue as AgentHarness) : null
    const automations = distinctIdentityRows(
      sqlite,
      `SELECT a.id, a.name
       FROM automation_executions e
       JOIN automation_occurrences o ON o.id = e.occurrence_id
       JOIN automations a ON a.id = o.automation_id
       WHERE e.run_id = ?
       ORDER BY a.id`,
      runId,
    )
    const orchestrations = distinctIdentityRows(
      sqlite,
      `SELECT o.task_id AS id, t.name
       FROM orchestration_agents a
       JOIN task_orchestrations o ON o.task_id = a.task_id
       LEFT JOIN tasks t ON t.id = o.task_id
       WHERE a.run_id = ?
       ORDER BY o.task_id`,
      runId,
    )
    const automation = automations.length === 1 ? automations[0] : null
    const orchestration = orchestrations.length === 1 ? orchestrations[0] : null

    return {
      snapshot: {
        state: "attributed",
        harness,
        projectId,
        projectName,
        taskId: stringOrNull(run.task_id),
        taskName: normalizedName(run.task_name),
        chatId: stringOrNull(run.chat_id),
        chatName: normalizedName(run.chat_name),
        automationId: automation?.id ?? null,
        automationName: automation?.name ?? null,
        orchestrationId: orchestration?.id ?? null,
        orchestrationName: orchestration?.name ?? null,
        runId,
      },
      model: normalizedName(run.model),
    }
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return { snapshot: { ...UNKNOWN_ATTRIBUTION }, model: null }
    }
    throw error
  }
}

export function classifyUsageFact(
  sample: Pick<
    UsageSampleInput,
    | "providerId"
    | "accountTag"
    | "source"
    | "sourceTag"
    | "metricKey"
    | "capturedAt"
    | "windowStart"
    | "windowEnd"
    | "resetAt"
    | "generationId"
    | "runId"
  >,
): UsageFactClassification {
  const sourceClass: UsageSourceClass =
    sample.runId || sample.source === "flapstack-run"
      ? "flapstack-run"
      : sample.source === "external-provider"
        ? "external-provider"
        : "provider-account-total"

  if (sourceClass !== "provider-account-total") {
    return { sourceClass, dedupeStrategy: "exact-fact", dedupeGroupKey: null }
  }

  const windowIdentity = [
    sample.windowStart?.toISOString() ?? "open",
    sample.windowEnd?.toISOString() ?? sample.resetAt?.toISOString() ?? "current",
  ]
  const canonical = JSON.stringify([
    sample.providerId,
    sample.accountTag ?? "",
    sample.sourceTag ?? "",
    sample.metricKey ?? "",
    ...windowIdentity,
  ])
  const digest = createHash("sha256").update(canonical).digest("hex")
  return {
    sourceClass,
    dedupeStrategy: "overlap-group",
    dedupeGroupKey: `provider-account:${digest}`,
  }
}

export function prepareUsageFact(
  db: UsageDb,
  sample: UsageSampleInput,
): ResolvedUsageAttribution & { classification: UsageFactClassification } {
  return {
    ...resolveUsageAttributionFromSqlite(rawClient(db), sample.runId),
    classification: classifyUsageFact(sample),
  }
}

/** Safe to run at every app/daemon start. Existing snapshots are never refreshed. */
export function backfillUsageAttribution(db: UsageDb): UsageAttributionBackfillReport {
  const sqlite = rawClient(db)
  try {
    const rows = sqlite
      .prepare(
        `SELECT id, provider_id, account_tag, source, source_tag, metric_key, captured_at,
                window_start, window_end, reset_at, generation_id, run_id,
                attribution_state, source_class, dedupe_strategy
         FROM usage_samples
         WHERE source_class = 'unknown'
            OR dedupe_strategy = 'unknown'
            OR (attribution_state = 'unknown' AND run_id IS NOT NULL)
         ORDER BY id`,
      )
      .all() as Row[]
    let attributed = 0
    let classified = 0
    let unresolved = 0

    const updateClassification = sqlite.prepare(
      `UPDATE usage_samples
       SET source_class = CASE WHEN source_class = 'unknown' THEN ? ELSE source_class END,
           dedupe_strategy = CASE WHEN dedupe_strategy = 'unknown' THEN ? ELSE dedupe_strategy END,
           dedupe_group_key = CASE
             WHEN dedupe_strategy = 'unknown' THEN ?
             ELSE dedupe_group_key
           END
       WHERE id = ? AND (source_class = 'unknown' OR dedupe_strategy = 'unknown')`,
    )
    const updateAttribution = sqlite.prepare(
      `UPDATE usage_samples
       SET attribution_state = 'attributed',
           attribution_harness = ?, attribution_project_id = ?, attribution_project_name = ?,
           attribution_task_id = ?, attribution_task_name = ?,
           attribution_chat_id = ?, attribution_chat_name = ?,
           attribution_automation_id = ?, attribution_automation_name = ?,
           attribution_orchestration_id = ?, attribution_orchestration_name = ?,
           attribution_run_id = ?, model = COALESCE(model, ?)
       WHERE id = ? AND attribution_state = 'unknown'`,
    )

    const apply = sqlite.transaction(() => {
      for (const row of rows) {
        const sample = sampleFromRow(row)
        const classification = classifyUsageFact(sample)
        const classificationResult = updateClassification.run(
          classification.sourceClass,
          classification.dedupeStrategy,
          classification.dedupeGroupKey,
          row.id,
        )
        if (classificationResult.changes > 0) classified += 1

        if (row.attribution_state !== "unknown" || !sample.runId) continue
        const resolved = resolveUsageAttributionFromSqlite(sqlite, sample.runId)
        if (resolved.snapshot.state === "unknown") {
          unresolved += 1
          continue
        }
        const snapshot = resolved.snapshot
        const result = updateAttribution.run(
          snapshot.harness,
          snapshot.projectId,
          snapshot.projectName,
          snapshot.taskId,
          snapshot.taskName,
          snapshot.chatId,
          snapshot.chatName,
          snapshot.automationId,
          snapshot.automationName,
          snapshot.orchestrationId,
          snapshot.orchestrationName,
          snapshot.runId,
          resolved.model,
          row.id,
        )
        if (result.changes > 0) attributed += 1
      }
    })
    apply.immediate()
    return { scanned: rows.length, attributed, classified, unresolved }
  } catch (error) {
    if (isMissingSchemaError(error)) {
      return { scanned: 0, attributed: 0, classified: 0, unresolved: 0 }
    }
    throw error
  }
}

/** Rebuilds source-separated aggregates from raw facts; no cache is authoritative. */
export function rebuildUsageAttributionRollups(db: UsageDb): UsageAttributionRebuild {
  const backfill = backfillUsageAttribution(db)
  const rows = rawClient(db)
    .prepare(
      `SELECT id, provider_id, account_tag, source, cost_quality, captured_at,
              input_tokens, output_tokens, reasoning_tokens, total_tokens, request_count,
              cost_usd_micros, cost_usd_estimated_micros, model,
              attribution_state, attribution_harness,
              attribution_project_id, attribution_project_name,
              attribution_task_id, attribution_task_name,
              attribution_chat_id, attribution_chat_name,
              attribution_automation_id, attribution_automation_name,
              attribution_orchestration_id, attribution_orchestration_name,
              attribution_run_id, source_class, dedupe_strategy, dedupe_group_key, dedupe_key
       FROM usage_samples
       ORDER BY id`,
    )
    .all() as Row[]
  const selected = selectLatestOverlapFacts(rows)
  const groups = new Map<
    string,
    {
      dimension: UsageRollupDimension
      value: string
      label: string | null
      sourceClass: UsageSourceClass
      rows: Row[]
    }
  >()

  for (const row of selected) {
    const sourceClass = usageSourceClass(row.source_class)
    for (const dimension of dimensions(row)) {
      const key = JSON.stringify([dimension.type, dimension.value, sourceClass])
      const group = groups.get(key) ?? {
        ...dimension,
        dimension: dimension.type,
        sourceClass,
        rows: [],
      }
      group.rows.push(row)
      groups.set(key, group)
    }
  }

  const rollups = [...groups.entries()]
    .map(([key, group]): UsageAttributionRollup => {
      const ordered = [...group.rows].sort((left, right) =>
        String(left.id).localeCompare(String(right.id)),
      )
      return {
        key,
        dimension: group.dimension,
        value: group.value,
        label: group.label,
        sourceClass: group.sourceClass,
        quality: weakestQuality(ordered.map((row) => String(row.cost_quality))),
        inputTokens: sumNullable(ordered, "input_tokens"),
        outputTokens: sumNullable(ordered, "output_tokens"),
        reasoningTokens: sumNullable(ordered, "reasoning_tokens"),
        totalTokens: sumNullable(ordered, "total_tokens"),
        requestCount: sumNullable(ordered, "request_count"),
        costUsdMicros: sumNullable(ordered, "cost_usd_micros"),
        costUsdEstimatedMicros: sumNullable(ordered, "cost_usd_estimated_micros"),
        factIds: ordered.map((row) => String(row.id)),
        provenance: ordered.map((row) => ({
          factId: String(row.id),
          dedupeKey: String(row.dedupe_key),
          source: String(row.source),
          sourceClass: usageSourceClass(row.source_class),
          costQuality: String(row.cost_quality),
          attributionState: row.attribution_state === "attributed" ? "attributed" : "unknown",
        })),
      }
    })
    .sort((left, right) => left.key.localeCompare(right.key))

  return { rawFactCount: rows.length, selectedFactCount: selected.length, backfill, rollups }
}

function rawClient(db: UsageDb): Sqlite {
  return (db as unknown as { $client: Sqlite }).$client
}

function distinctIdentityRows(sqlite: Sqlite, sql: string, runId: string) {
  const rows = sqlite.prepare(sql).all(runId) as Row[]
  const identities = new Map<string, { id: string; name: string | null }>()
  for (const row of rows) {
    const id = stringOrNull(row.id)
    if (id) identities.set(id, { id, name: normalizedName(row.name) })
  }
  return [...identities.values()]
}

function sampleFromRow(row: Row): UsageSampleInput {
  return {
    providerId: String(row.provider_id) as UsageSampleInput["providerId"],
    accountTag: stringOrNull(row.account_tag),
    source: String(row.source) as SampleSource,
    costQuality: "unknown",
    sourceTag: stringOrNull(row.source_tag),
    metricKey: stringOrNull(row.metric_key),
    capturedAt: dateOrUndefined(row.captured_at),
    windowStart: dateOrNull(row.window_start),
    windowEnd: dateOrNull(row.window_end),
    resetAt: dateOrNull(row.reset_at),
    generationId: stringOrNull(row.generation_id),
    runId: stringOrNull(row.run_id),
  }
}

function dimensions(
  row: Row,
): Array<{ type: UsageRollupDimension; value: string; label: string | null }> {
  const values: Array<{ type: UsageRollupDimension; value: string | null; label: string | null }> =
    [
      {
        type: "provider-account",
        value: JSON.stringify([String(row.provider_id), String(row.account_tag ?? "")]),
        label: null,
      },
      { type: "run", value: stringOrNull(row.attribution_run_id), label: null },
      {
        type: "chat",
        value: stringOrNull(row.attribution_chat_id),
        label: normalizedName(row.attribution_chat_name),
      },
      {
        type: "task",
        value: stringOrNull(row.attribution_task_id),
        label: normalizedName(row.attribution_task_name),
      },
      {
        type: "project",
        value: stringOrNull(row.attribution_project_id),
        label: normalizedName(row.attribution_project_name),
      },
      {
        type: "automation",
        value: stringOrNull(row.attribution_automation_id),
        label: normalizedName(row.attribution_automation_name),
      },
      {
        type: "orchestration",
        value: stringOrNull(row.attribution_orchestration_id),
        label: normalizedName(row.attribution_orchestration_name),
      },
      { type: "harness", value: stringOrNull(row.attribution_harness), label: null },
      { type: "model", value: stringOrNull(row.model), label: null },
      { type: "source", value: stringOrNull(row.source), label: null },
    ]
  return values.flatMap((value) =>
    value.value === null ? [] : [{ type: value.type, value: value.value, label: value.label }],
  )
}

function selectLatestOverlapFacts(rows: Row[]): Row[] {
  const selected = new Map<string, Row>()
  for (const row of rows) {
    const groupKey = stringOrNull(row.dedupe_group_key)
    const selectionKey =
      row.dedupe_strategy === "overlap-group" && groupKey
        ? `group:${String(row.source_class)}:${groupKey}`
        : `fact:${String(row.id)}`
    const current = selected.get(selectionKey)
    if (!current || compareUsageFactRecency(row, current) > 0) selected.set(selectionKey, row)
  }
  return [...selected.values()].sort((left, right) =>
    String(left.id).localeCompare(String(right.id)),
  )
}

export function compareUsageFactRecency(left: Row, right: Row): number {
  const time = numericOrZero(left.captured_at) - numericOrZero(right.captured_at)
  if (time) return time
  return compareStableIds(left.id, right.id)
}

function sumNullable(rows: Row[], field: string): number | null {
  const values = rows.flatMap((row) =>
    typeof row[field] === "number" && Number.isFinite(row[field]) ? [row[field] as number] : [],
  )
  return values.length ? values.reduce((total, value) => total + value, 0) : null
}

function weakestQuality(qualities: string[]): UsageRollupQuality {
  if (qualities.length === 0) return "unknown"
  const rank: Record<UsageRollupQuality, number> = {
    exact: 3,
    "provider-reported": 2,
    estimated: 1,
    unknown: 0,
  }
  return qualities
    .map((quality): UsageRollupQuality =>
      quality === "exact" || quality === "provider-reported" || quality === "estimated"
        ? quality
        : "unknown",
    )
    .reduce((weakest, quality) => (rank[quality] < rank[weakest] ? quality : weakest), "exact")
}

function compareStableIds(left: unknown, right: unknown): number {
  const leftText = String(left)
  const rightText = String(right)
  if (/^\d+$/.test(leftText) && /^\d+$/.test(rightText)) {
    const leftNumber = BigInt(leftText)
    const rightNumber = BigInt(rightText)
    return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0
  }
  return leftText.localeCompare(rightText)
}

function usageSourceClass(value: unknown): UsageSourceClass {
  return value === "provider-account-total" ||
    value === "flapstack-run" ||
    value === "external-provider"
    ? value
    : "unknown"
}

function normalizedName(value: unknown): string | null {
  const string = stringOrNull(value)?.trim()
  return string ? string.slice(0, 256) : null
}

function numericOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function dateOrUndefined(value: unknown): Date | undefined {
  return dateOrNull(value) ?? undefined
}

function dateOrNull(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return new Date(value < 10_000_000_000 ? value * 1_000 : value)
}

function isMissingSchemaError(error: unknown): boolean {
  return /no such (table|column)/i.test(error instanceof Error ? error.message : String(error))
}
