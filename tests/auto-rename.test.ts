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
    generateName: vi.fn().mockResolvedValue({ name: "private title" }),
    applyName: vi.fn().mockResolvedValue({ subChatApplied: true, parentChatApplied: true }),
    updateSubChatName: vi.fn(),
    updateChatName: vi.fn(),
  }
}

describe("automatic title application", () => {
  it("renames the first chat without logging prompt or title contents", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const input = params()
    await autoRenameAgentChat(input)
    expect(input.applyName).toHaveBeenCalledWith({
      subChatId: "sub",
      parentChatId: "parent",
      name: "private title",
    })
    expect(input.updateChatName).toHaveBeenCalledWith("parent", "private title")
    expect(log).not.toHaveBeenCalled()
  })

  it("does not apply generic metadata", async () => {
    const input = params()
    input.generateName.mockResolvedValue({ name: "New chat" })
    await autoRenameAgentChat(input)
    expect(input.applyName).not.toHaveBeenCalled()
  })

  it("retries a missing chat and updates local state only after success", async () => {
    vi.useFakeTimers()
    const input = params()
    input.applyName.mockRejectedValueOnce(new Error("not created yet"))
    const result = autoRenameAgentChat(input)
    await vi.advanceTimersByTimeAsync(0)
    expect(input.updateSubChatName).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3_000)
    await result
    expect(input.applyName).toHaveBeenCalledTimes(2)
    expect(input.updateSubChatName).toHaveBeenCalledOnce()
  })

  it("does not echo generation errors that may include private input", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const input = params()
    input.generateName.mockRejectedValue(new Error("private prompt"))
    await autoRenameAgentChat(input)
    expect(error).toHaveBeenCalledExactlyOnceWith("[auto-rename] Auto-rename failed")
    expect(input.applyName).not.toHaveBeenCalled()
  })

  it("does not update caches or retry when an existing name wins", async () => {
    const input = params()
    input.applyName.mockResolvedValue({ subChatApplied: false, parentChatApplied: false })
    await autoRenameAgentChat(input)
    expect(input.applyName).toHaveBeenCalledOnce()
    expect(input.updateSubChatName).not.toHaveBeenCalled()
    expect(input.updateChatName).not.toHaveBeenCalled()
  })

  it("preserves the parent cache when only a later sub-chat is named", async () => {
    const input = params()
    input.applyName.mockResolvedValue({ subChatApplied: true, parentChatApplied: false })
    await autoRenameAgentChat(input)
    expect(input.updateSubChatName).toHaveBeenCalledOnce()
    expect(input.updateChatName).not.toHaveBeenCalled()
  })
})
