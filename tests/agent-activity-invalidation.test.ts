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
  send.mockClear()
  sendDestroyed.mockClear()
})

describe("Agent activity multi-window invalidation", () => {
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
