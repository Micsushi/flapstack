import { describe, expect, it } from "vitest"
import {
  agentProfileBoundedOverrideSchema,
  agentProfileVersionInputSchema,
  DEFAULT_AGENT_CAPABILITY,
  DEFAULT_AGENT_PRESENTATION,
} from "../src/shared/agent-profiles"
import { agentProfileSpeedCompatibility } from "../src/shared/agent-profile-speed"

describe("Agent Profile speed preference", () => {
  it("migrates legacy definitions and launch overrides to no speed request", () => {
    const definition = agentProfileVersionInputSchema.parse({
      base: null,
      personality: null,
      capability: DEFAULT_AGENT_CAPABILITY,
      presentation: DEFAULT_AGENT_PRESENTATION,
      inheritCapabilityFields: [],
      inheritPresentationFields: [],
    })
    const override = agentProfileBoundedOverrideSchema.parse({
      instructionAppend: null,
      modelPreference: null,
      reasoningEffort: "high",
      presentation: null,
    })

    expect(definition.capability.speedPreference).toBeNull()
    expect(override.speedPreference).toBeNull()
  })

  it("keeps effort and speed independent in the typed contract", () => {
    const capability = {
      ...DEFAULT_AGENT_CAPABILITY,
      harness: "codex" as const,
      runtimePreference: "codex" as const,
      modelPreference: "gpt-5.4",
      reasoningEffort: "low" as const,
      speedPreference: "fast" as const,
    }

    expect(capability.reasoningEffort).toBe("low")
    expect(capability.speedPreference).toBe("fast")
    expect(
      agentProfileSpeedCompatibility(capability, {
        preference: "codex",
        resolvedRuntime: "codex",
      }),
    ).toEqual({ compatible: true, serviceTier: "fast" })
  })

  it.each([
    ["claude provider", "claude-code", "claude-code", "claude-opus-4-8"],
    ["unknown model", "codex", "codex", "gpt-future"],
    ["unsupported Codex model", "codex", "codex", "gpt-5.4-mini"],
    ["wrong Runtime", "codex", "flapstack-native", "gpt-5.4"],
  ] as const)(
    "blocks fast mode for %s with a visible repair",
    (_label, harness, runtime, model) => {
      const result = agentProfileSpeedCompatibility(
        {
          ...DEFAULT_AGENT_CAPABILITY,
          harness,
          modelPreference: model,
          speedPreference: "fast",
        },
        {
          preference: runtime,
          resolvedRuntime: runtime,
        },
      )

      expect(result.compatible).toBe(false)
      if (result.compatible) throw new Error("Expected an incompatible speed result.")
      expect(result.code).toBe("speed-unsupported")
      expect(result.message).toContain("Fast")
      expect(result.repair.length).toBeGreaterThan(10)
    },
  )

  it("clears the provider tier when no fast preference is requested", () => {
    expect(
      agentProfileSpeedCompatibility(
        {
          ...DEFAULT_AGENT_CAPABILITY,
          harness: "claude-code",
          modelPreference: null,
          speedPreference: null,
        },
        {
          preference: "claude-code",
          resolvedRuntime: "claude-code",
        },
      ),
    ).toEqual({ compatible: true, serviceTier: null })
  })
})
