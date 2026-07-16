import { describe, expect, it } from "vitest"
import {
  applyChatModeInstruction,
  normalizeChatMode,
  resolveChatModePermission,
} from "../src/shared/chat-mode"

describe("chat modes", () => {
  it("migrates the legacy agent value to write", () => {
    expect(normalizeChatMode("agent")).toBe("write")
  })

  it.each(["plan", "read", "review"] as const)("forces %s mode to read-only", (mode) => {
    expect(resolveChatModePermission(mode, "full-access")).toBe("read-only")
  })

  it("adds durable review instructions without changing the visible request", () => {
    const prompt = applyChatModeInstruction("Review this patch", "review")
    expect(prompt).toContain("Lead with concrete bugs")
    expect(prompt).toContain("Review this patch")
  })
})
