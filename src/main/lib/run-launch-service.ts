import type Database from "better-sqlite3"
import { openAppDatabase } from "./db/access"
import { createHash } from "node:crypto"
import { randomUUID } from "node:crypto"
import type { AgentHarness } from "../../shared/harness-types"
import { redactMcpAuditSummary } from "./mcp-control/audit-storage"
import { nowEpochSeconds } from "./db/timestamps"
import { claimPendingRunWithinUsageBudget } from "./usage/budgets"

export type QueuedAgentRun = {
  runId: string
  chatId: string
  subChatId: string
  harness: AgentHarness
  prompt: string
  model: string | null
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | null
  permissionMode: string
  customPermissions: string | null
  worktreePath: string | null
  projectPath: string | null
}

export type AgentRunLauncher = (run: QueuedAgentRun) => Promise<void>

type Row = Record<string, unknown>

/** App restart ends provider streams; requeue MCP work and cancel everything else. */
export function recoverInterruptedMcpRuns(databasePath: string): number {
  const db = openAppDatabase(databasePath)
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  try {
    const recover = db.transaction(() => {
      const runs = db
        .prepare(
          `SELECT id, sub_chat_id, prompt_message_id FROM agent_runs
           WHERE status = 'running' AND completed_at IS NULL`,
        )
        .all() as Row[]
      const affectedSubChats = new Set<string>()
      let recovered = 0
      const now = nowEpochSeconds()
      for (const run of runs) {
        affectedSubChats.add(String(run.sub_chat_id))
        const isMcp =
          typeof run.prompt_message_id === "string" && run.prompt_message_id.startsWith("mcp-")
        if (isMcp) {
          db.prepare("UPDATE agent_runs SET status = 'pending' WHERE id = ?").run(run.id)
          recovered += 1
        } else {
          db.prepare(
            "UPDATE agent_runs SET status = 'cancelled', completed_at = ? WHERE id = ?",
          ).run(now, run.id)
        }
      }

      for (const subChatId of affectedSubChats) {
        db.prepare(
          `UPDATE sub_chats SET run_status = COALESCE((
             SELECT status FROM agent_runs
             WHERE sub_chat_id = ? AND status IN ('pending','running')
             ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, started_at, id
             LIMIT 1
           ), (
             SELECT status FROM agent_runs
             WHERE sub_chat_id = ?
             ORDER BY started_at DESC, id DESC
             LIMIT 1
           ), run_status), updated_at = ? WHERE id = ?`,
        ).run(subChatId, subChatId, now, subChatId)
      }
      return recovered
    })
    return recover.immediate()
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
  const db = openAppDatabase(databasePath)
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
          c.project_id, p.path project_path,
          json_extract(oa.definition, '$.reasoningEffort') reasoning_effort
         FROM agent_runs r
         JOIN chats c ON c.id = r.chat_id
         JOIN sub_chats s ON s.id = r.sub_chat_id
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN orchestration_agents oa ON oa.run_id = r.id
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
      const claimed = claimPendingRunWithinUsageBudget(db, String(row.id))
      if (!claimed.claimed) continue
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
  const db = openAppDatabase(databasePath)
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  try {
    if (status === "failed") markFailed(db, run.runId, run.subChatId)
    appendLaunchAudit(db, run, status, error)
  } finally {
    db.close()
  }
}

function appendLaunchAudit(
  db: Database.Database,
  run: QueuedAgentRun,
  status: "completed" | "failed",
  error?: string,
): void {
  const source = findLaunchAuditSource(db, run.runId)
  if (!source) return
  db.prepare(
    `INSERT INTO mcp_audit_records (
      id, invocation_id, status, caller_chat_id, caller_run_id, tool_name, tier,
      caller_snapshot, chat_snapshot, run_snapshot, input_summary, result_summary, duration_ms,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
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
    redactMcpAuditSummary({ runId: run.runId }),
    source.input_summary,
    redactMcpAuditSummary({
      runId: run.runId,
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
    nowEpochSeconds(),
  )
}

function findLaunchAuditSource(db: Database.Database, runId: string): Row | undefined {
  const orchestration = db
    .prepare("SELECT task_id FROM orchestration_agents WHERE run_id = ?")
    .get(runId) as Row | undefined
  if (typeof orchestration?.task_id === "string") {
    const contextHash = createHash("sha256").update(orchestration.task_id).digest("hex")
    return db
      .prepare(
        `SELECT invocation_id, caller_chat_id, caller_run_id, tool_name, tier,
          caller_snapshot, chat_snapshot, input_summary
         FROM mcp_audit_records
         WHERE status = 'completed' AND tool_name = 'orchestrate_task'
           AND json_extract(run_snapshot, '$.contextHash') = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(contextHash) as Row | undefined
  }
  return db
    .prepare(
      `SELECT invocation_id, caller_chat_id, caller_run_id, tool_name, tier,
        caller_snapshot, chat_snapshot, input_summary
       FROM mcp_audit_records
       WHERE status = 'completed'
         AND tool_name IN ('launch_run', 'spawn_thread')
         AND (instr(result_summary, ?) > 0 OR instr(result_summary, ?) > 0)
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(createHash("sha256").update(runId).digest("hex"), runId) as Row | undefined
}

function queuedRun(row: Row): QueuedAgentRun | null {
  if (
    !["codex", "claude-code", "cursor-agent", "openrouter", "nanogpt", "local"].includes(
      String(row.harness),
    )
  )
    return null
  const prompt =
    (typeof row.initial_prompt === "string" ? row.initial_prompt.trim() : "") ||
    findPrompt(row.messages, row.prompt_message_id)
  if (!prompt) return null
  return {
    runId: String(row.id),
    chatId: String(row.chat_id),
    subChatId: String(row.sub_chat_id),
    harness: row.harness as AgentHarness,
    prompt,
    model: typeof row.model === "string" ? row.model : null,
    reasoningEffort: isReasoningEffort(row.reasoning_effort) ? row.reasoning_effort : null,
    permissionMode: String(row.permission_mode),
    customPermissions: typeof row.custom_permissions === "string" ? row.custom_permissions : null,
    worktreePath: typeof row.worktree_path === "string" ? row.worktree_path : null,
    projectPath: typeof row.project_path === "string" ? row.project_path : null,
  }
}

function isReasoningEffort(
  value: unknown,
): value is "minimal" | "low" | "medium" | "high" | "xhigh" {
  return ["minimal", "low", "medium", "high", "xhigh"].includes(String(value))
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
  const now = nowEpochSeconds()
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
