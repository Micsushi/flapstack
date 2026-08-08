// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"
import {
  closeNewChatDraft,
  countVisibleNewChatDraftsForProject,
  getNewChatDrafts,
  getNewChatDraftRestoreAction,
  getOpenNewChatDrafts,
  markDraftVisible,
  openNewChatDraft,
  resolveNewChatDraftDestination,
  updateNewChatDraftDestination,
  updateNewChatDraftText,
  type DraftProject,
} from "../src/renderer/features/agents/lib/drafts"

const project: DraftProject = {
  id: "project-1",
  name: "Flapstack",
  path: "/repos/flapstack",
  gitProvider: "github",
  gitOwner: "owner",
  gitRepo: "flapstack",
}

beforeEach(() => {
  localStorage.clear()
})

describe("new chat draft destinations", () => {
  it("resolves project drafts back into their project", () => {
    expect(
      resolveNewChatDraftDestination({
        id: "draft-1",
        text: "Fix the sidebar",
        updatedAt: 1,
        project,
      }),
    ).toEqual({ scope: "project", project })
    expect(resolveNewChatDraftDestination()).toEqual({ scope: "global" })
  })

  it("keeps the persisted project association current", () => {
    updateNewChatDraftText("draft-1", "Fix the sidebar", project)
    markDraftVisible("draft-1")
    expect(getNewChatDrafts()[0]?.project?.id).toBe(project.id)

    updateNewChatDraftText("draft-1", "Fix the sidebar")
    expect(getNewChatDrafts()[0]?.project).toBeUndefined()
  })

  it("does not restore a selected draft again after unrelated data refetches", () => {
    expect(getNewChatDraftRestoreAction("draft-1", "draft-1")).toBe("none")
    expect(getNewChatDraftRestoreAction(null, "draft-1")).toBe("restore")
    expect(getNewChatDraftRestoreAction("draft-1", null)).toBe("clear")
  })

  it("persists destination changes without requiring another text edit", () => {
    updateNewChatDraftText("draft-1", "Fix the sidebar")
    markDraftVisible("draft-1")
    updateNewChatDraftDestination("draft-1", project)
    expect(getNewChatDrafts()[0]).toMatchObject({ text: "Fix the sidebar", project })

    updateNewChatDraftDestination("draft-1")
    expect(getNewChatDrafts()[0]).toMatchObject({ text: "Fix the sidebar" })
    expect(getNewChatDrafts()[0]?.project).toBeUndefined()
  })

  it("keeps a navigated-away draft open until its tab is explicitly closed", () => {
    updateNewChatDraftText("draft-1", "Fix the sidebar", project)
    markDraftVisible("draft-1")

    expect(getOpenNewChatDrafts().map(({ id }) => id)).toEqual(["draft-1"])
    expect(countVisibleNewChatDraftsForProject(project.id)).toBe(1)

    closeNewChatDraft("draft-1")
    expect(getOpenNewChatDrafts()).toEqual([])
    expect(getNewChatDrafts().map(({ id }) => id)).toEqual(["draft-1"])

    openNewChatDraft("draft-1")
    expect(getOpenNewChatDrafts().map(({ id }) => id)).toEqual(["draft-1"])
  })
})
