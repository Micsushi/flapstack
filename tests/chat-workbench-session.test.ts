import { describe, expect, it } from "vitest"
import {
  CHAT_WORKBENCH_SESSION_VERSION,
  chatWorkbenchDragSessionSchema,
  chatWorkbenchWindowSessionSchema,
  createChatWorkbenchLayout,
  restoreChatWorkbenchWindows,
} from "../src/shared/chat-workbench"

describe("chat workbench sessions", () => {
  it("keeps drag IPC opaque, expiring, and free of transcript fields", () => {
    const session = chatWorkbenchDragSessionSchema.parse({
      version: 1,
      nonce: "nonce-1234567890",
      chatId: "chat-a",
      sourceWindowId: "main",
      sourceGroupId: "group-a",
      operation: "move",
      expiresAt: Date.now() + 5_000,
    })
    expect(Object.keys(session).sort()).toEqual([
      "chatId",
      "expiresAt",
      "nonce",
      "operation",
      "sourceGroupId",
      "sourceWindowId",
      "version",
    ])
    expect(
      chatWorkbenchDragSessionSchema.safeParse({ ...session, transcript: "secret" }).success,
    ).toBe(false)
  })

  it("restores main plus three recent windows and preserves dormant overflow", () => {
    const sessions = Array.from({ length: 6 }, (_, index) =>
      chatWorkbenchWindowSessionSchema.parse({
        version: CHAT_WORKBENCH_SESSION_VERSION,
        stableWindowId: index === 0 ? "main" : `window-${index}`,
        kind: index === 0 ? "main" : "chat",
        projectId: "project-a",
        layout: createChatWorkbenchLayout([`chat-${index}`]),
        lastFocusedAt: index,
        drafts: {},
        transcriptAnchors: {},
      }),
    )
    const restored = restoreChatWorkbenchWindows(sessions)

    expect(restored.live.map((entry) => entry.stableWindowId)).toEqual([
      "main",
      "window-5",
      "window-4",
      "window-3",
    ])
    expect(restored.dormant.map((entry) => entry.stableWindowId)).toEqual(["window-2", "window-1"])
  })
})
