import { describe, expect, it } from "vitest"
import {
  FLAPSTACK_MCP_INSTRUCTIONS,
  prependFlapstackMcpGuidance,
} from "../src/main/lib/mcp-control/guidance"

describe("Flapstack MCP model guidance", () => {
  it("explains cross-provider child agents without replacing the user prompt", () => {
    const prompt = "Can you create a Cursor subagent?"
    const guided = prependFlapstackMcpGuidance(prompt, true)

    expect(FLAPSTACK_MCP_INSTRUCTIONS).toContain("across supported providers")
    expect(FLAPSTACK_MCP_INSTRUCTIONS).toContain("without requiring the user to say MCP")
    expect(guided).toContain("Use spawn_thread")
    expect(guided).toContain("orchestrate_task")
    expect(guided).toContain(prompt)
  })

  it("leaves prompts untouched when product MCP is disabled", () => {
    expect(prependFlapstackMcpGuidance("hello", false)).toBe("hello")
  })
})
