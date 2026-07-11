import { describe, expect, it } from "vitest"
import { isNavigableScopedSearchResult } from "../src/renderer/features/search/scoped-search-navigation"
import { resolveQueuedSubChatNavigation } from "../src/renderer/features/agents/stores/sub-chat-navigation"

describe("scoped search result navigation", () => {
  it("only presents results with an owning chat as navigable", () => {
    expect(isNavigableScopedSearchResult({ chatId: "chat-1" })).toBe(true)
    expect(isNavigableScopedSearchResult({ chatId: null })).toBe(false)
    expect(isNavigableScopedSearchResult({})).toBe(false)
  })
})

describe("cross-chat scoped search hydration", () => {
  it("opens and selects the requested sub-chat after target chat hydration", () => {
    expect(resolveQueuedSubChatNavigation(["old"], "target")).toEqual({
      openSubChatIds: ["old", "target"],
      activeSubChatId: "target",
    })
    expect(resolveQueuedSubChatNavigation(["target"], "target")).toEqual({
      openSubChatIds: ["target"],
      activeSubChatId: "target",
    })
  })
})
