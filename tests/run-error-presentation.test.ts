import { describe, expect, it } from "vitest"
import {
  presentRunError,
  shouldShowPersistedRunFailure,
} from "../src/renderer/features/agents/main/run-error-presentation"

describe("run error presentation", () => {
  it("identifies Windows launch permission failures without calling them usage limits", () => {
    expect(presentRunError("Codex App Server probe failed: spawn EPERM", "win32")).toEqual({
      title: "Codex couldn’t start",
      message:
        "Windows blocked Flapstack from starting the Codex App Server. This is a local launch or permissions problem, not a usage-limit error.",
      technicalDetail: "Codex App Server probe failed: spawn EPERM",
    })
  })

  it("identifies Linux launch permission failures without calling them usage limits", () => {
    expect(
      presentRunError("Codex App Server probe failed: spawn /opt/flapstack/codex EACCES", "linux"),
    ).toEqual({
      title: "Codex couldn’t start",
      message:
        "Linux blocked Flapstack from starting the Codex App Server. Check executable permissions and mount options, then retry.",
      technicalDetail: "Codex App Server probe failed: spawn /opt/flapstack/codex EACCES",
    })
  })

  it("labels actual provider usage and rate-limit errors", () => {
    expect(presentRunError("429 insufficient_quota: rate limit exceeded")).toMatchObject({
      title: "Usage limit reached",
      message: expect.stringContaining("usage"),
    })
  })

  it("does not relabel a provider permission denial as a local launch failure", () => {
    expect(presentRunError("Provider permission denied", "linux")).toEqual({
      title: "Run failed",
      message: "Provider permission denied",
      technicalDetail: null,
    })
  })

  it("does not claim exhausted usage or a known reset for a bare rate limit", () => {
    const result = presentRunError("HTTP 429 Too Many Requests")
    expect(result.title).toBe("Provider rate limit")
    expect(result.message).not.toMatch(/out of usage|wait for the reset/i)
    expect(result.technicalDetail).toBe("HTTP 429 Too Many Requests")
  })

  it("preserves generation failures instead of claiming a usage limit", () => {
    expect(presentRunError("Failed to generate a response").title).toBe("Run failed")
    expect(presentRunError("Connection to port 429 closed").title).toBe("Run failed")
  })

  it("keeps an unknown provider error visible", () => {
    expect(presentRunError("Provider connection closed")).toEqual({
      title: "Run failed",
      message: "Provider connection closed",
      technicalDetail: null,
    })
  })
})

describe("persisted failed intent recovery", () => {
  const failed = {
    id: "failed-run",
    subChatId: "conversation",
    status: "failure",
    promptMessageId: "prompt",
  }
  const input = {
    run: failed,
    subChatId: "conversation",
    messages: [
      { id: "prompt", role: "user" },
      { id: "partial", role: "assistant" },
    ],
    status: "ready",
    retryingRunId: null,
  }

  it("restores a failed last intent even when partial assistant output was saved", () => {
    expect(shouldShowPersistedRunFailure(input)).toBe(true)
  })

  it("does not attach an older failure to a newer prompt or sibling conversation", () => {
    expect(
      shouldShowPersistedRunFailure({
        ...input,
        messages: [...input.messages, { id: "new-prompt", role: "user" }],
      }),
    ).toBe(false)
    expect(shouldShowPersistedRunFailure({ ...input, subChatId: "sibling" })).toBe(false)
    expect(
      shouldShowPersistedRunFailure({ ...input, run: { ...failed, promptMessageId: null } }),
    ).toBe(false)
  })

  it.each(["pending", "running", "success", "cancelled"])(
    "uses the latest %s result instead of a historical failure",
    (status) => {
      expect(
        shouldShowPersistedRunFailure({ ...input, run: { ...failed, id: "newer-run", status } }),
      ).toBe(false)
    },
  )

  it.each(["submitted", "streaming"])("does not show a cached failure while %s", (status) => {
    expect(shouldShowPersistedRunFailure({ ...input, status })).toBe(false)
  })

  it("suppresses only the retried row and surfaces a newly failed retry", () => {
    expect(shouldShowPersistedRunFailure({ ...input, retryingRunId: failed.id })).toBe(false)
    expect(
      shouldShowPersistedRunFailure({
        ...input,
        retryingRunId: failed.id,
        run: { ...failed, id: "retry-failed" },
      }),
    ).toBe(true)
  })
})
