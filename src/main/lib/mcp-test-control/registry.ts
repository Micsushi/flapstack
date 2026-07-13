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
    name: "get_provider_status",
    description: "Report OpenRouter and NanoGPT readiness and available model counts.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "list_provider_extensions",
    description:
      "List provider-scoped extension identities and capabilities without returning extension content.",
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
    name: "get_chat_state",
    description: "Inspect one chat transcript, run state, tools, and approvals without secrets.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "get_run_state",
    description: "Inspect one persisted agent run and its matching assistant metadata.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "get_reasoning_timer_state",
    description: "Inspect the authoritative live or completed reasoning timer for one run.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "list_pending_approvals",
    description: "List pending OpenRouter or NanoGPT permission requests.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "get_opencode_logs",
    description: "Read a bounded redacted tail of isolated provider runtime logs.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "list_agent_input_requests",
    description: "List provider-neutral input requests currently owned by the live app.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "get_renderer_agent_input_state",
    description: "Inspect active renderer question ownership and dialog visibility.",
    tier: 0,
    mutates: false,
    status: "implemented",
  },
  {
    name: "ensure_test_project",
    description: "Register or restore the active development checkout as a local test project.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "archive_test_project",
    description: "Reversibly archive an idle test project for the active development checkout.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "create_test_chat",
    description:
      "Create one local project chat and its canonical conversation for provider testing.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "open_test_chat",
    description: "Select one existing test chat in the live renderer without synthetic UI input.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "archive_test_chat",
    description: "Reversibly archive one idle test chat without deleting its history.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "mutate_project_provider_extension",
    description:
      "Create, update, or delete one project-scoped provider extension through the production adapter.",
    tier: 1,
    mutates: true,
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
    description:
      "Append a database-only test prompt for legacy fixture setup; does not launch a run.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "launch_test_run",
    description: "Launch a real OpenRouter or NanoGPT run through the app runtime.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "inject_agent_input_request",
    description: "Inject one bounded provider-neutral input request into a live test chat.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "reply_agent_input_request",
    description: "Answer, skip, or cancel one injected provider-neutral input request.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "reply_approval",
    description: "Reply once to a pending provider permission request.",
    tier: 1,
    mutates: true,
    status: "implemented",
  },
  {
    name: "cancel_run",
    description: "Cancel a matching active OpenRouter or NanoGPT run.",
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

export const devMcpExposedToolNames = [
  "get_test_environment",
  "get_harness_status",
  "get_provider_status",
  "list_provider_extensions",
  "list_test_targets",
  "get_chat_state",
  "get_run_state",
  "get_reasoning_timer_state",
  "list_pending_approvals",
  "get_opencode_logs",
  "list_agent_input_requests",
  "get_renderer_agent_input_state",
  "ensure_test_project",
  "archive_test_project",
  "create_test_chat",
  "open_test_chat",
  "archive_test_chat",
  "mutate_project_provider_extension",
  "launch_test_run",
  "inject_agent_input_request",
  "reply_agent_input_request",
  "reply_approval",
  "cancel_run",
  "wait_for_run",
] as const satisfies readonly DevMcpToolName[]

export const devMcpExposedTools = devMcpExposedToolNames.map((name) => {
  const tool = getDevMcpTool(name)
  if (!tool) throw new Error(`Missing dev MCP tool definition: ${name}`)
  return tool
})

export function isDevMcpToolName(name: string): name is DevMcpToolName {
  return getDevMcpTool(name) !== null
}
