import type { ResolvedRuntimeLaunch } from "../../../shared/agent-runtime"
import type { RuntimeSnapshotColumns } from "./snapshot"
import { RUNTIME_RELEASE_POLICY } from "./release-policy"

export class RuntimeProviderRouterError extends Error {
  readonly code = "runtime-provider-router-mismatch"

  constructor(
    readonly harness: string,
    readonly resolvedRuntime: ResolvedRuntimeLaunch["resolvedRuntime"],
    message: string,
    readonly repair: string,
  ) {
    super(message)
    this.name = "RuntimeProviderRouterError"
  }
}

/**
 * Stage 3 provider routers are the Flapstack Native delegation only. A direct
 * Runtime snapshot must never fall through to them, even through a stale UI or
 * an internal caller that bypasses renderer release controls.
 */
export function assertFlapstackNativeProviderRouter(input: {
  harness: string
  snapshot: RuntimeSnapshotColumns
}): void {
  if (input.snapshot.resolvedRuntime === "flapstack-native") return
  const release = RUNTIME_RELEASE_POLICY[input.snapshot.resolvedRuntime]
  throw new RuntimeProviderRouterError(
    input.harness,
    input.snapshot.resolvedRuntime,
    release.reason ??
      `${input.snapshot.resolvedRuntime} Runtime requires the central Runtime launch bridge.`,
    "Choose Flapstack Native explicitly, or launch the direct Runtime through the central registry after its release gates pass.",
  )
}
