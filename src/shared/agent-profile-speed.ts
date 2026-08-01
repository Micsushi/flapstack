import { CODEX_MODELS } from "./model-catalog"

type SpeedCapability = {
  harness: string
  modelPreference: string | null
  speedPreference: "standard" | "fast" | null
}

type RuntimeIdentity = {
  preference: string
  resolvedRuntime: string
}

export type AgentProfileSpeedCompatibility =
  | { compatible: true; serviceTier: "fast" | null }
  | {
      compatible: false
      code: "speed-unsupported"
      message: string
      repair: string
    }

/**
 * Resolves the provider-facing service tier without coupling it to reasoning
 * effort. The static list is deliberately fail-closed: unknown provider/model
 * combinations must be revalidated before a stored fast request can launch.
 */
export function agentProfileSpeedCompatibility(
  capability: SpeedCapability,
  runtime: RuntimeIdentity,
): AgentProfileSpeedCompatibility {
  if (capability.speedPreference !== "fast") {
    return { compatible: true, serviceTier: null }
  }
  if (capability.harness !== "codex" || runtime.resolvedRuntime !== "codex") {
    return unsupported(
      "Fast mode is unavailable for the selected provider and Runtime.",
      "Choose Standard speed or select a supported Codex Runtime and model.",
    )
  }

  const modelId = capability.modelPreference?.trim().split(/[\/[]/, 1)[0] ?? ""
  if (!modelId) {
    return unsupported(
      "Fast mode requires an exact supported Codex model; the profile model is unpinned.",
      "Pin a Codex model whose current capability record includes Fast, or choose Standard speed.",
    )
  }
  const model = CODEX_MODELS.find((candidate) => candidate.id === modelId)
  if (!model?.supportsFastMode) {
    return unsupported(
      `Fast mode is unavailable or unverified for model ${modelId}.`,
      "Choose Standard speed or select a Codex model whose current capability record includes Fast.",
    )
  }
  return { compatible: true, serviceTier: "fast" }
}

export function agentProfileFastModeSupported(
  capability: Pick<SpeedCapability, "harness" | "modelPreference">,
  resolvedRuntime = capability.harness,
): boolean {
  return agentProfileSpeedCompatibility(
    { ...capability, speedPreference: "fast" },
    { preference: resolvedRuntime, resolvedRuntime },
  ).compatible
}

function unsupported(
  message: string,
  repair: string,
): Extract<AgentProfileSpeedCompatibility, { compatible: false }> {
  return { compatible: false, code: "speed-unsupported", message, repair }
}
