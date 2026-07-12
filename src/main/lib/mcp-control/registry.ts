import { z } from "zod"
import { randomUUID } from "node:crypto"
import { McpApprovalLifecycle } from "./approval-lifecycle"
import type { AppendMcpAuditRecord, McpAuditStatus } from "./audit-storage"
import { evaluateMcpToolGate } from "./gate"
import { createMcpReadService, type McpReadService } from "./read-service"
import { evaluateMcpGateWithSelfReference } from "./self-reference"
import type {
  McpCallerIdentity,
  McpControlResponse,
  McpControlTool,
  McpMutationService,
} from "./types"

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
  audit?: Pick<McpAuditWriter, "append">
  mutations?: McpMutationService
  /** Single post-gate dispatch hook for future mutation handlers. */
  execute?: (input: {
    tool: McpControlTool
    caller: McpCallerIdentity
    rawInput: unknown
  }) => McpControlResponse | Promise<McpControlResponse>
}

export type McpAuditWriter = {
  append: (record: AppendMcpAuditRecord) => void
}

export const mcpControlTools: McpControlTool[] = [
  {
    name: "ping",
    description: "Check Flapstack app-control server health.",
    tier: 0,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "describe",
    description: "List app-control tool capabilities and risk tiers.",
    tier: 0,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "list_projects",
    description: "List caller-visible projects.",
    tier: 0,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "list_tasks",
    description: "List tasks in a project or globally.",
    tier: 0,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "list_chats",
    description: "List caller-visible chats.",
    tier: 0,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "list_runs",
    description: "List caller-visible agent runs.",
    tier: 0,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "list_worktrees",
    description: "List caller-visible worktrees.",
    tier: 0,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "list_artifacts",
    description: "List caller-visible attachment and run artifacts.",
    tier: 0,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "search",
    description: "Search caller-visible object metadata.",
    tier: 0,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "create_chat",
    description: "Create a new chat.",
    tier: 1,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "spawn_thread",
    description: "Create and optionally launch a thread for another supported harness.",
    tier: 3,
    requiredCapabilities: ["mcp", "shell"],
    status: "implemented",
  },
  {
    name: "create_task",
    description: "Create a new task.",
    tier: 1,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "rename_item",
    description: "Rename a project, task, or chat.",
    tier: 2,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "archive_item",
    description: "Archive a project, task, or chat.",
    tier: 2,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "move_chat",
    description: "Move a chat within caller scope.",
    tier: 2,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "pin_item",
    description: "Pin or unpin an app item.",
    tier: 1,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "restore_item",
    description: "Restore an archived app item.",
    tier: 2,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "add_attachment",
    description: "Add a text attachment to a chat.",
    tier: 1,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
  {
    name: "write_attachment_to_worktree",
    description: "Write an attachment into a worktree.",
    tier: 3,
    requiredCapabilities: ["mcp", "fileWrite"],
    status: "implemented",
  },
  {
    name: "launch_run",
    description: "Launch a new agent run.",
    tier: 3,
    requiredCapabilities: ["mcp", "shell"],
    status: "implemented",
  },
  {
    name: "create_automation_draft",
    description: "Create a non-runnable automation draft.",
    tier: 1,
    requiredCapabilities: ["mcp"],
    status: "implemented",
  },
]

export function getMcpControlTool(name: string): McpControlTool | null {
  return mcpControlTools.find((tool) => tool.name === name) ?? null
}

export function listImplementedMcpControlTools(): McpControlTool[] {
  return mcpControlTools.filter((tool) => tool.status === "implemented")
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
    audit(dependencies, {
      invocationId,
      startedAt,
      status: "allowed",
      caller: trustedCaller.caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: { decision },
    })

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
    return auditedDispatch(
      tool,
      recheckedCaller.caller,
      input,
      readService,
      dependencies,
      invocationId,
      startedAt,
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
  audit(dependencies, {
    invocationId,
    startedAt,
    status: "allowed",
    caller: trustedCaller.caller,
    toolName: tool.name,
    tier: tool.tier,
    input,
    result: { decision: initialGate.decision, reason: initialGate.reason },
  })
  return auditedDispatch(
    tool,
    trustedCaller.caller,
    input,
    readService,
    dependencies,
    invocationId,
    startedAt,
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
): Promise<McpControlResponse> {
  try {
    const response = await dispatch(tool, caller, input, readService, dependencies)
    audit(dependencies, {
      invocationId,
      startedAt,
      status: response.ok ? "completed" : "failed",
      caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: response,
    })
    return response
  } catch (error) {
    const response: McpControlResponse = {
      ok: false,
      error: { code: "internal-error", message: "Tool execution failed." },
    }
    audit(dependencies, {
      invocationId,
      startedAt,
      status: "failed",
      caller,
      toolName: tool.name,
      tier: tool.tier,
      input,
      result: { response, error: error instanceof Error ? error.message : String(error) },
    })
    return response
  }
}

function audit(
  dependencies: McpInvocationDependencies,
  event: Omit<AppendMcpAuditRecord, "durationMs"> & { startedAt: number },
): void {
  try {
    dependencies.audit?.append({ ...event, durationMs: Date.now() - event.startedAt })
  } catch {
    // Audit storage is append-only and must not turn an already safe denial into execution.
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
): McpControlResponse | Promise<McpControlResponse> {
  return (
    dependencies.execute?.({ tool, caller, rawInput: input }) ??
    executeImplementedTool(tool.name, caller, input, readService, dependencies.mutations)
  )
}

function executeImplementedTool(
  name: string,
  caller: McpCallerIdentity,
  input: unknown,
  readService?: McpReadService,
  mutations?: McpMutationService,
): McpControlResponse | Promise<McpControlResponse> {
  if (name === "ping") {
    return { ok: true, data: { status: "ok", caller: snapshotCaller(caller) } }
  }
  if (name === "describe") {
    return {
      ok: true,
      data: { transport: "stdio", caller: snapshotCaller(caller), tools: mcpControlTools },
    }
  }

  if (mcpControlTools.some((tool) => tool.name === name && tool.tier > 0)) {
    return mutations
      ? mutations.invoke(name, caller, input)
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
