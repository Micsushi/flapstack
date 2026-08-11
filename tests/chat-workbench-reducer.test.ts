import { describe, expect, it } from "vitest"
import {
  CHAT_WORKBENCH_MAX_GROUPS,
  applyChatDrop,
  chatWorkbenchLayoutSchema,
  collectChatGroups,
  createChatWorkbenchLayout,
  createTerminalPresentationId,
  getTerminalPresentationChatId,
  migrateChatWorkbenchLayout,
  previewChatDrop,
  projectResponsiveChatWorkbench,
  reduceChatWorkbench,
} from "../src/shared/chat-workbench"

describe("chat workbench reducer", () => {
  it("gives each chat one stable terminal presentation identity", () => {
    const terminalId = createTerminalPresentationId("chat-a")
    expect(terminalId).toBe("terminal:chat-a")
    expect(getTerminalPresentationChatId(terminalId)).toBe("chat-a")
    expect(getTerminalPresentationChatId("chat-a")).toBeNull()
  })

  it("allows four chat panes and four separately movable terminal panes", () => {
    let layout = createChatWorkbenchLayout(["a", "b", "c", "d"], "a")
    for (const [index, chatId] of ["b", "c", "d"].entries()) {
      const split = reduceChatWorkbench(layout, {
        type: "split",
        groupId: collectChatGroups(layout.root)[0].id,
        chatId,
        zone: index % 2 === 0 ? "right" : "bottom",
      })
      expect(split.accepted).toBe(true)
      if (!split.accepted) throw new Error("expected chat split")
      layout = split.layout
    }

    for (const chatId of ["a", "b", "c", "d"]) {
      const owner = collectChatGroups(layout.root).find((group) => group.chatIds.includes(chatId))
      if (!owner) throw new Error("expected chat owner")
      const terminalId = createTerminalPresentationId(chatId)
      const opened = reduceChatWorkbench(layout, {
        type: "open-tab",
        groupId: owner.id,
        chatId: terminalId,
      })
      expect(opened.accepted).toBe(true)
      if (!opened.accepted) throw new Error("expected terminal tab")
      const split = reduceChatWorkbench(opened.layout, {
        type: "split",
        groupId: owner.id,
        chatId: terminalId,
        zone: "right",
      })
      expect(split.accepted).toBe(true)
      if (!split.accepted) throw new Error("expected terminal split")
      layout = split.layout
    }

    expect(collectChatGroups(layout.root)).toHaveLength(8)
  })

  it("retains the surviving pane proportions when a middle pane is closed", () => {
    const initial = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c"]), {
      type: "apply-preset",
      preset: "three-columns",
    })
    expect(initial.accepted).toBe(true)
    if (!initial.accepted || initial.layout.root.type !== "split") {
      throw new Error("expected split layout")
    }
    const resized = reduceChatWorkbench(initial.layout, {
      type: "resize-split",
      splitId: initial.layout.root.id,
      sizes: [0.2, 0.3, 0.5],
    })
    expect(resized.accepted).toBe(true)
    if (!resized.accepted) throw new Error("expected resized layout")

    const closed = reduceChatWorkbench(resized.layout, {
      type: "close-tab",
      groupId: "chat-group-2",
      chatId: "b",
    })

    expect(closed.accepted).toBe(true)
    if (!closed.accepted || closed.layout.root.type !== "split") {
      throw new Error("expected surviving split layout")
    }
    expect(closed.layout.root.sizes[0]).toBeCloseTo(2 / 7)
    expect(closed.layout.root.sizes[1]).toBeCloseTo(5 / 7)
  })
  it("migrates legacy open Chat IDs into one valid group", () => {
    const layout = migrateChatWorkbenchLayout({
      openChatIds: ["chat-a", "chat-b", "chat-a"],
      selectedChatId: "chat-b",
    })

    expect(chatWorkbenchLayoutSchema.parse(layout)).toEqual(layout)
    expect(collectChatGroups(layout.root)).toEqual([
      expect.objectContaining({ chatIds: ["chat-a", "chat-b"], activeChatId: "chat-b" }),
    ])
  })

  it("replaces the empty-layout sentinel when a Chat is opened generically", () => {
    const opened = reduceChatWorkbench(createChatWorkbenchLayout([]), {
      type: "open-tab",
      groupId: "chat-group-1",
      chatId: "chat-a",
    })

    expect(opened.accepted).toBe(true)
    expect(collectChatGroups(opened.layout.root)).toEqual([
      expect.objectContaining({
        chatIds: ["chat-a"],
        activeChatId: "chat-a",
      }),
    ])
  })

  it("builds every bounded preset without duplicating Chat identity", () => {
    const presets = [
      "single",
      "two-columns",
      "two-rows",
      "three-columns",
      "three-rows",
      "grid-2x2",
      "two-rows-right",
      "two-columns-bottom",
      "four-columns",
      "four-rows",
    ] as const

    for (const preset of presets) {
      const result = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c", "d"]), {
        type: "apply-preset",
        preset,
      })
      expect(chatWorkbenchLayoutSchema.safeParse(result.layout).success).toBe(true)
      expect(collectChatGroups(result.layout.root)).toHaveLength(
        preset === "single"
          ? 1
          : preset === "two-columns" || preset === "two-rows"
            ? 2
            : preset.startsWith("three-") ||
                preset === "two-rows-right" ||
                preset === "two-columns-bottom"
              ? 3
              : 4,
      )
      expect(
        collectChatGroups(result.layout.root)
          .flatMap((group) => group.chatIds)
          .sort(),
      ).toEqual(["a", "b", "c", "d"])
    }
  })

  it("makes the drop preview the exact committed tree", () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"]), {
      type: "apply-preset",
      preset: "two-columns",
    }).layout
    const [source, target] = collectChatGroups(layout.root)
    const preview = previewChatDrop(layout, {
      chatId: source.activeChatId,
      sourceGroupId: source.id,
      targetGroupId: target.id,
      zone: "bottom",
    })

    expect(preview.accepted).toBe(true)
    if (!preview.accepted) throw new Error(preview.reason)
    expect(applyChatDrop(layout, preview).layout).toEqual(preview.layout)
  })

  it("recovers a fifth split as a tab without changing the source layout", () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c", "d", "e"]), {
      type: "apply-preset",
      preset: "grid-2x2",
    }).layout
    const groups = collectChatGroups(layout.root)
    expect(groups).toHaveLength(CHAT_WORKBENCH_MAX_GROUPS)

    const preview = previewChatDrop(layout, {
      chatId: "e",
      sourceGroupId: groups.find((group) => group.chatIds.includes("e"))!.id,
      targetGroupId: groups[1].id,
      zone: "right",
    })

    expect(preview).toMatchObject({
      accepted: false,
      recovery: { type: "add-as-tab", targetGroupId: groups[1].id },
    })
    expect(layout).toEqual(layout)
  })

  it("normalizes empty groups and supports resize and maximize/restore", () => {
    let layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"]), {
      type: "apply-preset",
      preset: "two-columns",
    }).layout
    const [left, right] = collectChatGroups(layout.root)
    layout = reduceChatWorkbench(layout, {
      type: "resize-split",
      splitId: layout.root.id,
      sizes: [0.7, 0.3],
    }).layout
    expect(layout.root).toMatchObject({ type: "split", sizes: [0.7, 0.3] })

    layout = reduceChatWorkbench(layout, { type: "toggle-maximize", groupId: right.id }).layout
    expect(layout.maximizedGroupId).toBe(right.id)
    layout = reduceChatWorkbench(layout, { type: "toggle-maximize", groupId: right.id }).layout
    expect(layout.maximizedGroupId).toBeNull()

    layout = reduceChatWorkbench(layout, {
      type: "close-tab",
      groupId: left.id,
      chatId: left.activeChatId,
    }).layout
    expect(collectChatGroups(layout.root)).toHaveLength(1)
    expect(collectChatGroups(layout.root)[0].id).toBe(right.id)
  })

  it("moves a whole pane beside another pane without splitting its tabs apart", () => {
    const initial = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c"]), {
      type: "apply-preset",
      preset: "three-columns",
    }).layout
    const [first, second, third] = collectChatGroups(initial.root)
    const moved = reduceChatWorkbench(initial, {
      type: "move-group",
      fromGroupId: first.id,
      toGroupId: third.id,
      zone: "right",
    })

    expect(moved.accepted).toBe(true)
    expect(collectChatGroups(moved.layout.root).map((group) => group.id)).toEqual([
      second.id,
      third.id,
      first.id,
    ])
    expect(collectChatGroups(moved.layout.root).flatMap((group) => group.chatIds)).toEqual([
      "b",
      "c",
      "a",
    ])
  })

  it("merges all tabs when a whole pane is dropped into another tab strip", () => {
    const initial = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c"]), {
      type: "apply-preset",
      preset: "two-columns",
    }).layout
    const [source, target] = collectChatGroups(initial.root)
    const merged = reduceChatWorkbench(initial, {
      type: "move-group",
      fromGroupId: source.id,
      toGroupId: target.id,
      zone: "tab",
    })

    expect(merged.accepted).toBe(true)
    expect(collectChatGroups(merged.layout.root)).toEqual([
      expect.objectContaining({ chatIds: ["b", "c", "a"], activeChatId: "a" }),
    ])
  })

  it("keeps every pane at the advertised five-percent minimum after extreme resize input", () => {
    const initial = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"]), {
      type: "apply-preset",
      preset: "two-columns",
    }).layout
    const resized = reduceChatWorkbench(initial, {
      type: "resize-split",
      splitId: initial.root.id,
      sizes: [2, -1],
    })

    expect(resized.accepted).toBe(true)
    if (!resized.accepted || resized.layout.root.type !== "split") {
      throw new Error("expected split layout")
    }
    expect(Math.min(...resized.layout.root.sizes)).toBeGreaterThanOrEqual(0.05)
    expect(resized.layout.root.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1)
  })

  it("keeps equivalent dividers linked across a two-by-two layout", () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c", "d"]), {
      type: "apply-preset",
      preset: "grid-2x2",
    }).layout
    if (layout.root.type !== "split") throw new Error("expected grid root")
    const top = layout.root.children[0]
    const bottom = layout.root.children[1]
    if (top.type !== "split" || bottom.type !== "split") {
      throw new Error("expected grid rows")
    }

    const resized = reduceChatWorkbench(layout, {
      type: "resize-split",
      splitId: top.id,
      sizes: [0.65, 0.35],
    })
    if (!resized.accepted || resized.layout.root.type !== "split") {
      throw new Error("expected linked resize")
    }
    expect(resized.layout.root.children).toEqual([
      expect.objectContaining({ id: top.id, sizes: [0.65, 0.35] }),
      expect.objectContaining({ id: bottom.id, sizes: [0.65, 0.35] }),
    ])

    const groups = collectChatGroups(layout.root)
    const columnGrid = chatWorkbenchLayoutSchema.parse({
      ...layout,
      root: {
        type: "split",
        id: "grid-columns",
        direction: "row",
        sizes: [0.5, 0.5],
        children: [
          {
            type: "split",
            id: "grid-left",
            direction: "column",
            sizes: [0.5, 0.5],
            children: [groups[0], groups[2]],
          },
          {
            type: "split",
            id: "grid-right",
            direction: "column",
            sizes: [0.5, 0.5],
            children: [groups[1], groups[3]],
          },
        ],
      },
    })
    const heightResized = reduceChatWorkbench(columnGrid, {
      type: "resize-split",
      splitId: "grid-left",
      sizes: [0.6, 0.4],
    })
    if (!heightResized.accepted || heightResized.layout.root.type !== "split") {
      throw new Error("expected linked height resize")
    }
    expect(heightResized.layout.root.children).toEqual([
      expect.objectContaining({ id: "grid-left", sizes: [0.6, 0.4] }),
      expect.objectContaining({ id: "grid-right", sizes: [0.6, 0.4] }),
    ])
  })

  it("collapses responsively as a projection without data loss", () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c", "d"]), {
      type: "apply-preset",
      preset: "grid-2x2",
    }).layout
    const projected = projectResponsiveChatWorkbench(layout, {
      width: 500,
      height: 500,
      minPaneWidth: 360,
      minPaneHeight: 280,
    })

    expect(projected.collapsedGroupIds.length).toBeGreaterThan(0)
    expect(projected.logicalLayout).toEqual(layout)
    expect(collectChatGroups(projected.visibleLayout.root)).toHaveLength(1)
    expect(collectChatGroups(projected.visibleLayout.root)[0].chatIds.sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
    ])
  })

  it("keeps a two-column layout when width fits even if height cannot fit two rows", () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b"]), {
      type: "apply-preset",
      preset: "two-columns",
    }).layout

    expect(
      projectResponsiveChatWorkbench(layout, {
        width: 800,
        height: 320,
        minPaneWidth: 360,
        minPaneHeight: 280,
      }).collapsedGroupIds,
    ).toEqual([])
  })

  it("includes divider space when deciding whether every pane can keep its minimum size", () => {
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(["a", "b", "c", "d"]), {
      type: "apply-preset",
      preset: "grid-2x2",
    }).layout
    const project = (width: number, height: number) =>
      projectResponsiveChatWorkbench(layout, {
        width,
        height,
        minPaneWidth: 350,
        minPaneHeight: 360,
        dividerSize: 4,
      }).collapsedGroupIds

    expect(project(704, 724)).toEqual([])
    expect(project(703, 724).length).toBeGreaterThan(0)
    expect(project(704, 723).length).toBeGreaterThan(0)
  })
})
