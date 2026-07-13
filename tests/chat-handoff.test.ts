import { describe, expect, it } from "vitest"
import { formatChatHandoff } from "../src/main/lib/chat-handoff"

describe("full chat handoff formatter", () => {
  it("keeps complete cross-conversation history in chronological order", () => {
    const result = formatChatHandoff(
      {
        chat: { id: "chat-1", name: "Release", branch: "codex/stage3" },
        project: { name: "Flapstack" },
        conversations: [
          {
            subChatId: "visible",
            subChatName: "Main",
            messages: [
              {
                id: "msg-1783920402000",
                role: "assistant",
                parts: [{ type: "text", text: "second" }],
              },
            ],
          },
          {
            subChatId: "legacy",
            subChatName: "Recovered",
            messages: [
              {
                id: "msg-1783920401000",
                role: "user",
                parts: [
                  { type: "text", text: "first" },
                  { type: "tool-Read", toolName: "Read", input: { file_path: "/tmp/a.ts" } },
                ],
              },
            ],
          },
        ],
      },
      new Date("2026-07-13T10:00:00.000Z"),
    )

    expect(result).toContain("# Flapstack Chat Handoff")
    expect(result).toContain("Legacy recovery: Recovered")
    expect(result).toContain("> Tool: Read: /tmp/a.ts")
    expect(result.indexOf("first")).toBeLessThan(result.indexOf("second"))
  })

  it("does not truncate long history", () => {
    const longText = "x".repeat(60_000)
    const result = formatChatHandoff({
      chat: { id: "chat-2", name: "Long" },
      conversations: [
        {
          subChatId: "visible",
          subChatName: null,
          messages: [{ role: "user", parts: [{ type: "text", text: longText }] }],
        },
      ],
    })
    expect(result).toContain(longText)
  })

  it("preserves persisted conversation order when any timestamp is unavailable", () => {
    const result = formatChatHandoff({
      chat: { id: "chat-3", name: "Legacy" },
      conversations: [
        {
          subChatId: "visible",
          subChatName: null,
          messages: [{ role: "user", parts: [{ type: "text", text: "unknown-time" }] }],
        },
        {
          subChatId: "legacy",
          subChatName: null,
          messages: [
            {
              id: "msg-1000000000000",
              role: "assistant",
              parts: [{ type: "text", text: "known-time" }],
            },
          ],
        },
      ],
    })
    expect(result.indexOf("unknown-time")).toBeLessThan(result.indexOf("known-time"))
  })

  it("copies visible reasoning, questions, answers, and safe tool summaries only", () => {
    const result = formatChatHandoff({
      chat: { id: "chat-4", name: "Visible content" },
      conversations: [
        {
          subChatId: "visible",
          subChatName: null,
          messages: [
            {
              role: "assistant",
              metadata: { privateChain: "never-copy-metadata" },
              parts: [
                {
                  type: "reasoning",
                  text: "Visible provider reasoning",
                  opaque: "never-copy-opaque",
                },
                {
                  type: "tool-AskUserQuestion",
                  input: {
                    questions: [{ question: "Which branch?", secret: "never-copy-secret" }],
                    privatePrompt: "never-copy-private-prompt",
                  },
                  result: { answers: { branch: "codex/f13" }, internal: "never-copy-internal" },
                },
                {
                  type: "tool-Bash",
                  input: { command: "npm test\n--hidden", privateToken: "never-copy-tool-token" },
                  output: { stdout: "never-copy-tool-output" },
                },
              ],
            },
            { role: "user", content: "Legacy visible content" },
          ],
        },
      ],
    })

    expect(result).toContain("> Reasoning: Visible provider reasoning")
    expect(result).toContain("> Question: Which branch?")
    expect(result).toContain("> Answer: codex/f13")
    expect(result).toContain("> Tool: Bash")
    expect(result).not.toContain("npm test")
    expect(result).toContain("Legacy visible content")
    for (const excluded of [
      "never-copy-metadata",
      "never-copy-opaque",
      "never-copy-secret",
      "never-copy-private-prompt",
      "never-copy-internal",
      "never-copy-tool-token",
      "never-copy-tool-output",
      "--hidden",
    ]) {
      expect(result).not.toContain(excluded)
    }
  })

  it("never copies secrets from tool commands, queries, or URLs", () => {
    const secrets = [
      "API_KEY=sk-live-command-secret",
      "Bearer bearer-command-secret",
      "https://hooks.example.test/services/webhook-secret",
      "https://example.test/file?X-Amz-Signature=signed-secret&token=query-secret",
    ]
    const result = formatChatHandoff({
      chat: { id: "chat-secret", name: "Secret tools" },
      conversations: [
        {
          subChatId: "visible",
          subChatName: null,
          messages: [
            {
              role: "assistant",
              parts: [
                { type: "tool-Bash", input: { command: secrets[0] } },
                { type: "tool-curl", input: { command: `curl -H '${secrets[1]}' /` } },
                { type: "tool-Webhook", input: { url: secrets[2] } },
                { type: "tool-WebFetch", input: { query: secrets[3] } },
              ],
            },
          ],
        },
      ],
    })

    expect(result).toContain("> Tool: Bash")
    expect(result).toContain("> Tool: Webhook")
    for (const secret of secrets) expect(result).not.toContain(secret)
    expect(result).not.toMatch(/sk-live|bearer-command|webhook-secret|signed-secret|query-secret/i)
  })
})
