import Database from "better-sqlite3"
import {
  AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES,
  agentProfileLaunchPolicySchema,
  agentProfilePermissionModeSchema,
  agentProfileWorkflowBindingSchema,
  agentProfileWorkflowTemplateReferenceSchema,
  type AgentProfileLaunchPolicy,
  type AgentProfileVersionRef,
} from "../../../shared/agent-profiles"
import {
  orchestrationAgentDefinitionSchema,
  type OrchestrationAgentDefinition,
} from "../../../shared/agent-orchestration"
import { orchestrationTemplateDefinitionSchema } from "../../../shared/orchestration-operations"
import { parseCustomPermissionCapabilities } from "../../../shared/permission-capabilities"
import { AgentProfileResolver, agentProfileSnapshotPolicyViolations } from "./resolver"
import { assertAgentProfileSecretFree } from "./service"
import { canonicalJson, epochSeconds as epoch } from "./values"
import type { WorkflowAgentMaterializerPort } from "../agent-orchestration/worker-materializer-port"

type DatabaseLike = Database.Database | object
type Row = Record<string, unknown>

/**
 * F12-owned side of the missing F3 pre-durable-worker materialization hook.
 * F3 must call this before it creates chats, sub-chats, orchestration agents,
 * or Runtime runs for the checkpoint. F11 reserve/launch is intentionally later.
 */
export type AgentProfileWorkflowMaterializeRequest = {
  workflowRunId: string
  taskId: string
  stepId: string
  attemptCount: number
  agentDefinition: OrchestrationAgentDefinition
}

export type AgentProfileWorkflowMaterializeResult =
  | {
      kind: "unbound"
      agentDefinition: OrchestrationAgentDefinition
      profileSnapshotId: null
      bindingVersion: null
    }
  | {
      kind: "bound"
      agentDefinition: OrchestrationAgentDefinition
      profileSnapshotId: string
      bindingVersion: number
    }

export interface AgentProfileWorkflowMaterializerPort {
  materialize(
    request: AgentProfileWorkflowMaterializeRequest,
  ): Promise<AgentProfileWorkflowMaterializeResult>
}

export class AgentProfileWorkflowBindingError extends Error {
  constructor(
    readonly code:
      | "workflow-missing"
      | "step-missing"
      | "binding-conflict"
      | "snapshot-conflict"
      | "profile-missing"
      | "profile-archived"
      | "launch-blocked"
      | "binding-unconfirmed"
      | "f3-contract-conflict",
    message: string,
  ) {
    super(message)
    this.name = "AgentProfileWorkflowBindingError"
  }
}

export class AgentProfileWorkflowBindingService {
  private readonly sqlite: Database.Database

  constructor(database: DatabaseLike) {
    this.sqlite = rawClient(database)
  }

  bind(inputValue: unknown, expectedVersion: number) {
    const binding = agentProfileWorkflowBindingSchema.parse(inputValue)
    assertAgentProfileSecretFree(binding)
    this.requireWorkflowStep(binding.workflowRunId, binding.stepId)
    const now = epoch()
    return this.sqlite
      .transaction(() => {
        const current = this.sqlite
          .prepare(
            `SELECT version, snapshot_id FROM agent_profile_workflow_bindings
             WHERE workflow_run_id = ? AND step_id = ?`,
          )
          .get(binding.workflowRunId, binding.stepId) as Row | undefined
        if (current?.snapshot_id) {
          throw new AgentProfileWorkflowBindingError(
            "snapshot-conflict",
            "A launched workflow step keeps its immutable Agent Profile snapshot. Fork or retry in a new workflow run.",
          )
        }
        this.requireActiveProfile(binding.profile)
        if (!current) {
          if (expectedVersion !== 0) throw versionConflict()
          this.sqlite
            .prepare(
              `INSERT INTO agent_profile_workflow_bindings
               (workflow_run_id, step_id, profile_id, profile_version, binding_json,
                snapshot_id, version, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)`,
            )
            .run(
              binding.workflowRunId,
              binding.stepId,
              binding.profile.profileId,
              binding.profile.version,
              JSON.stringify(binding),
              now,
              now,
            )
        } else {
          if (Number(current.version) !== expectedVersion) throw versionConflict()
          const result = this.sqlite
            .prepare(
              `UPDATE agent_profile_workflow_bindings SET
                 profile_id = ?, profile_version = ?, binding_json = ?,
                 version = version + 1, updated_at = ?
               WHERE workflow_run_id = ? AND step_id = ? AND version = ? AND snapshot_id IS NULL`,
            )
            .run(
              binding.profile.profileId,
              binding.profile.version,
              JSON.stringify(binding),
              now,
              binding.workflowRunId,
              binding.stepId,
              expectedVersion,
            )
          if (result.changes !== 1) throw versionConflict()
        }
        return this.get(binding.workflowRunId, binding.stepId)
      })
      .immediate()
  }

  preview(workflowRunId: string, stepId: string, policy: AgentProfileLaunchPolicy) {
    const binding = this.get(workflowRunId, stepId)
    return new AgentProfileResolver(this.sqlite).preview(
      { profile: binding.binding.profile, overrides: binding.binding.overrides, policy },
      "workflow",
    )
  }

  previewForConfirmation(workflowRunId: string, stepId: string) {
    return this.preview(workflowRunId, stepId, this.requireCurrentLaunchPolicy(workflowRunId))
  }

  confirm(workflowRunId: string, stepId: string, expectedVersion: number) {
    return this.sqlite
      .transaction(() => {
        const workflowStep = this.requireWorkflowStep(workflowRunId, stepId)
        const current = this.get(workflowRunId, stepId)
        if (current.version !== expectedVersion) throw versionConflict()
        if (current.snapshotId) {
          throw new AgentProfileWorkflowBindingError(
            "snapshot-conflict",
            "Workflow Agent Profile confirmation is immutable. Fork a new workflow run to change it.",
          )
        }
        this.requireActiveProfile(current.binding.profile)
        const policy = this.requireCurrentLaunchPolicy(workflowRunId)
        const snapshot = new AgentProfileResolver(this.sqlite).snapshot(
          current.binding.profile,
          current.binding.overrides,
          policy,
          "workflow",
        )
        const hardConflicts = snapshot.conflicts.filter((conflict) =>
          AGENT_PROFILE_LAUNCH_BLOCKING_CONFLICT_CODES.some((code) => code === conflict.code),
        )
        if (hardConflicts.length) {
          throw new AgentProfileWorkflowBindingError(
            "launch-blocked",
            hardConflicts.map((conflict) => conflict.message).join(" "),
          )
        }
        const result = this.sqlite
          .prepare(
            `UPDATE agent_profile_workflow_bindings SET
               snapshot_id = ?, version = version + 1, updated_at = ?
             WHERE workflow_run_id = ? AND step_id = ? AND version = ? AND snapshot_id IS NULL`,
          )
          .run(snapshot.snapshotId, epoch(), workflowRunId, stepId, expectedVersion)
        if (result.changes !== 1) throw versionConflict()
        return {
          snapshot,
          definition: this.definitionFromSnapshot(workflowStep, current.binding, snapshot),
          bindingVersion: expectedVersion + 1,
        }
      })
      .immediate()
  }

  /**
   * Materializes the exact definition F3 must persist for a workflow worker.
   * An absent binding is an explicit pass-through. A present but invalid binding
   * throws; it never falls back to the embedded F3 definition.
   */
  materializeForF3(
    request: AgentProfileWorkflowMaterializeRequest,
  ): AgentProfileWorkflowMaterializeResult {
    if (!Number.isInteger(request.attemptCount) || request.attemptCount < 1) {
      throw f3ContractConflict("F3 workflow checkpoint attemptCount must be a positive integer.")
    }
    const workflowStep = this.requireWorkflowStep(request.workflowRunId, request.stepId)
    if (workflowStep.taskId !== request.taskId) {
      throw f3ContractConflict("F3 workflow task identity does not match the durable workflow run.")
    }
    const embeddedDefinition = orchestrationAgentDefinitionSchema.parse(
      workflowStep.agentDefinition,
    )
    const requestedDefinition = orchestrationAgentDefinitionSchema.parse(request.agentDefinition)
    if (canonicalJson(embeddedDefinition) !== canonicalJson(requestedDefinition)) {
      throw f3ContractConflict(
        "F3 must materialize from the exact agent definition embedded in the durable workflow run.",
      )
    }
    const binding = this.sqlite
      .prepare(
        `SELECT snapshot_id FROM agent_profile_workflow_bindings
         WHERE workflow_run_id = ? AND step_id = ?`,
      )
      .get(request.workflowRunId, request.stepId) as { snapshot_id: string | null } | undefined
    if (!binding) {
      return {
        kind: "unbound",
        agentDefinition: requestedDefinition,
        profileSnapshotId: null,
        bindingVersion: null,
      }
    }
    if (!binding.snapshot_id) {
      throw new AgentProfileWorkflowBindingError(
        "binding-unconfirmed",
        "Workflow Agent Profile binding has no confirmed immutable launch snapshot.",
      )
    }
    const current = this.get(request.workflowRunId, request.stepId)
    const resolver = new AgentProfileResolver(this.sqlite)
    const snapshot = resolver.getSnapshot(binding.snapshot_id)
    this.assertSnapshotWithinCurrentPolicy(
      snapshot,
      this.requireCurrentLaunchPolicy(request.workflowRunId),
    )
    const definition = this.definitionFromSnapshot(workflowStep, current.binding, snapshot)
    assertStableF3Identity(requestedDefinition, definition)
    return {
      kind: "bound",
      agentDefinition: definition,
      profileSnapshotId: snapshot.snapshotId,
      bindingVersion: current.version,
    }
  }

  get(workflowRunId: string, stepId: string) {
    this.requireWorkflowStep(workflowRunId, stepId)
    const row = this.sqlite
      .prepare(
        `SELECT * FROM agent_profile_workflow_bindings
         WHERE workflow_run_id = ? AND step_id = ?`,
      )
      .get(workflowRunId, stepId) as Row | undefined
    if (!row) {
      throw new AgentProfileWorkflowBindingError(
        "step-missing",
        "Workflow step has no Agent Profile binding.",
      )
    }
    const binding = agentProfileWorkflowBindingSchema.parse(JSON.parse(String(row.binding_json)))
    return {
      binding,
      snapshotId: typeof row.snapshot_id === "string" ? row.snapshot_id : null,
      version: Number(row.version),
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
    }
  }

  list(workflowRunId: string) {
    const rows = this.sqlite
      .prepare(
        "SELECT step_id FROM agent_profile_workflow_bindings WHERE workflow_run_id = ? ORDER BY step_id",
      )
      .all(workflowRunId) as Array<{ step_id: string }>
    return rows.map((row) => this.get(workflowRunId, row.step_id))
  }

  fork(
    sourceWorkflowRunId: string,
    sourceStepId: string,
    targetWorkflowRunId: string,
    targetStepId: string,
    profile?: AgentProfileVersionRef,
  ) {
    const source = this.get(sourceWorkflowRunId, sourceStepId)
    return this.bind(
      {
        ...source.binding,
        workflowRunId: targetWorkflowRunId,
        stepId: targetStepId,
        profile: profile ?? source.binding.profile,
      },
      0,
    )
  }

  exportTemplateReference(workflowRunId: string, stepId: string) {
    const { binding } = this.get(workflowRunId, stepId)
    return JSON.stringify(
      agentProfileWorkflowTemplateReferenceSchema.parse({
        kind: "flapstack-agent-profile-workflow-binding",
        schemaVersion: 1,
        profile: binding.profile,
        workflowRole: binding.workflowRole,
        inputSchema: binding.inputSchema,
        outputSchema: binding.outputSchema,
        overrides: binding.overrides,
      }),
      null,
      2,
    )
  }

  importTemplateReference(
    bundle: string,
    workflowRunId: string,
    stepId: string,
    expectedVersion: number,
  ) {
    let reference: ReturnType<typeof agentProfileWorkflowTemplateReferenceSchema.parse>
    try {
      reference = agentProfileWorkflowTemplateReferenceSchema.parse(JSON.parse(bundle))
    } catch {
      throw new AgentProfileWorkflowBindingError(
        "binding-conflict",
        "Workflow Agent Profile template reference is malformed or unsupported.",
      )
    }
    return this.bind(
      {
        schemaVersion: reference.schemaVersion,
        workflowRunId,
        stepId,
        profile: reference.profile,
        workflowRole: reference.workflowRole,
        inputSchema: reference.inputSchema,
        outputSchema: reference.outputSchema,
        overrides: reference.overrides,
      },
      expectedVersion,
    )
  }

  private requireWorkflowStep(workflowRunId: string, stepId: string) {
    const row = this.sqlite
      .prepare("SELECT task_id, definition_json FROM orchestration_workflow_runs WHERE id = ?")
      .get(workflowRunId) as { task_id: string; definition_json: string } | undefined
    if (!row)
      throw new AgentProfileWorkflowBindingError("workflow-missing", "Workflow run is missing.")
    let definitionValue: unknown
    try {
      definitionValue = JSON.parse(row.definition_json)
    } catch {
      throw new AgentProfileWorkflowBindingError(
        "step-missing",
        "Workflow definition is malformed or unsupported.",
      )
    }
    const definition = orchestrationTemplateDefinitionSchema.safeParse(definitionValue)
    if (!definition.success) {
      throw new AgentProfileWorkflowBindingError(
        "step-missing",
        "Workflow definition is malformed or unsupported.",
      )
    }
    const step = definition.data.workflow.steps.find((candidate) => candidate.id === stepId)
    if (!step || !["agent", "synthesis"].includes(step.kind) || !step.agentDefinitionId) {
      throw new AgentProfileWorkflowBindingError("step-missing", "Workflow step is missing.")
    }
    const agentDefinition = definition.data.agents.find(
      (candidate) => candidate.definitionId === step.agentDefinitionId,
    )
    if (!agentDefinition) {
      throw new AgentProfileWorkflowBindingError(
        "step-missing",
        "Workflow step has no durable F3 agent definition.",
      )
    }
    return { taskId: row.task_id, step, agentDefinition }
  }

  private definitionFromSnapshot(
    workflowStep: ReturnType<AgentProfileWorkflowBindingService["requireWorkflowStep"]>,
    binding: ReturnType<typeof agentProfileWorkflowBindingSchema.parse>,
    snapshot: ReturnType<AgentProfileResolver["getSnapshot"]>,
  ) {
    return orchestrationAgentDefinitionSchema.parse({
      agentId: workflowStep.agentDefinition.agentId,
      definitionId: workflowStep.agentDefinition.definitionId,
      role: binding.workflowRole,
      name: snapshot.displayName,
      prompt: snapshot.capability.instructions,
      harness: snapshot.capability.harness,
      model: snapshot.capability.modelPreference ?? undefined,
      runtimePreference: snapshot.capability.runtimePreference,
      reasoningEffort: snapshot.capability.reasoningEffort ?? undefined,
      permissionMode: snapshot.capability.permissionMode,
      customPermissions: snapshot.capability.customPermissions ?? undefined,
      worktreeStrategy: snapshot.capability.worktreeStrategy,
      dependencyAgentIds: workflowStep.agentDefinition.dependencyAgentIds,
      completionCriteria: binding.outputSchema
        ? "Return output matching the bound JSON schema."
        : "Complete the bound workflow role and report a concrete result.",
    })
  }

  private requireCurrentLaunchPolicy(workflowRunId: string): AgentProfileLaunchPolicy {
    const row = this.sqlite
      .prepare(
        `SELECT t.default_permission_mode, t.default_custom_permissions, o.max_depth, t.project_id
         FROM orchestration_workflow_runs wr
         JOIN tasks t ON t.id = wr.task_id
         JOIN task_orchestrations o ON o.task_id = wr.task_id
         WHERE wr.id = ?`,
      )
      .get(workflowRunId) as
      | {
          default_permission_mode: string
          default_custom_permissions: string | null
          max_depth: number
          project_id: string
        }
      | undefined
    if (!row) {
      throw new AgentProfileWorkflowBindingError(
        "launch-blocked",
        "Workflow task or orchestration launch policy is missing.",
      )
    }
    const permissionMode = agentProfilePermissionModeSchema.safeParse(row.default_permission_mode)
    if (!permissionMode.success) {
      throw new AgentProfileWorkflowBindingError(
        "launch-blocked",
        "Workflow task permission policy is invalid.",
      )
    }
    let customPermissions = null
    if (permissionMode.data === "custom") {
      try {
        customPermissions = parseCustomPermissionCapabilities(
          JSON.parse(row.default_custom_permissions ?? "null"),
        )
      } catch {
        customPermissions = null
      }
      if (!customPermissions) {
        throw new AgentProfileWorkflowBindingError(
          "launch-blocked",
          "Workflow custom permission policy is missing or invalid.",
        )
      }
    }
    const runtimeRows = this.sqlite
      .prepare(
        `SELECT DISTINCT d.preference FROM agent_runtime_defaults d
         WHERE d.preference <> 'auto' AND (
           (d.scope_type = 'project' AND d.scope_id = ?) OR
           (d.scope_type = 'global' AND NOT EXISTS (
             SELECT 1 FROM agent_runtime_defaults p
             WHERE p.scope_type = 'project' AND p.scope_id = ? AND p.harness = d.harness
           ))
         )`,
      )
      .all(row.project_id, row.project_id) as Array<{ preference: string }>
    const parsed = agentProfileLaunchPolicySchema.safeParse({
      permissionMode: permissionMode.data,
      customPermissions,
      allowedTools: null,
      allowedSkills: null,
      allowedModels: null,
      allowedRuntimes: runtimeRows.length ? runtimeRows.map((runtime) => runtime.preference) : null,
      maxDescendants: row.max_depth,
    })
    if (!parsed.success) {
      throw new AgentProfileWorkflowBindingError(
        "launch-blocked",
        "Workflow orchestration launch policy is invalid.",
      )
    }
    return parsed.data
  }

  private assertSnapshotWithinCurrentPolicy(
    snapshot: ReturnType<AgentProfileResolver["getSnapshot"]>,
    policy: AgentProfileLaunchPolicy,
  ) {
    if (agentProfileSnapshotPolicyViolations(snapshot, policy).length > 0) {
      throw new AgentProfileWorkflowBindingError(
        "binding-unconfirmed",
        "Confirmed workflow snapshot exceeds the current launch-policy ceiling. Fork and confirm a new binding.",
      )
    }
  }

  private requireActiveProfile(profile: AgentProfileVersionRef) {
    const row = this.sqlite
      .prepare(
        `SELECT p.archived_at FROM agent_profiles p
         JOIN agent_profile_versions v ON v.profile_id = p.id
         WHERE p.id = ? AND v.version = ?`,
      )
      .get(profile.profileId, profile.version) as { archived_at: number | null } | undefined
    if (!row) {
      throw new AgentProfileWorkflowBindingError(
        "profile-missing",
        "Workflow Agent Profile version is missing. Choose an available exact version.",
      )
    }
    if (row.archived_at !== null) {
      throw new AgentProfileWorkflowBindingError(
        "profile-archived",
        "Workflow Agent Profile is archived. Restore it or choose a replacement.",
      )
    }
  }
}

export function createAgentProfileWorkflowMaterializerPort(
  database: DatabaseLike,
): AgentProfileWorkflowMaterializerPort {
  const service = new AgentProfileWorkflowBindingService(database)
  return {
    async materialize(request) {
      return service.materializeForF3(request)
    },
  }
}

export function createLazyAgentProfileWorkflowMaterializerPort(
  database: () => DatabaseLike,
): WorkflowAgentMaterializerPort {
  return {
    async materialize(request) {
      const result =
        await createAgentProfileWorkflowMaterializerPort(database()).materialize(request)
      return {
        agentDefinition: result.agentDefinition,
        ...(result.profileSnapshotId ? { profileSnapshotId: result.profileSnapshotId } : {}),
        ...(result.bindingVersion !== null ? { bindingVersion: result.bindingVersion } : {}),
      }
    },
  }
}

function assertStableF3Identity(
  embedded: OrchestrationAgentDefinition,
  materialized: OrchestrationAgentDefinition,
) {
  if (
    embedded.agentId !== materialized.agentId ||
    embedded.definitionId !== materialized.definitionId ||
    canonicalJson(embedded.dependencyAgentIds) !== canonicalJson(materialized.dependencyAgentIds)
  ) {
    throw f3ContractConflict(
      "Agent Profile materialization cannot change F3 agent, definition, or dependency identity.",
    )
  }
}

function f3ContractConflict(message: string) {
  return new AgentProfileWorkflowBindingError("f3-contract-conflict", message)
}

function versionConflict() {
  return new AgentProfileWorkflowBindingError(
    "binding-conflict",
    "Workflow Profile binding version conflict.",
  )
}

function rawClient(database: DatabaseLike): Database.Database {
  if ("prepare" in database && typeof database.prepare === "function") {
    return database as Database.Database
  }
  return (database as unknown as { $client: Database.Database }).$client
}

function timestamp(value: unknown) {
  const numeric = Number(value)
  return numeric < 10_000_000_000 ? numeric * 1_000 : numeric
}
