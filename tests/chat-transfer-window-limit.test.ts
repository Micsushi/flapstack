import { describe, expect, it, vi } from "vitest"
import { executeChatTransferDestinationAction } from "../src/renderer/lib/chat-transfer-window-limit"

describe("Chat transfer command destinations", () => {
  it.each([
    ["split-left", "left"],
    ["split-right", "right"],
    ["split-top", "top"],
    ["split-bottom", "bottom"],
    ["add-as-tab", "tab"],
  ] as const)("maps %s to the exact previewed destination zone", async (action, zone) => {
    const reserveChatTransfer = vi.fn().mockResolvedValue({
      status: "reserved",
      destination: {
        windowId: "window-2",
        groupId: "group-2",
        zone,
      },
    })
    const result = await executeChatTransferDestinationAction(
      {
        startChatTransfer: vi.fn().mockResolvedValue({
          status: "started",
          transfer: {
            version: 1,
            nonce: "opaque-nonce-123",
            chatId: "chat-a",
            sourceWindowId: "main",
            sourceGroupId: "group-1",
            operation: "move",
            expiresAt: Date.now() + 1_000,
          },
        }),
        reserveChatTransfer,
        focusStableWindow: vi.fn(),
      },
      {
        chatId: "chat-a",
        sourceWindowId: "main",
        sourceGroupId: "group-1",
        operation: "move",
      },
      {
        stableId: "window-2",
        label: "Window 2",
        groupId: "group-2",
      },
      action,
    )

    expect(result).toMatchObject({ status: "reserved" })
    expect(reserveChatTransfer).toHaveBeenCalledWith({
      version: 1,
      nonce: "opaque-nonce-123",
      destinationWindowId: "window-2",
      destinationGroupId: "group-2",
      zone,
    })
  })
})
