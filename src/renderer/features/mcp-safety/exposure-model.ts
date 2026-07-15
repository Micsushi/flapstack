export type McpExposureConnection = "disabled" | "next-run" | "connected" | "unsupported"

export type McpExposureState = {
  enabled: boolean
  supported: boolean
  connection: McpExposureConnection
  callerLabel: string | null
  activeRunIds?: string[]
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
      detail: "Choose a supported agent provider to use Flapstack MCP.",
      canToggle: false,
    }
  }
  if (!state.enabled) return { label: "Off", detail: "Disabled for this chat.", canToggle: true }
  if (state.connection === "connected") {
    const count = state.activeRunIds?.length ?? 1
    return {
      label: "Connected",
      detail: `${count} active ${count === 1 ? "run has" : "runs have"} the local Flapstack MCP server. Disable to stop ${count === 1 ? "it" : "them"}.`,
      canToggle: true,
    }
  }
  return {
    label: "Enabled for next run",
    detail: "The next agent run will register the local Flapstack MCP server.",
    canToggle: true,
  }
}
