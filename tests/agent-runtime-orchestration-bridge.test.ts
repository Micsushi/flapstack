import { describe, expect, it } from "vitest"
import { orchestrationAgentDefinitionSchema } from "../src/shared/agent-orchestration"

describe("Runtime orchestration worker boundary", () => {
  const base = {
    agentId: "worker",
    role: "reviewer",
    prompt: "Review the patch.",
    harness: "codex",
    permissionMode: "read-only",
    worktreeStrategy: "inherit",
    dependencyAgentIds: [],
    completionCriteria: "Report concrete findings.",
  } as const

  it.each([
    "auto",
    "codex",
    "codex-enhanced",
    "claude-code",
    "claude-code-enhanced",
    "flapstack-native",
  ] as const)(
    "accepts optional worker Runtime override %s without engine coupling",
    (runtimePreference) => {
      const worker = orchestrationAgentDefinitionSchema.parse({ ...base, runtimePreference })
      expect(worker.runtimePreference).toBe(runtimePreference)
      expect(worker).not.toHaveProperty("coordinationEngine")
    },
  )

  it("rejects unknown Runtime and incompatible override remains launch-seam authority", () => {
    expect(
      orchestrationAgentDefinitionSchema.safeParse({ ...base, runtimePreference: "codex-v2" })
        .success,
    ).toBe(false)

    const claudeWorker = orchestrationAgentDefinitionSchema.parse({
      ...base,
      harness: "claude-code",
      runtimePreference: "codex",
    })
    expect(claudeWorker.runtimePreference).toBe("codex")
    // Schema records operator intent; the shared Runtime resolver performs the
    // harness compatibility intersection before any provider spawn.
  })
})
