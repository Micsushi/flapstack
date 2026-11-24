import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createCodexPermissionDecision,
  resolveCodexPermissionOption,
  summarizeCodexPermissionRequest,
  listPendingCodexPermissionRequests,
  registerPendingCodexPermissionRequest,
  replyPendingCodexPermissionRequest,
} from "../src/main/lib/codex/permission-bridge"

afterEach(() => {
  vi.useRealTimers()
})

const options = [
  { optionId: "allow-once", name: "Allow once", kind: "allow_once" as const },
  { optionId: "allow-always", name: "Always allow", kind: "allow_always" as const },
  { optionId: "reject-once", name: "Reject", kind: "reject_once" as const },
]

describe("Codex ACP permission bridge", () => {
  it("accepts only an exact provider option and rejects unknown ids", () => {
    expect(resolveCodexPermissionOption({ options }, "allow-once")).toEqual({
      outcome: { outcome: "selected", optionId: "allow-once" },
    })
    expect(resolveCodexPermissionOption({ options }, "invented-allow")).toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    })
  })

  it("summarizes pending requests without exposing raw input or metadata", () => {
    const summary = summarizeCodexPermissionRequest({
      requestId: "request-1",
      subChatId: "sub-chat-1",
      runId: "run-1",
      request: {
        toolCall: {
          toolCallId: "tool-1",
          title: "Write release marker",
          kind: "edit",
          rawInput: { secret: "must-not-return" },
        },
        options,
        _meta: { private: "must-not-return" },
      },
    })

    expect(summary).toMatchObject({ requestId: "request-1", title: "Write release marker" })
    expect(JSON.stringify(summary)).not.toContain("must-not-return")
  })

  it("lists and resolves only the exact registered pending request", () => {
    const resolve = vi.fn()
    registerPendingCodexPermissionRequest("request-live", {
      subChatId: "sub-chat-live",
      runId: "run-live",
      request: {
        toolCall: { toolCallId: "tool-live", title: "Write marker", kind: "edit" },
        options,
      },
      resolve,
    })

    expect(listPendingCodexPermissionRequests({ runId: "run-live" })).toEqual([
      expect.objectContaining({ requestId: "request-live", runId: "run-live" }),
    ])
    expect(
      replyPendingCodexPermissionRequest({ requestId: "request-live", optionId: "unknown" }),
    ).toEqual({ resolved: true })
    expect(resolve).toHaveBeenCalledWith({
      outcome: { outcome: "selected", optionId: "reject-once" },
    })
    expect(listPendingCodexPermissionRequests({ runId: "run-live" })).toEqual([])
  })

  it("rejects pending approval when its run aborts", async () => {
    const controller = new AbortController()
    const decision = createCodexPermissionDecision({
      request: { options },
      signal: controller.signal,
      timeoutMs: 60_000,
    })

    controller.abort()
    await expect(decision.promise).resolves.toEqual({
      outcome: { outcome: "selected", optionId: "reject-once" },
    })
  })
})
