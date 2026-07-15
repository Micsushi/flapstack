import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import {
  AGENT_ACTIVITY_DISPLAY_CLASSES,
  AGENT_ACTIVITY_KINDS,
  AGENT_ACTIVITY_PHASES,
  AGENT_ACTIVITY_PRIVACY_CLASSES,
  AGENT_ACTIVITY_REDACTION_STATES,
  MAX_AGENT_ACTIVITY_BATCH_SIZE,
  MAX_AGENT_ACTIVITY_METADATA_DEPTH,
  MAX_AGENT_ACTIVITY_METADATA_ENTRIES,
  MAX_AGENT_ACTIVITY_METADATA_STRING,
  MAX_AGENT_ACTIVITY_PAYLOAD_BYTES,
  agentActivityQuerySchema,
  parseAgentActivityAppend,
  parseAgentActivityPayload,
  type AgentActivityAppend,
  type AgentActivityEvent,
  type AgentActivityInvalidation,
  type AgentActivityKind,
  type AgentActivityPage,
  type AgentActivityPayloadByKind,
  type AgentActivityPrivacyClass,
  type AgentActivityQuery,
  type BoundedActivityMetadata,
  type UnknownAgentActivity,
} from "../../../shared/agent-activity"
import { RESOLVED_AGENT_RUNTIMES, type ResolvedAgentRuntime } from "../../../shared/agent-runtime"

type Sqlite = Database.Database
type DatabaseLike = Sqlite | object
type SqlRow = Record<string, unknown>

export class AgentActivityError extends Error {
  constructor(
    readonly code:
      | "activity-run-missing"
      | "activity-invalid"
      | "activity-private-text"
      | "activity-too-large"
      | "activity-corrupt"
      | "activity-unknown-critical",
    message: string,
  ) {
    super(message)
    this.name = "AgentActivityError"
  }
}

export type AgentActivityStoreOptions = {
  now?: () => number
  createEventId?: () => string
  onInvalidated?: (invalidation: AgentActivityInvalidation) => void
}

export type AgentActivityRetentionInput = {
  beforeReceivedAt: number
  runId?: string
  mode: "redact" | "delete"
  reason: string
}

export type AgentActivityExport = {
  schemaVersion: 1
  exportedAt: number
  events: AgentActivityEvent[]
  excludedPrivateCount: number
}

export class AgentActivityStore {
  private readonly sqlite: Sqlite
  private readonly now: () => number
  private readonly createEventId: () => string
  private readonly onInvalidated?: (invalidation: AgentActivityInvalidation) => void

  constructor(database: DatabaseLike, options: AgentActivityStoreOptions = {}) {
    this.sqlite = rawClient(database)
    this.now = options.now ?? Date.now
    this.createEventId = options.createEventId ?? randomUUID
    this.onInvalidated = options.onInvalidated
  }

  append(runId: string, input: AgentActivityAppend): AgentActivityEvent {
    return this.appendBatch(runId, [input])[0]
  }

  appendBatch(runId: string, inputValues: readonly AgentActivityAppend[]): AgentActivityEvent[] {
    if (!runId.trim()) throw invalid("runId is required")
    if (inputValues.length === 0) return []
    if (inputValues.length > MAX_AGENT_ACTIVITY_BATCH_SIZE) {
      throw invalid(`Activity batch exceeds ${MAX_AGENT_ACTIVITY_BATCH_SIZE} events.`)
    }

    // Validate and bound every payload before opening the write transaction so
    // one bad callback cannot partially append a provider batch.
    const inputs = inputValues.map((value) => sanitizeAppend(value))
    const inserted: AgentActivityEvent[] = []
    const output: AgentActivityEvent[] = []
    let invalidation: AgentActivityInvalidation | null = null

    const transaction = this.sqlite.transaction(() => {
      const run = this.sqlite
        .prepare(
          `SELECT id, chat_id, sub_chat_id, harness, resolved_runtime
           FROM agent_runs WHERE id = ?`,
        )
        .get(runId) as
        | {
            id: string
            chat_id: string
            sub_chat_id: string | null
            harness: string
            resolved_runtime: ResolvedAgentRuntime
          }
        | undefined
      if (!run) {
        throw new AgentActivityError("activity-run-missing", `Activity run ${runId} is missing.`)
      }

      const sequenceTimestamp = Math.floor(this.now() / 1_000)
      this.sqlite
        .prepare(
          `INSERT INTO agent_activity_sequences (run_id, next_sequence, updated_at)
           SELECT ?, COALESCE(MAX(sequence), 0) + 1, ?
           FROM agent_activity_events WHERE run_id = ?
           ON CONFLICT(run_id) DO NOTHING`,
        )
        .run(runId, sequenceTimestamp, runId)
      let nextSequence = Number(
        (
          this.sqlite
            .prepare("SELECT next_sequence FROM agent_activity_sequences WHERE run_id = ?")
            .get(runId) as { next_sequence: number }
        ).next_sequence,
      )
      const inBatchDedup = new Map<string, AgentActivityEvent>()
      const existingByDedup = this.sqlite.prepare(
        "SELECT * FROM agent_activity_events WHERE run_id = ? AND dedup_key = ?",
      )
      const insert = this.sqlite.prepare(`
        INSERT INTO agent_activity_events (
          event_id, run_id, chat_id, sub_chat_id, orchestration_agent_id,
          runtime, harness, provider, sequence, kind, phase, display_class,
          privacy_class, redaction_state, redaction_reason, provider_timestamp,
          received_at, provider_event_id, provider_session_id, provider_thread_id,
          provider_turn_id, provider_item_id, provider_parent_item_id,
          provider_message_id, provider_tool_id, summary_index, content_index,
          part_index, section_boundary, dedup_key, payload_json, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', NULL, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `)

      for (const input of inputs) {
        const dedupKey = effectiveDedupKey(input)
        if (dedupKey) {
          const local = inBatchDedup.get(dedupKey)
          if (local) {
            output.push(local)
            continue
          }
          const existing = existingByDedup.get(runId, dedupKey) as SqlRow | undefined
          if (existing) {
            const decoded = decodeRow(existing, "fail")
            inBatchDedup.set(dedupKey, decoded)
            output.push(decoded)
            continue
          }
        }

        const eventId = this.createEventId()
        const receivedAt = input.receivedAt ?? this.now()
        const createdAt = Math.floor(this.now() / 1_000)
        const payloadJson = JSON.stringify(input.payload)
        const result = insert.run(
          eventId,
          runId,
          run.chat_id,
          run.sub_chat_id,
          input.orchestrationAgentId ?? null,
          run.resolved_runtime,
          run.harness,
          input.provider,
          nextSequence,
          input.kind,
          input.phase,
          input.displayClass,
          input.privacyClass,
          input.providerTimestamp ?? null,
          receivedAt,
          input.providerEventId ?? null,
          input.providerSessionId ?? null,
          input.providerThreadId ?? null,
          input.providerTurnId ?? null,
          input.providerItemId ?? null,
          input.providerParentItemId ?? null,
          input.providerMessageId ?? null,
          input.providerToolId ?? null,
          input.summaryIndex ?? null,
          input.contentIndex ?? null,
          input.partIndex ?? null,
          input.sectionBoundary ?? null,
          dedupKey,
          payloadJson,
          createdAt,
        )
        const row = this.sqlite
          .prepare("SELECT * FROM agent_activity_events WHERE storage_id = ?")
          .get(Number(result.lastInsertRowid)) as SqlRow
        const event = decodeRow(row, "fail")
        inserted.push(event)
        output.push(event)
        if (dedupKey) inBatchDedup.set(dedupKey, event)
        nextSequence += 1
      }

      if (inserted.length > 0) {
        this.sqlite
          .prepare(
            `UPDATE agent_activity_sequences
             SET next_sequence = ?, updated_at = ? WHERE run_id = ?`,
          )
          .run(nextSequence, sequenceTimestamp, runId)
        invalidation = {
          reason: "append",
          runId,
          chatId: run.chat_id,
          firstSequence: inserted[0].sequence,
          lastSequence: inserted[inserted.length - 1].sequence,
          lastStorageId: inserted[inserted.length - 1].storageId,
          insertedCount: inserted.length,
        }
      }
    })

    try {
      transaction.immediate()
    } catch (error) {
      if (error instanceof AgentActivityError) throw error
      throw new AgentActivityError(
        "activity-invalid",
        `Activity batch was not appended: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (invalidation) this.onInvalidated?.(invalidation)
    return output
  }

  query(inputValue: AgentActivityQuery): AgentActivityPage {
    const input = agentActivityQuerySchema.parse(inputValue)
    const filters: string[] = []
    const params: unknown[] = []
    if (input.runId) {
      filters.push("run_id = ?")
      params.push(input.runId)
    }
    if (input.chatId) {
      filters.push("chat_id = ?")
      params.push(input.chatId)
    }
    if (input.kinds?.length) addInFilter(filters, params, "kind", input.kinds)
    if (input.privacyClasses?.length) {
      addInFilter(filters, params, "privacy_class", input.privacyClasses)
    }
    if (input.afterStorageId) {
      filters.push("storage_id > ?")
      params.push(input.afterStorageId)
    }
    if (input.beforeStorageId) {
      filters.push("storage_id < ?")
      params.push(input.beforeStorageId)
    }
    const descending = input.direction === "backward"
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM agent_activity_events
         WHERE ${filters.join(" AND ")}
         ORDER BY storage_id ${descending ? "DESC" : "ASC"}
         LIMIT ?`,
      )
      .all(...params, input.limit + 1) as SqlRow[]
    const hasMore = rows.length > input.limit
    const selected = rows.slice(0, input.limit)
    const events = selected.map((row) => decodeRow(row, input.corruptionMode))
    if (descending) events.reverse()
    const nextCursor =
      events.length === 0
        ? null
        : descending
          ? events[0].storageId
          : events[events.length - 1].storageId
    return { events, nextCursor: hasMore ? nextCursor : null, hasMore }
  }

  replayRun(runId: string, afterSequence = 0, limit = 500): AgentActivityEvent[] {
    if (!runId.trim()) throw invalid("runId is required")
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw invalid("afterSequence must be a non-negative integer")
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
      throw invalid("replay limit must be between 1 and 10000")
    }
    const rows = this.sqlite
      .prepare(
        `SELECT * FROM agent_activity_events
         WHERE run_id = ? AND sequence > ?
         ORDER BY sequence ASC LIMIT ?`,
      )
      .all(runId, afterSequence, limit) as SqlRow[]
    return rows.map((row) => decodeRow(row, "fail"))
  }

  export(input: AgentActivityQuery): AgentActivityExport {
    const events: AgentActivityEvent[] = []
    let excludedPrivateCount = 0
    let cursor = input.afterStorageId
    const upperExclusive =
      input.beforeStorageId ??
      Number(
        (
          this.sqlite
            .prepare(
              "SELECT COALESCE(MAX(storage_id), 0) + 1 upper_exclusive FROM agent_activity_events",
            )
            .get() as { upper_exclusive: number }
        ).upper_exclusive,
      )
    do {
      const page = this.query({
        ...input,
        afterStorageId: cursor,
        beforeStorageId: upperExclusive,
        limit: 500,
        direction: "forward",
      })
      for (const event of page.events) {
        if (event.privacyClass === "private" || event.privacyClass === "encrypted") {
          excludedPrivateCount += 1
          continue
        }
        events.push(redactEventForExport(event))
      }
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    return { schemaVersion: 1, exportedAt: this.now(), events, excludedPrivateCount }
  }

  redactRun(runId: string, reason: string): number {
    if (!reason.trim()) throw invalid("redaction reason is required")
    return this.applyRedaction("run_id = ?", [runId], reason, "redacted")
  }

  applyRetention(input: AgentActivityRetentionInput): number {
    if (!Number.isFinite(input.beforeReceivedAt) || input.beforeReceivedAt < 0) {
      throw invalid("beforeReceivedAt must be a non-negative timestamp")
    }
    if (!input.reason.trim()) throw invalid("retention reason is required")
    const filter = `received_at < ?${input.runId ? " AND run_id = ?" : ""}`
    const params: unknown[] = [input.beforeReceivedAt]
    if (input.runId) params.push(input.runId)
    if (input.mode === "redact") {
      return this.applyRedaction(filter, params, input.reason, "retained-redaction")
    }
    const affected = this.affectedInvalidations(filter, params, "retention")
    const transaction = this.sqlite.transaction(
      () =>
        this.sqlite.prepare(`DELETE FROM agent_activity_events WHERE ${filter}`).run(...params)
          .changes,
    )
    const changes = transaction.immediate()
    for (const invalidation of affected) this.onInvalidated?.(invalidation)
    return changes
  }

  private applyRedaction(
    filter: string,
    params: unknown[],
    reason: string,
    redactionState: "redacted" | "retained-redaction",
  ): number {
    const safeReason = reason.trim().slice(0, 512)
    const redactedPayload =
      redactionState === "redacted"
        ? '{"eventType":"redacted","metadata":null}'
        : '{"eventType":"retained-redaction","metadata":null}'
    const affected = this.affectedInvalidations(filter, params, "redaction")
    const transaction = this.sqlite.transaction(
      () =>
        this.sqlite
          .prepare(
            `UPDATE agent_activity_events SET
             kind = 'private-metadata', display_class = 'private', privacy_class = 'private',
             redaction_state = ?, redaction_reason = ?, payload_json = ?
           WHERE ${filter}`,
          )
          .run(redactionState, safeReason, redactedPayload, ...params).changes,
    )
    const changes = transaction.immediate()
    for (const invalidation of affected) this.onInvalidated?.(invalidation)
    return changes
  }

  private affectedInvalidations(
    filter: string,
    params: unknown[],
    reason: "redaction" | "retention",
  ): AgentActivityInvalidation[] {
    const rows = this.sqlite
      .prepare(
        `SELECT run_id, chat_id, MIN(sequence) first_sequence,
                MAX(sequence) last_sequence, MAX(storage_id) last_storage_id
         FROM agent_activity_events WHERE ${filter}
         GROUP BY run_id, chat_id`,
      )
      .all(...params) as Array<{
      run_id: string
      chat_id: string
      first_sequence: number
      last_sequence: number
      last_storage_id: number
    }>
    return rows.map((row) => ({
      reason,
      runId: row.run_id,
      chatId: row.chat_id,
      firstSequence: row.first_sequence,
      lastSequence: row.last_sequence,
      lastStorageId: row.last_storage_id,
      insertedCount: 0,
    }))
  }
}

export function createAgentActivityStore(
  database: DatabaseLike,
  options?: AgentActivityStoreOptions,
): AgentActivityStore {
  return new AgentActivityStore(database, options)
}

export function normalizeUnknownAgentActivity(input: UnknownAgentActivity): AgentActivityAppend {
  if (input.criticality !== "metadata") {
    throw new AgentActivityError(
      "activity-unknown-critical",
      `Unknown ${input.criticality}-critical provider event ${input.eventType}; adapter must fail closed.`,
    )
  }
  return {
    kind: "opaque-metadata",
    phase: "snapshot",
    displayClass: "metadata",
    privacyClass: "sensitive",
    provider: input.provider,
    providerTimestamp: input.providerTimestamp,
    ...input.providerIdentity,
    payload: {
      eventType: input.eventType,
      metadata: boundMetadata(input.metadata, false),
    },
  }
}

export function effectiveDedupKey(input: AgentActivityAppend): string | null {
  const explicit = input.dedupKey?.trim()
  if (explicit) return `${input.provider}:${explicit}`
  const providerEventId = input.providerEventId?.trim()
  return providerEventId ? `${input.provider}:${providerEventId}` : null
}

function sanitizeAppend(inputValue: AgentActivityAppend): AgentActivityAppend {
  let input: AgentActivityAppend
  try {
    input = parseAgentActivityAppend(inputValue)
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error))
  }
  const privatePayload = input.privacyClass === "private" || input.privacyClass === "encrypted"
  if (privatePayload) {
    if (input.displayClass !== "private" || input.kind !== "private-metadata") {
      throw new AgentActivityError(
        "activity-private-text",
        "Private or encrypted activity may persist only as private metadata without display text.",
      )
    }
  } else if (input.kind === "private-metadata") {
    throw new AgentActivityError(
      "activity-private-text",
      "Private metadata requires private or encrypted privacy classification.",
    )
  }
  if (input.kind === "provider-visible-reasoning" && input.displayClass !== "provider-visible") {
    throw invalid("Provider-visible reasoning requires provider-visible display class.")
  }
  const payload =
    input.kind === "opaque-metadata" || input.kind === "private-metadata"
      ? {
          ...input.payload,
          metadata: boundMetadata(input.payload.metadata, privatePayload),
        }
      : input.payload
  const payloadJson = JSON.stringify(payload)
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_AGENT_ACTIVITY_PAYLOAD_BYTES) {
    throw new AgentActivityError(
      "activity-too-large",
      `Activity payload exceeds ${MAX_AGENT_ACTIVITY_PAYLOAD_BYTES} bytes.`,
    )
  }
  return { ...input, payload } as AgentActivityAppend
}

function boundMetadata(value: unknown, redactStrings: boolean, depth = 0): BoundedActivityMetadata {
  if (depth > MAX_AGENT_ACTIVITY_METADATA_DEPTH) return "[truncated-depth]"
  if (value === null || value === undefined) return null
  if (typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string") {
    if (redactStrings) return "[redacted]"
    return redactSecretText(value).slice(0, MAX_AGENT_ACTIVITY_METADATA_STRING)
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_AGENT_ACTIVITY_METADATA_ENTRIES)
      .map((item) => boundMetadata(item, redactStrings, depth + 1))
  }
  if (typeof value === "object") {
    const output: Record<string, BoundedActivityMetadata> = {}
    for (const [key, field] of Object.entries(value).slice(
      0,
      MAX_AGENT_ACTIVITY_METADATA_ENTRIES,
    )) {
      const safeKey = key.slice(0, 256)
      output[safeKey] = isSecretKey(key)
        ? "[redacted]"
        : boundMetadata(field, redactStrings, depth + 1)
    }
    return output
  }
  return String(value).slice(0, MAX_AGENT_ACTIVITY_METADATA_STRING)
}

function decodeRow(
  row: SqlRow,
  corruptionMode: "fail" | "redacted-placeholder",
): AgentActivityEvent {
  try {
    const kind = String(row.kind) as AgentActivityKind
    if (!AGENT_ACTIVITY_KINDS.includes(kind)) throw new Error(`unknown kind ${kind}`)
    const privacyClass = String(row.privacy_class) as AgentActivityPrivacyClass
    if (!AGENT_ACTIVITY_PRIVACY_CLASSES.includes(privacyClass)) {
      throw new Error(`unknown privacy class ${privacyClass}`)
    }
    const payloadJson = String(row.payload_json)
    if (Buffer.byteLength(payloadJson, "utf8") > MAX_AGENT_ACTIVITY_PAYLOAD_BYTES) {
      throw new Error("oversized payload")
    }
    const runtime = requiredString(row.runtime) as ResolvedAgentRuntime
    if (!RESOLVED_AGENT_RUNTIMES.includes(runtime)) throw new Error(`unknown runtime ${runtime}`)
    const phase = requiredString(row.phase) as AgentActivityEvent["phase"]
    if (!AGENT_ACTIVITY_PHASES.includes(phase)) throw new Error(`unknown phase ${phase}`)
    const displayClass = requiredString(row.display_class) as AgentActivityEvent["displayClass"]
    if (!AGENT_ACTIVITY_DISPLAY_CLASSES.includes(displayClass)) {
      throw new Error(`unknown display class ${displayClass}`)
    }
    const redactionState = requiredString(
      row.redaction_state,
    ) as AgentActivityEvent["redactionState"]
    if (!AGENT_ACTIVITY_REDACTION_STATES.includes(redactionState)) {
      throw new Error(`unknown redaction state ${redactionState}`)
    }
    let payload = parseAgentActivityPayload(kind, JSON.parse(payloadJson) as unknown)
    if (privacyClass === "private" || privacyClass === "encrypted") {
      if (kind !== "private-metadata" || displayClass !== "private") {
        throw new Error("private activity contains a displayable payload")
      }
      const privatePayload = payload as AgentActivityPayloadByKind["private-metadata"]
      payload = {
        ...privatePayload,
        metadata: boundMetadata(privatePayload.metadata, true),
      }
    } else if (kind === "private-metadata") {
      throw new Error("private metadata has a displayable privacy class")
    }
    return {
      storageId: requiredNumber(row.storage_id),
      eventId: requiredString(row.event_id),
      runId: requiredString(row.run_id),
      chatId: requiredString(row.chat_id),
      subChatId: nullableString(row.sub_chat_id),
      orchestrationAgentId: nullableString(row.orchestration_agent_id),
      runtime,
      harness: requiredString(row.harness),
      provider: requiredString(row.provider),
      sequence: requiredNumber(row.sequence),
      kind,
      phase,
      displayClass,
      privacyClass,
      redactionState,
      redactionReason: nullableString(row.redaction_reason),
      providerTimestamp: nullableNumber(row.provider_timestamp),
      receivedAt: requiredNumber(row.received_at),
      providerEventId: nullableString(row.provider_event_id),
      providerSessionId: nullableString(row.provider_session_id),
      providerThreadId: nullableString(row.provider_thread_id),
      providerTurnId: nullableString(row.provider_turn_id),
      providerItemId: nullableString(row.provider_item_id),
      providerParentItemId: nullableString(row.provider_parent_item_id),
      providerMessageId: nullableString(row.provider_message_id),
      providerToolId: nullableString(row.provider_tool_id),
      summaryIndex: nullableNumber(row.summary_index),
      contentIndex: nullableNumber(row.content_index),
      partIndex: nullableNumber(row.part_index),
      sectionBoundary: nullableString(row.section_boundary),
      dedupKey: nullableString(row.dedup_key),
      payload,
      createdAt: requiredNumber(row.created_at) * 1_000,
    } as AgentActivityEvent
  } catch (error) {
    if (corruptionMode === "fail") {
      throw new AgentActivityError(
        "activity-corrupt",
        `Corrupt activity row ${String(row.storage_id)}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return corruptPlaceholder(row)
  }
}

function corruptPlaceholder(row: SqlRow): AgentActivityEvent {
  return {
    storageId: requiredNumber(row.storage_id),
    eventId: requiredString(row.event_id),
    runId: requiredString(row.run_id),
    chatId: requiredString(row.chat_id),
    subChatId: nullableString(row.sub_chat_id),
    orchestrationAgentId: null,
    runtime: requiredString(row.runtime) as ResolvedAgentRuntime,
    harness: requiredString(row.harness),
    provider: requiredString(row.provider),
    sequence: requiredNumber(row.sequence),
    kind: "private-metadata",
    phase: "snapshot",
    displayClass: "private",
    privacyClass: "private",
    redactionState: "corrupt",
    redactionReason: "Corrupt row omitted from replay.",
    providerTimestamp: null,
    receivedAt: requiredNumber(row.received_at),
    dedupKey: null,
    payload: { eventType: "corrupt-row", metadata: null },
    createdAt: requiredNumber(row.created_at) * 1_000,
  }
}

function redactEventForExport(event: AgentActivityEvent): AgentActivityEvent {
  return {
    ...event,
    payload: redactExportValue(event.payload) as AgentActivityEvent["payload"],
  } as AgentActivityEvent
}

function redactExportValue(value: unknown): unknown {
  if (typeof value === "string") return redactSecretText(value)
  if (Array.isArray(value)) return value.map(redactExportValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [
        key,
        isSecretKey(key) ? "[redacted]" : redactExportValue(field),
      ]),
    )
  }
  return value
}

function redactSecretText(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi,
      "[redacted-private-key]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|ghp|gho|github_pat|xox[baprs])-[-A-Za-z0-9_]{8,}\b/g, "[redacted-credential]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
}

function isSecretKey(key: string): boolean {
  return /(?:secret|token|password|credential|api[_-]?key|private[_-]?key|authorization)/i.test(key)
}

function addInFilter(
  filters: string[],
  params: unknown[],
  column: string,
  values: readonly string[],
) {
  filters.push(`${column} IN (${values.map(() => "?").join(",")})`)
  params.push(...values)
}

function rawClient(database: DatabaseLike): Sqlite {
  if ("prepare" in database && typeof database.prepare === "function") return database as Sqlite
  return (database as { $client: Sqlite }).$client
}

function invalid(message: string): AgentActivityError {
  return new AgentActivityError("activity-invalid", message)
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("missing required string")
  return value
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function requiredNumber(value: unknown): number {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error("missing required number")
  return number
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : requiredNumber(value)
}
