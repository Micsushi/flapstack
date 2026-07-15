import { describe, expect, it } from "vitest"
import {
  savedWorkspaceLayoutSchema,
  type SavedWorkspaceLayout,
  type SavedWorkspaceLayoutNode,
} from "../src/shared/saved-workspaces"
import {
  MAX_VISIBLE_WORKSPACE_CHATS,
  createSingleChatWorkspaceLayout,
  enforceWorkspaceChatCap,
  getVisibleWorkspaceChatPaneIds,
  getWorkspaceGroups,
  reduceWorkspaceLayout,
} from "../src/renderer/features/saved-workspaces/layout-reducer"

describe("saved workspace layout reducer", () => {
  it("builds a versioned bounded single-chat layout", () => {
    const layout = createSingleChatWorkspaceLayout("chat-1", {
      groupId: "group-1",
      paneId: "pane-1",
    })
    expect(savedWorkspaceLayoutSchema.parse(layout)).toEqual(layout)
    expect(getVisibleWorkspaceChatPaneIds(layout)).toEqual(["pane-1"])
  })

  it("moves excess visible chats into overflow tabs without losing a pane", () => {
    const layout = sixChatLayout()
    const capped = enforceWorkspaceChatCap(layout)
    expect(getVisibleWorkspaceChatPaneIds(capped)).toHaveLength(MAX_VISIBLE_WORKSPACE_CHATS)
    expect(allPaneIds(capped).sort()).toEqual([
      "pane-1",
      "pane-2",
      "pane-3",
      "pane-4",
      "pane-5",
      "pane-6",
    ])
    expect(getWorkspaceGroups(capped).some((group) => group.panes.length === 3)).toBe(true)
    expect(savedWorkspaceLayoutSchema.safeParse(capped).success).toBe(true)
  })

  it("persists resize ratios and supports keyboard-equivalent reducer actions", () => {
    const layout = twoGroupLayout()
    const resized = reduceWorkspaceLayout(layout, {
      type: "resize-split",
      splitId: "split-root",
      sizes: [3, 1],
    })
    expect(resized.root).toMatchObject({ type: "split", sizes: [0.75, 0.25] })
    expect(savedWorkspaceLayoutSchema.safeParse(JSON.parse(JSON.stringify(resized))).success).toBe(
      true,
    )
  })

  it("reorders tabs and moves panes between groups", () => {
    let layout = reduceWorkspaceLayout(twoGroupLayout(), {
      type: "duplicate-tab",
      groupId: "group-1",
      paneId: "pane-1",
      newPaneId: "pane-copy",
    })
    layout = reduceWorkspaceLayout(layout, {
      type: "move-pane",
      paneId: "pane-copy",
      fromGroupId: "group-1",
      toGroupId: "group-2",
      toIndex: 0,
    })
    expect(getWorkspaceGroups(layout).find((group) => group.id === "group-2")?.panes[0].id).toBe(
      "pane-copy",
    )
    expect(new Set(allPaneIds(layout)).size).toBe(allPaneIds(layout).length)
  })

  it("duplicates max-length pinned context IDs inside schema bounds", () => {
    const sourceId = "p".repeat(200)
    const contextId = "c".repeat(200)
    const newPaneId = "n".repeat(200)
    const layout: SavedWorkspaceLayout = {
      version: 1,
      root: {
        type: "tabs",
        id: "group-max-ids",
        activePaneId: sourceId,
        panes: [
          {
            id: sourceId,
            binding: { type: "chat", chatId: "chat-1" },
            pinnedContext: [{ id: contextId, type: "browser", url: "https://example.com" }],
          },
        ],
      },
    }
    const duplicated = reduceWorkspaceLayout(layout, {
      type: "duplicate-tab",
      groupId: "group-max-ids",
      paneId: sourceId,
      newPaneId,
    })
    const copiedContextId = getWorkspaceGroups(duplicated)[0].panes[1].pinnedContext?.[0]?.id
    expect(copiedContextId).toBeDefined()
    expect(copiedContextId!.length).toBeLessThanOrEqual(200)
    expect(copiedContextId).not.toBe(contextId)
    expect(savedWorkspaceLayoutSchema.safeParse(duplicated).success).toBe(true)
  })

  it("keeps surviving split sizes attached when the first or middle group disappears", () => {
    const withoutMiddle = reduceWorkspaceLayout(threeGroupLayout(), {
      type: "move-pane",
      paneId: "pane-2",
      fromGroupId: "group-2",
      toGroupId: "group-1",
      toIndex: 1,
    })
    expect(withoutMiddle.root).toMatchObject({
      type: "split",
      children: [{ id: "group-1" }, { id: "group-3" }],
      sizes: [0.125, 0.875],
    })

    const withoutFirst = reduceWorkspaceLayout(threeGroupLayout(), {
      type: "move-pane",
      paneId: "pane-1",
      fromGroupId: "group-1",
      toGroupId: "group-2",
      toIndex: 1,
    })
    expect(withoutFirst.root).toMatchObject({
      type: "split",
      children: [{ id: "group-2" }, { id: "group-3" }],
      sizes: [2 / 9, 7 / 9],
    })
  })

  it("keeps schema, identity, and cap invariants through generated reducer sequences", () => {
    let seed = 0x4f3
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0
      return seed / 0x1_0000_0000
    }
    let nextId = 0
    for (let run = 0; run < 30; run += 1) {
      let layout = createSingleChatWorkspaceLayout(`chat-${run}`, {
        groupId: `group-${run}-0`,
        paneId: `pane-${run}-0`,
      })
      for (let step = 0; step < 40; step += 1) {
        const groups = getWorkspaceGroups(layout)
        const group = groups[Math.floor(random() * groups.length)]
        const pane = group.panes[Math.floor(random() * group.panes.length)]
        const choice = Math.floor(random() * 4)
        if (choice === 0 && groups.length < 10) {
          layout = reduceWorkspaceLayout(layout, {
            type: "split-group",
            groupId: group.id,
            direction: random() > 0.5 ? "row" : "column",
            splitId: `generated-split-${nextId}`,
            newGroupId: `generated-group-${nextId}`,
            newPaneId: `generated-pane-${nextId++}`,
          })
        } else if (choice === 1 && group.panes.length < 10) {
          layout = reduceWorkspaceLayout(layout, {
            type: "duplicate-tab",
            groupId: group.id,
            paneId: pane.id,
            newPaneId: `generated-pane-${nextId++}`,
          })
        } else if (choice === 2) {
          layout = reduceWorkspaceLayout(layout, {
            type: "activate-pane",
            groupId: group.id,
            paneId: pane.id,
          })
        } else {
          layout = reduceWorkspaceLayout(layout, {
            type: "resize-split",
            splitId: "does-not-exist",
            sizes: [random(), random()],
          })
        }
        expect(savedWorkspaceLayoutSchema.safeParse(layout).success).toBe(true)
        expect(new Set(allIdentities(layout)).size).toBe(allIdentities(layout).length)
        expect(getVisibleWorkspaceChatPaneIds(layout).length).toBeLessThanOrEqual(
          MAX_VISIBLE_WORKSPACE_CHATS,
        )
      }
    }
  })
})

function twoGroupLayout(): SavedWorkspaceLayout {
  return {
    version: 1,
    root: {
      type: "split",
      id: "split-root",
      direction: "row",
      sizes: [1, 1],
      children: [chatGroup(1), chatGroup(2)],
    },
  }
}

function sixChatLayout(): SavedWorkspaceLayout {
  return {
    version: 1,
    root: {
      type: "split",
      id: "split-root",
      direction: "row",
      sizes: [1, 1, 1, 1, 1, 1],
      children: [1, 2, 3, 4, 5, 6].map(chatGroup),
    },
  }
}

function threeGroupLayout(): SavedWorkspaceLayout {
  return {
    version: 1,
    root: {
      type: "split",
      id: "split-root",
      direction: "row",
      sizes: [1, 2, 7],
      children: [chatGroup(1), chatGroup(2), chatGroup(3)],
    },
  }
}

function chatGroup(index: number): SavedWorkspaceLayoutNode {
  return {
    type: "tabs",
    id: `group-${index}`,
    activePaneId: `pane-${index}`,
    panes: [
      {
        id: `pane-${index}`,
        title: `Chat ${index}`,
        binding: { type: "chat", chatId: `chat-${index}` },
      },
    ],
  }
}

function allPaneIds(layout: SavedWorkspaceLayout): string[] {
  return getWorkspaceGroups(layout).flatMap((group) => group.panes.map((pane) => pane.id))
}

function allIdentities(layout: SavedWorkspaceLayout): string[] {
  const identities: string[] = []
  const visit = (node: SavedWorkspaceLayoutNode) => {
    identities.push(node.id)
    if (node.type === "tabs") identities.push(...node.panes.map((pane) => pane.id))
    else node.children.forEach(visit)
  }
  visit(layout.root)
  return identities
}
