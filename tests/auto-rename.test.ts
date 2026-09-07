import { afterEach, describe, expect, it, vi } from "vitest"
import { autoRenameAgentChat } from "../src/renderer/features/agents/utils/auto-rename"

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function params() {
  return {
    subChatId: "sub",
    parentChatId: "parent",
    userMessage: "private prompt",
    isFirstSubChat: true,
    generateName: vi.fn().mockResolvedValue({ name: "private title" }),
    renameSubChat: vi.fn().mockResolvedValue(undefined),
    renameChat: vi.fn().mockResolvedValue(undefined),
    updateSubChatName: vi.fn(),
    updateChatName: vi.fn(),
  }
}

describe("automatic title application", () => {
  it("renames the first chat without logging prompt or title contents", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const input = params()
    await autoRenameAgentChat(input)
    expect(input.renameSubChat).toHaveBeenCalledWith({ subChatId: "sub", name: "private title" })
    expect(input.updateChatName).toHaveBeenCalledWith("parent", "private title")
    expect(log).not.toHaveBeenCalled()
  })

  it("does not apply generic metadata", async () => {
    const input = params()
    input.generateName.mockResolvedValue({ name: "New chat" })
    await autoRenameAgentChat(input)
    expect(input.renameSubChat).not.toHaveBeenCalled()
  })

  it("retries a missing chat and updates local state only after success", async () => {
    vi.useFakeTimers()
    const input = params()
    input.renameSubChat.mockRejectedValueOnce(new Error("not created yet"))
    const result = autoRenameAgentChat(input)
    await vi.advanceTimersByTimeAsync(0)
    expect(input.updateSubChatName).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3_000)
    await result
    expect(input.renameSubChat).toHaveBeenCalledTimes(2)
    expect(input.updateSubChatName).toHaveBeenCalledOnce()
  })

  it("does not echo generation errors that may include private input", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const input = params()
    input.generateName.mockRejectedValue(new Error("private prompt"))
    await autoRenameAgentChat(input)
    expect(error).toHaveBeenCalledExactlyOnceWith("[auto-rename] Auto-rename failed")
    expect(input.renameSubChat).not.toHaveBeenCalled()
  })
})
