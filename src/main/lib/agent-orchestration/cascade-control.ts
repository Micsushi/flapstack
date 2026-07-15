import Database from "better-sqlite3"
import { createHash, randomUUID } from "node:crypto"
import { recordOrchestrationTransition } from "./activity-projection"
import type { RuntimeLaunchCoordinatorPort } from "./runtime-launch-port"

type Row = Record<string, unknown>
const TARGET_CLAIM_SECONDS = 300
export type CascadeAction = "pause" | "resume" | "stop"
export type CascadePreview = {
  taskId: string
  action: CascadeAction
  engine: string
  fingerprint: string
  agents: Array<{
    agentId: string
    runId: string | null
    status: string
    orphaned: boolean
    staleLease: boolean
  }>
  uncertainProviderActions: number
}

export class CascadeControlService {
  constructor(
    private readonly databasePath: string,
    private readonly runtime: RuntimeLaunchCoordinatorPort,
  ) {}

  preview(taskId: string, action: CascadeAction): CascadePreview {
    const db = new Database(this.databasePath, { readonly: true })
    try {
      return buildPreview(db, taskId, action)
    } finally {
      db.close()
    }
  }

  request(
    taskId: string,
    action: CascadeAction,
    expectedFingerprint?: string | null,
  ): { intentId: string; preview: CascadePreview } {
    const db = new Database(this.databasePath)
    try {
      const intentId = randomUUID()
      let persistedPreview!: CascadePreview
      const tx = db.transaction(() => {
        // BEGIN IMMEDIATE prevents a concurrent descendant insert from slipping
        // between this authoritative requery and target materialization.
        const preview = buildPreview(db, taskId, action)
        if (expectedFingerprint && preview.fingerprint !== expectedFingerprint)
          throw new Error("Cascade preview is stale; descendants changed before request.")
        persistedPreview = preview
        const now = epoch()
        db.prepare(
          `INSERT INTO orchestration_control_intents
           (id, task_id, action, state, preview_json, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        ).run(intentId, taskId, action, JSON.stringify(preview), now, now)
        if (action === "stop") {
          db.prepare(
            `UPDATE task_orchestrations SET status = 'stopped',
             stop_reason = 'cascade-stop-intent', updated_at = ?
             WHERE task_id = ? AND status not in ('completed','failed','stopped')`,
          ).run(now, taskId)
          db.prepare(
            `UPDATE orchestration_workflow_runs SET stop_intent = 1,
             status = CASE WHEN status in ('queued','waiting','blocked','paused') THEN 'stopped' ELSE status END,
             updated_at = ? WHERE task_id = ? AND status not in ('completed','failed','stopped')`,
          ).run(now, taskId)
        }
        const insertTarget = db.prepare(
          `INSERT INTO orchestration_control_targets
           (intent_id, agent_id, run_id, state, error, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?)`,
        )
        for (const agent of preview.agents)
          insertTarget.run(
            intentId,
            agent.agentId,
            agent.runId,
            agent.runId ? "pending" : "no-run",
            now,
          )
        recordOrchestrationTransition(db, {
          dedupKey: `control:${intentId}:${action}:pending`,
          taskId,
          entityType: "control",
          entityId: intentId,
          kind: "coordination",
          phase: `${action}-pending`,
          createdAt: now,
        })
      })
      tx.immediate()
      return { intentId, preview: persistedPreview }
    } finally {
      db.close()
    }
  }

  async reconcile(intentId: string) {
    const headerDb = new Database(this.databasePath)
    const intent = headerDb
      .prepare("SELECT * FROM orchestration_control_intents WHERE id = ?")
      .get(intentId) as Row | undefined
    headerDb.close()
    if (!intent) throw new Error("Control intent not found.")

    const recoveryDb = new Database(this.databasePath)
    recoveryDb
      .prepare(
        `UPDATE orchestration_control_targets
         SET state = 'failed', error = 'Runtime control reconciliation lease expired.', updated_at = ?
         WHERE intent_id = ? AND state = 'processing' AND updated_at <= ?`,
      )
      .run(epoch(), intentId, epoch() - TARGET_CLAIM_SECONDS)
    recoveryDb.close()

    const candidateDb = new Database(this.databasePath, { readonly: true })
    const candidateAgentIds = (
      candidateDb
        .prepare(
          `SELECT agent_id FROM orchestration_control_targets
           WHERE intent_id = ? AND state in ('pending','failed') ORDER BY rowid`,
        )
        .all(intentId) as Array<{ agent_id: string }>
    ).map((row) => row.agent_id)
    candidateDb.close()
    for (const agentId of candidateAgentIds) {
      const claimDb = new Database(this.databasePath)
      const target = claimDb
        .transaction(() => {
          const candidate = claimDb
            .prepare(
              `SELECT * FROM orchestration_control_targets
             WHERE intent_id = ? AND agent_id = ? AND state in ('pending','failed')`,
            )
            .get(intentId, agentId) as Row | undefined
          if (!candidate) return null
          const claimed = claimDb
            .prepare(
              `UPDATE orchestration_control_targets SET state = 'processing', error = NULL, updated_at = ?
             WHERE intent_id = ? AND agent_id = ? AND state in ('pending','failed')`,
            )
            .run(epoch(), intentId, candidate.agent_id)
          return claimed.changes === 1 ? candidate : null
        })
        .immediate()
      claimDb.close()
      if (!target) continue
      try {
        if (target.run_id)
          await this.coordinateRuntime(String(intent.action), String(target.run_id), intentId)
        const finishDb = new Database(this.databasePath)
        finishDb
          .prepare(
            `UPDATE orchestration_control_targets SET state = 'reconciled', error = NULL, updated_at = ?
             WHERE intent_id = ? AND agent_id = ? AND state = 'processing'`,
          )
          .run(epoch(), intentId, target.agent_id)
        finishDb.close()
      } catch (error) {
        const finishDb = new Database(this.databasePath)
        finishDb
          .prepare(
            `UPDATE orchestration_control_targets SET state = 'failed', error = ?, updated_at = ?
             WHERE intent_id = ? AND agent_id = ? AND state = 'processing'`,
          )
          .run(redactProviderError(error), epoch(), intentId, target.agent_id)
        finishDb.close()
      }
    }

    const db = new Database(this.databasePath)
    try {
      const counts = db
        .prepare(
          "SELECT state, count(*) count FROM orchestration_control_targets WHERE intent_id = ? GROUP BY state",
        )
        .all(intentId) as Array<{ state: string; count: number }>
      const failed = counts.find((row) => row.state === "failed")?.count ?? 0
      const pending = counts
        .filter((row) => ["pending", "processing"].includes(row.state))
        .reduce((sum, row) => sum + row.count, 0)
      const state = pending ? "pending" : failed ? "partial" : "completed"
      const updated = db
        .prepare("UPDATE orchestration_control_intents SET state = ?, updated_at = ? WHERE id = ?")
        .run(state, epoch(), intentId)
      if (updated.changes !== 1)
        throw new Error("Control intent disappeared during reconciliation.")
      if (state === "completed") applyCompletedControl(db, intent)
      recordOrchestrationTransition(db, {
        dedupKey: `control:${intentId}:${String(intent.action)}:${state}`,
        taskId: String(intent.task_id),
        entityType: "control",
        entityId: intentId,
        kind: state === "partial" ? "warning" : "coordination",
        phase: `${String(intent.action)}-${state}`,
      })
      return { intentId, state, counts }
    } finally {
      db.close()
    }
  }

  pendingIntents(): string[] {
    const db = new Database(this.databasePath, { readonly: true })
    try {
      return (
        db
          .prepare(
            "SELECT id FROM orchestration_control_intents WHERE state in ('pending','partial') ORDER BY created_at, id",
          )
          .all() as Row[]
      ).map((row) => String(row.id))
    } finally {
      db.close()
    }
  }

  private async coordinateRuntime(action: string, runId: string, intentId: string) {
    const reason = `orchestration-${action}:${intentId}`
    if (action === "stop") {
      const reference = await this.runtime.cancel(runId, reason)
      if (reference.runId !== runId || ["running", "uncertain"].includes(reference.lifecycleState))
        throw new Error("Runtime stop was not authoritatively acknowledged.")
      return reference
    }
    const control = action === "pause" ? this.runtime.pause : this.runtime.resume
    if (!control)
      throw new Error(
        `F11 Runtime ${action} lifecycle authority is unavailable; durable agent state is unchanged.`,
      )
    const reference = await control.call(this.runtime, runId)
    if (reference.runId !== runId || reference.lifecycleState !== "running")
      throw new Error(`Runtime ${action} acknowledgement identity/state mismatch.`)
    return reference
  }
}

function applyCompletedControl(db: Database.Database, intent: Row) {
  const now = epoch()
  const taskId = String(intent.task_id)
  const action = String(intent.action)
  if (action === "pause") {
    db.prepare(
      "UPDATE task_orchestrations SET status = 'paused', updated_at = ? WHERE task_id = ? AND status in ('queued','running')",
    ).run(now, taskId)
    db.prepare(
      `UPDATE orchestration_workflow_runs SET status = 'paused', updated_at = ?
       WHERE task_id = ? AND status in ('queued','running','waiting','blocked')`,
    ).run(now, taskId)
    return
  }
  if (action === "resume") {
    db.prepare(
      "UPDATE task_orchestrations SET status = 'running', updated_at = ? WHERE task_id = ? AND status = 'paused'",
    ).run(now, taskId)
    db.prepare(
      `UPDATE orchestration_workflow_runs SET status = 'running', updated_at = ?
       WHERE task_id = ? AND status = 'paused' AND stop_intent = 0`,
    ).run(now, taskId)
    return
  }
  db.prepare(
    `UPDATE orchestration_workflow_runs SET status = 'stopped', updated_at = ?
     WHERE task_id = ? AND status not in ('completed','failed','stopped')`,
  ).run(now, taskId)
}

function buildPreview(
  db: Database.Database,
  taskId: string,
  action: CascadeAction,
): CascadePreview {
  const orchestration = db
    .prepare("SELECT coordination_engine FROM task_orchestrations WHERE task_id = ?")
    .get(taskId) as Row | undefined
  if (!orchestration) throw new Error("Orchestration not found.")
  const rows = db
    .prepare(
      `SELECT id, run_id, parent_agent_id, status, lease_expires_at
       FROM orchestration_agents WHERE task_id = ? ORDER BY depth DESC, id`,
    )
    .all(taskId) as Row[]
  const ids = new Set(rows.map((row) => String(row.id)))
  const uncertain = db
    .prepare(
      `SELECT count(*) count FROM coordination_action_intents
       WHERE task_id = ? AND state in ('dispatching','uncertain')`,
    )
    .get(taskId) as { count: number }
  const agents = rows.map((row) => ({
    agentId: String(row.id),
    runId: row.run_id === null ? null : String(row.run_id),
    status: String(row.status),
    orphaned: row.parent_agent_id !== null && !ids.has(String(row.parent_agent_id)),
    staleLease: row.lease_expires_at !== null && Number(row.lease_expires_at) <= epoch(),
  }))
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(agents.map(({ agentId, runId, status }) => [agentId, runId, status])))
    .digest("hex")
  return {
    taskId,
    action,
    engine: String(orchestration.coordination_engine),
    fingerprint,
    agents,
    uncertainProviderActions: Number(uncertain.count),
  }
}

export function redactProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, "[REDACTED]")
    .replace(/\bAKIA[A-Z0-9]{16}\b/g, "[REDACTED]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/(?:api[-_ ]?key|token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/https?:\/\/[^\s/:]+:[^\s/@]+@/gi, "https://[REDACTED]@")
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED]",
    )
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500)
}
function epoch() {
  return Math.floor(Date.now() / 1000)
}
