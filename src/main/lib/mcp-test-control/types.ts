export type DevMcpRiskTier = 0 | 1 | 2

export type DevMcpToolName =
  | "get_test_environment"
  | "get_harness_status"
  | "get_provider_status"
  | "get_credential_status"
  | "set_or_replace_credential"
  | "migrate_legacy_credential"
  | "remove_credential"
  | "get_settings_state"
  | "control_settings"
  | "get_settings_legacy_state"
  | "mutate_settings_legacy_state"
  | "get_visible_copy_search_state"
  | "select_test_chat"
  | "copy_test_chat_history"
  | "get_renderer_orchestration_state"
  | "get_shortcut_state"
  | "mutate_shortcut_binding"
  | "list_provider_extensions"
  | "list_test_targets"
  | "get_chat_state"
  | "get_run_state"
  | "get_reasoning_timer_state"
  | "get_voice_state"
  | "control_voice_settings"
  | "create_voice_ui_fixture"
  | "cleanup_voice_ui_fixture"
  | "get_renderer_voice_ui_state"
  | "control_renderer_voice_ui"
  | "get_usage_state"
  | "refresh_usage_state"
  | "create_usage_ui_fixture"
  | "cleanup_usage_ui_fixture"
  | "get_renderer_usage_ui_state"
  | "control_renderer_usage_ui"
  | "get_run_change_state"
  | "undo_run_change"
  | "create_carryover_run_fixture"
  | "get_carryover_run_fixture_files"
  | "cleanup_carryover_run_fixture"
  | "get_renderer_carryover_state"
  | "control_renderer_carryover"
  | "list_pending_approvals"
  | "get_opencode_logs"
  | "prepare_product_mcp_caller"
  | "set_product_mcp_exposure"
  | "start_product_mcp_call"
  | "get_product_mcp_call"
  | "reply_product_mcp_approval"
  | "get_product_mcp_state"
  | "get_product_mcp_renderer_state"
  | "control_product_mcp_renderer"
  | "manage_product_mcp_recovery"
  | "cleanup_product_mcp_caller"
  | "cancel_product_mcp_child_run"
  | "list_agent_input_requests"
  | "get_renderer_agent_input_state"
  | "get_renderer_agent_input_navigation_state"
  | "navigate_agent_input_notification"
  | "capture_test_renderer"
  | "cleanup_test_renderer_capture"
  | "ensure_test_project"
  | "archive_test_project"
  | "create_test_chat"
  | "open_test_chat"
  | "archive_test_chat"
  | "mutate_project_provider_extension"
  | "get_permission_state"
  | "set_permission_default"
  | "set_permission_change_behavior"
  | "set_chat_permission"
  | "preview_permission"
  | "get_permission_ui_state"
  | "control_permission_ui"
  | "set_chat_run_config"
  | "send_test_prompt"
  | "launch_test_run"
  | "launch_harness_test_run"
  | "list_codex_permission_requests"
  | "reply_codex_permission_request"
  | "inject_agent_input_request"
  | "reply_agent_input_request"
  | "reply_approval"
  | "cancel_run"
  | "wait_for_run"
  | "verify_run_artifacts"
  | "run_project_check"
  | "openspec_validate"
  | "create_test_orchestration"
  | "create_test_orchestration_fixture"
  | "get_test_orchestration"
  | "mutate_test_orchestration"

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
