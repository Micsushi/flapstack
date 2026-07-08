import { describe, expect, it } from "vitest"

import { buildOrderedIds, moveIdInOrder } from "../src/renderer/features/sidebar/sidebar-ordering"

describe("sidebar ordering", () => {
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
})
