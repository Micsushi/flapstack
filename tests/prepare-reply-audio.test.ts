import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), error: vi.fn() }))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpcClient: { speech: { prepareReply: { mutate: mocks.prepare } } },
}))
vi.mock("sonner", () => ({ toast: { error: mocks.error } }))
import { prepareReplyAudio } from "../src/renderer/lib/prepare-reply-audio"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepare.mockResolvedValue({ prepared: true })
})
describe("completed reply audio", () => {
  it("prepares only assistant prose with stable conversation and message identity", () => {
    prepareReplyAudio("chat", "sub", {
      id: "a",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "private reasoning" },
        { type: "text", text: "Hello." },
      ],
    })
    expect(mocks.prepare).toHaveBeenCalledWith({
      chatId: "chat",
      subChatId: "sub",
      messageId: "a",
      text: "Hello.",
    })
    prepareReplyAudio("chat", "sub", {
      id: "u",
      role: "user",
      parts: [{ type: "text", text: "Hi" }],
    })
    prepareReplyAudio("chat", "sub", { id: "empty", role: "assistant", parts: [] })
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
  })
  it("makes preparation failures visible without starting playback", async () => {
    mocks.prepare.mockRejectedValue(new Error("Kokoro download failed"))
    prepareReplyAudio("chat", "sub", {
      id: "a",
      role: "assistant",
      parts: [{ type: "text", text: "Hello." }],
    })
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        "Reply audio could not be prepared",
        expect.objectContaining({ description: "Kokoro download failed" }),
      ),
    )
  })
})
