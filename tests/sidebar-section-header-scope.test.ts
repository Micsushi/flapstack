import { describe, expect, it } from "vitest"
import { resolveSectionHeaderScopeSelection } from "../src/renderer/features/sidebar/section-header-scope"

const projectScope = { type: "project", id: "project-1", name: "Project" } as const

describe("sidebar section header scope selection", () => {
  it.each([true, false])(
    "opens the project screen with no open Chats when willExpand is %s",
    (willExpand) => {
      expect(
        resolveSectionHeaderScopeSelection({
          isProjectSection: true,
          hasOpenChats: false,
          willExpand,
          scope: projectScope,
        }),
      ).toEqual(projectScope)
    },
  )

  it.each([true, false])(
    "preserves the current Chat with open Chats when willExpand is %s",
    (willExpand) => {
      expect(
        resolveSectionHeaderScopeSelection({
          isProjectSection: true,
          hasOpenChats: true,
          willExpand,
          scope: projectScope,
        }),
      ).toBeUndefined()
    },
  )

  it("keeps the existing expand and collapse behavior for non-project sections", () => {
    expect(
      resolveSectionHeaderScopeSelection({
        isProjectSection: false,
        hasOpenChats: false,
        willExpand: true,
        scope: { type: "global", id: "global", name: "Global chats" },
      }),
    ).toEqual({ type: "global", id: "global", name: "Global chats" })
    expect(
      resolveSectionHeaderScopeSelection({
        isProjectSection: false,
        hasOpenChats: false,
        willExpand: false,
        scope: { type: "global", id: "global", name: "Global chats" },
      }),
    ).toBeNull()
  })
})
