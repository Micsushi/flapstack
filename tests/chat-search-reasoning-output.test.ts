import { describe, expect, it } from "vitest"
import { extractSearchableText } from "../src/renderer/features/agents/search/chat-search-utils"

describe("chat search visible reasoning output", () => {
  it("includes completed reasoning-output text without indexing other tool input", () => {
    const results = extractSearchableText([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "tool-ReasoningOutput", input: { text: "Investigate the failing test." } },
          { type: "tool-Bash", input: { command: "secret command" } },
        ],
      },
    ] as any)

    expect(results).toEqual([
      {
        messageId: "assistant-1",
        partIndex: 0,
        partType: "tool-ReasoningOutput",
        text: "Investigate the failing test.",
      },
    ])
  })
})
