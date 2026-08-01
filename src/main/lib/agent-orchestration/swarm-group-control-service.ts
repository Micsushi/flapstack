import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { recordOrchestrationTransition } from "./activity-projection"
import type { RuntimeLaunchCoordinatorPort } from "./runtime-launch-port"
import {
  SwarmGroupControl,
  type SwarmControlAction,
  type SwarmControlAudit,
  type SwarmControlExecution,
  type SwarmControlPreview,
  type SwarmControlTarget,
} from "./swarm-group-control"

type TargetRow = {
  id: string
  run_id: string | null
  status: string
  updated_at: number
  orchestration_status: string
}

export class SwarmGroupControlService {
  constructor(
    private readonly databasePath: string,
    private readonly runtime: RuntimeLaunchCoordinatorPort,
  ) {}

  preview(
    taskId: string,
    action: SwarmControlAction,
    selectedAgentIds: readonly string[],
  ): SwarmControlPreview {
    const targets = this.#loadTargets(taskId)
    return this.#control(taskId).preview(action, targets, selectedAgentIds)
  }

  async execute(
    taskId: string,
    preview: SwarmControlPreview,
    steerMessage: string,
  ): Promise<SwarmControlExecution> {
    if (preview.action === "steer" && !steerMessage.trim()) {
      throw new Error("Enter a steering message before confirming.")
    }
    const result = await this.#control(taskId).execute(preview, this.#loadTargets(taskId))
    if (result.status === "stale-selection") return result
    return result
  }

  #loadTargets(taskId: string): SwarmControlTarget[] {
    const database = new Database(this.databasePath, { readonly: true })
    try {
      const rows = database
        .prepare(
          `SELECT a.id, a.run_id, a.status, a.updated_at,
                  o.status AS orchestration_status
             FROM orchestration_agents a
             JOIN task_orchestrations o ON o.task_id = a.task_id
            WHERE a.task_id = ?
            ORDER BY a.id`,
        )
        .all(taskId) as TargetRow[]
      return rows.map((row) => {
        const capabilities: SwarmControlAction[] = []
        if (row.status === "active") {
          if (row.orchestration_status === "paused" && this.runtime.resume) {
            capabilities.push("resume")
          }
          if (row.orchestration_status !== "paused" && this.runtime.pause) {
            capabilities.push("pause")
          }
          capabilities.push("cancel")
        }
        if (row.status === "queued") capabilities.push("cancel")
        return {
          agentId: row.id,
          runId: row.run_id,
          version: Number(row.updated_at),
          status: `${row.status}:${row.orchestration_status}`,
          capabilities,
          permissions: ["control"],
        }
      })
    } finally {
      database.close()
    }
  }

  #control(taskId: string): SwarmGroupControl {
    return new SwarmGroupControl({
      approve: async () => randomUUID(),
      cascade: async (action, target) => {
        if (!target.runId) return { acknowledged: false }
        if (action === "pause") {
          const reference = await this.runtime.pause?.(target.runId)
          return { acknowledged: reference?.runId === target.runId }
        }
        if (action === "resume") {
          const reference = await this.runtime.resume?.(target.runId)
          return { acknowledged: reference?.runId === target.runId }
        }
        const reference = await this.runtime.cancel(
          target.runId,
          `swarm-group-cancel:${taskId}:${target.agentId}`,
        )
        const acknowledged =
          reference.runId === target.runId &&
          reference.lifecycleState !== "running" &&
          reference.lifecycleState !== "uncertain"
        if (acknowledged) this.#markCancelled(target.agentId)
        return { acknowledged }
      },
      steer: async () => {
        throw new Error("Selected Runtime does not expose group steering authority.")
      },
      audit: (event) => this.#audit(taskId, event),
    })
  }

  #markCancelled(agentId: string): void {
    const database = new Database(this.databasePath)
    try {
      database
        .prepare(
          `UPDATE orchestration_agents
              SET status = 'stopped', stop_reason = 'swarm-group-cancel',
                  completed_at = ?, updated_at = ?
            WHERE id = ? AND status IN ('queued', 'active')`,
        )
        .run(epoch(), epoch(), agentId)
    } finally {
      database.close()
    }
  }

  #audit(taskId: string, event: SwarmControlAudit): void {
    const database = new Database(this.databasePath)
    try {
      recordOrchestrationTransition(database, {
        dedupKey: [
          "swarm-group",
          event.selectionVersion,
          event.agentId ?? "selection",
          event.outcome,
        ].join(":"),
        taskId,
        entityType: "control",
        entityId: event.selectionVersion,
        agentId: event.agentId ?? null,
        runId: event.runId ?? null,
        kind: event.outcome === "failed" ? "warning" : "coordination",
        phase: `${event.action}-${event.outcome}`,
        summary:
          [event.detail, event.approvalAuditId ? `approval:${event.approvalAuditId}` : undefined]
            .filter((part): part is string => Boolean(part))
            .join("; ") || null,
      })
    } finally {
      database.close()
    }
  }
}

function epoch(): number {
  return Math.floor(Date.now() / 1_000)
}
