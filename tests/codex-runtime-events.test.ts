import { describe, expect, it } from "vitest"
import {
  CodexProtocolDriftError,
  mapCodexNotification,
} from "../src/main/lib/agent-runtime/codex/events"

describe("direct Codex Runtime event mapping", () => {
  it("fails closed on unknown execution and permission semantics", () => {
    expect(() =>
      mapCodexNotification({ method: "turn/futureExecution", params: { threadId: "thread-1" } }),
    ).toThrow(CodexProtocolDriftError)
    expect(() =>
      mapCodexNotification({ method: "item/futurePermission", params: { itemId: "item-1" } }),
    ).toThrow(CodexProtocolDriftError)

    const failed = mapCodexNotification({
      method: "error",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        willRetry: false,
        error: { message: "TERMINAL_ERROR_A" },
      },
    })
    expect(failed).toMatchObject([
      { kind: "lifecycle", phase: "failed", payload: { detail: "TERMINAL_ERROR_A" } },
    ])
  })

  it("preserves current context usage and model window", () => {
    expect(
      mapCodexNotification({
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          tokenUsage: {
            last: {
              inputTokens: 42_057,
              cachedInputTokens: 39_680,
              outputTokens: 470,
              reasoningOutputTokens: 186,
            },
            modelContextWindow: 258_400,
          },
        },
      }),
    ).toMatchObject([
      {
        kind: "usage",
        payload: {
          inputTokens: 42_057,
          cachedTokens: 39_680,
          contextWindow: 258_400,
        },
      },
    ])
  })
})
