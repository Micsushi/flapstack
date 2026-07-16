import type Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { openAppDatabase } from "./db/access"
import * as dbSchema from "./db/schema"
import { createHash } from "node:crypto"
import { randomUUID } from "node:crypto"
import { AGENT_HARNESSES, type AgentHarness } from "../../shared/harness-types"
import type { ResolvedRuntimeLaunch } from "../../shared/agent-runtime"
import { resolvedLaunchFromSnapshotRow } from "./agent-runtime/snapshot"
import { redactMcpAuditSummary } from "./mcp-control/audit-storage"
import { nowEpochSeconds } from "./db/timestamps"
import { claimPendingRunWithinUsageBudget } from "./usage/budgets"
import { createDatabaseLocalModelRunPersistence } from "./harness/local-model-stream"
import {
  orchestrationAgentDefinitionSchema,
  orchestrationPermissionModeSchema,
  type OrchestrationAgentDefinition,
} from "../../shared/agent-orchestration"
import { parseCustomPermissionCapabilities } from "../../shared/permission-capabilities"
import { normalizeChatMode, type ChatMode } from "../../shared/chat-mode"
import { resolveAgentHotlineEnabled } from "../../shared/agent-hotline"

export type QueuedAgentRun = {
  runId: string
  chatId: string
  subChatId: string
  harness: AgentHarness
  prompt: string
  images?: Array<{ base64Data: string; mediaType: string; filename?: string }>
  chatMode?: ChatMode
  hotlineEnabled?: boolean
  model: string | null
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | null
  permissionMode: string
  customPermissions: string | null
  worktreePath: string | null
  projectPath: string | null
  localEndpoint?: string
  requiredLocalToolTiers?: Array<"read" | "project-write" | "shell" | "git" | "network">
  runtimeLaunch?: ResolvedRuntimeLaunch
}

export type AgentRunLauncher = (run: QueuedAgentRun) => Promise<void>

export type AgentRunReconciliationState =
  "running" | "completed" | "cancelled" | "failed" | "uncertain"

export type InterruptedRuntimeRecoveryAuthority = {
  reconcile(run: QueuedAgentRun): Promise<AgentRunReconciliationState>
}

type Row = Record<string, unknown>

/** Projects durable run truth without invoking a provider authority. */
export function loadAgentRunReconciliationState(
  databasePath: string,
  runId: string,
): AgentRunReconciliationState {
  const db = openAppDatabase(databasePath)
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  try {
    const row = db.prepare("SELECT status FROM agent_runs WHERE id = ?").get(runId) as
      { status: string } | undefined
    if (!row) return "uncertain"
    if (row.status === "running") return "running"
    if (row.status === "success") return "completed"
    if (row.status === "cancelled") return "cancelled"
    if (row.status === "failure") return "failed"
    return "uncertain"
  } finally {
    db.close()
  }
}

/** Loads one still-running durable launch by identity without resolving or replaying it. */
export function loadRunningAgentRun(databasePath: string, runId: string): QueuedAgentRun | null {
  const db = openAppDatabase(databasePath)
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  try {
    const runtimeProjection = runtimeSnapshotProjection(db)
    const row = db
      .prepare(
        `SELECT r.id, r.chat_id, r.sub_chat_id, r.harness, r.model, r.permission_mode,
          r.custom_permissions, ${runtimeProjection}, r.worktree_path, r.prompt_message_id,
          r.initial_prompt, s.messages, s.mode chat_mode, c.project_id, p.path project_path,
          oa.definition orchestration_definition
         FROM agent_runs r
         JOIN chats c ON c.id = r.chat_id
         JOIN sub_chats s ON s.id = r.sub_chat_id
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN orchestration_agents oa ON oa.run_id = r.id
         WHERE r.id = ? AND r.status = 'running' AND r.completed_at IS NULL`,
      )
      .get(runId) as Row | undefined
    return row ? queuedRun(row) : null
  } finally {
    db.close()
  }
}

/** Native MCP can requeue. Direct Runtime intent must reconcile and never replay. */
export async function recoverInterruptedMcpRuns(
  databasePath: string,
  authority?: InterruptedRuntimeRecoveryAuthority,
): Promise<number> {
  const db = openAppDatabase(databasePath)
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  try {
    const runtimeProjection = runtimeSnapshotProjection(db)
    const now = nowEpochSeconds()
    createDatabaseLocalModelRunPersistence(drizzle(db, { schema: dbSchema })).recoverAbandoned(
      new Date(now * 1_000),
    )
    const runs = db
      .prepare(
        `SELECT r.id, r.chat_id, r.sub_chat_id, r.harness, r.model, r.permission_mode,
          r.custom_permissions, ${runtimeProjection}, r.worktree_path, r.prompt_message_id,
          r.initial_prompt, s.messages, s.mode chat_mode, c.project_id, p.path project_path,
          oa.definition orchestration_definition
         FROM agent_runs r
         JOIN chats c ON c.id = r.chat_id
         JOIN sub_chats s ON s.id = r.sub_chat_id
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN orchestration_agents oa ON oa.run_id = r.id
         WHERE r.status = 'running' AND r.completed_at IS NULL`,
      )
      .all() as Row[]
    const direct: QueuedAgentRun[] = []
    const affectedSubChats = new Set<string>()
    let recovered = 0
    const recover = db.transaction(() => {
      for (const run of runs) {
        affectedSubChats.add(String(run.sub_chat_id))
        const isMcp =
          typeof run.prompt_message_id === "string" && run.prompt_message_id.startsWith("mcp-")
        const runtime = String(run.resolved_runtime ?? "flapstack-native")
        if (run.harness === "local") {
          db.prepare("UPDATE agent_runs SET status = 'failure', completed_at = ? WHERE id = ?").run(
            now,
            run.id,
          )
        } else if (runtime === "codex" || runtime === "claude-code") {
          try {
            const queued = queuedRun(run)
            if (!queued) throw new Error("Interrupted direct Runtime has no durable prompt.")
            direct.push(queued)
          } catch {
            markFailed(db, String(run.id), String(run.sub_chat_id))
          }
        } else if (isMcp && runtime === "flapstack-native") {
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
    })
    recover.immediate()
    for (const run of direct) {
      let state: AgentRunReconciliationState = "uncertain"
      try {
        state = authority ? await authority.reconcile(run) : "uncertain"
      } catch {
        state = "uncertain"
      }
      if (state === "uncertain" || state === "failed") markFailed(db, run.runId, run.subChatId)
      else if (state === "completed") projectTerminalRun(db, run.runId, run.subChatId, "success")
      else if (state === "cancelled") projectTerminalRun(db, run.runId, run.subChatId, "cancelled")
    }
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
  const db = openAppDatabase(databasePath)
  db.pragma("foreign_keys = ON")
  db.pragma("busy_timeout = 5000")
  let started = 0
  const launches: Promise<void>[] = []
  try {
    const runtimeProjection = runtimeSnapshotProjection(db)
    const pending = db
      .prepare(
        `SELECT r.id, r.chat_id, r.sub_chat_id, r.harness, r.model, r.permission_mode,
          r.custom_permissions, ${runtimeProjection},
          r.worktree_path, r.prompt_message_id, r.initial_prompt, s.messages, s.mode chat_mode,
          c.project_id, p.path project_path,
          oa.definition orchestration_definition
         FROM agent_runs r
         JOIN chats c ON c.id = r.chat_id
         JOIN sub_chats s ON s.id = r.sub_chat_id
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN orchestration_agents oa ON oa.run_id = r.id
         WHERE r.status = 'pending' AND r.prompt_message_id LIKE 'mcp-%'
           AND NOT EXISTS (
             SELECT 1 FROM orchestration_transition_events workflow_owner
             WHERE workflow_owner.run_id = r.id
               AND workflow_owner.dedup_key LIKE 'workflow-materialized:%'
           )
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
      let run: QueuedAgentRun | null = null
      try {
        run = queuedRun(row)
      } catch (error) {
        markFailed(db, String(row.id), String(row.sub_chat_id))
        appendCorruptLaunchAudit(db, row, error)
        continue
      }
      if (!run) {
        markFailed(db, String(row.id), String(row.sub_chat_id))
        continue
      }
      const claimed = claimPendingRunWithinUsageBudget(db, String(row.id))
      if (!claimed.claimed) continue
      db.prepare("UPDATE sub_chats SET run_status = 'running' WHERE id = ?").run(row.sub_chat_id)
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

function appendCorruptLaunchAudit(db: Database.Database, row: Row, error: unknown): void {
  const run: QueuedAgentRun = {
    runId: String(row.id),
    chatId: String(row.chat_id),
    subChatId: String(row.sub_chat_id),
    harness: row.harness as AgentHarness,
    prompt: "[corrupt Runtime snapshot]",
    model: typeof row.model === "string" ? row.model : null,
    reasoningEffort: null,
    permissionMode: String(row.permission_mode),
    customPermissions: null,
    worktreePath: null,
    projectPath: null,
  }
  appendLaunchAudit(
    db,
    run,
    "failed",
    error instanceof Error ? error.message : "Corrupt Runtime snapshot.",
  )
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
  if (!AGENT_HARNESSES.includes(row.harness as AgentHarness)) return null
  const prompt =
    (typeof row.initial_prompt === "string" ? row.initial_prompt.trim() : "") ||
    findPrompt(row.messages, row.prompt_message_id)
  if (!prompt) return null
  const durableDefinition = parseDurableOrchestrationDefinition(row.orchestration_definition)
  const localInputs = validateDurableLocalLaunchInputs(row, durableDefinition)
  return {
    runId: String(row.id),
    chatId: String(row.chat_id),
    subChatId: String(row.sub_chat_id),
    harness: row.harness as AgentHarness,
    prompt,
    chatMode: normalizeChatMode(row.chat_mode),
    hotlineEnabled: resolveAgentHotlineEnabled(parseDurableMessages(row.messages)),
    model: typeof row.model === "string" ? row.model : null,
    reasoningEffort: isReasoningEffort(durableDefinition?.reasoningEffort)
      ? durableDefinition.reasoningEffort
      : null,
    permissionMode: String(row.permission_mode),
    customPermissions: typeof row.custom_permissions === "string" ? row.custom_permissions : null,
    worktreePath: typeof row.worktree_path === "string" ? row.worktree_path : null,
    projectPath: typeof row.project_path === "string" ? row.project_path : null,
    ...localInputs,
    runtimeLaunch: resolvedLaunchFromSnapshotRow(row),
  }
}

function parseDurableMessages(value: unknown): unknown[] {
  if (typeof value !== "string") return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseDurableOrchestrationDefinition(value: unknown): OrchestrationAgentDefinition | null {
  if (value === null || value === undefined) return null
  try {
    if (typeof value !== "string") throw new Error("definition is not text")
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("definition is not an object")
    }
    const normalized = { ...(parsed as Record<string, unknown>) }
    if (normalized.requiredLocalToolTiers === null) {
      delete normalized.requiredLocalToolTiers
    }
    return orchestrationAgentDefinitionSchema.parse(normalized)
  } catch {
    throw new Error("Durable orchestration agent definition is malformed.")
  }
}

function validateDurableLocalLaunchInputs(
  row: Row,
  definition: OrchestrationAgentDefinition | null,
): Pick<QueuedAgentRun, "localEndpoint" | "requiredLocalToolTiers"> {
  if (String(row.harness) !== "local") return {}
  const model = typeof row.model === "string" ? row.model : ""
  if (!model || model !== model.trim() || model.length > 200) {
    throw new Error("Durable local Runtime model identity is invalid.")
  }
  const permission = orchestrationPermissionModeSchema.safeParse(row.permission_mode)
  if (!permission.success) {
    throw new Error("Durable local Runtime permission mode is invalid.")
  }
  const customPermissions = parseDurableCustomPermissions(row.custom_permissions, permission.data)
  if (definition) {
    if (
      definition.harness !== "local" ||
      definition.model !== model ||
      definition.permissionMode !== permission.data ||
      JSON.stringify(definition.customPermissions ?? null) !== JSON.stringify(customPermissions)
    ) {
      throw new Error(
        "Durable local Runtime launch snapshot does not match its orchestration input.",
      )
    }
  }
  return {
    ...(definition?.localEndpoint ? { localEndpoint: definition.localEndpoint } : {}),
    requiredLocalToolTiers: definition?.requiredLocalToolTiers ?? [],
  }
}

function parseDurableCustomPermissions(
  value: unknown,
  permissionMode: OrchestrationAgentDefinition["permissionMode"],
) {
  if (permissionMode !== "custom") {
    if (value !== null && value !== undefined) {
      throw new Error("Durable local Runtime custom permissions are forbidden for this mode.")
    }
    return null
  }
  if (typeof value !== "string") {
    throw new Error("Durable local Runtime custom permissions are missing.")
  }
  try {
    const parsed = parseCustomPermissionCapabilities(JSON.parse(value))
    if (!parsed) throw new Error("custom permissions are invalid")
    return parsed
  } catch {
    throw new Error("Durable local Runtime custom permissions are malformed.")
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
  projectTerminalRun(db, runId, subChatId, "failure")
}

function projectTerminalRun(
  db: Database.Database,
  runId: string,
  subChatId: string,
  terminal: "success" | "failure" | "cancelled",
): void {
  const now = nowEpochSeconds()
  const project = () => {
    const transition = db
      .prepare(
        `UPDATE agent_runs SET status = ?, completed_at = ?
         WHERE id = ? AND status IN ('pending','running') AND completed_at IS NULL`,
      )
      .run(terminal, now, runId)
    if (transition.changes === 0) return
    db.prepare(
      `UPDATE sub_chats SET run_status = COALESCE((
         SELECT status FROM agent_runs
         WHERE sub_chat_id = ? AND id <> ? AND status IN ('pending','running')
         ORDER BY CASE WHEN status = 'running' THEN 0 ELSE 1 END, started_at, id
         LIMIT 1
       ), ?), updated_at = ? WHERE id = ?`,
    ).run(subChatId, runId, terminal, now, subChatId)
  }
  if (db.inTransaction) project()
  else db.transaction(project).immediate()
}

function runtimeSnapshotProjection(db: Database.Database): string {
  const columns = db.prepare("PRAGMA table_info(agent_runs)").all() as Array<{ name: string }>
  if (columns.some((column) => column.name === "runtime_snapshot_version")) {
    return `r.runtime_snapshot_version, r.runtime_preference,
      r.runtime_preference_source, r.resolved_runtime, r.runtime_adapter_version,
      r.runtime_protocol_version, r.runtime_capability_snapshot, r.runtime_control_snapshot`
  }
  return `0 runtime_snapshot_version, 'flapstack-native' runtime_preference,
    'legacy' runtime_preference_source, 'flapstack-native' resolved_runtime,
    'legacy-stage3' runtime_adapter_version, 'legacy-stage3' runtime_protocol_version,
    '{}' runtime_capability_snapshot, '{}' runtime_control_snapshot`
}
