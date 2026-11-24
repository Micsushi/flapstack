export type ProviderSelection = {
  harness: string | null
  runtime?: string | null
  model: string | null
  reasoningEffort: string | null
}

export type ProviderTransitionPlan =
  | { type: "apply_on_next_turn" }
  | { type: "restart_session" }
  | { type: "create_with_handoff" }
  | { type: "reject"; reason: string }

export function planProviderTransition(input: {
  current: ProviderSelection
  target: ProviderSelection
  hasHistory: boolean
  active?: boolean
  supportsModelSwitch?: boolean
}): ProviderTransitionPlan {
  const providerChanged =
    input.current.harness !== input.target.harness || input.current.runtime !== input.target.runtime
  if (providerChanged && input.active)
    return {
      type: "reject",
      reason: "Wait for the active and queued turns before changing provider.",
    }
  if (providerChanged && input.hasHistory) return { type: "create_with_handoff" }

  const modelChanged = input.current.model !== input.target.model
  const effortChanged = input.current.reasoningEffort !== input.target.reasoningEffort
  if (input.hasHistory && modelChanged && input.supportsModelSwitch === false)
    return { type: "reject", reason: "The current provider session cannot switch models." }
  if (
    !providerChanged &&
    input.hasHistory &&
    (modelChanged || effortChanged) &&
    input.target.harness === "claude-code"
  )
    return { type: "restart_session" }
  return { type: "apply_on_next_turn" }
}
