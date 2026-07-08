export type DevMcpRiskTier = 0 | 1 | 2

export type DevMcpToolName =
  | "get_test_environment"
  | "get_harness_status"
  | "list_test_targets"
  | "set_chat_run_config"
  | "send_test_prompt"
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
