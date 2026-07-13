export const REASONING_EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const
export type ReasoningEffortLevel = (typeof REASONING_EFFORT_LEVELS)[number]

export type ReasoningControlRequest = {
  enabled: boolean
  effort?: ReasoningEffortLevel
}

export type ReasoningControlCapability = {
  toggle: boolean
  efforts?: readonly ReasoningEffortLevel[]
}

export type ReasoningControlResolution = {
  requested: ReasoningControlRequest
  sent: { enabled?: boolean; effort?: ReasoningEffortLevel }
  exact: boolean
  limitations: string[]
}

export function resolveReasoningControls(
  capability: ReasoningControlCapability,
  requested: ReasoningControlRequest,
): ReasoningControlResolution {
  const sent: ReasoningControlResolution["sent"] = {}
  const limitations: string[] = []

  if (capability.toggle) sent.enabled = requested.enabled
  else {
    limitations.push(
      `Reasoning ${requested.enabled ? "on" : "off"} is not a verified native control and was omitted.`,
    )
  }

  if (requested.enabled && requested.effort) {
    const efforts = capability.efforts ?? []
    if (efforts.includes(requested.effort)) sent.effort = requested.effort
    else if (efforts.length > 0) {
      const requestedIndex = REASONING_EFFORT_LEVELS.indexOf(requested.effort)
      sent.effort = [...efforts].sort(
        (left, right) =>
          Math.abs(REASONING_EFFORT_LEVELS.indexOf(left) - requestedIndex) -
          Math.abs(REASONING_EFFORT_LEVELS.indexOf(right) - requestedIndex),
      )[0]
      limitations.push(`Reasoning effort ${requested.effort} mapped to ${sent.effort}.`)
    } else {
      limitations.push(`Reasoning effort ${requested.effort} is unsupported and was omitted.`)
    }
  }

  return { requested, sent, exact: limitations.length === 0, limitations }
}
