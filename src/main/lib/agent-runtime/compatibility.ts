import type {
  ResolvedAgentRuntime,
  RuntimeAdapterCompositionSnapshot,
  RuntimeBlockReason,
  RuntimeCompatibilityResult,
} from "../../../shared/agent-runtime"

const explicitCompatibility: Readonly<Record<string, readonly ResolvedAgentRuntime[]>> = {
  codex: ["codex", "flapstack-native"],
  "claude-code": ["claude-code", "flapstack-native"],
  "cursor-agent": ["flapstack-native"],
  openrouter: ["flapstack-native"],
  nanogpt: ["flapstack-native"],
  local: ["flapstack-native"],
  custom: ["flapstack-native"],
  generic: ["flapstack-native"],
}

export const RUNTIME_COMPATIBILITY_MATRIX = explicitCompatibility

export function allowedRuntimesForHarness(harness: string): readonly ResolvedAgentRuntime[] {
  return explicitCompatibility[harness] ?? explicitCompatibility.generic
}

export function productRuntimeForHarness(harness: string): ResolvedAgentRuntime {
  if (harness === "codex") return "codex"
  if (harness === "claude-code") return "claude-code"
  return "flapstack-native"
}

export function checkRuntimeCompatibility(
  harness: string,
  runtime: ResolvedAgentRuntime,
  composition?: RuntimeAdapterCompositionSnapshot | null,
): RuntimeCompatibilityResult {
  if (allowedRuntimesForHarness(harness).includes(runtime)) {
    return { compatible: true, harness, runtime, reason: null }
  }
  if (
    composition?.runtimeMode === "translated" &&
    composition.adapterChain.length > 0 &&
    composition.providerRuntime === productRuntimeForHarness(harness) &&
    composition.providerRuntime !== runtime
  ) {
    return { compatible: true, harness, runtime, reason: null }
  }
  const allowed = allowedRuntimesForHarness(harness).join(", ")
  const reason: RuntimeBlockReason = {
    code: "runtime-incompatible",
    harness,
    runtime,
    message: `${runtime} Runtime is incompatible with the ${harness} harness.`,
    repair: `Choose one of: ${allowed}.`,
  }
  return { compatible: false, harness, runtime, reason }
}
