// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import { DRAFTS_STORAGE_KEY } from "../src/renderer/features/agents/lib/drafts"
import {
  createWorkbenchDraftReference,
  createWorkbenchScrollAnchorReference,
  readWorkbenchScrollPosition,
  restoreWorkbenchPresentationReferences,
  writeWorkbenchScrollPosition,
} from "../src/renderer/features/agents/workbench/chat-workbench-presentation-state"

describe("chat workbench presentation references", () => {
  beforeEach(() => localStorage.clear())

  it("resolves session draft references to the real canonical draft values", () => {
    localStorage.setItem(
      DRAFTS_STORAGE_KEY,
      JSON.stringify({
        "chat-a:sub-1": { text: "unfinished prompt", updatedAt: 10 },
        "chat-b:sub-2": { text: "another chat", updatedAt: 11 },
      }),
    )

    const restored = restoreWorkbenchPresentationReferences(localStorage, {
      draftRefs: { "chat-a": createWorkbenchDraftReference("chat-a") },
      scrollAnchorRefs: {},
    })

    expect(restored.draftsByChat).toEqual({
      "chat-a": {
        "chat-a:sub-1": { text: "unfinished prompt", updatedAt: 10 },
      },
    })
  })

  it("round-trips real numeric scroll positions through a session reference", () => {
    writeWorkbenchScrollPosition(localStorage, "chat-a", "sub-1", {
      scrollTop: 845,
      scrollHeight: 4_200,
      wasAtBottom: false,
    })

    const restored = restoreWorkbenchPresentationReferences(localStorage, {
      draftRefs: {},
      scrollAnchorRefs: {
        "chat-a": createWorkbenchScrollAnchorReference("chat-a"),
      },
    })

    expect(restored.scrollPositionsByChat["chat-a"]?.["sub-1"]).toEqual({
      scrollTop: 845,
      scrollHeight: 4_200,
      wasAtBottom: false,
    })
    expect(readWorkbenchScrollPosition(localStorage, "chat-a", "sub-1")).toEqual({
      scrollTop: 845,
      scrollHeight: 4_200,
      wasAtBottom: false,
    })
  })

  it("rejects a reference assigned to a different Chat", () => {
    localStorage.setItem(
      DRAFTS_STORAGE_KEY,
      JSON.stringify({
        "chat-a:sub-1": { text: "private to A", updatedAt: 10 },
      }),
    )

    const restored = restoreWorkbenchPresentationReferences(localStorage, {
      draftRefs: { "chat-b": createWorkbenchDraftReference("chat-a") },
      scrollAnchorRefs: {
        "chat-b": createWorkbenchScrollAnchorReference("chat-a"),
      },
    })

    expect(restored).toEqual({
      draftsByChat: {},
      scrollPositionsByChat: {},
    })
  })
})
