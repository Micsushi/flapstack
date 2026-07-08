import type { DevMcpToolDefinition, DevMcpToolName } from "./types"

export const devMcpTestControlTools: DevMcpToolDefinition[] = [
  {
    name: "get_test_environment",
    description: "Report local app, database, runtime, and repository diagnostics for E2 testing.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "get_harness_status",
    description: "Report Codex and Claude readiness without returning secrets.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "list_test_targets",
    description: "List projects, chats, sub-chats, worktree paths, and recent message counts.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "set_chat_run_config",
    description: "Persist a test run configuration hint for a sub-chat.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "send_test_prompt",
    description: "Append a no-edit test prompt to a sub-chat for UI/harness smoke testing.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "wait_for_run",
    description: "Poll a sub-chat until an assistant reply appears or timeout expires.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "verify_run_artifacts",
    description: "Verify persisted assistant reply and no-edit expectations for a sub-chat.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "run_project_check",
    description: "Run npm check with the known-good bundled Node runtime when present.",
    tier: 2,
    mutates: false,
    status: "implemented",
  },
  {
    name: "openspec_validate",
    description: "Run strict OpenSpec validation for the active Stage 1 change.",
    tier: 2,
    mutates: false,
    status: "implemented",
  },
]

export function getDevMcpTool(name: string): DevMcpToolDefinition | null {
  return devMcpTestControlTools.find((tool) => tool.name === name) ?? null
}

export function isDevMcpToolName(name: string): name is DevMcpToolName {
  return getDevMcpTool(name) !== null
}
