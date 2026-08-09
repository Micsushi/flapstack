import { z } from "zod"
import {
  chatWorkbenchLayoutSchema,
  collectChatGroups,
  createChatWorkbenchLayout,
  isEmptyChatWorkbenchLayout,
  reduceChatWorkbench,
  type ChatWorkbenchLayout,
} from "./chat-workbench"

export const CHAT_WORKBENCH_SELECT_CHAT_EVENT = "flapstack:chat-workbench-select-chat"
export const CHAT_WORKBENCH_NAVIGATION_CHANGE_EVENT = "flapstack:chat-workbench-navigation-change"
export const CHAT_WORKBENCH_GROUP_COLORS = [
  "blue",
  "cyan",
  "teal",
  "green",
  "lime",
  "amber",
  "orange",
  "red",
  "pink",
  "violet",
] as const
export type ChatWorkbenchGroupColor = (typeof CHAT_WORKBENCH_GROUP_COLORS)[number]

export type ChatWorkbenchSavedGroup = {
  id: string
  name: string
  color?: ChatWorkbenchGroupColor
  layout: ChatWorkbenchLayout
}

export type ChatWorkbenchNavigationItem = {
  kind: "group" | "chat"
  id: string
}

export type ChatWorkbenchNavigation = {
  activeGroupId: string | null
  groups: ChatWorkbenchSavedGroup[]
  order?: ChatWorkbenchNavigationItem[]
}

export type ChatWorkbenchGroupCloseBehavior = "keep-chats" | "close-chats"

export function chatWorkbenchNavigationStorageKey(stableWindowId: string): string {
  return `${stableWindowId}:chat-workbench-navigation-v1`
}

export function getGroupedChatIds(navigation: ChatWorkbenchNavigation): Set<string> {
  return new Set(
    navigation.groups.flatMap((group) =>
      collectChatGroups(group.layout.root).flatMap((pane) => pane.chatIds),
    ),
  )
}

const navigationSchema = z.object({
  activeGroupId: z.string().nullable(),
  groups: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      color: z.enum(CHAT_WORKBENCH_GROUP_COLORS).optional(),
      layout: chatWorkbenchLayoutSchema,
    }),
  ),
  order: z.array(z.object({ kind: z.enum(["group", "chat"]), id: z.string().min(1) })).optional(),
})

function navigationItemKey(item: ChatWorkbenchNavigationItem): string {
  return `${item.kind}:${item.id}`
}

export function resolveChatWorkbenchNavigationItems(
  navigation: ChatWorkbenchNavigation,
  visibleChatIds: readonly string[],
): ChatWorkbenchNavigationItem[] {
  const visible = [
    ...navigation.groups.map((group) => ({ kind: "group" as const, id: group.id })),
    ...visibleChatIds.map((id) => ({ kind: "chat" as const, id })),
  ]
  const visibleByKey = new Map(visible.map((item) => [navigationItemKey(item), item]))
  const seen = new Set<string>()
  const ordered = (navigation.order ?? []).flatMap((item) => {
    const key = navigationItemKey(item)
    const live = visibleByKey.get(key)
    if (!live || seen.has(key)) return []
    seen.add(key)
    return [live]
  })
  for (const item of visible) {
    const key = navigationItemKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    ordered.push(item)
  }
  return ordered
}

export function reorderChatWorkbenchNavigationItem(
  navigation: ChatWorkbenchNavigation,
  visibleChatIds: readonly string[],
  source: ChatWorkbenchNavigationItem,
  target: ChatWorkbenchNavigationItem,
  position: "before" | "after",
): ChatWorkbenchNavigation {
  const items = resolveChatWorkbenchNavigationItems(navigation, visibleChatIds)
  const sourceKey = navigationItemKey(source)
  const targetKey = navigationItemKey(target)
  if (sourceKey === targetKey || !items.some((item) => navigationItemKey(item) === sourceKey)) {
    return navigation
  }
  const withoutSource = items.filter((item) => navigationItemKey(item) !== sourceKey)
  const targetIndex = withoutSource.findIndex((item) => navigationItemKey(item) === targetKey)
  if (targetIndex < 0) return navigation
  withoutSource.splice(targetIndex + (position === "after" ? 1 : 0), 0, source)
  return { ...navigation, order: withoutSource }
}

export function appendChatWorkbenchNavigationItem(
  navigation: ChatWorkbenchNavigation,
  visibleChatIds: readonly string[],
  item: ChatWorkbenchNavigationItem,
): ChatWorkbenchNavigation {
  const itemKey = navigationItemKey(item)
  const order = resolveChatWorkbenchNavigationItems(navigation, visibleChatIds).filter(
    (candidate) => navigationItemKey(candidate) !== itemKey,
  )
  order.push(item)
  return { ...navigation, order }
}

export function renameChatWorkbenchGroup(
  navigation: ChatWorkbenchNavigation,
  groupId: string,
  name: string,
): ChatWorkbenchNavigation {
  const normalized = name.trim()
  if (!normalized) return navigation
  return {
    ...navigation,
    groups: navigation.groups.map((group) =>
      group.id === groupId ? { ...group, name: normalized } : group,
    ),
  }
}

export function setChatWorkbenchGroupColor(
  navigation: ChatWorkbenchNavigation,
  groupId: string,
  color: ChatWorkbenchGroupColor,
): ChatWorkbenchNavigation {
  return {
    ...navigation,
    groups: navigation.groups.map((group) => (group.id === groupId ? { ...group, color } : group)),
  }
}

function randomUnusedGroupColor(
  groups: readonly ChatWorkbenchSavedGroup[],
  random: () => number,
): ChatWorkbenchGroupColor {
  const usedColors = new Set(groups.map((group) => group.color))
  const unusedColors = CHAT_WORKBENCH_GROUP_COLORS.filter((color) => !usedColors.has(color))
  const availableColors = unusedColors.length > 0 ? unusedColors : CHAT_WORKBENCH_GROUP_COLORS
  const index = Math.min(
    availableColors.length - 1,
    Math.max(0, Math.floor(random() * availableColors.length)),
  )
  return availableColors[index]!
}

export function reconcileChatWorkbenchNavigation(
  navigation: ChatWorkbenchNavigation,
  previousLayout: ChatWorkbenchLayout,
  nextLayout: ChatWorkbenchLayout,
  random: () => number = Math.random,
): ChatWorkbenchNavigation {
  const wasMultiPane = collectChatGroups(previousLayout.root).length > 1
  const isMultiPane = collectChatGroups(nextLayout.root).length > 1
  if (navigation.activeGroupId) {
    if (isEmptyChatWorkbenchLayout(nextLayout)) {
      return {
        ...navigation,
        activeGroupId: null,
        groups: navigation.groups.filter((group) => group.id !== navigation.activeGroupId),
        order: navigation.order?.filter(
          (item) => item.kind !== "group" || item.id !== navigation.activeGroupId,
        ),
      }
    }
    return {
      ...navigation,
      groups: navigation.groups.map((group) =>
        group.id === navigation.activeGroupId ? { ...group, layout: nextLayout } : group,
      ),
    }
  }
  if (wasMultiPane || !isMultiPane) return navigation
  const id = nextGroupId(navigation.groups)
  return {
    activeGroupId: id,
    groups: [
      ...navigation.groups,
      {
        id,
        name: `Group ${navigation.groups.length + 1}`,
        color: randomUnusedGroupColor(navigation.groups, random),
        layout: nextLayout,
      },
    ],
  }
}

export function activateSingleChat(navigation: ChatWorkbenchNavigation, chatId: string) {
  return {
    navigation: { ...navigation, activeGroupId: null },
    layout: createChatWorkbenchLayout([chatId], chatId),
  }
}

export function activateChatSelection(
  navigation: ChatWorkbenchNavigation,
  currentLayout: ChatWorkbenchLayout,
  chatId: string,
): { navigation: ChatWorkbenchNavigation; layout: ChatWorkbenchLayout } {
  const currentOwner = collectChatGroups(currentLayout.root).find((pane) =>
    pane.chatIds.includes(chatId),
  )
  if (currentOwner) {
    const selected = reduceChatWorkbench(currentLayout, {
      type: "activate-tab",
      groupId: currentOwner.id,
      chatId,
    })
    const layout = selected.layout
    return {
      navigation: navigation.activeGroupId
        ? {
            ...navigation,
            groups: navigation.groups.map((group) =>
              group.id === navigation.activeGroupId ? { ...group, layout } : group,
            ),
          }
        : navigation,
      layout,
    }
  }

  const savedOwner = navigation.groups.find((group) =>
    collectChatGroups(group.layout.root).some((pane) => pane.chatIds.includes(chatId)),
  )
  if (!savedOwner) return activateSingleChat(navigation, chatId)
  const pane = collectChatGroups(savedOwner.layout.root).find((candidate) =>
    candidate.chatIds.includes(chatId),
  )!
  const selected = reduceChatWorkbench(savedOwner.layout, {
    type: "activate-tab",
    groupId: pane.id,
    chatId,
  })
  return {
    navigation: {
      ...navigation,
      activeGroupId: savedOwner.id,
      groups: navigation.groups.map((group) =>
        group.id === savedOwner.id ? { ...group, layout: selected.layout } : group,
      ),
    },
    layout: selected.layout,
  }
}

export function activateChatWorkbenchGroup(
  navigation: ChatWorkbenchNavigation,
  groupId: string,
): { navigation: ChatWorkbenchNavigation; layout: ChatWorkbenchLayout } {
  const group = navigation.groups.find((candidate) => candidate.id === groupId)
  if (!group) throw new Error(`Unknown Chat group ${groupId}`)
  return { navigation: { ...navigation, activeGroupId: groupId }, layout: group.layout }
}

export function detachChatFromWorkbenchGroup(
  navigation: ChatWorkbenchNavigation,
  chatId: string,
): { navigation: ChatWorkbenchNavigation; layout: ChatWorkbenchLayout } {
  const owner = navigation.groups.find((group) =>
    collectChatGroups(group.layout.root).some((pane) => pane.chatIds.includes(chatId)),
  )
  if (!owner) return activateSingleChat(navigation, chatId)
  const pane = collectChatGroups(owner.layout.root).find((candidate) =>
    candidate.chatIds.includes(chatId),
  )!
  const removed = reduceChatWorkbench(owner.layout, {
    type: "close-tab",
    groupId: pane.id,
    chatId,
  })
  if (!removed.accepted) return activateSingleChat(navigation, chatId)
  const reconciled = reconcileChatWorkbenchNavigation(
    { ...navigation, activeGroupId: owner.id },
    owner.layout,
    removed.layout,
  )
  return activateSingleChat(reconciled, chatId)
}

export function moveChatToWorkbenchGroup(
  navigation: ChatWorkbenchNavigation,
  chatId: string,
  targetGroupId: string,
): ChatWorkbenchNavigation {
  const currentOwner = navigation.groups.find((group) =>
    collectChatGroups(group.layout.root).some((pane) => pane.chatIds.includes(chatId)),
  )
  if (currentOwner?.id === targetGroupId) return navigation

  const withoutChat = removeChatFromSavedGroups(navigation, chatId)
  const target = withoutChat.groups.find((group) => group.id === targetGroupId)
  if (!target) return navigation
  const opened = reduceChatWorkbench(target.layout, {
    type: "open-tab",
    groupId: target.layout.activeGroupId,
    chatId,
  })
  if (!opened.accepted) return navigation
  return {
    ...withoutChat,
    activeGroupId: targetGroupId,
    groups: withoutChat.groups.map((group) =>
      group.id === targetGroupId ? { ...group, layout: opened.layout } : group,
    ),
  }
}

export function createChatWorkbenchGroup(
  navigation: ChatWorkbenchNavigation,
  visibleChatIds: readonly string[],
  chatId: string,
  random: () => number = Math.random,
): ChatWorkbenchNavigation {
  const items = resolveChatWorkbenchNavigationItems(navigation, visibleChatIds)
  const withoutChat = removeChatFromSavedGroups(navigation, chatId)
  const id = nextGroupId(withoutChat.groups)
  const group: ChatWorkbenchSavedGroup = {
    id,
    name: `Group ${withoutChat.groups.length + 1}`,
    color: randomUnusedGroupColor(withoutChat.groups, random),
    layout: createChatWorkbenchLayout([chatId], chatId),
  }
  const liveGroupIds = new Set([...withoutChat.groups.map((candidate) => candidate.id), id])
  let inserted = false
  const order = items.flatMap((item): ChatWorkbenchNavigationItem[] => {
    if (item.kind === "chat" && item.id === chatId) {
      inserted = true
      return [{ kind: "group", id }]
    }
    if (item.kind === "group" && !liveGroupIds.has(item.id)) return []
    return [item]
  })
  if (!inserted) order.push({ kind: "group", id })
  return {
    ...withoutChat,
    activeGroupId: id,
    groups: [...withoutChat.groups, group],
    order,
  }
}

export function findLoneChatGroupTransition(
  previous: ChatWorkbenchNavigation,
  next: ChatWorkbenchNavigation,
): { groupId: string; chatId: string } | null {
  const previousCounts = new Map(
    previous.groups.map((group) => [
      group.id,
      collectChatGroups(group.layout.root).flatMap((pane) => pane.chatIds).length,
    ]),
  )
  for (const group of next.groups) {
    if ((previousCounts.get(group.id) ?? 0) <= 1) continue
    const chatIds = collectChatGroups(group.layout.root).flatMap((pane) => pane.chatIds)
    if (chatIds.length === 1) return { groupId: group.id, chatId: chatIds[0]! }
  }
  return null
}

export function removeChatWorkbenchGroup(
  navigation: ChatWorkbenchNavigation,
  groupId: string,
  visibleChatIds: readonly string[],
  behavior: ChatWorkbenchGroupCloseBehavior = "keep-chats",
): ChatWorkbenchNavigation {
  const group = navigation.groups.find((candidate) => candidate.id === groupId)
  if (!group) return navigation
  const chatIds = collectChatGroups(group.layout.root).flatMap((pane) => pane.chatIds)
  const resolved = resolveChatWorkbenchNavigationItems(navigation, visibleChatIds)
  const order = resolved.flatMap((item): ChatWorkbenchNavigationItem[] =>
    item.kind === "group" && item.id === groupId
      ? behavior === "keep-chats"
        ? chatIds.map((id) => ({ kind: "chat", id }))
        : []
      : [item],
  )
  return {
    ...navigation,
    activeGroupId: navigation.activeGroupId === groupId ? null : navigation.activeGroupId,
    groups: navigation.groups.filter((candidate) => candidate.id !== groupId),
    order,
  }
}

export function parseChatWorkbenchNavigation(value: string | null): ChatWorkbenchNavigation {
  if (!value) return { activeGroupId: null, groups: [] }
  try {
    return navigationSchema.parse(JSON.parse(value))
  } catch {
    return { activeGroupId: null, groups: [] }
  }
}

function nextGroupId(groups: readonly ChatWorkbenchSavedGroup[]) {
  const used = new Set(groups.map((group) => group.id))
  for (let index = 1; index < 10_000; index += 1) {
    const id = `workbench-group-${index}`
    if (!used.has(id)) return id
  }
  throw new Error("Unable to allocate a Chat group identity.")
}

function removeChatFromSavedGroups(
  navigation: ChatWorkbenchNavigation,
  chatId: string,
): ChatWorkbenchNavigation {
  const removedGroupIds = new Set<string>()
  const groups = navigation.groups.flatMap((group) => {
    const pane = collectChatGroups(group.layout.root).find((candidate) =>
      candidate.chatIds.includes(chatId),
    )
    if (!pane) return [group]
    const removed = reduceChatWorkbench(group.layout, {
      type: "close-tab",
      groupId: pane.id,
      chatId,
    })
    if (!removed.accepted || isEmptyChatWorkbenchLayout(removed.layout)) {
      removedGroupIds.add(group.id)
      return []
    }
    return [{ ...group, layout: removed.layout }]
  })
  return {
    ...navigation,
    activeGroupId:
      navigation.activeGroupId && removedGroupIds.has(navigation.activeGroupId)
        ? null
        : navigation.activeGroupId,
    groups,
    order: navigation.order?.filter(
      (item) =>
        !(item.kind === "chat" && item.id === chatId) &&
        !(item.kind === "group" && removedGroupIds.has(item.id)),
    ),
  }
}
