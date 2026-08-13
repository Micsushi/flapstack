import { describe, expect, it } from "vitest"
import {
  collectChatGroups,
  createChatWorkbenchLayout,
  reduceChatWorkbench,
} from "../src/shared/chat-workbench"
import {
  activateChatWorkbenchGroup,
  activateChatSelection,
  activateSingleChat,
  appendChatWorkbenchNavigationItem,
  CHAT_WORKBENCH_GROUP_COLORS,
  createChatWorkbenchGroup,
  detachChatFromWorkbenchGroup,
  findLoneChatGroupTransition,
  getGroupedChatIds,
  moveChatToWorkbenchGroup,
  parseChatWorkbenchNavigation,
  parseStoredProjectColors,
  removeChatWorkbenchGroup,
  renameChatWorkbenchGroup,
  reconcileChatWorkbenchNavigation,
  reorderChatWorkbenchNavigationItem,
  resolveChatWorkbenchNavigationItems,
  setChatWorkbenchGroupColor,
} from "../src/shared/chat-workbench-navigation"

describe("chat workbench top-level navigation", () => {
  it("filters malformed persisted project colors", () => {
    expect(
      parseStoredProjectColors(
        JSON.stringify({
          valid: "#22c55e",
          short: "#0f0",
          null: null,
          number: 42,
          object: { color: "#f97316" },
        }),
      ),
    ).toEqual({ valid: "#22c55e" })
  })

  it("reports every Chat owned by a saved group", () => {
    const split = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"], "a"), {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout

    expect(
      getGroupedChatIds({
        activeGroupId: "workbench-group-1",
        groups: [{ id: "workbench-group-1", name: "Group 1", layout: split }],
      }),
    ).toEqual(new Set(["a", "b"]))
  })

  it("creates a durable group only when a layout gains multiple panes", () => {
    const single = createChatWorkbenchLayout(["a", "b"], "a")
    const split = reduceChatWorkbench(single, {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout

    const navigation = reconcileChatWorkbenchNavigation(
      { activeGroupId: null, groups: [] },
      single,
      split,
      () => 0,
    )

    expect(navigation.groups).toHaveLength(1)
    expect(navigation.groups[0]?.color).toBe("blue")
    expect(navigation.groups[0]?.layout).toEqual(split)
    expect(navigation.activeGroupId).toBe(navigation.groups[0]?.id)
  })

  it("opens an ordinary Chat alone without discarding a saved multi-pane group", () => {
    const split = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"], "a"), {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout
    const grouped = reconcileChatWorkbenchNavigation(
      { activeGroupId: null, groups: [] },
      createChatWorkbenchLayout(["a", "b"], "a"),
      split,
    )

    const ordinary = activateSingleChat(grouped, "c")
    expect(ordinary.navigation.groups).toEqual(grouped.groups)
    expect(ordinary.navigation.activeGroupId).toBeNull()
    expect(ordinary.layout).toEqual(createChatWorkbenchLayout(["c"], "c"))

    const restored = activateChatWorkbenchGroup(ordinary.navigation, grouped.groups[0]!.id)
    expect(restored.layout).toEqual(split)
  })

  it("routes a newly created Chat out of the active group into a full-screen ordinary tab", () => {
    const split = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"], "a"), {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout
    const grouped = reconcileChatWorkbenchNavigation(
      { activeGroupId: null, groups: [] },
      createChatWorkbenchLayout(["a", "b"], "a"),
      split,
    )

    const selected = activateChatSelection(grouped, split, "hello")
    expect(selected.navigation.groups).toEqual(grouped.groups)
    expect(selected.navigation.activeGroupId).toBeNull()
    expect(selected.layout).toEqual(createChatWorkbenchLayout(["hello"], "hello"))
  })

  it("restores a saved group when one of its member chats is selected", () => {
    const split = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"], "a"), {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout
    const grouped = reconcileChatWorkbenchNavigation(
      { activeGroupId: null, groups: [] },
      createChatWorkbenchLayout(["a", "b"], "a"),
      split,
    )
    const ordinary = activateSingleChat(grouped, "c")

    const selected = activateChatSelection(ordinary.navigation, ordinary.layout, "b")
    expect(selected.navigation.activeGroupId).toBe(grouped.groups[0]!.id)
    expect(selected.layout.activeGroupId).toBe("chat-group-2")
    expect(selected.layout.root).toMatchObject({ type: "split" })
  })

  it("persists an interleaved order for ordinary Chats and groups", () => {
    const split = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"], "a"), {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout
    const grouped = reconcileChatWorkbenchNavigation(
      { activeGroupId: null, groups: [] },
      createChatWorkbenchLayout(["a", "b"], "a"),
      split,
    )
    const groupId = grouped.groups[0]!.id
    const ordered = reorderChatWorkbenchNavigationItem(
      grouped,
      ["c", "d"],
      { kind: "chat", id: "c" },
      { kind: "group", id: groupId },
      "after",
    )

    expect(resolveChatWorkbenchNavigationItems(ordered, ["c", "d"])).toEqual([
      { kind: "group", id: groupId },
      { kind: "chat", id: "c" },
      { kind: "chat", id: "d" },
    ])
  })

  it("renames a saved group without changing its layout or identity", () => {
    const split = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"], "a"), {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout
    const grouped = reconcileChatWorkbenchNavigation(
      { activeGroupId: null, groups: [] },
      createChatWorkbenchLayout(["a", "b"], "a"),
      split,
    )
    const renamed = renameChatWorkbenchGroup(grouped, grouped.groups[0]!.id, "Research")
    expect(renamed.groups[0]).toEqual({ ...grouped.groups[0], name: "Research" })
  })

  it("stores one of ten durable group colors", () => {
    const split = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"], "a"), {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout
    const grouped = reconcileChatWorkbenchNavigation(
      { activeGroupId: null, groups: [] },
      createChatWorkbenchLayout(["a", "b"], "a"),
      split,
    )

    expect(CHAT_WORKBENCH_GROUP_COLORS).toHaveLength(10)
    const colored = setChatWorkbenchGroupColor(grouped, grouped.groups[0]!.id, "violet")
    expect(colored.groups[0]?.color).toBe("violet")
    expect(parseChatWorkbenchNavigation(JSON.stringify(colored))).toEqual(colored)
  })

  it("moves a pane Chat back to the ordinary main bar without discarding the remaining group", () => {
    const single = createChatWorkbenchLayout(["a", "b", "c"], "a")
    const twoPanes = reduceChatWorkbench(single, {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout
    const threePanes = reduceChatWorkbench(twoPanes, {
      type: "split",
      groupId: "chat-group-1",
      chatId: "c",
      zone: "bottom",
    }).layout
    const grouped = reconcileChatWorkbenchNavigation(
      { activeGroupId: null, groups: [] },
      single,
      threePanes,
    )

    const detached = detachChatFromWorkbenchGroup(grouped, "b")

    expect(detached.navigation.activeGroupId).toBeNull()
    expect(detached.navigation.groups).toHaveLength(1)
    expect(
      collectChatGroups(detached.navigation.groups[0]!.layout.root).flatMap((pane) => pane.chatIds),
    ).toEqual(expect.not.arrayContaining(["b"]))
    expect(collectChatGroups(detached.layout.root)[0]).toMatchObject({
      chatIds: ["b"],
      activeChatId: "b",
    })
  })

  it("keeps a saved group when moving a Chat leaves one Chat behind", () => {
    const single = createChatWorkbenchLayout(["a", "b"], "a")
    const split = reduceChatWorkbench(single, {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout
    const grouped = reconcileChatWorkbenchNavigation(
      { activeGroupId: null, groups: [] },
      single,
      split,
    )

    const detached = detachChatFromWorkbenchGroup(grouped, "b")

    expect(detached.navigation.groups).toHaveLength(1)
    expect(
      collectChatGroups(detached.navigation.groups[0]!.layout.root).flatMap((pane) => pane.chatIds),
    ).toEqual(["a"])
  })

  it("moves a Chat from one saved group into another", () => {
    const firstSingle = createChatWorkbenchLayout(["a", "b"], "a")
    const firstSplit = reduceChatWorkbench(firstSingle, {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout
    const first = reconcileChatWorkbenchNavigation(
      { activeGroupId: null, groups: [] },
      firstSingle,
      firstSplit,
    )
    const secondSingle = createChatWorkbenchLayout(["c", "d"], "c")
    const secondSplit = reduceChatWorkbench(secondSingle, {
      type: "split",
      groupId: "chat-group-1",
      chatId: "d",
      zone: "right",
    }).layout
    const grouped = reconcileChatWorkbenchNavigation(
      { ...first, activeGroupId: null },
      secondSingle,
      secondSplit,
    )

    const moved = moveChatToWorkbenchGroup(grouped, "b", grouped.groups[1]!.id)

    expect(moved.activeGroupId).toBe(grouped.groups[1]!.id)
    expect(collectChatGroups(moved.groups[0]!.layout.root).flatMap((pane) => pane.chatIds)).toEqual(
      ["a"],
    )
    expect(collectChatGroups(moved.groups[1]!.layout.root).flatMap((pane) => pane.chatIds)).toEqual(
      expect.arrayContaining(["b", "c", "d"]),
    )
  })

  it("creates a one-Chat group at the Chat's main-bar position", () => {
    const created = createChatWorkbenchGroup(
      {
        activeGroupId: null,
        groups: [],
        order: [
          { kind: "chat", id: "a" },
          { kind: "chat", id: "b" },
        ],
      },
      ["a", "b"],
      "b",
      () => 0,
    )

    expect(created.groups).toHaveLength(1)
    expect(created.groups[0]!.color).toBe("blue")
    expect(created.activeGroupId).toBe(created.groups[0]!.id)
    expect(collectChatGroups(created.groups[0]!.layout.root)[0]?.chatIds).toEqual(["b"])
    expect(resolveChatWorkbenchNavigationItems(created, ["a"])).toEqual([
      { kind: "chat", id: "a" },
      { kind: "group", id: created.groups[0]!.id },
    ])
  })

  it("randomly assigns an unused color when a group is first created", () => {
    const layout = createChatWorkbenchLayout(["a"], "a")
    const created = createChatWorkbenchGroup(
      {
        activeGroupId: null,
        groups: [
          { id: "workbench-group-1", name: "First", color: "blue", layout },
          { id: "workbench-group-2", name: "Second", color: "green", layout },
        ],
      },
      ["c"],
      "c",
      () => 0,
    )

    expect(created.groups.at(-1)?.color).toBe("cyan")
  })

  it("prefers a group hue that is distinct from project colors", () => {
    const created = createChatWorkbenchGroup(
      { activeGroupId: null, groups: [] },
      ["a"],
      "a",
      () => 0,
      ["#22c55e"],
    )

    expect(created.groups[0]?.color).toBe("pink")
  })

  it("appends a detached Chat to the empty tail of the main bar", () => {
    const navigation = appendChatWorkbenchNavigationItem(
      {
        activeGroupId: null,
        groups: [],
        order: [
          { kind: "chat", id: "b" },
          { kind: "chat", id: "a" },
        ],
      },
      ["a", "b", "c"],
      { kind: "chat", id: "c" },
    )

    expect(resolveChatWorkbenchNavigationItems(navigation, ["a", "b", "c"])).toEqual([
      { kind: "chat", id: "b" },
      { kind: "chat", id: "a" },
      { kind: "chat", id: "c" },
    ])
  })

  it("detects only a group transition from multiple Chats to one", () => {
    const beforeLayout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"], "a"), {
      type: "split",
      groupId: "chat-group-1",
      chatId: "b",
      zone: "right",
    }).layout
    const before = {
      activeGroupId: "workbench-group-1",
      groups: [{ id: "workbench-group-1", name: "Group 1", layout: beforeLayout }],
    }
    const after = detachChatFromWorkbenchGroup(before, "b").navigation

    expect(findLoneChatGroupTransition(before, after)).toEqual({
      groupId: "workbench-group-1",
      chatId: "a",
    })
    expect(findLoneChatGroupTransition(after, after)).toBeNull()
  })

  it("removes a saved group and exposes its remaining Chats on the main bar", () => {
    const grouped = createChatWorkbenchGroup({ activeGroupId: null, groups: [] }, ["a"], "a")
    const removed = removeChatWorkbenchGroup(grouped, grouped.groups[0]!.id, ["b"])

    expect(removed.groups).toEqual([])
    expect(removed.activeGroupId).toBeNull()
    expect(resolveChatWorkbenchNavigationItems(removed, ["a", "b"])).toEqual([
      { kind: "chat", id: "a" },
      { kind: "chat", id: "b" },
    ])
  })

  it("removes a saved group without exposing its Chats when they are closed", () => {
    const grouped = createChatWorkbenchGroup({ activeGroupId: null, groups: [] }, ["a"], "a")
    const removed = removeChatWorkbenchGroup(grouped, grouped.groups[0]!.id, ["b"], "close-chats")

    expect(removed.groups).toEqual([])
    expect(removed.activeGroupId).toBeNull()
    expect(removed.order).toEqual([{ kind: "chat", id: "b" }])
    expect(resolveChatWorkbenchNavigationItems(removed, ["b"])).toEqual([{ kind: "chat", id: "b" }])
  })
})
