import { describe, expect, it } from "vitest"
import {
  AgentRuntimeResolutionError,
  assertResolvedAgentRuntime,
  resolveAgentRuntime,
} from "../src/main/lib/agent-runtime/resolver"
import type {
  AgentRuntimePreference,
  ResolvedAgentRuntime,
  RuntimeAdapterProbe,
} from "../src/shared/agent-runtime"

const permission = { mode: "read-only" as const, customPermissions: null }
const harnesses = [
  "codex",
  "claude-code",
  "cursor-agent",
  "openrouter",
  "nanogpt",
  "local",
  "custom",
  "generic",
] as const
const preferences: AgentRuntimePreference[] = ["auto", "codex", "claude-code", "flapstack-native"]
const scopes = ["chat", "project", "global"] as const

describe("Agent Runtime resolver", () => {
  for (const harness of harnesses) {
    for (const preference of preferences) {
      for (const scope of scopes) {
        it(`${harness} resolves or blocks ${scope} ${preference}`, () => {
          const result = resolveAgentRuntime({
            harness,
            permission,
            chatPreference: scope === "chat" ? preference : null,
            projectPreference: scope === "project" ? preference : null,
            globalPreference: scope === "global" ? preference : null,
          })
          const expected = preference === "auto" ? productRuntime(harness) : preference
          const compatible = allowed(harness).includes(expected)
          expect(result.ok).toBe(compatible)
          if (result.ok) {
            expect(result.launch).toMatchObject({
              harness,
              requestedPreference: preference,
              resolvedRuntime: expected,
              preferenceSource: scope,
            })
          } else {
            expect(result.reason.code).toBe("runtime-incompatible")
          }
        })
      }
    }
  }

  it.each([
    [
      "chat",
      { chatPreference: "flapstack-native", projectPreference: "codex", globalPreference: "codex" },
    ],
    [
      "project",
      { chatPreference: null, projectPreference: "flapstack-native", globalPreference: "codex" },
    ],
    [
      "global",
      { chatPreference: null, projectPreference: null, globalPreference: "flapstack-native" },
    ],
    ["product", { chatPreference: null, projectPreference: null, globalPreference: null }],
  ] as const)("uses %s precedence", (source, inputs) => {
    const launch = assertResolvedAgentRuntime({ harness: "codex", permission, ...inputs })
    expect(launch.preferenceSource).toBe(source)
    expect(launch.resolvedRuntime).toBe(source === "product" ? "codex" : "flapstack-native")
  })

  it.each([
    [
      "chat",
      { chatPreference: "auto", projectPreference: "flapstack-native", globalPreference: "codex" },
    ],
    [
      "project",
      { chatPreference: null, projectPreference: "auto", globalPreference: "flapstack-native" },
    ],
    ["product", { chatPreference: null, projectPreference: null, globalPreference: null }],
  ] as const)("keeps scoped auto distinct from inherit at %s", (source, inputs) => {
    const launch = assertResolvedAgentRuntime({ harness: "codex", permission, ...inputs })
    expect(launch).toMatchObject({
      requestedPreference: "auto",
      preferenceSource: source,
      resolvedRuntime: "codex",
    })
  })

  it("blocks an unavailable explicit adapter without silently selecting Native", () => {
    const unavailable = probe("codex", false)
    const result = resolveAgentRuntime({
      harness: "codex",
      chatPreference: "codex",
      permission,
      adapterProbes: { codex: unavailable },
    })
    expect(result).toEqual({ ok: false, reason: unavailable.reason })
    expect(() =>
      assertResolvedAgentRuntime({
        harness: "codex",
        chatPreference: "codex",
        permission,
        adapterProbes: { codex: unavailable },
      }),
    ).toThrowError(AgentRuntimeResolutionError)
  })

  it("snapshots controls and unresolved versions before adapter wiring", () => {
    const launch = assertResolvedAgentRuntime({
      harness: "claude-code",
      model: "sonnet",
      permission,
      controls: { reasoningDisplay: false, hookDiagnostics: true },
    })
    expect(launch).toMatchObject({
      model: "sonnet",
      versions: { adapterVersion: "unresolved", protocolVersion: "unresolved" },
      capabilities: { status: "unprobed" },
      controls: { reasoningDisplay: false, hookDiagnostics: true },
    })
  })
})

function probe(runtime: ResolvedAgentRuntime, available: boolean): RuntimeAdapterProbe {
  const reason = available
    ? null
    : {
        code: "adapter-disabled" as const,
        harness: "codex",
        runtime,
        message: "Codex Runtime adapter is disabled.",
        repair: "Enable the adapter or explicitly choose Flapstack Native.",
      }
  return {
    runtime,
    harness: "codex",
    available,
    versions: { adapterVersion: "1", protocolVersion: "1" },
    capabilities: {
      schemaVersion: 1,
      status: available ? "available" : "unavailable",
      capturedAt: "2026-07-14T00:00:00.000Z",
      controls: {
        modelThinking: { supported: true, reason: null },
        reasoningDisplay: { supported: true, reason: null },
        subagentActivity: { supported: true, reason: null },
        hookDiagnostics: { supported: true, reason: null },
      },
      limitations: [],
      unavailableReason: reason,
    },
    reason,
  }
}

function productRuntime(harness: string): ResolvedAgentRuntime {
  return harness === "codex"
    ? "codex"
    : harness === "claude-code"
      ? "claude-code"
      : "flapstack-native"
}

function allowed(harness: string): ResolvedAgentRuntime[] {
  return harness === "codex"
    ? ["codex", "flapstack-native"]
    : harness === "claude-code"
      ? ["claude-code", "flapstack-native"]
      : ["flapstack-native"]
}
