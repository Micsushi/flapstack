import { describe, expect, it, vi } from "vitest"
import {
  chatBelongsToProject,
  refreshDevSelectionSnapshot,
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
})
