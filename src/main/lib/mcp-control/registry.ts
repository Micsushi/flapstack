import { z } from "zod"
import { createMcpReadService, type McpReadService } from "./read-service"
import type { McpCallerIdentity, McpControlResponse, McpControlTool } from "./types"

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

function snapshotCaller(caller: McpCallerIdentity): McpCallerIdentity {
  return { chatId: caller.chatId, runId: caller.runId, permissionMode: caller.permissionMode }
}
