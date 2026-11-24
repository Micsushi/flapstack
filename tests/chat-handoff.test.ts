import { describe, expect, it } from "vitest"
import { buildVisibleContextManifest } from "../src/main/lib/agent-runtime/context-manifest"
import { formatChatHandoff } from "../src/main/lib/chat-handoff"

describe("full chat handoff formatter", () => {
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

describe("provider handoff budget", () => {
  const build = (budget?: { maxTokens?: number; maxBytes?: number }) =>
    buildVisibleContextManifest({
      sourceChatId: "source",
      sourceRunId: null,
      budget,
      conversations: [
        {
          subChatId: "sub",
          subChatName: null,
          messages: [
            { id: "old", role: "user", content: "large context ".repeat(9_000) },
            { id: "visible", role: "assistant", content: "latest answer" },
            {
              id: "request",
              role: "user",
              content: "latest request " + String.fromCodePoint(0x1f642).repeat(25_000),
            },
          ],
        },
      ],
    })

  it("caps provider handoffs in UTF-8 with useful recent text and honest omissions", () => {
    const result = build({ maxTokens: 1024, maxBytes: 4700 })
    expect(Buffer.byteLength(result.contextText)).toBeLessThanOrEqual(4096)
    expect(result.contextText).toContain("latest request")
    expect(result.contextText).toContain("latest answer")
    expect(result.contextText).toContain("[Message excerpt]")
    expect(result.contextText).not.toContain(String.fromCodePoint(0xfffd))
    expect(result.manifest.omissions).toContainEqual({ class: "context-budget", count: 2 })
    expect(result.manifest.selected.map((entry) => entry.messageId)).toEqual(["visible", "request"])
  })
})

describe("provider handoff attachments", () => {
  it.each([false, true])("omits local text attachments with compact set to %s", (compact) => {
    const paste = "@[pasted:42:private-paste\r preview|C:\\profile\\pasted_123.txt]"
    const history = "@[chatHistory:124:private-history preview|C:\\profile\\chat-history.md]"
    const result = buildVisibleContextManifest({
      sourceChatId: "source",
      sourceRunId: null,
      compact,
      conversations: [
        {
          subChatId: "sub",
          subChatName: null,
          messages: [
            { role: "user", content: `Previous request ${history}` },
            {
              role: "assistant",
              parts: [
                {
                  type: "tool-AskUserQuestion",
                  input: { questions: [{ question: `Follow-up ${history}` }] },
                },
              ],
            },
            {
              role: "user",
              parts: [{ type: "text", text: `Latest request ${paste} ${history}` }],
            },
          ],
        },
      ],
    })

    expect(result.contextText).toContain("Previous request")
    expect(result.contextText).toContain("Latest request")
    expect(result.contextText).toContain("Follow-up")
    expect(result.contextText).not.toMatch(/private-(paste|history)|C:\\profile/)
    expect(result.manifest.omissions).toContainEqual({ class: "unselected-attachment", count: 3 })
  })
})
