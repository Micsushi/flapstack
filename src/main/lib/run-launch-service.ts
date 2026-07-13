import Database from "better-sqlite3"
import { createHash } from "node:crypto"
import { randomUUID } from "node:crypto"
import { redactMcpAuditSummary } from "./mcp-control/audit-storage"

export type QueuedAgentRun = {
  runId: string
  chatId: string
  subChatId: string
  harness: "codex" | "claude-code"
  prompt: string
  model: string | null
  permissionMode: string
  customPermissions: string | null
  worktreePath: string | null
  projectPath: string | null
}

export type AgentRunLauncher = (run: QueuedAgentRun) => Promise<void>

type Row = Record<string, unknown>

/** App restart ends provider streams; requeue MCP work and cancel everything else. */
export function recoverInterruptedMcpRuns(databasePath: string): number {
  const db = new Database(databasePath)
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  try {
    const runs = db
      .prepare(
        `SELECT id, sub_chat_id, prompt_message_id FROM agent_runs
         WHERE status = 'running' AND completed_at IS NULL`,
      )
      .all() as Row[]
    let recovered = 0
    const recover = db.transaction(() => {
      const now = Date.now()
      for (const run of runs) {
        const isMcp =
          typeof run.prompt_message_id === "string" && run.prompt_message_id.startsWith("mcp-")
        if (isMcp) {
          db.prepare("UPDATE agent_runs SET status = 'pending' WHERE id = ?").run(run.id)
          db.prepare("UPDATE sub_chats SET run_status = 'pending' WHERE id = ?").run(
            run.sub_chat_id,
          )
          recovered += 1
        } else {
          db.prepare(
            "UPDATE agent_runs SET status = 'cancelled', completed_at = ? WHERE id = ?",
          ).run(now, run.id)
          db.prepare("UPDATE sub_chats SET run_status = 'cancelled' WHERE id = ?").run(
            run.sub_chat_id,
          )
        }
      }
    })
    recover()
    return recovered
  } finally {
    db.close()
  }
}

/**
 * Claims and starts durable pending runs through the app's existing harness
 * launch path. Claiming is atomic, so repeated polls and app restarts cannot
 * start the same run twice.
 */
export async function drainPendingMcpRuns(
  databasePath: string,
  launch: AgentRunLauncher,
  options: { waitForCompletion?: boolean } = {},
): Promise<number> {
  const db = new Database(databasePath)
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  let started = 0
  const launches: Promise<void>[] = []
  try {
    const pending = db
      .prepare(
        `SELECT r.id, r.chat_id, r.sub_chat_id, r.harness, r.model, r.permission_mode,
          r.custom_permissions,
          r.worktree_path, r.prompt_message_id, r.initial_prompt, s.messages,
          c.project_id, p.path project_path
         FROM agent_runs r
         JOIN chats c ON c.id = r.chat_id
         JOIN sub_chats s ON s.id = r.sub_chat_id
         LEFT JOIN projects p ON p.id = c.project_id
         WHERE r.status = 'pending' AND r.prompt_message_id LIKE 'mcp-%'
           AND NOT EXISTS (
             SELECT 1 FROM agent_runs active
             WHERE active.sub_chat_id = r.sub_chat_id
               AND active.status = 'running'
           )
           AND NOT EXISTS (
             SELECT 1 FROM agent_runs earlier
             WHERE earlier.sub_chat_id = r.sub_chat_id
               AND earlier.status = 'pending'
               AND earlier.prompt_message_id LIKE 'mcp-%'
               AND (earlier.started_at < r.started_at OR
                    (earlier.started_at = r.started_at AND earlier.id < r.id))
           )
         ORDER BY r.started_at, r.id`,
      )
      .all() as Row[]

    for (const row of pending) {
      const claimed = db
        .prepare(
          `UPDATE agent_runs SET status = 'running'
           WHERE id = ? AND status = 'pending'
             AND NOT EXISTS (
               SELECT 1 FROM agent_runs active
               WHERE active.sub_chat_id = agent_runs.sub_chat_id
                 AND active.status = 'running'
                 AND active.id <> agent_runs.id
             )`,
        )
        .run(row.id)
      if (claimed.changes !== 1) continue
      db.prepare("UPDATE sub_chats SET run_status = 'running' WHERE id = ?").run(row.sub_chat_id)
      const run = queuedRun(row)
      if (!run) {
        markFailed(db, String(row.id), String(row.sub_chat_id))
        continue
      }
      started += 1
      const launched = launch(run)
        .then(() => recordLaunchOutcome(databasePath, run, "completed"))
        .catch((error: unknown) =>
          recordLaunchOutcome(
            databasePath,
            run,
            "failed",
            error instanceof Error ? error.message : "Harness launch failed.",
          ),
        )
      if (options.waitForCompletion) launches.push(launched)
    }
    if (options.waitForCompletion) await Promise.all(launches)
    return started
  } finally {
    db.close()
  }
}

/** @deprecated Use the MCP-specific name; retained for existing callers. */
export const drainPendingAgentRuns = drainPendingMcpRuns

function recordLaunchOutcome(
  databasePath: string,
  run: QueuedAgentRun,
  status: "completed" | "failed",
  error?: string,
): void {
  const db = new Database(databasePath)
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  try {
    if (status === "failed") markFailed(db, run.runId, run.subChatId)
    appendLaunchAudit(db, run.runId, status, error)
  } finally {
    db.close()
  }
}

function appendLaunchAudit(
  db: Database.Database,
  runId: string,
  status: "completed" | "failed",
  error?: string,
): void {
  const source = db
    .prepare(
      `SELECT invocation_id, caller_chat_id, caller_run_id, tool_name, tier,
        caller_snapshot, chat_snapshot, input_summary
       FROM mcp_audit_records
       WHERE status = 'completed'
         AND tool_name IN ('launch_run', 'spawn_thread')
         AND result_summary LIKE ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(`%${runId}%`) as Row | undefined
  if (!source) return
  db.prepare(
    `INSERT INTO mcp_audit_records (
      id, invocation_id, status, caller_chat_id, caller_run_id, tool_name, tier,
      caller_snapshot, chat_snapshot, run_snapshot, input_summary, result_summary, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    randomUUID(),
    source.invocation_id,
    status,
    source.caller_chat_id,
    source.caller_run_id,
    source.tool_name,
    source.tier,
    source.caller_snapshot,
    source.chat_snapshot,
    redactMcpAuditSummary({ runId }),
    source.input_summary,
    redactMcpAuditSummary({
      runId,
      outcome: status,
      ...(error
        ? {
            error: {
              byteLength: Buffer.byteLength(error),
              sha256: createHash("sha256").update(error).digest("hex"),
            },
          }
        : {}),
    }),
  )
}

function queuedRun(row: Row): QueuedAgentRun | null {
  if (row.harness !== "codex" && row.harness !== "claude-code") return null
  const prompt =
    (typeof row.initial_prompt === "string" ? row.initial_prompt.trim() : "") ||
    findPrompt(row.messages, row.prompt_message_id)
  if (!prompt) return null
  return {
    runId: String(row.id),
    chatId: String(row.chat_id),
    subChatId: String(row.sub_chat_id),
    harness: row.harness,
    prompt,
    model: typeof row.model === "string" ? row.model : null,
    permissionMode: String(row.permission_mode),
    customPermissions: typeof row.custom_permissions === "string" ? row.custom_permissions : null,
    worktreePath: typeof row.worktree_path === "string" ? row.worktree_path : null,
    projectPath: typeof row.project_path === "string" ? row.project_path : null,
  }
}

function findPrompt(messagesValue: unknown, promptMessageId: unknown): string {
  if (typeof messagesValue !== "string" || typeof promptMessageId !== "string") return ""
  try {
    const messages = JSON.parse(messagesValue) as Array<Record<string, unknown>>
    const message = messages.find((candidate) => candidate.id === promptMessageId)
    if (!message || !Array.isArray(message.parts)) return ""
    return message.parts
      .filter((part): part is { type: string; text: string } => {
        return Boolean(
          part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string",
        )
      })
      .map((part) => part.text)
      .join("\n")
      .trim()
  } catch {
    return ""
  }
}

function markFailed(db: Database.Database, runId: string, subChatId: string): void {
  const now = Date.now()
  db.prepare(
    "UPDATE agent_runs SET status = 'failure', completed_at = ? WHERE id = ? AND completed_at IS NULL",
  ).run(now, runId)
  db.prepare(
    `UPDATE sub_chats
     SET run_status = COALESCE((
       SELECT status FROM agent_runs
       WHERE sub_chat_id = ? AND id <> ? AND status IN ('pending', 'running')
       ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, started_at, id
       LIMIT 1
     ), 'failure')
     WHERE id = ?`,
  ).run(subChatId, runId, subChatId)
}
