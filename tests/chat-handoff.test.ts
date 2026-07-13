import { describe, expect, it } from "vitest"
import { formatChatHandoff } from "../src/main/lib/chat-handoff"
import {
  omitHiddenFileContentFromMessage,
  stringifyVisibleMessageJson,
} from "../src/shared/chat-visible-content"

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
    expect(result).toContain("> Tool: Read")
    expect(result).not.toContain("/tmp/a.ts")
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

  it("exports names only for secret-bearing tool path fields", () => {
    const secrets = [
      "/tmp/password=hunter2",
      "https://user:pass@example.com/private",
      "Basic dXNlcjpwYXNz",
      "/tmp/sk-proj-1234567890",
      "/tmp/file?X-Amz-Signature=abc&token=def",
      "/hooks/webhook/super-secret-value",
    ]
    const result = formatChatHandoff({
      chat: { id: "chat-secret-paths", name: "Secret paths" },
      conversations: [
        {
          subChatId: "visible",
          subChatName: null,
          messages: [
            {
              role: "assistant",
              parts: secrets.map((secret, index) => ({
                type: index % 2 === 0 ? "tool-Read" : "tool-call",
                toolName: `Tool${index}`,
                input: index % 2 === 0 ? { file_path: secret } : { path: secret },
              })),
            },
          ],
        },
      ],
    })

    for (let index = 0; index < secrets.length; index += 1) {
      expect(result).toContain(`> Tool: Tool${index}`)
      expect(result).not.toContain(secrets[index])
    }
  })

  it("excludes hidden file content from current, legacy, handoff, and JSON export shapes", () => {
    const hidden = "sk-proj-hidden-file-secret"
    const messages = [
      {
        role: "user",
        parts: [
          { type: "text", text: "visible current text" },
          { type: "file-content", content: hidden, name: "safe-name.txt" },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "visible legacy text" },
          { type: "file-content", text: hidden, name: "legacy-name.txt" },
        ],
      },
    ]
    const result = formatChatHandoff({
      chat: { id: "chat-file-content", name: "Hidden files" },
      conversations: [{ subChatId: "visible", subChatName: null, messages }],
    })
    expect(result).toContain("visible current text")
    expect(result).toContain("visible legacy text")
    expect(result).not.toContain(hidden)

    const json = JSON.stringify(messages.map(omitHiddenFileContentFromMessage))
    expect(json).not.toContain(hidden)
    expect(json).not.toContain("file-content")
  })

  it("sanitizes current, legacy, and nested hidden file content for dev JSON", () => {
    const hidden = "never-render-or-copy-this-file"
    const json = stringifyVisibleMessageJson({
      role: "user",
      parts: [
        { type: "file-content", content: hidden },
        { type: "text", text: "visible" },
      ],
      content: [{ type: "file-content", text: hidden }],
      legacyEnvelope: { items: [{ type: "file-content", data: hidden }] },
    })

    expect(json).toContain("visible")
    expect(json).not.toContain(hidden)
    expect(json).not.toContain("file-content")
  })
})
