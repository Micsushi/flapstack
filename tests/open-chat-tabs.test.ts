import { describe, expect, it } from "vitest"
import {
  ARCHIVED_CHAT_ACCENT_COLOR,
  isReservedArchivedAccentColor,
  resolveOpenChatTabUnderlineColor,
  resolveProjectAccentColor,
  resolveVisibleOpenChatTabs,
} from "../src/renderer/features/agents/lib/open-chat-tabs"

const chats = [
  { id: "one", name: "One" },
  { id: "two", name: "Two" },
]

describe("visible parent chat tabs", () => {
  it("shows the selected local chat before open-tab storage catches up", () => {
    expect(
      resolveVisibleOpenChatTabs({
        chats,
        openChatIds: [],
        selectedChatId: "one",
        selectedChatIsRemote: false,
      }),
    ).toEqual([chats[0]])
  })

  it("uses the current chat while the all-chats query is still unavailable", () => {
    expect(
      resolveVisibleOpenChatTabs({
        selectedChat: chats[0],
        openChatIds: [],
        selectedChatId: "one",
        selectedChatIsRemote: false,
      }),
    ).toEqual([chats[0]])
  })

  it("preserves persisted tab order without duplicating the selected chat", () => {
    expect(
      resolveVisibleOpenChatTabs({
        chats,
        openChatIds: ["two", "one"],
        selectedChatId: "one",
        selectedChatIsRemote: false,
      }),
    ).toEqual([chats[1], chats[0]])
  })

  it("does not add remote chats to the local tab strip", () => {
    expect(
      resolveVisibleOpenChatTabs({
        chats,
        openChatIds: [],
        selectedChatId: "one",
        selectedChatIsRemote: true,
      }),
    ).toEqual([])
  })

  it("keeps an opened archived chat visible after another tab is selected", () => {
    const archivedChat = { id: "archived", name: "Archived", archivedAt: new Date() }
    expect(
      resolveVisibleOpenChatTabs({
        chats,
        archivedChats: [archivedChat],
        openChatIds: ["archived", "two"],
        selectedChatId: "two",
        selectedChatIsRemote: false,
      }),
    ).toEqual([archivedChat, chats[1]])
  })

  it("removes chats owned by saved multi-pane groups from the main tab strip", () => {
    expect(
      resolveVisibleOpenChatTabs({
        chats,
        openChatIds: ["one", "two"],
        selectedChatId: "one",
        selectedChatIsRemote: false,
        excludedChatIds: new Set(["one"]),
      }),
    ).toEqual([chats[1]])
  })
})

describe("open parent chat tab underline", () => {
  it("uses the project color for active chats", () => {
    expect(
      resolveOpenChatTabUnderlineColor(
        { projectId: "project-one", archivedAt: null },
        { "project-one": "#22c55e" },
      ),
    ).toBe("#22c55e")
  })

  it("uses red for archived chats", () => {
    expect(
      resolveOpenChatTabUnderlineColor(
        { projectId: "project-one", archivedAt: new Date() },
        { "project-one": "#22c55e" },
      ),
    ).toBe(ARCHIVED_CHAT_ACCENT_COLOR)
  })

  it("reserves red accents for archived chats", () => {
    expect(isReservedArchivedAccentColor("#ef4444")).toBe(true)
    expect(isReservedArchivedAccentColor("#991b1b")).toBe(true)
    expect(isReservedArchivedAccentColor("#f97316")).toBe(false)
    expect(resolveProjectAccentColor("project-one", { "project-one": "#ef4444" })).toBe("#38bdf8")
  })
})
