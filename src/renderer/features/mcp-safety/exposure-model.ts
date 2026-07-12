export type McpExposureConnection = "disabled" | "next-run" | "unsupported"

export type McpExposureState = {
  enabled: boolean
  supported: boolean
  connection: McpExposureConnection
  callerLabel: string | null
  error: string | null
}

export function exposurePresentation(state: McpExposureState | undefined): {
  label: string
  detail: string
  canToggle: boolean
} {
  if (!state)
    return { label: "Checking MCP", detail: "Reading saved chat exposure.", canToggle: false }
  if (state.error)
    return { label: "Registration error", detail: state.error, canToggle: state.supported }
  if (!state.supported) {
    return {
      label: "Unsupported",
      detail: "Flapstack MCP currently supports Codex and Claude chats only.",
      canToggle: false,
    }
  }
  if (!state.enabled) return { label: "Off", detail: "Disabled for this chat.", canToggle: true }
  return {
    label: "Enabled for next run",
    detail: "The next Codex or Claude run will register the local Flapstack MCP server.",
    canToggle: true,
  }
}
