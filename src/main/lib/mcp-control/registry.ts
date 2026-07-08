import type { McpControlTool } from "./types"

export const mcpControlTools: McpControlTool[] = [
  {
    name: "ping",
    description: "Check Flapstack app-control server health.",
    tier: 0,
    status: "implemented",
  },
  {
    name: "describe",
    description: "List app-control tool capabilities and risk tiers.",
    tier: 0,
    status: "implemented",
  },
  { name: "list_projects", description: "List local projects.", tier: 0, status: "scaffolded" },
  {
    name: "list_tasks",
    description: "List tasks in a project or globally.",
    tier: 0,
    status: "scaffolded",
  },
  { name: "list_chats", description: "List chats by scope.", tier: 0, status: "scaffolded" },
  { name: "search", description: "Run scoped search.", tier: 0, status: "scaffolded" },
  { name: "create_chat", description: "Create a new chat.", tier: 1, status: "stubbed" },
  { name: "create_task", description: "Create a new task.", tier: 1, status: "stubbed" },
  {
    name: "rename_item",
    description: "Rename a project, task, or chat.",
    tier: 2,
    status: "stubbed",
  },
  {
    name: "archive_item",
    description: "Archive a project, task, or chat.",
    tier: 2,
    status: "stubbed",
  },
  {
    name: "write_attachment_to_worktree",
    description: "Write an attachment into a worktree.",
    tier: 3,
    status: "stubbed",
  },
  { name: "launch_run", description: "Launch a new agent run.", tier: 3, status: "stubbed" },
]

export function getMcpControlTool(name: string): McpControlTool | null {
  return mcpControlTools.find((tool) => tool.name === name) ?? null
}
