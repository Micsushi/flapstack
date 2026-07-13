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

  it("finds the same visible reasoning after persisted history reload", () => {
    const persisted = JSON.stringify([
      {
        id: "assistant-reloaded",
        role: "assistant",
        metadata: { durationMs: 4_200 },
        parts: [
          {
            type: "tool-ReasoningOutput",
            input: { text: "Reloaded provider-visible reasoning." },
            opaque: { encrypted: "private" },
          },
        ],
      },
    ])
    const reloaded = JSON.parse(persisted)
    const results = extractSearchableText(reloaded)
    expect(results).toEqual([
      {
        messageId: "assistant-reloaded",
        partIndex: 0,
        partType: "tool-ReasoningOutput",
        text: "Reloaded provider-visible reasoning.",
      },
    ])
    expect(JSON.stringify(results)).not.toContain("private")
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

  it("indexes visible structured questions and answers without arbitrary tool input", () => {
    const results = extractSearchableText([
      {
        id: "assistant-question",
        role: "assistant",
        parts: [
          {
            type: "tool-AskUserQuestion",
            input: {
              questions: [{ question: "Which branch should I use?", secret: "hidden" }],
              privatePrompt: "do not index",
            },
            result: { answers: { branch: "codex/feature" } },
          },
        ],
      },
    ] as any)

    expect(results.map((result) => result.text)).toEqual([
      "Which branch should I use?",
      "codex/feature",
    ])
  })
})
