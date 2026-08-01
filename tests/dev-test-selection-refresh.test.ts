import { describe, expect, it, vi } from "vitest"
import {
  chatBelongsToProject,
  refreshDevChatUntilVisible,
  refreshDevSelectionSnapshot,
  validateDevChatSelectionSnapshot,
} from "../src/renderer/features/settings/dev-test-selection-refresh"

describe("development renderer selection refresh", () => {
  it("refreshes project, chat-list, and exact-chat caches before returning fixture state", async () => {
    const calls: string[] = []
    const snapshot = await refreshDevSelectionSnapshot(
      {
        invalidateProjects: vi.fn(async () => {
          calls.push("invalidate-projects")
        }),
        fetchProjects: vi.fn(async () => {
          calls.push("fetch-projects")
          return [{ id: "fixture-project" }]
        }),
        invalidateChats: vi.fn(async () => {
          calls.push("invalidate-chats")
        }),
        fetchChats: vi.fn(async () => {
          calls.push("fetch-chats")
          return [{ id: "fixture-chat", projectId: "fixture-project" }]
        }),
        invalidateChat: vi.fn(async (chatId) => {
          calls.push(`invalidate-chat:${chatId}`)
        }),
        fetchChat: vi.fn(async (chatId) => {
          calls.push(`fetch-chat:${chatId}`)
          return { id: chatId, projectId: "fixture-project" }
        }),
      },
      "fixture-chat",
    )

    expect(calls.slice(0, 3)).toEqual([
      "invalidate-projects",
      "invalidate-chats",
      "invalidate-chat:fixture-chat",
    ])
    expect(calls.slice(3).sort()).toEqual(
      ["fetch-projects", "fetch-chats", "fetch-chat:fixture-chat"].sort(),
    )
    expect(snapshot).toEqual({
      projects: [{ id: "fixture-project" }],
      chats: [{ id: "fixture-chat", projectId: "fixture-project" }],
      targetChat: { id: "fixture-chat", projectId: "fixture-project" },
    })
  })

  it("clears compatibility when the selected chat is missing or belongs to another project", () => {
    const chats = [
      { id: "old-chat", projectId: "old-project" },
      { id: "fixture-chat", projectId: "fixture-project" },
    ]
    expect(chatBelongsToProject(chats, "fixture-chat", "fixture-project")).toBe(true)
    expect(chatBelongsToProject(chats, "old-chat", "fixture-project")).toBe(false)
    expect(chatBelongsToProject(chats, "missing", "fixture-project")).toBe(false)
    expect(chatBelongsToProject(chats, "fixture-chat", null)).toBe(false)
  })

  it("rejects chat selection until the exact fixture project and chat are in renderer caches", () => {
    const valid = {
      projects: [{ id: "fixture-project" }],
      chats: [{ id: "fixture-chat", projectId: "fixture-project" }],
      targetChat: { id: "fixture-chat", projectId: "fixture-project" },
    }

    expect(() =>
      validateDevChatSelectionSnapshot(valid, "fixture-project", "fixture-chat"),
    ).not.toThrow()
    expect(() =>
      validateDevChatSelectionSnapshot(
        { ...valid, projects: [] },
        "fixture-project",
        "fixture-chat",
      ),
    ).toThrow(/project.*cache/i)
    expect(() =>
      validateDevChatSelectionSnapshot(
        { ...valid, targetChat: null },
        "fixture-project",
        "fixture-chat",
      ),
    ).toThrow(/chat.*cache/i)
    expect(() =>
      validateDevChatSelectionSnapshot(
        {
          ...valid,
          targetChat: { id: "fixture-chat", projectId: "other-project" },
        },
        "fixture-project",
        "fixture-chat",
      ),
    ).toThrow(/project/i)
  })

  it("replays the bounded refresh until the exact product transcript is visible", async () => {
    let frame = 0
    const dispatchRefresh = vi.fn()
    const prepareSelection = vi.fn()
    const visible = await refreshDevChatUntilVisible(
      {
        chatId: "fixture-chat",
        subChatId: "fixture-sub-chat",
        messages: [{ id: "one" }, { id: "two" }],
      },
      {
        timeoutMs: 1_000,
        now: () => frame * 16,
        nextFrame: async () => {
          frame += 1
        },
        prepareSelection,
        dispatchRefresh,
        readVisibleState: () =>
          frame < 3
            ? null
            : {
                chatId: "fixture-chat",
                subChatId: "fixture-sub-chat",
                messageCount: 2,
              },
      },
    )

    expect(prepareSelection).toHaveBeenCalledTimes(3)
    expect(dispatchRefresh).toHaveBeenCalledTimes(3)
    expect(visible).toEqual({
      chatId: "fixture-chat",
      subChatId: "fixture-sub-chat",
      messageCount: 2,
    })
  })

  it("reports the last observed product pane state when selection times out", async () => {
    let frame = 0
    await expect(
      refreshDevChatUntilVisible(
        {
          chatId: "fixture-chat",
          subChatId: "fixture-sub-chat",
          messages: [{ id: "one" }],
        },
        {
          timeoutMs: 16,
          now: () => frame * 16,
          nextFrame: async () => {
            frame += 1
          },
          prepareSelection: vi.fn(),
          dispatchRefresh: vi.fn(),
          readVisibleState: () => ({
            chatId: "fixture-chat",
            subChatId: "other-sub-chat",
            messageCount: -1,
            details: { transcriptMounted: false },
          }),
        },
      ),
    ).rejects.toThrow(/"subChatId":"other-sub-chat".*"transcriptMounted":false/)
  })
})
