import type { ResolvedAgentRuntime } from "../../../shared/agent-runtime"

export type RuntimeReleaseStatus = {
  runtime: ResolvedAgentRuntime
  enabledForNewLaunches: boolean
  reason: string | null
}

export function buildRuntimeReleasePolicy(
  platform: NodeJS.Platform = process.platform,
): Record<ResolvedAgentRuntime, RuntimeReleaseStatus> {
  const nativeRuntimesQualified = platform === "win32"
  const unqualifiedPlatformReason =
    "Direct native Runtimes are awaiting packaged qualification on this platform."
  return {
    codex: {
      runtime: "codex",
      enabledForNewLaunches: nativeRuntimesQualified,
      reason: nativeRuntimesQualified ? null : unqualifiedPlatformReason,
    },
    "claude-code": {
      runtime: "claude-code",
      enabledForNewLaunches: nativeRuntimesQualified,
      reason: nativeRuntimesQualified ? null : unqualifiedPlatformReason,
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
