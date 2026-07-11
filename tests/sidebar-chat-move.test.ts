import { describe, expect, it } from "vitest"

import {
  buildChatMoveDestinations,
  chatMoveTargetKey,
  isCurrentChatMoveTarget,
  toChatMoveMutationInput,
} from "../src/renderer/features/sidebar/chat-move-destinations"

describe("sidebar chat move destinations", () => {
  const destinations = buildChatMoveDestinations(
    [
      { id: "project-a", name: "Alpha", gitRepo: "alpha-repo" },
      { id: "project-b", name: "Beta" },
    ],
    [
      { id: "task-a", name: "Ship it", projectId: "project-a" },
      { id: "orphan-task", name: "Archived parent", projectId: "missing-project" },
    ],
  )

  it("builds global, active project, and active task destinations", () => {
    expect(destinations.map(chatMoveTargetKey)).toEqual([
      "global",
      "project:project-a",
      "task:task-a",
      "project:project-b",
    ])
    expect(destinations[2]).toMatchObject({
      label: "Ship it",
      detail: "alpha-repo · Task",
    })
  })

  it("marks only the chat's exact current scope as current", () => {
    expect(isCurrentChatMoveTarget({}, destinations[0]!)).toBe(true)
    expect(isCurrentChatMoveTarget({ projectId: "project-a" }, destinations[1]!)).toBe(true)
    expect(
      isCurrentChatMoveTarget({ projectId: "project-a", taskId: "task-a" }, destinations[2]!),
    ).toBe(true)
    expect(
      isCurrentChatMoveTarget({ projectId: "project-a", taskId: "task-a" }, destinations[1]!),
    ).toBe(false)
  })

  it("creates the minimal validated mutation input for each destination", () => {
    expect(toChatMoveMutationInput("chat-1", destinations[0]!)).toEqual({
      id: "chat-1",
      scope: "global",
    })
    expect(toChatMoveMutationInput("chat-1", destinations[1]!)).toEqual({
      id: "chat-1",
      scope: "project",
      projectId: "project-a",
    })
    expect(toChatMoveMutationInput("chat-1", destinations[2]!)).toEqual({
      id: "chat-1",
      scope: "task",
      taskId: "task-a",
    })
  })
})
