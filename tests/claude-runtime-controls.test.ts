import { describe, expect, it } from "vitest"
import { buildClaudeRuntimeSdkControls } from "../src/main/lib/agent-runtime/claude-code"

describe("Claude Runtime independent controls", () => {
  it("keeps thinking, display, subagent forwarding, and hook diagnostics independent", () => {
    for (const modelThinking of [false, true, null] as const) {
      for (const reasoningDisplay of [false, true]) {
        for (const subagentActivity of [false, true]) {
          for (const hookDiagnostics of [false, true]) {
            const result = buildClaudeRuntimeSdkControls({
              schemaVersion: 1,
              modelEffort: "xhigh",
              modelThinking,
              reasoningDisplay,
              subagentActivity,
              hookDiagnostics,
            })
            expect(result.includePartialMessages).toBe(true)
            expect(result.effort).toBe("xhigh")
            expect(result.forwardSubagentText).toBe(subagentActivity)
            expect(result.includeHookEvents).toBe(hookDiagnostics)
            if (modelThinking === false) {
              expect(result.thinking).toEqual({ type: "disabled" })
            } else if (modelThinking === true || reasoningDisplay === false) {
              expect(result.thinking).toEqual({
                type: "adaptive",
                display: reasoningDisplay ? "summarized" : "omitted",
              })
            } else {
              expect(result.thinking).toBeUndefined()
            }
          }
        }
      }
    }
  })

  it("fails closed for unsupported effort values", () => {
    expect(() =>
      buildClaudeRuntimeSdkControls({
        schemaVersion: 1,
        modelEffort: "future-ultra",
        modelThinking: true,
        reasoningDisplay: true,
        subagentActivity: true,
        hookDiagnostics: false,
      }),
    ).toThrow("Unsupported Claude effort")
  })
})
