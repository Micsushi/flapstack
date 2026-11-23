import { sql } from "drizzle-orm"
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import type Database from "better-sqlite3"
import type * as schema from "./db/schema"

type AppDatabase = BetterSQLite3Database<typeof schema>

export function recordSubmittedAt(db: Database.Database, runId: string, submittedAtMs?: number) {
  if (submittedAtMs === undefined || submittedAtMs > Date.now()) return
  db.prepare(
    "INSERT OR IGNORE INTO agent_run_timing_marks (run_id,phase,at_ms) VALUES (?, 'submitted', ?)",
  ).run(runId, submittedAtMs)
}

function mark(db: AppDatabase, runId: string, phase: string, at: number, itemId = "") {
  db.run(sql`INSERT OR IGNORE INTO agent_run_timing_marks (run_id, phase, item_id, at_ms)
    SELECT id, ${phase}, ${itemId}, ${at} FROM agent_runs WHERE id = ${runId}`)
}

export function recordCheckpointTiming(
  db: AppDatabase,
  runId: string,
  kind: "before" | "after",
  start: number,
  end: number,
) {
  db.transaction((tx) => {
    mark(tx, runId, `${kind}-start`, start)
    mark(tx, runId, `${kind}-end`, end)
  })
}

export function legacyRunTimer(database: () => AppDatabase, currentRunId: () => string | null) {
  const seen = new Set<string>()
  let disabled = false
  const once = (phase: string, itemId = "") => {
    const runId = currentRunId()
    const key = phase + "/" + itemId
    if (!runId || disabled || seen.has(key)) return
    try {
      mark(database(), runId, phase, Date.now(), itemId)
      seen.add(key)
    } catch (error) {
      disabled = true
      console.warn("[run-timing] Could not record provider timing", error)
    }
  }
  return {
    once,
    chunk(chunk: { type: string; delta?: unknown; toolCallId?: string }) {
      if (chunk.type === "reasoning-delta" && chunk.delta) once("first-progress")
      if (chunk.type === "text-delta" && chunk.delta) once("first-answer")
      if (!chunk.toolCallId) return
      if (chunk.type === "tool-input-start" || chunk.type === "tool-input-available")
        once("tool-start", chunk.toolCallId)
      if (
        chunk.type === "tool-output-available" ||
        chunk.type === "tool-output-error" ||
        chunk.type === "tool-output-denied"
      )
        once("tool-end", chunk.toolCallId)
    },
  }
}

export function readRunTimings(db: Database.Database, runId: string) {
  const marks = new Map<string, number>()
  const tools = new Map<string, { startedAt: number | null; endedAt: number | null }>()
  const observeTool = (id: string, start: boolean, at: number) => {
    const item = tools.get(id) ?? { startedAt: null, endedAt: null }
    if (start) item.startedAt ??= at
    else item.endedAt = at
    tools.set(id, item)
  }
  for (const row of db
    .prepare("SELECT phase,item_id,at_ms FROM agent_run_timing_marks WHERE run_id=? ORDER BY at_ms")
    .iterate(runId) as Iterable<{ phase: string; item_id: string; at_ms: number }>) {
    if (row.phase === "tool-start" || row.phase === "tool-end")
      observeTool(row.item_id, row.phase === "tool-start", row.at_ms)
    else marks.set(row.phase, row.at_ms)
  }
  const submitted = marks.get("submitted")
  if (submitted !== undefined) marks.set("start", submitted)
  const first = (phase: string, at: number) => {
    marks.set(phase, Math.min(marks.get(phase) ?? at, at))
  }
  const events =
    db.prepare(`SELECT kind, phase, provider, provider_item_id, provider_message_id, provider_tool_id, received_at,
    section_boundary, json_extract(payload_json,'$.state') AS state,
    length(json_extract(payload_json,'$.text')) > 0 AS has_text
    FROM agent_activity_events WHERE run_id=? AND kind IN ('lifecycle','agent-text','tool','command','reasoning-summary','provider-visible-reasoning')
    ORDER BY sequence`)
  // The provider can label an item as commentary on completion, after its first delta.
  const text = new Map<string, { phase: string | null; first: number | null }>()
  for (const e of events.iterate(runId) as Iterable<{
    kind: string
    phase: string
    provider: string
    provider_item_id: string | null
    provider_message_id: string | null
    provider_tool_id: string | null
    received_at: number
    section_boundary: string | null
    state: string | null
    has_text: number
  }>) {
    if (e.kind === "lifecycle") {
      if (e.state === "intent-persisted") first("spawn-start", e.received_at)
      if (
        (e.provider !== "runtime" && e.state === "session-initialized") ||
        e.state === "thread-started"
      )
        first("provider-ready", e.received_at)
      if (e.state === "session-started") first("spawn-end", e.received_at)
    } else if (e.kind === "agent-text") {
      const key = e.provider_item_id ?? e.provider_message_id ?? e.provider
      const item = text.get(key) ?? { phase: null, first: null }
      if (e.section_boundary) item.phase = e.section_boundary
      if (e.has_text) item.first ??= e.received_at
      text.set(key, item)
    } else if (e.kind === "tool" || e.kind === "command") {
      const id = e.provider_tool_id ?? e.provider_item_id
      if (id && (e.phase === "started" || ["completed", "failed", "cancelled"].includes(e.phase)))
        observeTool(id, e.phase === "started", e.received_at)
    } else if (e.has_text) first("first-progress", e.received_at)
  }
  for (const item of text.values()) {
    if (item.first != null)
      first(item.phase === "commentary" ? "first-progress" : "first-answer", item.first)
  }
  const elapsed = (end: string, start = "start") => {
    const later = marks.get(end),
      earlier = marks.get(start)
    return later == null || earlier == null ? null : Math.max(0, later - earlier)
  }
  return {
    preLaunchMs: elapsed("spawn-start") ?? elapsed("end"),
    beforeCheckpointMs: elapsed("before-end", "before-start"),
    spawnContextMs: elapsed("provider-ready", "spawn-start") ?? elapsed("spawn-end", "spawn-start"),
    firstProgressMs: elapsed("first-progress"),
    firstAnswerMs: elapsed("first-answer"),
    afterCheckpointMs: elapsed("after-end", "after-start"),
    postRunMs: elapsed("end", "after-start"),
    totalMs: elapsed("end"),
    tools: [...tools].map(([id, t]) => ({
      id,
      ...t,
      durationMs: t.startedAt == null || t.endedAt == null ? null : t.endedAt - t.startedAt,
    })),
  }
}
