import type Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { nowEpochSeconds } from "./db/timestamps"
import { queueChatRun } from "./run-launch-service"

const ACTIVE_RUN_STATUSES = ["pending", "running"] as const
const DEFAULT_QUIET_PERIOD_SECONDS = 2
/** Failed waits stay visible until dismissed, so the surfaced list must stay bounded. */
const MAX_SURFACED_FAILED_WAITS = 20
const MAX_SURFACED_WAIT_ERROR_LENGTH = 200

type WaitRow = {
  id: string
  waiter_chat_id: string
  waiter_run_id: string
  target_chat_ids: string
  idempotency_key: string
  status: string
  settled_at: number | null
}

/** Durable lifecycle of one wait row. Only the first two can still resume a chat. */
export type ChatWaitState = "waiting" | "resuming" | "completed" | "cancelled" | "failed"

const CHAT_WAIT_STATES: readonly ChatWaitState[] = [
  "waiting",
  "resuming",
  "completed",
  "cancelled",
  "failed",
]

/** States surfaced to the renderer: still pending, or failed and not yet dismissed. */
export type SurfacedChatWaitStatus = "waiting" | "resuming" | "failed"

export type AgentChatWait = {
  id: string
  chatId: string
  targetChatIds: string[]
  targetNames: string[]
  status: SurfacedChatWaitStatus
  error: string | null
  createdAt: number
}

export type RegisterChatWaitResult =
  | {
      ok: true
      id: string
      created: boolean
      /** Truthful durable state. Replay of a settled wait never reports `waiting`. */
      state: ChatWaitState
      /** True only while this wait can still resume the caller chat. */
      active: boolean
      targetChatIds: string[]
    }
  | {
      ok: false
      code: "invalid-input" | "stale-caller" | "conflict"
      message: string
    }

export function registerChatWait(
  database: Database.Database,
  input: {
    waiterChatId: string
    waiterRunId: string | null | undefined
    targetChatIds: string[]
    idempotencyKey: string
  },
): RegisterChatWaitResult {
  const targetChatIds = [...new Set(input.targetChatIds)]
  if (!input.waiterRunId) {
    return { ok: false, code: "stale-caller", message: "An active caller run is required." }
  }
  if (targetChatIds.length === 0 || targetChatIds.length > 8) {
    return { ok: false, code: "invalid-input", message: "Choose between one and eight chats." }
  }
  if (targetChatIds.includes(input.waiterChatId)) {
    return { ok: false, code: "invalid-input", message: "A chat cannot wait for itself." }
  }
  const caller = database
    .prepare(
      `SELECT id FROM agent_runs
       WHERE id = ? AND chat_id = ? AND status = 'running' AND completed_at IS NULL`,
    )
    .get(input.waiterRunId, input.waiterChatId)
  if (!caller) {
    return { ok: false, code: "stale-caller", message: "The caller run is no longer active." }
  }

  const existing = database
    .prepare(
      `SELECT id, target_chat_ids, status FROM chat_waits
       WHERE waiter_chat_id = ? AND idempotency_key = ? LIMIT 1`,
    )
    .get(input.waiterChatId, input.idempotencyKey) as
    { id: string; target_chat_ids: string; status: string } | undefined
  if (existing) {
    const state = toChatWaitState(existing.status)
    return {
      ok: true,
      id: existing.id,
      created: false,
      state,
      active: state === "waiting" || state === "resuming",
      targetChatIds: parseTargetIds(existing.target_chat_ids),
    }
  }

  const active = database
    .prepare(
      `SELECT id FROM chat_waits
       WHERE waiter_chat_id = ? AND status IN ('waiting','resuming') LIMIT 1`,
    )
    .get(input.waiterChatId)
  if (active) {
    return {
      ok: false,
      code: "conflict",
      message: "This chat already has an active wait condition.",
    }
  }
  if (wouldCreateWaitCycle(database, input.waiterChatId, targetChatIds)) {
    return {
      ok: false,
      code: "conflict",
      message: "This wait would create a cycle between chats.",
    }
  }

  const id = randomUUID()
  const now = nowEpochSeconds()
  database
    .prepare(
      `INSERT INTO chat_waits
        (id, waiter_chat_id, waiter_run_id, target_chat_ids, idempotency_key,
         status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?)`,
    )
    .run(
      id,
      input.waiterChatId,
      input.waiterRunId,
      JSON.stringify(targetChatIds),
      input.idempotencyKey,
      now,
      now,
    )
  return { ok: true, id, created: true, state: "waiting", active: true, targetChatIds }
}

function toChatWaitState(status: string): ChatWaitState {
  // An unrecognized durable status must never be reported as a resumable wait.
  return CHAT_WAIT_STATES.includes(status as ChatWaitState) ? (status as ChatWaitState) : "failed"
}

/**
 * Reconcile durable waits and queue a new run in the waiting chat once every
 * target has stayed free of pending/running work for a short quiet period.
 */
export function advanceChatWaits(
  database: Database.Database,
  quietPeriodSeconds = DEFAULT_QUIET_PERIOD_SECONDS,
): number {
  const waits = database
    .prepare(
      `SELECT id, waiter_chat_id, waiter_run_id, target_chat_ids, idempotency_key,
                status, settled_at
         FROM chat_waits WHERE status IN ('waiting','resuming') ORDER BY created_at, id`,
    )
    .all() as WaitRow[]
  let resumed = 0
  for (const wait of waits) {
    const now = nowEpochSeconds()
    const targetChatIds = parseTargetIds(wait.target_chat_ids)
    if (targetChatIds.length === 0) {
      failWait(database, wait.id, "Wait targets are invalid.", now)
      continue
    }
    if (!allChatsActive(database, [wait.waiter_chat_id, ...targetChatIds])) {
      failWait(database, wait.id, "A waiting chat or target was archived or removed.", now)
      continue
    }
    if (hasActiveRun(database, targetChatIds)) {
      if (wait.settled_at !== null) {
        database
          .prepare("UPDATE chat_waits SET settled_at = NULL, updated_at = ? WHERE id = ?")
          .run(now, wait.id)
      }
      continue
    }
    if (wait.status === "waiting" && wait.settled_at === null) {
      database
        .prepare("UPDATE chat_waits SET settled_at = ?, updated_at = ? WHERE id = ?")
        .run(now, now, wait.id)
      continue
    }
    if (
      wait.status === "waiting" &&
      now - Number(wait.settled_at) < Math.max(0, quietPeriodSeconds)
    ) {
      continue
    }
    if (hasActiveRun(database, [wait.waiter_chat_id])) continue

    if (wait.status === "waiting") {
      const claimed = database
        .prepare(
          "UPDATE chat_waits SET status = 'resuming', updated_at = ? WHERE id = ? AND status = 'waiting'",
        )
        .run(now, wait.id)
      if (claimed.changes === 0) continue
    }

    const targetNames = chatNames(database, targetChatIds)
    const queued = queueChatRun(database, {
      chatId: wait.waiter_chat_id,
      idempotencyKey: `wait-resume-${wait.id}`,
      initialPrompt: buildWaitResumePrompt(targetNames),
    })
    if (!queued.ok) {
      failWait(database, wait.id, queued.message, now)
      continue
    }
    database
      .prepare(
        `UPDATE chat_waits
           SET status = 'completed', resumed_run_id = ?, completed_at = ?, updated_at = ?, error = NULL
           WHERE id = ?`,
      )
      .run(queued.runId, now, now, wait.id)
    resumed += queued.created ? 1 : 0
  }
  return resumed
}

/**
 * Waits the renderer may show: still pending, plus failed waits the user has not
 * dismissed yet. A failed wait never resumes its chat, so hiding it would leave
 * the chat silently stalled.
 */
export function listAgentChatWaits(database: Database.Database): AgentChatWait[] {
  type SurfacedRow = {
    id: string
    waiter_chat_id: string
    target_chat_ids: string
    status: SurfacedChatWaitStatus
    error: string | null
    created_at: number
  }
  const rows = [
    ...(database
      .prepare(
        `SELECT w.id, w.waiter_chat_id, w.target_chat_ids, w.status, w.error, w.created_at
         FROM chat_waits w
         INNER JOIN chats c ON c.id = w.waiter_chat_id AND c.archived_at IS NULL
         WHERE w.status IN ('waiting','resuming') ORDER BY w.created_at, w.id`,
      )
      .all() as SurfacedRow[]),
    ...(database
      .prepare(
        `SELECT w.id, w.waiter_chat_id, w.target_chat_ids, w.status, w.error, w.created_at
         FROM chat_waits w
         INNER JOIN chats c ON c.id = w.waiter_chat_id AND c.archived_at IS NULL
         WHERE w.status = 'failed' ORDER BY w.updated_at DESC, w.id LIMIT ?`,
      )
      .all(MAX_SURFACED_FAILED_WAITS) as SurfacedRow[]),
  ]
  return rows.flatMap((row) => {
    const targetChatIds = parseTargetIds(row.target_chat_ids)
    if (targetChatIds.length === 0) return []
    return [
      {
        id: row.id,
        chatId: row.waiter_chat_id,
        targetChatIds,
        targetNames: chatNames(database, targetChatIds),
        status: row.status,
        // Wait errors are generated by Flapstack, never copied from prompts.
        error: row.error ? row.error.slice(0, MAX_SURFACED_WAIT_ERROR_LENGTH) : null,
        createdAt: row.created_at,
      },
    ]
  })
}

/**
 * User acknowledgement of a failed wait. The row stays durable for audit, but
 * stops being surfaced so the badge cannot become permanently sticky.
 */
export function dismissFailedChatWait(database: Database.Database, waitId: string): boolean {
  const now = nowEpochSeconds()
  return (
    database
      .prepare(
        `UPDATE chat_waits SET status = 'cancelled', updated_at = ?
         WHERE id = ? AND status = 'failed'`,
      )
      .run(now, waitId).changes > 0
  )
}

function hasActiveRun(database: Database.Database, chatIds: string[]): boolean {
  const placeholders = chatIds.map(() => "?").join(",")
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM agent_runs
         WHERE chat_id IN (${placeholders}) AND status IN (?, ?) LIMIT 1`,
      )
      .get(...chatIds, ...ACTIVE_RUN_STATUSES),
  )
}

function allChatsActive(database: Database.Database, chatIds: string[]): boolean {
  const unique = [...new Set(chatIds)]
  const placeholders = unique.map(() => "?").join(",")
  const row = database
    .prepare(
      `SELECT COUNT(*) count FROM chats
       WHERE id IN (${placeholders}) AND archived_at IS NULL`,
    )
    .get(...unique) as { count: number }
  return Number(row.count) === unique.length
}

function chatNames(database: Database.Database, chatIds: string[]): string[] {
  const placeholders = chatIds.map(() => "?").join(",")
  const rows = database
    .prepare(`SELECT id, name FROM chats WHERE id IN (${placeholders})`)
    .all(...chatIds) as Array<{ id: string; name: string | null }>
  const byId = new Map(rows.map((row) => [row.id, row.name?.trim() || "Untitled chat"]))
  return chatIds.map((id) => byId.get(id) ?? "Unavailable chat")
}

function wouldCreateWaitCycle(
  database: Database.Database,
  waiterChatId: string,
  targetChatIds: string[],
): boolean {
  const rows = database
    .prepare(
      `SELECT waiter_chat_id, target_chat_ids FROM chat_waits
       WHERE status IN ('waiting','resuming')`,
    )
    .all() as Array<{ waiter_chat_id: string; target_chat_ids: string }>
  const edges = new Map<string, string[]>()
  for (const row of rows) edges.set(row.waiter_chat_id, parseTargetIds(row.target_chat_ids))
  edges.set(waiterChatId, targetChatIds)
  const pending = [...targetChatIds]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current === waiterChatId) return true
    if (visited.has(current)) continue
    visited.add(current)
    pending.push(...(edges.get(current) ?? []))
  }
  return false
}

function buildWaitResumePrompt(targetNames: string[]): string {
  return [
    "[FLAPSTACK WAIT COMPLETED]",
    `The ${targetNames.length === 1 ? "chat" : "chats"} you explicitly waited for now ${targetNames.length === 1 ? "has" : "have"} no pending or running work after a quiet period: ${targetNames.join(", ")}.`,
    "Continue the work you paused using this chat's existing context. Do not ask another chat to send a completion message.",
  ].join("\n")
}

function failWait(database: Database.Database, waitId: string, error: string, now: number): void {
  database
    .prepare(
      `UPDATE chat_waits SET status = 'failed', error = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(error.slice(0, 1_000), now, now, waitId)
}

function parseTargetIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter(
          (id, index, all): id is string =>
            typeof id === "string" && id.length > 0 && all.indexOf(id) === index,
        )
      : []
  } catch {
    return []
  }
}
