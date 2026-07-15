import Database from "better-sqlite3"
import { createHash } from "node:crypto"

type Row = Record<string, unknown>
export type OrchestrationActivityKind =
  | "workflow-phase"
  | "checkpoint"
  | "dependency"
  | "spawn"
  | "replacement"
  | "mailbox"
  | "coordination"
  | "warning"
  | "usage"
  | "aggregate-status"

export type OrchestrationActivityFilters = {
  agentId?: string
  runId?: string
  runtime?: "codex" | "claude-code" | "flapstack-native"
  kind?: OrchestrationActivityKind
  phase?: string
  limit?: number
}

export type OrchestrationActivityRow = {
  id: string
  taskId: string
  agentId: string | null
  runId: string | null
  runtime: string | null
  sourceActivityEventId: string | null
  kind: OrchestrationActivityKind
  phase: string
  summary: string | null
  createdAt: number
}

export type OrchestrationTransition = {
  dedupKey: string
  taskId: string
  entityType: "workflow" | "checkpoint" | "agent" | "coordination" | "control" | "summary"
  entityId: string
  agentId?: string | null
  runId?: string | null
  kind: OrchestrationActivityKind
  phase: string
  summary?: string | null
  createdAt?: number
}

/** Durable source event plus its immediately queryable projection, in the caller transaction. */
export function recordOrchestrationTransition(
  db: Database.Database,
  event: OrchestrationTransition,
): boolean {
  const summary = event.summary ? redactActivitySummary(event.summary) : null
  const id = digest(`transition:${event.dedupKey}`)
  const createdAt = event.createdAt ?? epoch()
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO orchestration_transition_events
       (id, dedup_key, task_id, entity_type, entity_id, agent_id, run_id, kind, phase, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      event.dedupKey,
      event.taskId,
      event.entityType,
      event.entityId,
      event.agentId ?? null,
      event.runId ?? null,
      event.kind,
      boundedLabel(event.phase),
      summary,
      createdAt,
    )
  if (inserted.changes !== 1) return false
  projectTransition(db, {
    id,
    taskId: event.taskId,
    agentId: event.agentId ?? null,
    runId: event.runId ?? null,
    kind: event.kind,
    phase: boundedLabel(event.phase),
    summary,
    createdAt,
  })
  return true
}

export class OrchestrationActivityProjectionService {
  constructor(private readonly databasePath: string) {}

  /** Rebuild only from durable transition sources and F11 Runtime event references. */
  rebuild(taskId: string): number {
    const db = new Database(this.databasePath)
    try {
      const tx = db.transaction(() => {
        db.prepare("DELETE FROM orchestration_activity_events WHERE task_id = ?").run(taskId)
        let count = 0
        const transitions = db
          .prepare(
            `SELECT id, task_id, agent_id, run_id, kind, phase, summary, created_at
             FROM orchestration_transition_events WHERE task_id = ? ORDER BY created_at, id`,
          )
          .all(taskId) as Row[]
        for (const row of transitions) {
          projectTransition(db, {
            id: String(row.id),
            taskId,
            agentId: nullable(row.agent_id),
            runId: nullable(row.run_id),
            kind: String(row.kind) as OrchestrationActivityKind,
            phase: String(row.phase),
            summary: nullable(row.summary),
            createdAt: Number(row.created_at),
          })
          count += 1
        }
        const runtimeEvents = db
          .prepare(
            `SELECT event_id, orchestration_agent_id, run_id, kind, phase, received_at
             FROM agent_activity_events
             WHERE orchestration_agent_id IN
               (SELECT id FROM orchestration_agents WHERE task_id = ?)
             ORDER BY received_at, storage_id`,
          )
          .all(taskId) as Row[]
        const insertRuntime = db.prepare(
          `INSERT OR IGNORE INTO orchestration_activity_events
           (id, dedup_key, task_id, agent_id, run_id, source_activity_event_id, kind, phase, summary, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        )
        for (const row of runtimeEvents) {
          const sourceId = String(row.event_id)
          const key = `runtime:${sourceId}`
          count += insertRuntime.run(
            digest(key),
            key,
            taskId,
            nullable(row.orchestration_agent_id),
            String(row.run_id),
            sourceId,
            row.kind === "usage"
              ? "usage"
              : row.kind === "warning"
                ? "warning"
                : "aggregate-status",
            boundedLabel(String(row.phase)),
            Number(row.received_at),
          ).changes
        }
        return count
      })
      return Number(tx.immediate())
    } finally {
      db.close()
    }
  }

  list(taskId: string, filters: OrchestrationActivityFilters = {}): OrchestrationActivityRow[] {
    const db = new Database(this.databasePath, { readonly: true })
    try {
      const clauses = ["e.task_id = ?"]
      const values: unknown[] = [taskId]
      if (filters.agentId) {
        clauses.push("e.agent_id = ?")
        values.push(filters.agentId)
      }
      if (filters.runId) {
        clauses.push("e.run_id = ?")
        values.push(filters.runId)
      }
      if (filters.kind) {
        clauses.push("e.kind = ?")
        values.push(filters.kind)
      }
      if (filters.phase) {
        clauses.push("e.phase = ?")
        values.push(filters.phase)
      }
      if (filters.runtime) {
        clauses.push("r.resolved_runtime = ?")
        values.push(filters.runtime)
      }
      const limit = Math.min(Math.max(filters.limit ?? 250, 1), 1_000)
      values.push(limit)
      const rows = db
        .prepare(
          `SELECT e.*, r.resolved_runtime
           FROM orchestration_activity_events e
           LEFT JOIN agent_runs r ON r.id = e.run_id
           WHERE ${clauses.join(" AND ")}
           ORDER BY e.created_at, e.id LIMIT ?`,
        )
        .all(...values) as Row[]
      return rows.map((row) => ({
        id: String(row.id),
        taskId: String(row.task_id),
        agentId: nullable(row.agent_id),
        runId: nullable(row.run_id),
        runtime: nullable(row.resolved_runtime),
        sourceActivityEventId: nullable(row.source_activity_event_id),
        kind: String(row.kind) as OrchestrationActivityKind,
        phase: String(row.phase),
        summary: nullable(row.summary),
        createdAt: Number(row.created_at),
      }))
    } finally {
      db.close()
    }
  }

  recordActivitySummary(taskId: string, summary: string) {
    const db = new Database(this.databasePath)
    try {
      const sanitized = redactActivitySummary(summary)
      const key = `summary:${taskId}:${digest(sanitized)}`
      recordOrchestrationTransition(db, {
        dedupKey: key,
        taskId,
        entityType: "summary",
        entityId: digest(key),
        kind: "aggregate-status",
        phase: "summary",
        summary: sanitized,
      })
      const sourceId = digest(`transition:${key}`)
      return digest(`transition:${sourceId}`)
    } finally {
      db.close()
    }
  }
}

export function redactActivitySummary(value: string): string {
  let text = value.replace(/[\r\n\t]+/g, " ").trim()
  if (!text) throw new Error("Activity summary is empty.")
  const secrets = [
    /\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
    /\bAKIA[A-Z0-9]{16}\b/g,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}=*/gi,
    /(?:api[-_ ]?key|token|secret|password|authorization)\s*[:=]\s*[^\s,;]{4,}/gi,
    /https?:\/\/[^\s/:]+:[^\s/@]+@/gi,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  ]
  for (const pattern of secrets) text = text.replace(pattern, "[REDACTED]")
  text = truncateUtf8(text, 1_000)
  return text.startsWith("Activity summary:") ? text : `Activity summary: ${text}`
}

function projectTransition(
  db: Database.Database,
  event: {
    id: string
    taskId: string
    agentId: string | null
    runId: string | null
    kind: OrchestrationActivityKind
    phase: string
    summary: string | null
    createdAt: number
  },
) {
  const key = `transition:${event.id}`
  const projectedRunId =
    event.runId && db.prepare("SELECT 1 present FROM agent_runs WHERE id = ?").get(event.runId)
      ? event.runId
      : null
  db.prepare(
    `INSERT OR IGNORE INTO orchestration_activity_events
     (id, dedup_key, task_id, agent_id, run_id, source_activity_event_id, kind, phase, summary, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  ).run(
    digest(key),
    key,
    event.taskId,
    event.agentId,
    projectedRunId,
    event.kind,
    event.phase,
    event.summary,
    event.createdAt,
  )
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value) <= maxBytes) return value
  let end = value.length
  while (end > 0 && Buffer.byteLength(`${value.slice(0, end)}…`) > maxBytes) end -= 1
  return `${value.slice(0, end)}…`
}
function boundedLabel(value: string) {
  return (
    value
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      .slice(0, 200) || "unknown"
  )
}
function digest(value: string) {
  return createHash("sha256").update(value).digest("hex")
}
function nullable(value: unknown) {
  return value === null || value === undefined ? null : String(value)
}
function epoch() {
  return Math.floor(Date.now() / 1000)
}
