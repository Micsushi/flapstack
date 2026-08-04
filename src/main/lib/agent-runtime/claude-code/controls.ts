import type { RuntimeLaunchControls } from "../../../../shared/agent-runtime"

export type ClaudeRuntimeSdkControls = {
  includePartialMessages: true
  thinking?: { type: "adaptive"; display: "summarized" | "omitted" } | { type: "disabled" }
  effort?: "low" | "medium" | "high" | "xhigh" | "max"
  forwardSubagentText: boolean
  includeHookEvents: boolean
}

const EFFORT_VALUES = new Set(["low", "medium", "high", "xhigh", "max"])

export function normalizeClaudeRuntimeEffort(
  effort: string | null | undefined,
): ClaudeRuntimeSdkControls["effort"] {
  const normalized =
    effort == null || effort === "none" || effort === "minimal"
      ? undefined
      : effort === "ultra"
        ? "max"
        : effort
  if (normalized !== undefined && !EFFORT_VALUES.has(normalized)) {
    throw new Error(`Unsupported Claude effort: ${normalized}`)
  }
  return normalized as ClaudeRuntimeSdkControls["effort"]
}

export function buildClaudeRuntimeSdkControls(
  controls: RuntimeLaunchControls,
): ClaudeRuntimeSdkControls {
  const effort = normalizeClaudeRuntimeEffort(controls.modelEffort)

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
    ...(effort ? { effort } : {}),
    forwardSubagentText: controls.subagentActivity,
    includeHookEvents: controls.hookDiagnostics,
  }
}
