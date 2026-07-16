import type { ResolvedAgentRuntime } from "../../../shared/agent-runtime"

export type RuntimeReleaseStatus = {
  runtime: ResolvedAgentRuntime
  enabledForNewLaunches: boolean
  reason: string | null
}

/**
 * Direct defaults remain gated in production until T10 has observed
 * credentialed live proof. Development enables both direct Runtimes so that
 * proof can be collected. Preview packages can opt in through the explicit
 * environment flag without silently changing production defaults.
 */
export function buildRuntimeReleasePolicy(
  enableUnverifiedNativeRuntimes = Boolean(process.env.ELECTRON_RENDERER_URL) ||
    process.env.FLAPSTACK_ENABLE_UNVERIFIED_NATIVE_RUNTIMES === "1",
): Record<ResolvedAgentRuntime, RuntimeReleaseStatus> {
  return {
    codex: {
      runtime: "codex",
      enabledForNewLaunches: enableUnverifiedNativeRuntimes,
      reason: enableUnverifiedNativeRuntimes
        ? null
        : "Direct Codex Runtime credentialed live-provider proof is open.",
    },
    "claude-code": {
      runtime: "claude-code",
      enabledForNewLaunches: enableUnverifiedNativeRuntimes,
      reason: enableUnverifiedNativeRuntimes
        ? null
        : "Native Claude Code Runtime credentialed live-provider proof is open.",
    },
    "flapstack-native": {
      runtime: "flapstack-native",
      enabledForNewLaunches: true,
      reason: null,
    },
  }
}

export const RUNTIME_RELEASE_POLICY = buildRuntimeReleasePolicy()

export function getRuntimeReleasePolicy(): RuntimeReleaseStatus[] {
  return Object.values(RUNTIME_RELEASE_POLICY)
}
