export type DevMcpRiskTier = 0 | 1 | 2

export type DevMcpToolName =
  | "get_test_environment"
  | "get_harness_status"
  | "get_provider_status"
  | "list_test_targets"
  | "get_chat_state"
  | "get_run_state"
  | "get_reasoning_timer_state"
  | "list_pending_approvals"
  | "get_opencode_logs"
  | "create_test_chat"
  | "archive_test_chat"
  | "set_chat_run_config"
  | "send_test_prompt"
  | "launch_test_run"
  | "reply_approval"
  | "cancel_run"
  | "wait_for_run"
  | "verify_run_artifacts"
  | "run_project_check"
  | "openspec_validate"

export type DevMcpToolDefinition = {
  name: DevMcpToolName
  description: string
  tier: DevMcpRiskTier
  mutates: boolean
  status: "implemented" | "stubbed"
}

export type ShellResult = {
  command: string
  args: string[]
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export type TestControlResult<T> = {
  ok: boolean
  data: T
  warnings: string[]
}
