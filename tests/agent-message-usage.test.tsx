import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  AgentMessageUsage,
  resolveChatTokenUsage,
  resolveMessageTokenUsage,
} from "../src/renderer/features/agents/ui/agent-message-usage"

describe("agent message usage", () => {
  it("counts cached input in Claude message usage", () => {
    expect(
      resolveMessageTokenUsage({
        inputTokens: 2,
        outputTokens: 110,
        cacheReadInputTokens: 22_077,
        totalTokens: 112,
      }),
    ).toEqual({ inputTokens: 2, cachedTokens: 22_077, outputTokens: 110, totalTokens: 22_189 })
  })

  it("does not double-count Codex cached input", () => {
    expect(
      resolveMessageTokenUsage({
        transport: "codex-runtime",
        inputTokens: 42_057,
        outputTokens: 470,
        cacheReadInputTokens: 39_680,
        totalTokens: 42_527,
      }).totalTokens,
    ).toBe(42_527)
  })

  it("deduplicates the live snapshot when calculating chat total", () => {
    expect(
      resolveChatTokenUsage(
        [
          { role: "assistant", metadata: { runId: "run-1", inputTokens: 100, outputTokens: 20 } },
          { role: "assistant", metadata: { runId: "run-2", inputTokens: 200, outputTokens: 30 } },
        ],
        { runId: "run-2", inputTokens: 220, outputTokens: 40 },
      ),
    ).toBe(380)
  })

  it("renders a changing token badge while the message is streaming", () => {
    const html = renderToStaticMarkup(
      <AgentMessageUsage metadata={{ inputTokens: 1_250, outputTokens: 75 }} isStreaming />,
    )

    expect(html).toContain("1.3k")
    expect(html).toContain("Token usage, live")
  })
})
