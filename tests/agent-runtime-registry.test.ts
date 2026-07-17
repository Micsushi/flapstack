import { describe, expect, it, vi } from "vitest"
import {
  createAgentRuntimeRegistry,
  RuntimeRegistryError,
} from "../src/main/lib/agent-runtime/registry"
import type {
  HarnessAdapter,
  ResolvedAgentRuntime,
  RuntimeAdapterContext,
  RuntimeAdapterSession,
} from "../src/shared/agent-runtime"

describe("Agent Runtime registry", () => {
  it("registers all three factories once and dispatches by exact Runtime", () => {
    const factories = {
      codex: vi.fn(() => adapter("codex")),
      "claude-code": vi.fn(() => adapter("claude-code")),
      "flapstack-native": vi.fn(() => adapter("flapstack-native")),
    }
    const registry = createAgentRuntimeRegistry(
      Object.entries(factories).map(([runtime, factory]) => ({
        runtime: runtime as ResolvedAgentRuntime,
        factory,
      })),
    )

    expect(registry.list().map((entry) => entry.runtime)).toEqual([
      "codex",
      "claude-code",
      "flapstack-native",
    ])
    expect(registry.forNewLaunch("codex", "codex")).toBe(registry.get("codex"))
    expect(factories.codex).toHaveBeenCalledTimes(1)
    expect(factories["claude-code"]).not.toHaveBeenCalled()
  })

  it("blocks disabled new launches while preserving the adapter for recovery", async () => {
    const registry = createAgentRuntimeRegistry([
      { runtime: "codex", factory: () => adapter("codex") },
    ])
    const existing = registry.get("codex")
    registry.setEnabled("codex", false, "Codex live/package gates are open.")

    expect(() => registry.forNewLaunch("codex", "codex")).toThrowError(
      expect.objectContaining<Partial<RuntimeRegistryError>>({
        reason: expect.objectContaining({ code: "adapter-disabled", runtime: "codex" }),
      }),
    )
    expect(registry.get("codex")).toBe(existing)
    await expect(registry.probe("codex", "codex")).resolves.toMatchObject({
      available: false,
      reason: { code: "adapter-disabled" },
    })
  })

  it("rejects mismatched factories and duplicate registrations", () => {
    expect(() =>
      createAgentRuntimeRegistry([{ runtime: "codex", factory: () => adapter("claude-code") }]).get(
        "codex",
      ),
    ).toThrow("mismatched adapter")
    expect(() =>
      createAgentRuntimeRegistry([
        { runtime: "codex", factory: () => adapter("codex") },
        { runtime: "codex", factory: () => adapter("codex") },
      ]),
    ).toThrow("already registered")
  })

  it("reuses a fresh provider probe across resolution and immediate launch", async () => {
    const value = adapter("codex")
    value.probe = vi.fn(value.probe)
    const registry = createAgentRuntimeRegistry([{ runtime: "codex", factory: () => value }])

    await registry.probe("codex", "codex")
    await registry.probe("codex", "codex")

    expect(value.probe).toHaveBeenCalledTimes(1)
  })
})

function adapter(runtime: ResolvedAgentRuntime): HarnessAdapter {
  return {
    runtime,
    async probe(harness) {
      return {
        runtime,
        harness,
        available: true,
        versions: { adapterVersion: "1", protocolVersion: "1" },
        capabilities: {
          schemaVersion: 1,
          status: "available",
          capturedAt: "2026-07-14T00:00:00.000Z",
          controls: {
            modelThinking: { supported: true, reason: null },
            reasoningDisplay: { supported: true, reason: null },
            subagentActivity: { supported: true, reason: null },
            hookDiagnostics: { supported: true, reason: null },
          },
          limitations: [],
          unavailableReason: null,
        },
        reason: null,
      }
    },
    async startSession() {
      return { providerSessionId: null, providerThreadId: null }
    },
    async resumeSession(_context: RuntimeAdapterContext, session: RuntimeAdapterSession) {
      return session
    },
    async startTurn() {
      return { providerTurnId: null }
    },
    async *streamActivity() {},
    async requestPermission() {},
    async requestInput() {},
    async cancel() {},
    async complete() {},
    async reconcile() {
      return "completed"
    },
    async cleanup() {},
  }
}
