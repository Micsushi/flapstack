import { describe, expect, it } from "vitest"
import {
  createChatWorkbenchHistory,
  recordChatWorkbenchHistory,
  redoChatWorkbenchHistory,
  undoChatWorkbenchHistory,
} from "../src/shared/chat-workbench-history"
import { createChatWorkbenchLayout } from "../src/shared/chat-workbench"

describe("Chat workbench history", () => {
  const first = {
    navigation: { activeGroupId: null, groups: [] },
    layout: createChatWorkbenchLayout(["a"], "a"),
    openChatIds: ["a"],
  }
  const second = {
    navigation: { activeGroupId: null, groups: [] },
    layout: createChatWorkbenchLayout(["b"], "b"),
    openChatIds: ["b"],
  }

  it("undoes and redoes navigation and layout as one snapshot", () => {
    const recorded = recordChatWorkbenchHistory(createChatWorkbenchHistory(), first)
    const undone = undoChatWorkbenchHistory(recorded, second)
    expect(undone?.snapshot).toEqual(first)

    const redone = redoChatWorkbenchHistory(undone!.history, first)
    expect(redone?.snapshot).toEqual(second)
  })

  it("clears redo history when a new mutation is recorded", () => {
    const recorded = recordChatWorkbenchHistory({ past: [], future: [second] }, first)
    expect(recorded.future).toEqual([])
  })
})
