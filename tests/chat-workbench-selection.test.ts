import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  closeChatsInWorkbench,
  collectChatGroups,
  createChatWorkbenchLayout,
  selectChatInWorkbench,
} from "../src/shared/chat-workbench"

describe("authoritative Chat workbench selection", () => {
  it("activates an already-open inactive Chat without creating a duplicate tab model", () => {
    const selected = selectChatInWorkbench(createChatWorkbenchLayout(["a", "b"], "a"), "b")

    expect(selected.accepted).toBe(true)
    if (!selected.accepted) throw new Error("expected selection")
    expect(collectChatGroups(selected.layout.root)).toEqual([
      expect.objectContaining({
        id: "chat-group-1",
        chatIds: ["a", "b"],
        activeChatId: "b",
      }),
    ])
    expect(selected.layout.activeGroupId).toBe("chat-group-1")
  })

  it("opens a missing selected Chat in the active group exactly once", () => {
    const selected = selectChatInWorkbench(createChatWorkbenchLayout(["a"]), "b")

    expect(selected.accepted).toBe(true)
    if (!selected.accepted) throw new Error("expected selection")
    expect(collectChatGroups(selected.layout.root)[0]).toMatchObject({
      chatIds: ["a", "b"],
      activeChatId: "b",
    })
  })

  it("removes legacy-strip closes from the authoritative workbench layout", () => {
    const closed = closeChatsInWorkbench(
      createChatWorkbenchLayout(["chat-a", "chat-b"], "chat-a"),
      ["chat-a"],
    )

    expect(collectChatGroups(closed.root)).toEqual([
      expect.objectContaining({
        chatIds: ["chat-b"],
        activeChatId: "chat-b",
      }),
    ])
  })

  it("routes both legacy close handlers through the authoritative layout", () => {
    const agentsContent = readFileSync(
      new URL("../src/renderer/features/agents/ui/agents-content.tsx", import.meta.url),
      "utf8",
    )
    expect(agentsContent).toContain("closeWorkbenchChats([chatId])")
    expect(agentsContent).toContain("closeWorkbenchChats(chatIds)")
  })

  it("does not publish, select, or claim the empty-layout sentinel as a real Chat", () => {
    const agentsContent = readFileSync(
      new URL("../src/renderer/features/agents/ui/agents-content.tsx", import.meta.url),
      "utf8",
    )
    const app = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8")

    expect(agentsContent).toContain("isEmptyChatWorkbenchLayout")
    expect(
      agentsContent.match(/isEmptyChatWorkbenchLayout\(/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3)
    expect(agentsContent).toMatch(/destination\.zone\s*!==\s*"tab"\s*&&\s*!destinationWasEmpty/)
    expect(app).toContain('if (currentChatId === "new-chat")')
  })

  it("replaces the empty-layout sentinel when a real Chat is selected after last close", () => {
    const closed = closeChatsInWorkbench(createChatWorkbenchLayout(["chat-a"]), ["chat-a"])
    const selected = selectChatInWorkbench(closed, "chat-b")

    expect(selected.accepted).toBe(true)
    if (!selected.accepted) throw new Error("expected selection")
    expect(collectChatGroups(selected.layout.root)).toEqual([
      expect.objectContaining({
        chatIds: ["chat-b"],
        activeChatId: "chat-b",
      }),
    ])
  })
})
