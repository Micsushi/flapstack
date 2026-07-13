import { describe, expect, it } from "vitest"
import {
  buildClaudeSessionResumeOptions,
  getOwnedClaudeSessionId,
  resetClaudeSessionOptionsForFreshRun,
} from "../src/main/lib/claude/session-options"

describe("Claude chat-owned session options", () => {
  it("starts a fresh chat without continue or resume", () => {
    expect(
      buildClaudeSessionResumeOptions({
        shouldForkResume: false,
        isUsingOllama: false,
      }),
    ).toEqual({})
  })

  it("resumes only the session stored on the same sub-chat", () => {
    const sessionId = getOwnedClaudeSessionId({
      storedSessionId: "stored-chat-session",
      requestedSessionId: "unrelated-request-session",
    })

    expect(sessionId).toBe("stored-chat-session")
    expect(
      buildClaudeSessionResumeOptions({
        resumeSessionId: sessionId,
        shouldForkResume: false,
        isUsingOllama: false,
      }),
    ).toEqual({ resume: "stored-chat-session" })
  })

  it("clears a missing session and retries as an isolated fresh run", () => {
    const options: Record<string, unknown> = {
      resume: "missing-session",
      resumeSessionAt: "message-id",
      forkSession: true,
      continue: true,
      model: "claude-sonnet",
    }

    resetClaudeSessionOptionsForFreshRun(options)

    expect(options).toEqual({ model: "claude-sonnet" })
  })
})
