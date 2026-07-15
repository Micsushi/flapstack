import type { RuntimeLaunchControls } from "../../../../shared/agent-runtime"

export type ClaudeRuntimeSdkControls = {
  includePartialMessages: true
  thinking?: { type: "adaptive"; display: "summarized" | "omitted" } | { type: "disabled" }
  effort?: "low" | "medium" | "high" | "xhigh" | "max"
  forwardSubagentText: boolean
  includeHookEvents: boolean
}

const EFFORT_VALUES = new Set(["low", "medium", "high", "xhigh", "max"])

export function buildClaudeRuntimeSdkControls(
  controls: RuntimeLaunchControls,
): ClaudeRuntimeSdkControls {
  const effort = controls.modelEffort
  if (effort !== null && !EFFORT_VALUES.has(effort)) {
    throw new Error(`Unsupported Claude effort: ${effort}`)
  }

  const thinking =
    controls.modelThinking === false
      ? ({ type: "disabled" } as const)
      : controls.modelThinking === true || controls.reasoningDisplay === false
        ? ({
            type: "adaptive",
            display: controls.reasoningDisplay ? "summarized" : "omitted",
          } as const)
        : undefined

  return {
    includePartialMessages: true,
    ...(thinking ? { thinking } : {}),
    ...(effort ? { effort: effort as ClaudeRuntimeSdkControls["effort"] } : {}),
    forwardSubagentText: controls.subagentActivity,
    includeHookEvents: controls.hookDiagnostics,
  }
}
