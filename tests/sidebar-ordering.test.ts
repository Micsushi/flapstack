import { describe, expect, it } from "vitest"

import {
  buildOrderedIds,
  moveProjectToCustomSidebarSection,
  moveIdInOrder,
  orderSidebarProjects,
  parseCustomSidebarProjectSections,
  resolveBoundaryHighlightIds,
  resolveMoveIndicatorIds,
  resolveSidebarDragCursor,
  setProjectQuickAccessMembership,
  resolveTaskEndDropTarget,
  resolveTaskGroupDropTarget,
  resolveTaskHeaderDropPosition,
} from "../src/renderer/features/sidebar/sidebar-ordering"

describe("sidebar ordering", () => {
  it("loads valid custom sections and keeps each project in only one section", () => {
    expect(
      parseCustomSidebarProjectSections(
        JSON.stringify([
          { id: "work", name: " Work ", projectIds: ["one", "two", "one"] },
          { id: "later", name: "Later", projectIds: ["two", "three"] },
          { id: "work", name: "Duplicate", projectIds: [] },
          { id: "", name: "Invalid", projectIds: [] },
        ]),
      ),
    ).toEqual([
      { id: "work", name: "Work", projectIds: ["one", "two"] },
      { id: "later", name: "Later", projectIds: ["three"] },
    ])
    expect(parseCustomSidebarProjectSections("not-json")).toEqual([])
  })

  it("moves a project between custom sections or back to Projects", () => {
    const sections = [
      { id: "work", name: "Work", projectIds: ["one", "two"] },
      { id: "later", name: "Later", projectIds: ["three"] },
    ]

    expect(moveProjectToCustomSidebarSection(sections, "two", "later")).toEqual([
      { id: "work", name: "Work", projectIds: ["one"] },
      { id: "later", name: "Later", projectIds: ["three", "two"] },
    ])
    expect(moveProjectToCustomSidebarSection(sections, "one", null)).toEqual([
      { id: "work", name: "Work", projectIds: ["two"] },
      { id: "later", name: "Later", projectIds: ["three"] },
    ])
  })

  it("applies a project order that remains a manual drag order", () => {
    const projects = [
      { id: "b", name: "Beta", updatedAt: new Date("2026-01-01") },
      { id: "a", name: "Alpha", updatedAt: new Date("2026-02-01") },
    ]

    const ordered = orderSidebarProjects(projects, "name-asc")
    expect(ordered).toEqual(["a", "b"])
    expect(moveIdInOrder(ordered, ordered, "b", "a", "before")).toEqual(["b", "a"])
    expect(orderSidebarProjects(projects, "name-desc")).toEqual(["b", "a"])
    expect(orderSidebarProjects(projects, "newest")).toEqual(["a", "b"])
    expect(orderSidebarProjects(projects, "oldest")).toEqual(["b", "a"])
  })

  it("moves projects into and out of Quick Access without mutating the prior set", () => {
    const original = new Set(["project-a"])

    expect([...setProjectQuickAccessMembership(original, "project-b", true)]).toEqual([
      "project-a",
      "project-b",
    ])
    expect([...setProjectQuickAccessMembership(original, "project-a", false)]).toEqual([])
    expect([...original]).toEqual(["project-a"])
  })

  it("moves a mixed project child up before a task in one drop", () => {
    const activeIds = ["task:one", "chat:a", "task:two", "chat:b"]

    expect(moveIdInOrder(activeIds, activeIds, "chat:b", "task:one", "before")).toEqual([
      "chat:b",
      "task:one",
      "chat:a",
      "task:two",
    ])
  })

  it("moves a mixed project child down after a chat in one drop", () => {
    const activeIds = ["task:one", "chat:a", "task:two", "chat:b"]

    expect(moveIdInOrder(activeIds, activeIds, "task:one", "task:two", "after")).toEqual([
      "chat:a",
      "task:two",
      "task:one",
      "chat:b",
    ])
  })

  it("keeps before drops attached to the hovered item, not the previous sibling", () => {
    const activeIds = ["project:a", "project:b", "project:c"]

    expect(moveIdInOrder(activeIds, activeIds, "project:c", "project:b", "before")).toEqual([
      "project:a",
      "project:c",
      "project:b",
    ])
  })

  it("filters stale persisted ids and appends new active ids", () => {
    expect(buildOrderedIds(["stale", "chat:b"], ["chat:a", "chat:b", "task:one"])).toEqual([
      "chat:b",
      "chat:a",
      "task:one",
    ])
  })

  it("uses the full expanded task header as an inside-task target", () => {
    expect(
      resolveTaskHeaderDropPosition({
        isTaskHeader: true,
        splitAfterTaskZone: false,
        relativeY: 0.99,
      }),
    ).toBe("inside")
  })

  it("splits the full task group for task-on-task reordering", () => {
    expect(
      resolveTaskGroupDropTarget({
        draggingKind: "project-child",
        draggingId: "task:source",
        targetTaskId: "target",
        relativeY: 0.49,
        offsetY: 20,
      }),
    ).toEqual({ kind: "project-child", id: "task:target", position: "before" })
    expect(
      resolveTaskGroupDropTarget({
        draggingKind: "project-child",
        draggingId: "task:source",
        targetTaskId: "target",
        relativeY: 0.5,
        offsetY: 20,
      }),
    ).toEqual({ kind: "project-child", id: "task:target", position: "after" })
  })

  it("highlights both tasks around a shared task boundary", () => {
    const items = [
      { id: "task:one", groupId: "project-a" },
      { id: "task:two", groupId: "project-a" },
    ]

    expect(
      resolveBoundaryHighlightIds({
        items,
        targetId: "task:two",
        position: "before",
      }),
    ).toEqual(["task:two", "task:one"])
    expect(
      resolveBoundaryHighlightIds({
        items,
        targetId: "task:one",
        position: "after",
      }),
    ).toEqual(["task:one", "task:two"])
  })

  it("does not treat inside-task drops as shared boundaries", () => {
    expect(
      resolveBoundaryHighlightIds({
        items: [
          { id: "task:one", groupId: "project-a" },
          { id: "task:two", groupId: "project-a" },
        ],
        targetId: "task:two",
        position: "inside",
      }),
    ).toEqual([])
  })

  it("highlights both items around task-chat, chat-chat, and chat-task boundaries", () => {
    const items = [
      { id: "task:one", groupId: "project-a" },
      { id: "chat:one", groupId: "project-a" },
      { id: "chat:two", groupId: "project-a" },
      { id: "task:two", groupId: "project-a" },
    ]

    expect(
      resolveBoundaryHighlightIds({ items, targetId: "chat:one", position: "before" }),
    ).toEqual(["chat:one", "task:one"])
    expect(resolveBoundaryHighlightIds({ items, targetId: "chat:one", position: "after" })).toEqual(
      ["chat:one", "chat:two"],
    )
    expect(resolveBoundaryHighlightIds({ items, targetId: "chat:two", position: "after" })).toEqual(
      ["chat:two", "task:two"],
    )
  })

  it("uses the task top edge as a before-task target for chats", () => {
    expect(
      resolveTaskGroupDropTarget({
        draggingKind: "project-child",
        draggingId: "chat:source",
        targetTaskId: "target",
        relativeY: 0.05,
        offsetY: 8,
      }),
    ).toEqual({ kind: "project-child", id: "task:target", position: "before" })
    expect(
      resolveTaskGroupDropTarget({
        draggingKind: "task-chat",
        draggingId: "chat:source",
        targetTaskId: "target",
        relativeY: 0.1,
        offsetY: 8.1,
      }),
    ).toBeNull()
  })

  it("splits collapsed and empty task headers halfway", () => {
    expect(
      resolveTaskHeaderDropPosition({
        isTaskHeader: true,
        splitAfterTaskZone: true,
        relativeY: 0.49,
      }),
    ).toBe("inside")
    expect(
      resolveTaskHeaderDropPosition({
        isTaskHeader: true,
        splitAfterTaskZone: true,
        relativeY: 0.5,
      }),
    ).toBe("after")
  })

  it("splits the last task chat between last-item and after-task targets", () => {
    expect(
      resolveTaskEndDropTarget({
        taskId: "task-one",
        targetKind: "task-chat",
        targetId: "chat-last",
        isOnlyTaskChat: false,
        relativeY: 0.49,
      }),
    ).toEqual({
      kind: "task-chat",
      id: "chat-last",
      position: "after",
    })
    expect(
      resolveTaskEndDropTarget({
        taskId: "task-one",
        targetKind: "task-chat",
        targetId: "chat-last",
        isOnlyTaskChat: false,
        relativeY: 0.5,
      }),
    ).toEqual({
      kind: "project-child",
      id: "task:task-one",
      position: "after",
    })
  })

  it("uses the top half of a single task chat as the first-item target", () => {
    expect(
      resolveTaskEndDropTarget({
        taskId: "task-one",
        targetKind: "task-chat",
        targetId: "only-chat",
        isOnlyTaskChat: true,
        relativeY: 0.49,
      }),
    ).toEqual({ kind: "task-chat", id: "only-chat", position: "before" })
  })

  it("uses distinct cursors for task insertion and after-task movement", () => {
    expect(resolveSidebarDragCursor({ hasValidDropTarget: true, isInsertionTarget: true })).toBe(
      "copy",
    )
    expect(resolveSidebarDragCursor({ hasValidDropTarget: true, isInsertionTarget: false })).toBe(
      "move",
    )
    expect(resolveSidebarDragCursor({ hasValidDropTarget: false, isInsertionTarget: false })).toBe(
      "grabbing",
    )
  })

  it("puts insertion indicators on the task and its new project", () => {
    expect(
      resolveMoveIndicatorIds({
        targetScope: "task",
        targetProjectId: "project-b",
        targetTaskId: "task-b",
        sourceProjectId: "project-a",
      }),
    ).toEqual({ taskId: "task-b", projectId: "project-b" })

    expect(
      resolveMoveIndicatorIds({
        targetScope: "task",
        targetProjectId: "project-a",
        targetTaskId: "task-b",
        sourceProjectId: "project-a",
      }),
    ).toEqual({ taskId: "task-b", projectId: null })
  })
})
