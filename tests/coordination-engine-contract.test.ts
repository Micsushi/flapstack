import { describe, expect, it } from "vitest"
import {
  COORDINATION_ENGINE_VERSIONS,
  PROFILE_PROMOTION_BOUNDARY,
  type CoordinationEngine,
  type CoordinationEngineProbe,
} from "../src/shared/coordination-engine"
import {
  CoordinationEngineError,
  createDefaultCoordinationEngineProbes,
  interpretCoordinationEngineSnapshot,
  previewCoordinationEngine,
  resolveCoordinationEngine,
} from "../src/main/lib/agent-orchestration/coordination-engine"

describe("coordination engine contract", () => {
  it.each([
    [
      "per-launch",
      { perLaunchEngine: "workflow", projectEngine: "codex-v2", globalEngine: "codex-v1" },
    ],
    ["project", { projectEngine: "workflow", globalEngine: "codex-v1" }],
    ["global", { globalEngine: "workflow" }],
    ["product", {}],
  ] as const)("resolves %s precedence and defaults to workflow", (source, input) => {
    const result = resolveCoordinationEngine(input)
    expect(result).toMatchObject({
      ok: true,
      snapshot: { source, engine: "workflow", engineVersion: "workflow-v1" },
    })
  })

  it("keeps precedence invariant across arbitrary lower-priority values", () => {
    const engines: CoordinationEngine[] = ["workflow", "codex-v2", "codex-v1"]
    for (const projectEngine of engines) {
      for (const globalEngine of engines) {
        const result = resolveCoordinationEngine({
          perLaunchEngine: "workflow",
          projectEngine,
          globalEngine,
        })
        expect(result).toMatchObject({
          ok: true,
          snapshot: { source: "per-launch", engine: "workflow" },
        })
      }
    }
  })

  it("blocks unavailable V2 without silently selecting workflow", () => {
    const result = resolveCoordinationEngine({ perLaunchEngine: "codex-v2" })
    expect(result).toMatchObject({
      ok: false,
      reason: { engine: "codex-v2", code: "engine-capability-missing" },
    })
    const preview = previewCoordinationEngine({ perLaunchEngine: "codex-v2" })
    expect(preview.resolved).toBeNull()
    expect(preview.requestedEngine).toBe("codex-v2")
  })

  it.each([
    (probe: CoordinationEngineProbe) => ({ ...probe, engine: "workflow" as const }),
    (probe: CoordinationEngineProbe) => ({ ...probe, engineVersion: "wrong" }),
    (probe: CoordinationEngineProbe) => ({
      ...probe,
      snapshot: { ...probe.snapshot, engine: "workflow" as const },
    }),
    (probe: CoordinationEngineProbe) => ({
      ...probe,
      snapshot: { ...probe.snapshot, engineVersion: "wrong" },
    }),
    (probe: CoordinationEngineProbe) => ({
      ...probe,
      snapshot: { ...probe.snapshot, status: "unavailable" as const },
    }),
    (probe: CoordinationEngineProbe) => ({
      ...probe,
      snapshot: { ...probe.snapshot, capturedAt: null },
    }),
    (probe: CoordinationEngineProbe) => ({
      ...probe,
      snapshot: { ...probe.snapshot, limitations: ["x".repeat(1_001)] },
    }),
    (probe: CoordinationEngineProbe) => ({
      ...probe,
      reason: {
        code: "engine-unavailable" as const,
        engine: "workflow" as const,
        message: "mismatch",
        missingCapabilities: [],
        repair: "repair",
      },
    }),
  ])("fails closed for incoherent caller probe %#", (mutate) => {
    const v2 = availableProbe("codex-v2")
    const result = resolveCoordinationEngine({
      perLaunchEngine: "codex-v2",
      probes: { "codex-v2": mutate(v2) as CoordinationEngineProbe },
    })
    expect(result).toMatchObject({
      ok: false,
      reason: { code: "engine-version-unsupported", engine: "codex-v2" },
    })
  })

  it.each([
    ["workflow", []],
    ["codex-v2", ["named-task-paths"]],
    ["codex-v1", []],
  ] as const)(
    "blocks available %s probe missing its minimum capabilities",
    (engine, capabilities) => {
      const probe = availableProbe(engine)
      const result = resolveCoordinationEngine({
        perLaunchEngine: engine,
        probes: {
          [engine]: {
            ...probe,
            snapshot: { ...probe.snapshot, capabilities: [...capabilities] },
          },
        },
      })
      expect(result).toMatchObject({
        ok: false,
        reason: {
          code: "engine-capability-missing",
          engine,
          missingCapabilities: expect.arrayContaining([expect.any(String)]),
        },
      })
    },
  )

  it("rejects unavailable probes whose duplicated reason metadata disagrees", () => {
    const probe = createDefaultCoordinationEngineProbes()["codex-v2"]
    const result = resolveCoordinationEngine({
      perLaunchEngine: "codex-v2",
      probes: {
        "codex-v2": {
          ...probe,
          snapshot: {
            ...probe.snapshot,
            unavailableReason: {
              ...probe.reason!,
              repair: "Different repair.",
            },
          },
        },
      },
    })
    expect(result).toMatchObject({
      ok: false,
      reason: { code: "engine-version-unsupported", engine: "codex-v2" },
    })
  })

  it("validates durable snapshot identity instead of blind casting", () => {
    const good = availableProbe("codex-v2")
    const row = {
      engine_snapshot_version: 1,
      coordination_engine: "codex-v2",
      coordination_engine_version: good.engineVersion,
      coordination_engine_source: "per-launch",
      coordination_engine_capability_snapshot: JSON.stringify(good.snapshot),
      coordination_engine_provider_identity: "null",
    }
    expect(interpretCoordinationEngineSnapshot(row)).toMatchObject({ engine: "codex-v2" })
    expect(() =>
      interpretCoordinationEngineSnapshot({
        ...row,
        coordination_engine_capability_snapshot: JSON.stringify({
          ...good.snapshot,
          engine: "workflow",
        }),
      }),
    ).toThrowError(CoordinationEngineError)
    expect(() =>
      interpretCoordinationEngineSnapshot({
        ...row,
        coordination_engine_source: "unknown-source",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CoordinationEngineError>>({
        reason: expect.objectContaining({ engine: "codex-v2" }),
      }),
    )
    expect(() =>
      interpretCoordinationEngineSnapshot({
        ...row,
        coordination_engine_provider_identity: JSON.stringify({
          schemaVersion: 1,
          engine: "codex-v2",
          canonicalTaskPath: "/root/reviewer",
          taskName: "",
          providerTaskId: null,
        }),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<CoordinationEngineError>>({
        reason: expect.objectContaining({ engine: "codex-v2" }),
      }),
    )
    expect(() =>
      interpretCoordinationEngineSnapshot({
        ...row,
        coordination_engine_provider_identity: JSON.stringify({
          schemaVersion: 1,
          engine: "codex-v1",
          providerAgentId: "a",
          nickname: null,
        }),
      }),
    ).toThrowError(CoordinationEngineError)
    expect(() =>
      interpretCoordinationEngineSnapshot({
        ...row,
        coordination_engine_capability_snapshot: "{",
      }),
    ).toThrowError(CoordinationEngineError)
  })

  it("interprets only canonical version-zero rows as legacy workflow history", () => {
    const legacy = {
      engine_snapshot_version: 0,
      coordination_engine: "workflow",
      coordination_engine_version: "workflow-legacy-graph",
      coordination_engine_source: "legacy",
    }
    expect(interpretCoordinationEngineSnapshot(legacy)).toMatchObject({
      source: "legacy",
      engine: "workflow",
      engineVersion: "workflow-legacy-graph",
    })
    expect(() =>
      interpretCoordinationEngineSnapshot({ ...legacy, coordination_engine: "codex-v1" }),
    ).toThrowError(CoordinationEngineError)
  })

  it("keeps profile presentation separate from capability, workflow, and Runtime", () => {
    expect(PROFILE_PROMOTION_BOUNDARY).toMatchObject({
      schemaVersion: 1,
      capabilityProfile: expect.stringContaining("permissions"),
      presentationStyle: expect.stringContaining("Tone"),
      workflowBinding: expect.stringContaining("Topology"),
      runtimeSnapshot: expect.stringContaining("Immutable"),
      authorityRule: expect.stringContaining("cannot widen"),
    })
  })

  it("keeps default probe versions coherent", () => {
    const probes = createDefaultCoordinationEngineProbes("2026-07-14T00:00:00.000Z")
    expect(probes.workflow).toMatchObject({ available: true, engineVersion: "workflow-v1" })
    expect(probes["codex-v2"].reason?.repair).toMatch(/Codex Runtime/i)
    expect(probes["codex-v1"].reason?.message).toMatch(/V1/i)
  })
})

function availableProbe(engine: CoordinationEngine): CoordinationEngineProbe {
  const defaults = createDefaultCoordinationEngineProbes("2026-07-14T00:00:00.000Z")
  const capabilities =
    engine === "codex-v2"
      ? ([
          "named-task-paths",
          "selective-context-fork",
          "queued-messages",
          "follow-up",
          "mailbox",
          "interrupt-without-destroy",
          "resident-workers",
        ] as const)
      : engine === "codex-v1"
        ? (["legacy-agent-ids", "legacy-resume", "legacy-close"] as const)
        : defaults[engine].snapshot.capabilities
  return {
    engine,
    available: true,
    engineVersion: COORDINATION_ENGINE_VERSIONS[engine],
    snapshot: {
      schemaVersion: 1,
      engine,
      engineVersion: COORDINATION_ENGINE_VERSIONS[engine],
      status: "available",
      capturedAt: "2026-07-14T00:00:00.000Z",
      capabilities: [...capabilities],
      limitations: [],
      unavailableReason: null,
    },
    reason: null,
  }
}
