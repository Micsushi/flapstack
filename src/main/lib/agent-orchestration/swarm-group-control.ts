import { createHash } from "node:crypto"
import { redactProviderError } from "./cascade-control"

export type SwarmControlAction = "pause" | "resume" | "cancel" | "steer"

export type SwarmControlTarget = {
  agentId: string
  runId: string | null
  version: number
  status: string
  capabilities: readonly SwarmControlAction[]
  permissions: readonly ("control" | "steer")[]
}

export type SwarmControlPreview = {
  action: SwarmControlAction
  version: string
  selection: string[]
  capabilityIntersection: SwarmControlAction[]
  permissionIntersection: Array<"control" | "steer">
  approvalRequired: boolean
  targets: Array<{
    agentId: string
    runId: string | null
    version: number
    supported: boolean
    reason: "missing-target" | "missing-run" | "unsupported-capability" | "permission-denied" | null
  }>
}

export type SwarmControlAudit = {
  action: SwarmControlAction
  selectionVersion: string
  agentId?: string
  runId?: string | null
  outcome: "succeeded" | "failed" | "unchanged" | "stale-selection"
  detail?: string
  approvalAuditId?: string | null
}

export type SwarmGroupControlAuthority = {
  approve: (preview: SwarmControlPreview) => Promise<string | null>
  cascade: (
    action: Exclude<SwarmControlAction, "steer">,
    target: SwarmControlTarget,
    approvalAuditId: string | null,
  ) => Promise<{ acknowledged: boolean }>
  steer: (
    target: SwarmControlTarget,
    approvalAuditId: string | null,
  ) => Promise<{ acknowledged: boolean }>
  audit: (event: SwarmControlAudit) => void
}

export type SwarmControlExecution = {
  status: "completed" | "partial" | "stale-selection"
  approvalAuditId: string | null
  results: Array<{
    agentId: string
    outcome: "succeeded" | "failed" | "unchanged"
    detail?: string
  }>
}

export class SwarmGroupControl {
  constructor(private readonly authority: SwarmGroupControlAuthority) {}

  preview(
    action: SwarmControlAction,
    currentTargets: readonly SwarmControlTarget[],
    selectedAgentIds: readonly string[],
  ): SwarmControlPreview {
    const selection = [...new Set(selectedAgentIds)].sort()
    const byId = new Map(currentTargets.map((target) => [target.agentId, target]))
    const selectedTargets = selection.flatMap((agentId) => {
      const target = byId.get(agentId)
      return target ? [target] : []
    })
    const requiredPermission = action === "steer" ? "steer" : "control"
    const targets = selection.map((agentId) => {
      const target = byId.get(agentId)
      if (!target) {
        return {
          agentId,
          runId: null,
          version: 0,
          supported: false,
          reason: "missing-target" as const,
        }
      }
      const reason =
        target.runId === null
          ? ("missing-run" as const)
          : !target.capabilities.includes(action)
            ? ("unsupported-capability" as const)
            : !target.permissions.includes(requiredPermission)
              ? ("permission-denied" as const)
              : null
      return {
        agentId,
        runId: target.runId,
        version: target.version,
        supported: reason === null,
        reason,
      }
    })
    const preview = {
      action,
      selection,
      capabilityIntersection: intersect(
        selectedTargets.map((target) => target.capabilities),
      ) as SwarmControlAction[],
      permissionIntersection: intersect(
        selectedTargets.map((target) => target.permissions),
      ) as Array<"control" | "steer">,
      approvalRequired: action === "cancel" || action === "steer",
      targets,
    }
    return { ...preview, version: selectionVersion(action, selectedTargets) }
  }

  async execute(
    preview: SwarmControlPreview,
    currentTargets: readonly SwarmControlTarget[],
  ): Promise<SwarmControlExecution> {
    const current = this.preview(preview.action, currentTargets, preview.selection)
    if (current.version !== preview.version || !samePreview(current, preview)) {
      this.authority.audit({
        action: preview.action,
        selectionVersion: preview.version,
        outcome: "stale-selection",
      })
      return { status: "stale-selection", approvalAuditId: null, results: [] }
    }
    const approvalAuditId = current.approvalRequired ? await this.authority.approve(current) : null
    const byId = new Map(currentTargets.map((target) => [target.agentId, target]))
    const results: SwarmControlExecution["results"] = []
    for (const targetPreview of current.targets) {
      const target = byId.get(targetPreview.agentId)
      if (!targetPreview.supported || !target) {
        const detail = targetPreview.reason ?? "missing-target"
        const result = { agentId: targetPreview.agentId, outcome: "unchanged" as const, detail }
        results.push(result)
        this.authority.audit({
          action: preview.action,
          selectionVersion: preview.version,
          agentId: targetPreview.agentId,
          runId: targetPreview.runId,
          outcome: result.outcome,
          detail,
          approvalAuditId,
        })
        continue
      }
      try {
        const acknowledgment =
          current.action === "steer"
            ? await this.authority.steer(target, approvalAuditId)
            : await this.authority.cascade(current.action, target, approvalAuditId)
        if (!acknowledgment.acknowledged)
          throw new Error("Authority did not acknowledge the action.")
        const result = { agentId: target.agentId, outcome: "succeeded" as const }
        results.push(result)
        this.authority.audit({
          action: preview.action,
          selectionVersion: preview.version,
          agentId: target.agentId,
          runId: target.runId,
          outcome: result.outcome,
          approvalAuditId,
        })
      } catch (error) {
        const detail = redactProviderError(error)
        const result = { agentId: target.agentId, outcome: "failed" as const, detail }
        results.push(result)
        this.authority.audit({
          action: preview.action,
          selectionVersion: preview.version,
          agentId: target.agentId,
          runId: target.runId,
          outcome: result.outcome,
          detail,
          approvalAuditId,
        })
      }
    }
    return {
      status: results.every((result) => result.outcome === "succeeded") ? "completed" : "partial",
      approvalAuditId,
      results,
    }
  }
}

function samePreview(current: SwarmControlPreview, supplied: SwarmControlPreview): boolean {
  return JSON.stringify(current) === JSON.stringify(supplied)
}

function selectionVersion(
  action: SwarmControlAction,
  targets: readonly SwarmControlTarget[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        action,
        [...targets]
          .sort((left, right) => left.agentId.localeCompare(right.agentId))
          .map((target) => [
            target.agentId,
            target.runId,
            target.version,
            target.status,
            [...target.capabilities].sort(),
            [...target.permissions].sort(),
          ]),
      ]),
    )
    .digest("hex")
}

function intersect<T extends string>(sets: readonly (readonly T[])[]): T[] {
  if (sets.length === 0) return []
  return [...new Set(sets[0])].filter((value) => sets.every((set) => set.includes(value))).sort()
}
