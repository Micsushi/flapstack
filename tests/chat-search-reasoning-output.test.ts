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

  it("includes standard reasoning parts used by Cursor and OpenCode", () => {
    const results = extractSearchableText([
      {
        id: "assistant-2",
        role: "assistant",
        parts: [{ type: "reasoning", text: "Compare the provider responses." }],
      },
    ] as any)

    expect(results).toEqual([
      {
        messageId: "assistant-2",
        partIndex: 0,
        partType: "reasoning",
        text: "Compare the provider responses.",
      },
    ])
  })

  it("indexes visible file-content parts so scoped results can highlight in chat", () => {
    const results = extractSearchableText([
      {
        id: "user-file",
        role: "user",
        parts: [{ type: "file-content", content: "needle inside attachment" }],
      },
    ] as any)
    expect(results).toContainEqual({
      messageId: "user-file",
      partIndex: 0,
      partType: "text",
      text: "needle inside attachment",
    })
  })
})
