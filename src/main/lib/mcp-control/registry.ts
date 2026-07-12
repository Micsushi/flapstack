import { z } from "zod"
import { randomUUID } from "node:crypto"
import { McpApprovalLifecycle } from "./approval-lifecycle"
import { evaluateMcpToolGate } from "./gate"
import { createMcpReadService, type McpReadService } from "./read-service"
import type { McpCallerIdentity, McpControlResponse, McpControlTool } from "./types"

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
  /** Single post-gate dispatch hook for future mutation handlers. */
  execute?: (input: {
    tool: McpControlTool
    caller: McpCallerIdentity
    rawInput: unknown
  }) => McpControlResponse | Promise<McpControlResponse>
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
    status: "stubbed",
  },
  {
    name: "create_task",
    description: "Create a new task.",
    tier: 1,
    requiredCapabilities: ["mcp"],
    status: "stubbed",
  },
  {
    name: "rename_item",
    description: "Rename a project, task, or chat.",
    tier: 2,
    requiredCapabilities: ["mcp"],
    status: "stubbed",
  },
  {
    name: "archive_item",
    description: "Archive a project, task, or chat.",
    tier: 2,
    requiredCapabilities: ["mcp"],
    status: "stubbed",
  },
  {
    name: "write_attachment_to_worktree",
    description: "Write an attachment into a worktree.",
    tier: 3,
    requiredCapabilities: ["mcp", "fileWrite"],
    status: "stubbed",
  },
  {
    name: "launch_run",
    description: "Launch a new agent run.",
    tier: 3,
    requiredCapabilities: ["mcp", "shell"],
    status: "stubbed",
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
  const tool = getMcpControlTool(name)
  if (!tool) {
    return { ok: false, error: { code: "tool-not-found", message: `Unknown tool: ${name}` } }
  }
  if (tool.status !== "implemented") {
    return {
      ok: false,
      error: { code: "tool-unavailable", message: `${name} is not available in this build.` },
    }
  }

  const trustedCaller = resolveCaller(caller, dependencies)
  if (!trustedCaller.ok) return trustedCaller.response

  const initialGate = evaluateMcpToolGate({ tool, caller: trustedCaller.caller })
  if (initialGate.decision === "denied") return denied(initialGate.reason)

  if (initialGate.decision === "approval-required") {
    const approvals = dependencies.approvals
    if (!approvals) return denied("Approval lifecycle is unavailable.")
    const wait = approvals.request({
      id: dependencies.approvalId?.() ?? randomUUID(),
      caller: trustedCaller.caller,
      toolName: tool.name,
      tier: tool.tier,
    })
    const decision = await wait.decision
    const approvalError = approvalDecisionError(decision.state)
    if (approvalError) return approvalError

    // Approval never authorizes an old snapshot. Both caller and selected
    // target are resolved again immediately before any handler can run.
    const recheckedCaller = resolveCaller(caller, dependencies)
    if (!recheckedCaller.ok) return recheckedCaller.response
    const finalGate = evaluateMcpToolGate({ tool, caller: recheckedCaller.caller, approved: true })
    if (finalGate.decision !== "allowed") return denied(finalGate.reason)
    const target = resolveTarget(tool, recheckedCaller.caller, input, dependencies)
    if (!target.ok) return target.response
    return dispatch(tool, recheckedCaller.caller, input, readService, dependencies)
  }

  const target = resolveTarget(tool, trustedCaller.caller, input, dependencies)
  if (!target.ok) return target.response
  return dispatch(tool, trustedCaller.caller, input, readService, dependencies)
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
    executeImplementedTool(tool.name, caller, input, readService)
  )
}

function executeImplementedTool(
  name: string,
  caller: McpCallerIdentity,
  input: unknown,
  readService?: McpReadService,
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
