import { beforeEach, describe, expect, it, vi } from "vitest"

const send = vi.fn()
const sendDestroyed = vi.fn()

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: () => [
      { isDestroyed: () => false, webContents: { send } },
      { isDestroyed: () => true, webContents: { send: sendDestroyed } },
      { isDestroyed: () => false, webContents: { send } },
    ],
  },
}))

vi.mock("../src/main/lib/db", () => ({ getDatabase: vi.fn() }))

import { broadcastAgentActivityInvalidation } from "../src/main/lib/agent-runtime/activity-service"

beforeEach(() => {
  send.mockReset()
  sendDestroyed.mockClear()
})

describe("Agent activity multi-window invalidation", () => {
  it("continues notifying live windows when one renderer closes during delivery", () => {
    send.mockImplementationOnce(() => {
      throw new Error("renderer closed")
    })
    expect(() =>
      broadcastAgentActivityInvalidation({
        reason: "append",
        runId: "run-1",
        chatId: "chat-1",
        firstSequence: 1,
        lastSequence: 1,
        lastStorageId: 1,
        insertedCount: 1,
      }),
    ).not.toThrow()
    expect(send).toHaveBeenCalledTimes(2)
  })
  it("broadcasts the durable cursor to every live window", () => {
    const invalidation = {
      reason: "append" as const,
      runId: "run-1",
      chatId: "chat-1",
      firstSequence: 4,
      lastSequence: 8,
      lastStorageId: 20,
      insertedCount: 5,
    }
    broadcastAgentActivityInvalidation(invalidation)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(1, "agent-activity:invalidated", invalidation)
    expect(sendDestroyed).not.toHaveBeenCalled()
  })
})
