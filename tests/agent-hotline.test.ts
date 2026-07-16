import { describe, expect, it } from "vitest"
import {
  applyAgentHotlineCommands,
  resolveAgentHotlineEnabled,
  stripInactiveAgentHotlineLabels,
} from "../src/shared/agent-hotline"

describe("Agent Hotline conversation state", () => {
  it("keeps read-aloud active across turns until the user turns it off", () => {
    const messages = [
      { role: "user", parts: [{ type: "text", text: "hotline on" }] },
      { role: "assistant", parts: [{ type: "text", text: "Spoken:\nReady." }] },
      { role: "user", parts: [{ type: "text", text: "continue the review" }] },
    ]
    expect(resolveAgentHotlineEnabled(messages)).toBe(true)
    messages.push({ role: "user", parts: [{ type: "text", text: "hotline off" }] })
    expect(resolveAgentHotlineEnabled(messages)).toBe(false)
  })

  it("uses the last command when on and off appear in one request", () => {
    expect(applyAgentHotlineCommands(false, "hotline on, then hotline off")).toBe(false)
    expect(applyAgentHotlineCommands(true, "hotline off; actually hotline on")).toBe(true)
    expect(applyAgentHotlineCommands(true, "spoken mode off")).toBe(false)
  })

  it("removes leaked response labels only while read-aloud is inactive", () => {
    const response = "Spoken: Fixed.\nDisplayed:\nDetails"
    expect(stripInactiveAgentHotlineLabels(response, false)).toBe("Fixed.\n\nDetails")
    expect(stripInactiveAgentHotlineLabels(response, true)).toBe(response)
  })
})
