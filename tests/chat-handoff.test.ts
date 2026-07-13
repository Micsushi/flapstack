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
})
