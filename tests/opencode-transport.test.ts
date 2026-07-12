// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"

vi.mock("../src/renderer/lib/trpc", () => ({ trpcClient: {} }))
vi.mock("sonner", () => ({ toast: {} }))

import {
  normalizeOpencodeTransportChunk,
  OpencodeChatTransport,
} from "../src/renderer/features/agents/lib/opencode-chat-transport"

describe("OpenCode renderer transport", () => {
  it("converts authentication failures into normal AI SDK error chunks", () => {
    expect(normalizeOpencodeTransportChunk({ type: "auth-error", errorText: "bad key" })).toEqual({
      type: "error",
      errorText: "bad key",
    })
  })

  it("updates model/provider configuration without retaining stale launch state", () => {
    const transport = new OpencodeChatTransport({
      chatId: "chat",
      subChatId: "subchat",
      cwd: "/old",
      provider: "openrouter",
      model: "openrouter/old",
    })
    transport.updateConfig({ cwd: "/new", provider: "nanogpt", model: "nanogpt/new" })
    expect(transport.getConfig()).toMatchObject({
      cwd: "/new",
      provider: "nanogpt",
      model: "nanogpt/new",
    })
  })
})
