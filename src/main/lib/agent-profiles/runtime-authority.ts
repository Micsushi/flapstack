import type Database from "better-sqlite3"
import {
  agentCapabilityProfileSchema,
  agentProfileRuntimeAuthoritySchema,
  type AgentProfileRuntimeAuthority,
} from "../../../shared/agent-profiles"
import { canonicalJson } from "./values"
import { FLAPSTACK_MCP_SERVER_NAME } from "../mcp-control/registration"
import { parseDurableOrchestrationAgentDefinition } from "../agent-orchestration/durable-definition"

type Row = Record<string, unknown>

export type DurableAgentProfileRuntimeAuthority =
  | { kind: "none" }
  | { kind: "authority"; authority: AgentProfileRuntimeAuthority }
  | { kind: "invalid" }

export function readDurableAgentProfileRuntimeAuthority(
  database: Database.Database | object,
  runId: string,
): DurableAgentProfileRuntimeAuthority {
  const db =
    "prepare" in database && typeof database.prepare === "function"
      ? (database as Database.Database)
      : (database as { $client: Database.Database }).$client
  const standaloneRows = db
    .prepare(
      `SELECT l.snapshot_id, s.resolved_json
       FROM agent_profile_standalone_launches l
       LEFT JOIN agent_profile_snapshots s ON s.id = l.snapshot_id
       WHERE l.run_id = ?`,
    )
    .all(runId) as Row[]
  if (standaloneRows.length > 1) return { kind: "invalid" }
  if (standaloneRows.length === 1) {
    return authorityFromSnapshotRow(standaloneRows[0]!)
  }

  const orchestrationRows = db
    .prepare("SELECT definition FROM orchestration_agents WHERE run_id = ?")
    .all(runId) as Row[]
  if (orchestrationRows.length > 1) return { kind: "invalid" }
  if (orchestrationRows.length === 0) {
    const run = db.prepare("SELECT prompt_message_id FROM agent_runs WHERE id = ?").get(runId) as
      { prompt_message_id: string | null } | undefined
    return run?.prompt_message_id?.startsWith("profile-") ? { kind: "invalid" } : { kind: "none" }
  }
  try {
    const definition = parseDurableOrchestrationAgentDefinition(orchestrationRows[0]!.definition)
    const workflowRows = db
      .prepare(
        `SELECT b.snapshot_id, s.resolved_json
         FROM orchestration_transition_events e
         JOIN agent_profile_workflow_bindings b
           ON e.entity_id = b.workflow_run_id || ':' || b.step_id
         LEFT JOIN agent_profile_snapshots s ON s.id = b.snapshot_id
         WHERE e.run_id = ? AND e.phase = 'workflow-materialized'
           AND b.snapshot_id IS NOT NULL`,
      )
      .all(runId) as Row[]
    if (workflowRows.length > 1) return { kind: "invalid" }
    if (workflowRows.length === 1) {
      const resolved = authorityFromSnapshotRow(workflowRows[0]!)
      if (resolved.kind !== "authority") return { kind: "invalid" }
      return definition.profileRuntimeAuthority &&
        canonicalJson(resolved.authority) !== canonicalJson(definition.profileRuntimeAuthority)
        ? { kind: "invalid" }
        : resolved
    }
    if (!definition.profileRuntimeAuthority) {
      return definition.definitionId?.startsWith("profile-snapshot:")
        ? { kind: "invalid" }
        : { kind: "none" }
    }
    const snapshot = db
      .prepare("SELECT id snapshot_id, resolved_json FROM agent_profile_snapshots WHERE id = ?")
      .get(definition.profileRuntimeAuthority.snapshotId) as Row | undefined
    if (!snapshot) return { kind: "invalid" }
    const resolved = authorityFromSnapshotRow(snapshot)
    return resolved.kind === "authority" &&
      canonicalJson(resolved.authority) === canonicalJson(definition.profileRuntimeAuthority)
      ? resolved
      : { kind: "invalid" }
  } catch {
    return { kind: "invalid" }
  }
}

export function isFrozenAgentProfileToolAllowed(
  authority: AgentProfileRuntimeAuthority,
  toolName: string,
): boolean {
  if (authority.allowedTools.includes(toolName)) return true
  const productPrefix = `mcp__${FLAPSTACK_MCP_SERVER_NAME}__`
  return (
    toolName.startsWith(productPrefix) &&
    authority.allowedTools.includes(toolName.slice(productPrefix.length))
  )
}

export function verifyFrozenAgentProfileRuntimeAuthority(
  database: Database.Database | object,
  authority: AgentProfileRuntimeAuthority,
): boolean {
  const db =
    "prepare" in database && typeof database.prepare === "function"
      ? (database as Database.Database)
      : (database as { $client: Database.Database }).$client
  const snapshot = db
    .prepare("SELECT id snapshot_id, resolved_json FROM agent_profile_snapshots WHERE id = ?")
    .get(authority.snapshotId) as Row | undefined
  if (!snapshot) return false
  const resolved = authorityFromSnapshotRow(snapshot)
  return (
    resolved.kind === "authority" && canonicalJson(resolved.authority) === canonicalJson(authority)
  )
}

function authorityFromSnapshotRow(row: Row): DurableAgentProfileRuntimeAuthority {
  try {
    if (typeof row.snapshot_id !== "string" || typeof row.resolved_json !== "string") {
      return { kind: "invalid" }
    }
    const snapshot = JSON.parse(row.resolved_json) as Record<string, unknown>
    const capability = agentCapabilityProfileSchema.parse(snapshot.capability)
    const authority = agentProfileRuntimeAuthoritySchema.parse({
      snapshotId: row.snapshot_id,
      snapshotDigest: snapshot.digest,
      profile: snapshot.profile,
      allowedTools: capability.tools,
      allowedSkills: capability.skills,
      memoryPolicy: capability.memoryPolicy,
      allowedDescendantProfileIds: capability.allowedDescendantProfileIds,
      maxDescendants: capability.maxDescendants,
    })
    return { kind: "authority", authority }
  } catch {
    return { kind: "invalid" }
  }
}
