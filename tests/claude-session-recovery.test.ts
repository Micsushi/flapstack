import { describe, expect, it } from "vitest"
import {
  findMissingClaudeSessionMessage,
  isMissingClaudeSessionError,
} from "../src/main/lib/claude/session-recovery"

describe("Claude session recovery", () => {
  it("detects missing-session errors from Claude result payloads", () => {
    const payload = {
      type: "result",
      subtype: "error_during_execution",
      errors: ["No conversation found with session ID: abc-123"],
    }

    expect(isMissingClaudeSessionError(payload)).toBe(true)
    expect(findMissingClaudeSessionMessage(payload)).toBe(
      "No conversation found with session ID: abc-123",
    )
  })

  it("detects missing-session errors from thrown process text", () => {
    expect(
      isMissingClaudeSessionError(
        "Process exited with code 1",
        "No conversation found with session ID: stale-session",
      ),
    ).toBe(true)
  })

  it("does not treat unrelated process exits as missing sessions", () => {
    expect(isMissingClaudeSessionError("Process exited with code 1")).toBe(false)
  })
})
