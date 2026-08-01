import { z } from "zod"
import { randomUUID } from "node:crypto"
import { McpApprovalLifecycle } from "./approval-lifecycle"
import type { AppendMcpAuditRecord, McpAuditStatus, McpDispatchBlock } from "./audit-storage"
import { evaluateMcpToolGate } from "./gate"
import { createMcpReadService, type McpReadService } from "./read-service"
import { evaluateMcpGateWithSelfReference } from "./self-reference"
import { mcpProjectVaultToolNames, type McpProjectVaultService } from "./project-vault-service"
import { mcpAutomationToolNames, type McpAutomationService } from "./automation-service"
import { mcpTaskProposalToolNames, type McpTaskProposalService } from "./task-proposal-service"
import type {
  McpCallerIdentity,
  McpControlResponse,
  McpControlTool,
  McpMutationService,
} from "./types"
import {
  getBetaFeatureSettings,
  isMcpInvocationBetaEnabled,
  isMcpToolBetaEnabled,
} from "../beta-features/settings"
import { isFrozenAgentProfileToolAllowed } from "../agent-profiles/runtime-authority"

export type McpInvocationDependencies = {
  /** Resolves immutable launch identity against durable state on every check. */
  resolveCaller?: (caller: McpCallerIdentity) => McpCallerIdentity
  /** Resolves the selected target from durable state. Return null when it went stale. */
  resolveTarget?: (input: {
    tool: McpControlTool
    caller: McpCallerIdentity
    rawInput: unknown
  }) => unknown | null
  approvals?: McpApprovalLifecycle
  approvalId?: () => string
  /** Stable ID joining all append-only audit events for one tool call. */
  invocationId?: () => string
  audit?: McpAuditWriter
  mutations?: McpMutationService
  projectVaults?: McpProjectVaultService
  automationControls?: McpAutomationService
  taskProposalControls?: McpTaskProposalService
  /** Single post-gate dispatch hook for future mutation handlers. */
  execute?: (input: {
    tool: McpControlTool
    caller: McpCallerIdentity
    rawInput: unknown
  }) => McpControlResponse | Promise<McpControlResponse>
}

export type McpAuditWriter = {
  append: (record: AppendMcpAuditRecord) => void
  findUnresolvedDispatch?: (input: {
    invocationId: string
    caller: Pick<McpCallerIdentity, "chatId" | "runId">
    toolName: string
    input: unknown
  }) => McpDispatchBlock | null
}

export const mcpControlTools: McpControlTool[] = [
  {
    name: "ping",
    description: "Check Flapstack app-control server health.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "describe",
    description: "List app-control tool capabilities and risk tiers.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "list_projects",
    description: "List caller-visible projects.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "list_tasks",
    description: "List tasks in a project or globally.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "list_orchestrations",
    description: "List the caller-visible orchestration fleet without scheduling work.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "list_chats",
    description: "List caller-visible chats.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "list_runs",
    description: "List caller-visible agent runs.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "list_worktrees",
    description: "List caller-visible worktrees.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "list_artifacts",
    description: "List caller-visible attachment and run artifacts.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "search",
    description: "Search caller-visible object metadata.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "list_vault_sections",
    description: "List typed knowledge sections in a caller-visible project vault.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "read_vault_section",
    description: "Read one exact caller-visible project vault section.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "list_vault_nodes",
    description: "List one exact generation of caller-visible project vault graph nodes.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "read_vault_node",
    description: "Read one exact custom project vault node by stable identity and generation.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "preview_vault_context",
    description: "Preview bounded exact project vault graph context provenance without content.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "create_vault_section",
    description: "Create one approved typed project vault section from expected version zero.",
    tier: 2,
    requiredCapabilities: ["projectWrite"],
    status: "implemented",
  },
  {
    name: "update_vault_section",
    description: "Replace one exact project vault section using its current version.",
    tier: 2,
    requiredCapabilities: ["projectWrite"],
    status: "implemented",
  },
  {
    name: "update_vault_handoff",
    description: "Replace the bounded handoff section using its current version.",
    tier: 2,
    requiredCapabilities: ["projectWrite"],
    status: "implemented",
  },
  {
    name: "record_vault_decision",
    description: "Append one bounded decision entry using the decision section's current version.",
    tier: 2,
    requiredCapabilities: ["projectWrite"],
    status: "implemented",
  },
  {
    name: "create_vault_node",
    description: "Create one bounded custom Markdown node in the caller-visible project vault.",
    tier: 2,
    requiredCapabilities: ["projectWrite"],
    status: "implemented",
  },
  {
    name: "update_vault_node",
    description: "Update one custom vault node with exact generation, version, and hash CAS.",
    tier: 2,
    requiredCapabilities: ["projectWrite"],
    status: "implemented",
  },
  {
    name: "move_vault_node",
    description: "Move one custom vault node while preserving its stable identity.",
    tier: 2,
    requiredCapabilities: ["projectWrite"],
    status: "implemented",
  },
  {
    name: "link_vault_nodes",
    description: "Add one explicit Wikilink between exact caller-visible vault nodes.",
    tier: 2,
    requiredCapabilities: ["projectWrite"],
    status: "implemented",
  },
  {
    name: "create_chat",
    description: "Create a new chat.",
    tier: 1,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "spawn_thread",
    description: "Create and optionally launch a thread for another supported harness.",
    tier: 3,
    requiredCapabilities: ["subagents", "shell"],
    status: "implemented",
  },
  {
    name: "orchestrate_task",
    description: "Create or attach a task and launch a bounded, durable multi-agent orchestration.",
    tier: 3,
    requiredCapabilities: ["subagents", "shell"],
    status: "implemented",
  },
  {
    name: "create_task",
    description: "Create a new task.",
    tier: 1,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "rename_item",
    description: "Rename a project, task, or chat.",
    tier: 2,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "archive_item",
    description: "Archive a project, task, or chat.",
    tier: 2,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "move_chat",
    description: "Move a chat within caller scope.",
    tier: 2,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "pin_item",
    description: "Pin or unpin an app item.",
    tier: 1,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "restore_item",
    description: "Restore an archived app item.",
    tier: 2,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "add_attachment",
    description: "Add a text attachment to a chat.",
    tier: 1,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "request_visual_capture",
    description:
      "Request one approval-gated visual capture; the user must still choose the exact visible source and confirm its derivative.",
    tier: 3,
    requiredCapabilities: ["productMcpTier3"],
    status: "implemented",
  },
  {
    name: "read_visual_context",
    description: "Read one exact visual artifact already selected for the caller's chat or run.",
    tier: 2,
    requiredCapabilities: ["productMcpRead"],
    status: "implemented",
  },
  {
    name: "write_attachment_to_worktree",
    description: "Write an attachment into a worktree.",
    tier: 3,
    requiredCapabilities: ["projectWrite"],
    status: "implemented",
  },
  {
    name: "launch_run",
    description: "Launch a new agent run.",
    tier: 3,
    requiredCapabilities: ["subagents", "shell"],
    status: "implemented",
  },
  {
    name: "list_automations",
    description: "List caller-visible local automations.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "read_automation",
    description: "Read one caller-visible local automation and its exact version.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "create_automation_draft",
    description: "Create an idempotent, non-runnable local automation draft.",
    tier: 1,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "update_automation",
    description: "Update an exact automation version after user approval.",
    tier: 3,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "enable_automation",
    description: "Enable or disable an exact automation version after user approval.",
    tier: 3,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "propose_task",
    description: "Create one bounded, inert AI task proposal for later user review.",
    tier: 1,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "list_task_proposals",
    description: "List task proposals owned by this caller within its durable scope.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "read_task_proposal",
    description: "Read one exact task proposal owned by this caller.",
    tier: 0,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "update_task_proposal",
    description: "Update one pending task proposal using its exact version.",
    tier: 1,
    requiredCapabilities: [],
    status: "implemented",
  },
  {
    name: "cancel_task_proposal",
    description: "Terminally cancel and archive one pending task proposal.",
    tier: 1,
    requiredCapabilities: [],
    status: "implemented",
  },
]

export function getMcpControlTool(name: string): McpControlTool | null {
  return mcpControlTools.find((tool) => tool.name === name) ?? null
}

export function listImplementedMcpControlTools(
  options: { includeDisabledBeta?: boolean } = {},
): McpControlTool[] {
  const betaFeatures = getBetaFeatureSettings()
  return mcpControlTools.filter(
    (tool) =>
      tool.status === "implemented" &&
      (options.includeDisabledBeta || isMcpToolBetaEnabled(tool.name, betaFeatures)),
  )
}

export async function invokeMcpControlTool(
  name: string,
  caller: McpCallerIdentity,
  input: unknown = {},
  readService?: McpReadService,
  dependencies: McpInvocationDependencies = {},
): Promise<McpControlResponse> {
  const invocationId = dependencies.invocationId?.() ?? randomUUID()
  const startedAt = Date.now()
  const tool = getMcpControlTool(name)
  if (!tool) {
    const response = {
      ok: false as const,
      error: { code: "tool-not-found" as const, message: `Unknown tool: ${name}` },
    }
    audit(dependencies, {
      invocationId,
      startedAt,
      status: "denied",
      caller,
      toolName: name,
      tier: 0,
      input,
      result: response,
    })
    return response
  }
  if (tool.status !== "implemented") {
    const response: McpControlResponse = {
      ok: false,
      error: { code: "tool-unavailable", message: `${name} is not available in this build.` },
    }
    audit(dependencies, {
      invocationId,
      startedAt,
      status: "denied",
      caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: response,
    })
    return response
  }
  if (!isMcpInvocationBetaEnabled(tool.name, input)) {
    const response: McpControlResponse = {
      ok: false,
      error: {
        code: "tool-unavailable",
        message: `${name} is disabled. Enable its service in Settings > Beta Features.`,
      },
    }
    audit(dependencies, {
      invocationId,
      startedAt,
      status: "denied",
      caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: response,
    })
    return response
  }

  const trustedCaller = resolveCaller(caller, dependencies)
  if (!trustedCaller.ok) {
    audit(dependencies, {
      invocationId,
      startedAt,
      status: "stale",
      caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: trustedCaller.response,
    })
    return trustedCaller.response
  }

  const initialGate = applySelfReference(
    tool,
    trustedCaller.caller,
    input,
    evaluateMcpToolGate({ tool, caller: trustedCaller.caller }),
  )
  if (initialGate.decision === "denied") {
    const response = denied(initialGate.reason)
    audit(dependencies, {
      invocationId,
      startedAt,
      status: "denied",
      caller: trustedCaller.caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: response,
    })
    return response
  }

  if (initialGate.decision === "approval-required") {
    const approvals = dependencies.approvals
    if (!approvals) {
      const response = denied("Approval lifecycle is unavailable.")
      audit(dependencies, {
        invocationId,
        startedAt,
        status: "denied",
        caller: trustedCaller.caller,
        toolName: tool.name,
        tier: tool.tier,
        input,
        result: response,
      })
      return response
    }
    audit(dependencies, {
      invocationId,
      startedAt,
      status: "approval-required",
      caller: trustedCaller.caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: { decision: initialGate.decision, reason: initialGate.reason },
    })
    const wait = approvals.request({
      id: dependencies.approvalId?.() ?? invocationId,
      invocationId,
      caller: trustedCaller.caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
    })
    const decision = await wait.decision
    const approvalError = approvalDecisionError(decision.state)
    if (approvalError) {
      audit(dependencies, {
        invocationId,
        startedAt,
        status: auditStatusForApproval(decision.state),
        caller: trustedCaller.caller,
        toolName: tool.name,
        tier: tool.tier,
        input,
        result: { decision, response: approvalError },
      })
      return approvalError
    }
    // Approval never authorizes an old snapshot. Both caller and selected
    // target are resolved again immediately before any handler can run.
    const recheckedCaller = resolveCaller(caller, dependencies)
    if (!recheckedCaller.ok) {
      audit(dependencies, {
        invocationId,
        startedAt,
        status: "stale",
        caller: trustedCaller.caller,
        toolName: tool.name,
        tier: tool.tier,
        input,
        result: recheckedCaller.response,
      })
      return recheckedCaller.response
    }
    const finalGate = applySelfReference(
      tool,
      recheckedCaller.caller,
      input,
      evaluateMcpToolGate({ tool, caller: recheckedCaller.caller, approved: true }),
    )
    if (finalGate.decision !== "allowed") {
      const response = denied(finalGate.reason)
      audit(dependencies, {
        invocationId,
        startedAt,
        status: "denied",
        caller: recheckedCaller.caller,
        toolName: tool.name,
        tier: tool.tier,
        input,
        result: response,
      })
      return response
    }
    const target = resolveTarget(tool, recheckedCaller.caller, input, dependencies)
    if (!target.ok) {
      audit(dependencies, {
        invocationId,
        startedAt,
        status: "stale",
        caller: recheckedCaller.caller,
        toolName: tool.name,
        tier: tool.tier,
        input,
        result: target.response,
      })
      return target.response
    }
    const unresolved = unresolvedDispatch(
      dependencies,
      invocationId,
      recheckedCaller.caller,
      tool,
      input,
    )
    if (unresolved.failed) return auditStorageUnavailable(false)
    if (unresolved.block) return reconciliationRequired(unresolved.block)
    const allowedAuditPersisted = audit(dependencies, {
      invocationId,
      startedAt,
      status: "allowed",
      caller: recheckedCaller.caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: { decision },
    })
    if (!allowedAuditPersisted) return auditStorageUnavailable(false)
    const approvalAuditPersisted = audit(dependencies, {
      invocationId,
      startedAt,
      status: "dispatch-started",
      caller: recheckedCaller.caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: { decision },
    })
    if (!approvalAuditPersisted) return auditStorageUnavailable(false)
    return auditedDispatch(
      tool,
      recheckedCaller.caller,
      input,
      readService,
      dependencies,
      invocationId,
      startedAt,
      true,
    )
  }

  const target = resolveTarget(tool, trustedCaller.caller, input, dependencies)
  if (!target.ok) {
    audit(dependencies, {
      invocationId,
      startedAt,
      status: "stale",
      caller: trustedCaller.caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: target.response,
    })
    return target.response
  }
  const unresolved = unresolvedDispatch(
    dependencies,
    invocationId,
    trustedCaller.caller,
    tool,
    input,
  )
  if (unresolved.failed) return auditStorageUnavailable(false)
  if (unresolved.block) return reconciliationRequired(unresolved.block)
  const allowedAuditPersisted = audit(dependencies, {
    invocationId,
    startedAt,
    status: "allowed",
    caller: trustedCaller.caller,
    toolName: tool.name,
    tier: tool.tier,
    input,
    result: { decision: initialGate.decision, reason: initialGate.reason },
  })
  if (!allowedAuditPersisted) return auditStorageUnavailable(false)
  const preExecutionAuditPersisted = audit(dependencies, {
    invocationId,
    startedAt,
    status: "dispatch-started",
    caller: trustedCaller.caller,
    toolName: tool.name,
    tier: tool.tier,
    input,
    result: { decision: initialGate.decision, reason: initialGate.reason },
  })
  if (!preExecutionAuditPersisted) return auditStorageUnavailable(false)
  return auditedDispatch(
    tool,
    trustedCaller.caller,
    input,
    readService,
    dependencies,
    invocationId,
    startedAt,
    tool.tier === 3 && trustedCaller.caller.permissionMode === "full-access",
  )
}

async function auditedDispatch(
  tool: McpControlTool,
  caller: McpCallerIdentity,
  input: unknown,
  readService: McpReadService | undefined,
  dependencies: McpInvocationDependencies,
  invocationId: string,
  startedAt: number,
  approved: boolean,
): Promise<McpControlResponse> {
  try {
    const response = await dispatch(tool, caller, input, readService, dependencies, {
      invocationId,
      approved,
    })
    const terminalAuditPersisted = audit(dependencies, {
      invocationId,
      startedAt,
      status: response.ok ? "completed" : "failed",
      caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: response,
    })
    if (!terminalAuditPersisted) return reconciliationRequired(invocationId)
    return response
  } catch (error) {
    const response: McpControlResponse = {
      ok: false,
      error: { code: "internal-error", message: "Tool execution failed." },
    }
    const failureAuditPersisted = audit(dependencies, {
      invocationId,
      startedAt,
      status: "failed",
      caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: { response, error: error instanceof Error ? error.message : String(error) },
    })
    if (!failureAuditPersisted) return reconciliationRequired(invocationId)
    return response
  }
}

function audit(
  dependencies: McpInvocationDependencies,
  event: Omit<AppendMcpAuditRecord, "durationMs"> & { startedAt: number },
): boolean {
  try {
    dependencies.audit?.append({ ...event, durationMs: Date.now() - event.startedAt })
    return dependencies.audit !== undefined
  } catch {
    // Audit storage is append-only and must not turn an already safe denial into execution.
    return false
  }
}

function auditStorageUnavailable(afterDispatch: boolean): McpControlResponse {
  return {
    ok: false,
    error: {
      code: "internal-error",
      message: afterDispatch
        ? "Tool execution reached a terminal state, but its completion audit could not be persisted. Reconciliation is required."
        : "Tool blocked because its mandatory pre-execution audit could not be persisted.",
    },
  }
}

function unresolvedDispatch(
  dependencies: McpInvocationDependencies,
  invocationId: string,
  caller: McpCallerIdentity,
  tool: McpControlTool,
  input: unknown,
): { failed: boolean; block: McpDispatchBlock | null } {
  try {
    return {
      failed: false,
      block:
        dependencies.audit?.findUnresolvedDispatch?.({
          invocationId,
          caller,
          toolName: tool.name,
          input,
        }) ?? null,
    }
  } catch {
    return { failed: true, block: null }
  }
}

function reconciliationRequired(block: McpDispatchBlock | string): McpControlResponse {
  const invocationId = typeof block === "string" ? block : block.invocationId
  const state = typeof block === "string" ? "dispatch-started" : block.state
  return {
    ok: false,
    error: {
      code: "reconciliation-required",
      message: `Execution may have completed, but terminal audit persistence failed. Reconcile invocation ${invocationId} (${state}) before retrying.`,
    },
  }
}

function auditStatusForApproval(
  state: "approved" | "denied" | "timed-out" | "cancelled" | "shutdown",
): McpAuditStatus {
  if (state === "denied" || state === "cancelled" || state === "shutdown") return "denied"
  return "timed-out"
}

function dispatch(
  tool: McpControlTool,
  caller: McpCallerIdentity,
  input: unknown,
  readService: McpReadService | undefined,
  dependencies: McpInvocationDependencies,
  context: { invocationId: string; approved: boolean },
): McpControlResponse | Promise<McpControlResponse> {
  return (
    dependencies.execute?.({ tool, caller, rawInput: input }) ??
    executeImplementedTool(
      tool.name,
      caller,
      input,
      readService,
      dependencies.mutations,
      dependencies.projectVaults,
      dependencies.automationControls,
      dependencies.taskProposalControls,
      context,
    )
  )
}

function executeImplementedTool(
  name: string,
  caller: McpCallerIdentity,
  input: unknown,
  readService?: McpReadService,
  mutations?: McpMutationService,
  projectVaults?: McpProjectVaultService,
  automationControls?: McpAutomationService,
  taskProposalControls?: McpTaskProposalService,
  context: { invocationId: string; approved: boolean } = {
    invocationId: "untracked",
    approved: false,
  },
): McpControlResponse | Promise<McpControlResponse> {
  if (name === "ping") {
    return { ok: true, data: { status: "ok", caller: snapshotCaller(caller) } }
  }
  if (name === "describe") {
    return {
      ok: true,
      data: {
        transport: "stdio",
        caller: snapshotCaller(caller),
        tools: listImplementedMcpControlTools().filter(
          (tool) =>
            !caller.profileRuntimeAuthority ||
            isFrozenAgentProfileToolAllowed(caller.profileRuntimeAuthority, tool.name),
        ),
      },
    }
  }

  if (mcpProjectVaultToolNames.has(name)) {
    return projectVaults
      ? projectVaults.invoke(name, caller, input)
      : {
          ok: false,
          error: { code: "tool-unavailable", message: "Project vault service is unavailable." },
        }
  }

  if (mcpAutomationToolNames.has(name)) {
    return automationControls
      ? automationControls.invoke(name, caller, input, context)
      : {
          ok: false,
          error: { code: "tool-unavailable", message: "Automation control is unavailable." },
        }
  }

  if (mcpTaskProposalToolNames.has(name)) {
    return taskProposalControls
      ? taskProposalControls.invoke(name, caller, input)
      : {
          ok: false,
          error: { code: "tool-unavailable", message: "Task proposals are unavailable." },
        }
  }

  if (mcpControlTools.some((tool) => tool.name === name && tool.tier > 0)) {
    return mutations
      ? mutations.invoke(name, caller, input, context)
      : {
          ok: false,
          error: { code: "tool-unavailable", message: "Mutation service is unavailable." },
        }
  }

  try {
    return { ok: true, data: (readService ?? createMcpReadService()).invoke(name, caller, input) }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        error: { code: "invalid-input", message: error.issues[0]?.message ?? "Invalid input." },
      }
    }
    if (error instanceof Error && error.name === "McpReadError") {
      const [code, message] = error.message.split(":", 2)
      return {
        ok: false,
        error: {
          code: code as "invalid-input" | "out-of-scope" | "not-found",
          message: message ?? "Read failed.",
        },
      }
    }
    return { ok: false, error: { code: "internal-error", message: "Read operation failed." } }
  }
}

function resolveCaller(
  caller: McpCallerIdentity,
  dependencies: McpInvocationDependencies,
): { ok: true; caller: McpCallerIdentity } | { ok: false; response: McpControlResponse } {
  try {
    return { ok: true, caller: dependencies.resolveCaller?.(caller) ?? caller }
  } catch {
    return {
      ok: false,
      response: {
        ok: false,
        error: {
          code: "stale-caller",
          message: "Caller is missing, inactive, or no longer authorized.",
        },
      },
    }
  }
}

function resolveTarget(
  tool: McpControlTool,
  caller: McpCallerIdentity,
  rawInput: unknown,
  dependencies: McpInvocationDependencies,
): { ok: true } | { ok: false; response: McpControlResponse } {
  try {
    if (dependencies.resolveTarget?.({ tool, caller, rawInput }) === null) {
      return {
        ok: false,
        response: {
          ok: false,
          error: { code: "stale-target", message: "Target is missing or stale." },
        },
      }
    }
    return { ok: true }
  } catch {
    return {
      ok: false,
      response: {
        ok: false,
        error: { code: "stale-target", message: "Target is missing or stale." },
      },
    }
  }
}

function denied(message: string): McpControlResponse {
  return { ok: false, error: { code: "permission-denied", message } }
}

function approvalDecisionError(
  state: "approved" | "denied" | "timed-out" | "cancelled" | "shutdown",
): McpControlResponse | null {
  if (state === "approved") return null
  const code =
    state === "denied"
      ? "approval-denied"
      : state === "timed-out"
        ? "approval-timeout"
        : state === "cancelled"
          ? "approval-cancelled"
          : "approval-shutdown"
  return { ok: false, error: { code, message: `Approval ${state}.` } }
}

function snapshotCaller(caller: McpCallerIdentity): McpCallerIdentity {
  return { chatId: caller.chatId, runId: caller.runId, permissionMode: caller.permissionMode }
}

function applySelfReference(
  tool: McpControlTool,
  caller: McpCallerIdentity,
  rawInput: unknown,
  gate: ReturnType<typeof evaluateMcpToolGate>,
) {
  if (!rawInput || typeof rawInput !== "object") return gate
  const input = rawInput as Record<string, unknown>
  const operation =
    tool.name === "rename_item"
      ? "rename"
      : tool.name === "archive_item"
        ? "archive"
        : tool.name === "move_chat"
          ? "move"
          : tool.name === "write_attachment_to_worktree"
            ? "write"
            : tool.name === "launch_run"
              ? "launch"
              : null
  const kind =
    input.kind === "project" || input.kind === "task" || input.kind === "chat"
      ? input.kind
      : tool.name === "move_chat" || tool.name === "launch_run"
        ? "chat"
        : null
  const targetId =
    typeof input.id === "string" ? input.id : typeof input.chatId === "string" ? input.chatId : null
  if (!operation || !kind || !targetId) return gate
  return evaluateMcpGateWithSelfReference({
    caller,
    operation,
    target: { kind, id: targetId },
    gate,
  })
}
