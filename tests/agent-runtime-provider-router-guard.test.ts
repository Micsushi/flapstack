import { describe, expect, it } from "vitest"
import {
  RuntimeProviderRouterError,
  assertFlapstackNativeProviderRouter,
} from "../src/main/lib/agent-runtime/provider-router-guard"
import type { RuntimeSnapshotColumns } from "../src/main/lib/agent-runtime/snapshot"

function snapshot(
  resolvedRuntime: RuntimeSnapshotColumns["resolvedRuntime"],
): RuntimeSnapshotColumns {
  return {
    runtimeSnapshotVersion: 1,
    runtimePreference: resolvedRuntime,
    runtimePreferenceSource: "chat",
    resolvedRuntime,
    runtimeAdapterVersion: "adapter",
    runtimeProtocolVersion: "protocol",
    runtimeCapabilitySnapshot: "{}",
    runtimeControlSnapshot: "{}",
  }
}

describe("Agent Runtime Stage 3 provider-router guard", () => {
  it("allows only explicit Flapstack Native snapshots", () => {
    expect(() =>
      assertFlapstackNativeProviderRouter({
        harness: "codex",
        snapshot: snapshot("flapstack-native"),
      }),
    ).not.toThrow()
  })

  it.each(["codex", "claude-code"] as const)(
    "blocks %s snapshots before they can silently use a Native router",
    (resolvedRuntime) => {
      expect(() =>
        assertFlapstackNativeProviderRouter({
          harness: resolvedRuntime,
          snapshot: snapshot(resolvedRuntime),
        }),
      ).toThrowError(
        expect.objectContaining<Partial<RuntimeProviderRouterError>>({
          code: "runtime-provider-router-mismatch",
          resolvedRuntime,
        }),
      )
    },
  )
})
