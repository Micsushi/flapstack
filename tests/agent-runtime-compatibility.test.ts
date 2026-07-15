import { describe, expect, it } from "vitest"
import {
  allowedRuntimesForHarness,
  checkRuntimeCompatibility,
  productRuntimeForHarness,
} from "../src/main/lib/agent-runtime/compatibility"
import { RESOLVED_AGENT_RUNTIMES } from "../src/shared/agent-runtime"

const matrix = {
  codex: ["codex", "flapstack-native"],
  "claude-code": ["claude-code", "flapstack-native"],
  "cursor-agent": ["flapstack-native"],
  openrouter: ["flapstack-native"],
  nanogpt: ["flapstack-native"],
  local: ["flapstack-native"],
  custom: ["flapstack-native"],
  generic: ["flapstack-native"],
  "future-provider": ["flapstack-native"],
} as const

describe("Agent Runtime compatibility", () => {
  for (const [harness, allowed] of Object.entries(matrix)) {
    it(`${harness} exposes its full compatibility row`, () => {
      expect(allowedRuntimesForHarness(harness)).toEqual(allowed)
      for (const runtime of RESOLVED_AGENT_RUNTIMES) {
        const result = checkRuntimeCompatibility(harness, runtime)
        expect(result.compatible).toBe(allowed.includes(runtime as never))
        if (!result.compatible) {
          expect(result.reason).toMatchObject({
            code: "runtime-incompatible",
            harness,
            runtime,
          })
          expect(result.reason.repair).toContain("flapstack-native")
        }
      }
    })
  }

  it("maps product defaults by harness, never model vendor", () => {
    expect(productRuntimeForHarness("codex")).toBe("codex")
    expect(productRuntimeForHarness("claude-code")).toBe("claude-code")
    expect(productRuntimeForHarness("openrouter")).toBe("flapstack-native")
    expect(productRuntimeForHarness("custom-openai")).toBe("flapstack-native")
  })
})
