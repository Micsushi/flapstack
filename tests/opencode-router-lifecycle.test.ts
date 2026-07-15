import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getProviderKeyAsync: vi.fn(),
  getAvailableProviderModels: vi.fn(),
  refreshProviderModels: vi.fn(),
}))

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/flapstack-opencode-router-test", isPackaged: false },
}))

vi.mock("../src/main/lib/harness/opencode-sidecar/credentials", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/main/lib/harness/opencode-sidecar/credentials")
  >()),
  getProviderKeyAsync: mocks.getProviderKeyAsync,
}))

vi.mock("../src/main/lib/harness/opencode-sidecar/models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/main/lib/harness/opencode-sidecar/models")>()),
  getAvailableProviderModels: mocks.getAvailableProviderModels,
  refreshProviderModels: mocks.refreshProviderModels,
}))

vi.mock("../src/main/lib/mcp-control/exposure", () => ({
  getChatMcpExposure: () => false,
  registerActiveProductMcpSession: () => () => undefined,
}))

import {
  hasActiveOpencodeStreams,
  startOpencodeDevRun,
} from "../src/main/lib/trpc/routers/opencode"

afterEach(() => {
  mocks.getProviderKeyAsync.mockReset()
  mocks.getAvailableProviderModels.mockReset()
  mocks.refreshProviderModels.mockReset()
})

describe("OpenCode router preflight lifecycle", () => {
  it("cleans the active stream when catalog refresh fails", async () => {
    mocks.getProviderKeyAsync.mockResolvedValue("test-key")
    mocks.getAvailableProviderModels.mockReturnValue({ source: "seed", models: [] })
    mocks.refreshProviderModels.mockRejectedValue(new Error("catalog unavailable"))

    await startOpencodeDevRun(input("openrouter/model"))
    await vi.waitFor(() => expect(hasActiveOpencodeStreams()).toBe(false))
  })

  it("cleans the active stream when the selected model fails preflight", async () => {
    mocks.getProviderKeyAsync.mockResolvedValue("test-key")
    mocks.getAvailableProviderModels.mockReturnValue({ source: "cache", models: [] })

    await startOpencodeDevRun(input("openrouter/removed-model"))
    await vi.waitFor(() => expect(hasActiveOpencodeStreams()).toBe(false))
  })
})

function input(model: string) {
  return {
    subChatId: `sub-${model}`,
    chatId: `chat-${model}`,
    provider: "openrouter" as const,
    model,
    prompt: "test",
    cwd: "/tmp",
  }
}
