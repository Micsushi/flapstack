import { describe, expect, it, vi } from "vitest"

import { createPersistedMessageCache } from "../src/renderer/features/agents/main/persisted-message-cache"
import { normalizePersistedMessages } from "../src/renderer/features/agents/main/normalize-persisted-messages"

describe("persisted message cache", () => {
  it("parses and normalizes a payload only once while its identity is unchanged", () => {
    const parse = vi.fn((raw: string) => JSON.parse(raw) as unknown[])
    const normalize = vi.fn((messages: unknown[]) => messages.map((message) => ({ message })))
    const cache = createPersistedMessageCache({ parse, normalize })
    const raw = JSON.stringify([{ id: "one" }])

    const first = cache.read("sub-chat", raw)
    const second = cache.read("sub-chat", raw)

    expect(second).toBe(first)
    expect(parse).toHaveBeenCalledTimes(1)
    expect(normalize).toHaveBeenCalledTimes(1)
  })

  it("reparses when the persisted payload changes", () => {
    const parse = vi.fn((raw: string) => JSON.parse(raw) as unknown[])
    const cache = createPersistedMessageCache({ parse, normalize: (messages) => messages })

    cache.read("sub-chat", "[]")
    cache.read("sub-chat", '[{"id":"two"}]')

    expect(parse).toHaveBeenCalledTimes(2)
  })

  it("releases every retained transcript on clear", () => {
    const parse = vi.fn((raw: string) => JSON.parse(raw) as unknown[])
    const cache = createPersistedMessageCache({ parse, normalize: (messages) => messages })

    cache.read("first", '[{"id":"one"}]')
    cache.read("second", '[{"id":"two"}]')
    cache.clear()
    cache.read("first", '[{"id":"one"}]')
    cache.read("second", '[{"id":"two"}]')

    expect(parse).toHaveBeenCalledTimes(4)
  })

  it("normalizes legacy tool payloads at the transcript boundary", () => {
    const [message] = normalizePersistedMessages([
      {
        id: "assistant",
        parts: [
          {
            type: "tool-invocation",
            toolName: "Read",
            toolInvocationId: "tool-1",
            args: { file_path: "README.md" },
            state: "result",
            result: { success: true },
          },
        ],
      },
    ]) as Array<{ parts: Array<Record<string, unknown>> }>

    expect(message.parts[0]).toMatchObject({
      type: "tool-Read",
      toolCallId: "tool-1",
      input: { file_path: "README.md" },
      state: "output-available",
    })
  })
})
