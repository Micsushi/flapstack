import type { ResolvedAgentRuntime } from "../../../shared/agent-runtime"

export type RuntimeReleaseStatus = {
  runtime: ResolvedAgentRuntime
  enabledForNewLaunches: boolean
  reason: string | null
}

/**
 * Direct defaults remain gated until T10 has observed credentialed live proof.
 * Preview-package smoke has passed, but it is not a substitute for a real
 * provider lifecycle. Flapstack Native remains the explicit compatibility path.
 */
export const RUNTIME_RELEASE_POLICY: Record<ResolvedAgentRuntime, RuntimeReleaseStatus> = {
  codex: {
    runtime: "codex",
    enabledForNewLaunches: false,
    reason:
      "Direct Codex Runtime credentialed live-provider proof is open, and installed Codex 0.144.2 does not match pinned 0.144.1.",
  },
  "claude-code": {
    runtime: "claude-code",
    enabledForNewLaunches: false,
    reason: "Native Claude Code Runtime credentialed live-provider proof is open.",
  },
  "flapstack-native": {
    runtime: "flapstack-native",
    enabledForNewLaunches: true,
    reason: null,
  },
}

export function getRuntimeReleasePolicy(): RuntimeReleaseStatus[] {
  return Object.values(RUNTIME_RELEASE_POLICY)
}
