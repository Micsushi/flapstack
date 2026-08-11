import { z } from "zod"

export const CHAT_WORKBENCH_LAYOUT_VERSION = 1 as const
export const CHAT_WORKBENCH_SESSION_VERSION = 1 as const
export const CHAT_WORKBENCH_DRAG_VERSION = 1 as const
export const CHAT_WORKBENCH_MAX_GROUPS = 4
export const CHAT_WORKBENCH_MAX_TERMINALS = 4
export const CHAT_WORKBENCH_MAX_PRESENTATION_GROUPS =
  CHAT_WORKBENCH_MAX_GROUPS + CHAT_WORKBENCH_MAX_TERMINALS
export const CHAT_WORKBENCH_MAX_WINDOWS = 4
export const CHAT_WORKBENCH_DRAG_MIME = "application/x-flapstack-chat-workbench"
export const CHAT_WORKBENCH_EXTERNAL_GROUP_ID = "sidebar"
export const CHAT_WORKBENCH_DRAG_SESSION_KEY = "flapstack:chat-workbench-drag-session"
export const CHAT_WORKBENCH_TERMINAL_PREFIX = "terminal:"

export function createTerminalPresentationId(chatId: string): string {
  return `${CHAT_WORKBENCH_TERMINAL_PREFIX}${chatId}`
}

export function getTerminalPresentationChatId(presentationId: string): string | null {
  if (!presentationId.startsWith(CHAT_WORKBENCH_TERMINAL_PREFIX)) return null
  const chatId = presentationId.slice(CHAT_WORKBENCH_TERMINAL_PREFIX.length).trim()
  return chatId || null
}

export type ChatWorkbenchPreset =
  | "single"
  | "two-columns"
  | "two-rows"
  | "three-columns"
  | "three-rows"
  | "grid-2x2"
  | "two-rows-right"
  | "two-columns-bottom"
  | "four-columns"
  | "four-rows"

export type ChatDropZone = "tab" | "left" | "right" | "top" | "bottom"

export type ChatGroupNode =
  | {
      type: "group"
      id: string
      chatIds: string[]
      activeChatId: string
    }
  | {
      type: "split"
      id: string
      direction: "row" | "column"
      sizes: number[]
      children: ChatGroupNode[]
    }

export type ChatWorkbenchLayout = {
  version: typeof CHAT_WORKBENCH_LAYOUT_VERSION
  root: ChatGroupNode
  activeGroupId: string
  maximizedGroupId: string | null
  paneBounds?: Record<string, ChatPaneBounds>
}

export type ChatPaneBounds = {
  x: number
  y: number
  width: number
  height: number
}

const idSchema = z.string().trim().min(1).max(256)
const paneBoundsSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
  })
  .strict()
const groupNodeSchema: z.ZodType<ChatGroupNode> = z.lazy(() =>
  z.union([
    z
      .object({
        type: z.literal("group"),
        id: idSchema,
        chatIds: z.array(idSchema).min(1),
        activeChatId: idSchema,
      })
      .strict()
      .superRefine((group, context) => {
        if (!group.chatIds.includes(group.activeChatId)) {
          context.addIssue({ code: "custom", message: "Active Chat must belong to its group." })
        }
        if (new Set(group.chatIds).size !== group.chatIds.length) {
          context.addIssue({ code: "custom", message: "Chat IDs must be unique within a group." })
        }
      }),
    z
      .object({
        type: z.literal("split"),
        id: idSchema,
        direction: z.enum(["row", "column"]),
        sizes: z
          .array(z.number().finite().positive())
          .min(2)
          .max(CHAT_WORKBENCH_MAX_PRESENTATION_GROUPS),
        children: z.array(groupNodeSchema).min(2).max(CHAT_WORKBENCH_MAX_PRESENTATION_GROUPS),
      })
      .strict()
      .superRefine((split, context) => {
        if (split.sizes.length !== split.children.length) {
          context.addIssue({ code: "custom", message: "Split sizes must match its children." })
        }
      }),
  ]),
)

export const chatWorkbenchLayoutSchema = z
  .object({
    version: z.literal(CHAT_WORKBENCH_LAYOUT_VERSION),
    root: groupNodeSchema,
    activeGroupId: idSchema,
    maximizedGroupId: idSchema.nullable(),
    paneBounds: z.record(idSchema, paneBoundsSchema).optional(),
  })
  .strict()
  .superRefine((layout, context) => {
    const groups = collectChatGroups(layout.root)
    const groupIds = new Set(groups.map((group) => group.id))
    const allChatIds = groups.flatMap((group) => group.chatIds)
    const chatGroups = groups.filter((group) =>
      group.chatIds.some((id) => getTerminalPresentationChatId(id) === null),
    )
    const terminalIds = allChatIds.filter((id) => getTerminalPresentationChatId(id) !== null)
    if (groups.length > CHAT_WORKBENCH_MAX_PRESENTATION_GROUPS) {
      context.addIssue({ code: "custom", message: "Too many workbench panes are visible." })
    }
    if (chatGroups.length > CHAT_WORKBENCH_MAX_GROUPS) {
      context.addIssue({ code: "custom", message: "At most four Chat groups may be visible." })
    }
    if (terminalIds.length > CHAT_WORKBENCH_MAX_TERMINALS) {
      context.addIssue({ code: "custom", message: "At most four Terminal panes may be visible." })
    }
    if (!groupIds.has(layout.activeGroupId)) {
      context.addIssue({ code: "custom", message: "Active group must exist." })
    }
    if (layout.maximizedGroupId && !groupIds.has(layout.maximizedGroupId)) {
      context.addIssue({ code: "custom", message: "Maximized group must exist." })
    }
    if (new Set(allChatIds).size !== allChatIds.length) {
      context.addIssue({ code: "custom", message: "A Chat may appear only once in a layout." })
    }
    if (layout.paneBounds) {
      const boundIds = Object.keys(layout.paneBounds)
      if (boundIds.length !== groupIds.size || boundIds.some((groupId) => !groupIds.has(groupId))) {
        context.addIssue({ code: "custom", message: "Pane bounds must match visible groups." })
      }
      for (const bounds of Object.values(layout.paneBounds)) {
        if (bounds.x + bounds.width > 1.000001 || bounds.y + bounds.height > 1.000001) {
          context.addIssue({ code: "custom", message: "Pane bounds must stay inside the layout." })
        }
      }
    }
  })

const chatWorkbenchWindowSessionInputSchema = z
  .object({
    version: z.literal(CHAT_WORKBENCH_SESSION_VERSION),
    stableWindowId: idSchema,
    kind: z.enum(["main", "chat", "saved-workspace"]),
    projectId: idSchema.nullable(),
    workspaceId: idSchema.nullable().optional(),
    layout: chatWorkbenchLayoutSchema,
    displayId: z.string().max(256).optional(),
    bounds: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        width: z.number().finite().positive(),
        height: z.number().finite().positive(),
      })
      .strict()
      .optional(),
    compact: z.boolean().optional(),
    lastFocusedAt: z.number().finite(),
    draftRefs: z.record(idSchema, idSchema).default({}),
    transcriptAnchorRefs: z.record(idSchema, idSchema).default({}),
    // Empty v1 fields are accepted for migration only. Draft/message content is
    // intentionally rejected from the durable window-session envelope.
    drafts: z.record(idSchema, z.never()).optional(),
    transcriptAnchors: z.record(idSchema, z.never()).optional(),
  })
  .strict()
  .transform(({ drafts: _drafts, transcriptAnchors: _anchors, ...session }) => session)

export const chatWorkbenchWindowSessionSchema = chatWorkbenchWindowSessionInputSchema

export type ChatWorkbenchWindowSession = z.infer<typeof chatWorkbenchWindowSessionSchema>

export const chatWorkbenchSessionPresentationSchema = z
  .object({
    layout: chatWorkbenchLayoutSchema,
    compact: z.boolean(),
    draftRefs: z.record(idSchema, idSchema),
    scrollAnchorRefs: z.record(idSchema, idSchema),
  })
  .strict()

export type ChatWorkbenchSessionPresentation = z.infer<
  typeof chatWorkbenchSessionPresentationSchema
>

export const chatWorkbenchDragSessionSchema = z
  .object({
    version: z.literal(CHAT_WORKBENCH_DRAG_VERSION),
    nonce: z.string().min(12).max(256),
    chatId: idSchema,
    sourceWindowId: idSchema,
    sourceGroupId: idSchema,
    operation: z.enum(["move", "read-only-copy"]),
    expiresAt: z.number().finite().positive(),
  })
  .strict()

export type ChatWorkbenchAction =
  | { type: "open-tab"; groupId: string; chatId: string }
  | { type: "activate-tab"; groupId: string; chatId: string }
  | { type: "close-tab"; groupId: string; chatId: string }
  | { type: "move-tab"; fromGroupId: string; toGroupId: string; chatId: string; toIndex?: number }
  | {
      type: "move-group"
      fromGroupId: string
      toGroupId: string
      zone: ChatDropZone
    }
  | { type: "split"; groupId: string; chatId: string; zone: Exclude<ChatDropZone, "tab"> }
  | { type: "apply-preset"; preset: ChatWorkbenchPreset }
  | { type: "resize-split"; splitId: string; sizes: number[] }
  | { type: "toggle-maximize"; groupId: string }

export type ChatWorkbenchResult =
  | { accepted: true; layout: ChatWorkbenchLayout; announcement?: string }
  | {
      accepted: false
      layout: ChatWorkbenchLayout
      reason: "invalid-source" | "invalid-target" | "group-limit"
      recovery?: { type: "add-as-tab"; targetGroupId: string }
    }

export type ChatDropRequest = {
  chatId: string
  sourceGroupId: string
  targetGroupId: string
  zone: ChatDropZone
  toIndex?: number
}

export type ChatDropPreview =
  | {
      accepted: true
      request: ChatDropRequest
      layout: ChatWorkbenchLayout
      announcement: string
    }
  | {
      accepted: false
      request: ChatDropRequest
      reason: "invalid-source" | "invalid-target" | "group-limit"
      recovery?: { type: "add-as-tab"; targetGroupId: string }
    }

export function createChatWorkbenchLayout(
  chatIds: string[],
  selectedChatId?: string | null,
): ChatWorkbenchLayout {
  const normalized = uniqueIds(chatIds)
  const ids = normalized.length > 0 ? normalized : ["new-chat"]
  const group: ChatGroupNode = {
    type: "group",
    id: "chat-group-1",
    chatIds: ids,
    activeChatId: selectedChatId && ids.includes(selectedChatId) ? selectedChatId : ids[0],
  }
  return {
    version: CHAT_WORKBENCH_LAYOUT_VERSION,
    root: group,
    activeGroupId: group.id,
    maximizedGroupId: null,
  }
}

export function migrateChatWorkbenchLayout(input: unknown): ChatWorkbenchLayout {
  const parsed = chatWorkbenchLayoutSchema.safeParse(input)
  if (parsed.success) return parsed.data
  const legacy = z
    .object({
      openChatIds: z.array(idSchema).optional(),
      selectedChatId: idSchema.nullable().optional(),
    })
    .passthrough()
    .safeParse(input)
  if (!legacy.success) return createChatWorkbenchLayout([])
  return createChatWorkbenchLayout(
    legacy.data.openChatIds ?? (legacy.data.selectedChatId ? [legacy.data.selectedChatId] : []),
    legacy.data.selectedChatId,
  )
}

export function collectChatGroups(
  root: ChatGroupNode,
): Array<Extract<ChatGroupNode, { type: "group" }>> {
  if (root.type === "group") return [root]
  return root.children.flatMap(collectChatGroups)
}

export function isEmptyChatWorkbenchLayout(layout: ChatWorkbenchLayout): boolean {
  const groups = collectChatGroups(layout.root)
  return (
    groups.length === 1 && groups[0].chatIds.length === 1 && groups[0].chatIds[0] === "new-chat"
  )
}

export function reduceChatWorkbench(
  layout: ChatWorkbenchLayout,
  action: ChatWorkbenchAction,
): ChatWorkbenchResult {
  if (action.type === "open-tab") {
    if (isEmptyChatWorkbenchLayout(layout) && action.chatId !== "new-chat") {
      return accepted(
        createChatWorkbenchLayout([action.chatId], action.chatId),
        "Opened Chat as tab",
      )
    }
    const existing = collectChatGroups(layout.root).find((group) =>
      group.chatIds.includes(action.chatId),
    )
    if (existing) {
      return reduceChatWorkbench(layout, {
        type: "activate-tab",
        groupId: existing.id,
        chatId: action.chatId,
      })
    }
    const group = findGroup(layout.root, action.groupId)
    if (!group) return rejected(layout, "invalid-target")
    const root = mapNode(layout.root, (node) =>
      node.type === "group" && node.id === group.id
        ? { ...node, chatIds: [...node.chatIds, action.chatId], activeChatId: action.chatId }
        : node,
    )
    return accepted(validate({ ...layout, root, activeGroupId: group.id }), "Opened Chat as tab")
  }
  if (action.type === "apply-preset") {
    return accepted(applyPreset(layout, action.preset), `Applied ${action.preset} layout`)
  }
  if (action.type === "resize-split") {
    const split = findNode(layout.root, action.splitId)
    if (!split || split.type !== "split" || split.children.length !== action.sizes.length) {
      return rejected(layout, "invalid-target")
    }
    const linkedIds = findLinkedSplitIds(layout.root, action.splitId)
    const sizes = normalizeSizes(action.sizes)
    const root = mapNode(layout.root, (node) =>
      linkedIds.has(node.id) &&
      node.type === "split" &&
      node.direction === split.direction &&
      node.children.length === sizes.length
        ? { ...node, sizes }
        : node,
    )
    return accepted(validate(withoutPaneBounds({ ...layout, root })))
  }
  if (action.type === "toggle-maximize") {
    if (!findGroup(layout.root, action.groupId)) return rejected(layout, "invalid-target")
    return accepted(
      validate({
        ...layout,
        activeGroupId: action.groupId,
        maximizedGroupId: layout.maximizedGroupId === action.groupId ? null : action.groupId,
      }),
    )
  }
  if (action.type === "activate-tab") {
    const group = findGroup(layout.root, action.groupId)
    if (!group || !group.chatIds.includes(action.chatId)) return rejected(layout, "invalid-target")
    const root = mapNode(layout.root, (node) =>
      node.type === "group" && node.id === group.id
        ? { ...node, activeChatId: action.chatId }
        : node,
    )
    return accepted(validate({ ...layout, root, activeGroupId: group.id }))
  }
  if (action.type === "close-tab") {
    const group = findGroup(layout.root, action.groupId)
    if (!group || !group.chatIds.includes(action.chatId)) return rejected(layout, "invalid-source")
    const root = removeChat(layout.root, action.groupId, action.chatId)
    if (!root) return accepted(createChatWorkbenchLayout([]), "Closed Chat presentation")
    const groups = collectChatGroups(root)
    const activeGroupId = groups.some((candidate) => candidate.id === layout.activeGroupId)
      ? layout.activeGroupId
      : groups[0].id
    return accepted(
      validate(
        withoutPaneBounds({
          ...layout,
          root,
          activeGroupId,
          maximizedGroupId:
            layout.maximizedGroupId && groups.some((group) => group.id === layout.maximizedGroupId)
              ? layout.maximizedGroupId
              : null,
        }),
      ),
      "Closed Chat presentation",
    )
  }
  if (action.type === "move-tab") {
    return moveTab(layout, action)
  }
  if (action.type === "move-group") {
    return moveGroup(layout, action)
  }
  return splitChat(layout, action)
}

export function selectChatInWorkbench(
  layout: ChatWorkbenchLayout,
  chatId: string,
): ChatWorkbenchResult {
  const groups = collectChatGroups(layout.root)
  if (isEmptyChatWorkbenchLayout(layout) && chatId !== "new-chat") {
    return accepted(createChatWorkbenchLayout([chatId], chatId))
  }

  const owner = groups.find((group) => group.chatIds.includes(chatId))
  return owner
    ? reduceChatWorkbench(layout, {
        type: "activate-tab",
        groupId: owner.id,
        chatId,
      })
    : reduceChatWorkbench(layout, {
        type: "open-tab",
        groupId: layout.activeGroupId,
        chatId,
      })
}

export function closeChatsInWorkbench(
  layout: ChatWorkbenchLayout,
  chatIds: readonly string[],
): ChatWorkbenchLayout {
  let nextLayout = layout
  for (const chatId of new Set(chatIds)) {
    const owner = collectChatGroups(nextLayout.root).find((group) => group.chatIds.includes(chatId))
    if (!owner) continue
    const closed = reduceChatWorkbench(nextLayout, {
      type: "close-tab",
      groupId: owner.id,
      chatId,
    })
    if (closed.accepted) nextLayout = closed.layout
  }
  return nextLayout
}

export function previewChatDrop(
  layout: ChatWorkbenchLayout,
  request: ChatDropRequest,
): ChatDropPreview {
  const source = findGroup(layout.root, request.sourceGroupId)
  const target = findGroup(layout.root, request.targetGroupId)
  if (!source && request.sourceGroupId === CHAT_WORKBENCH_EXTERNAL_GROUP_ID) {
    if (collectChatGroups(layout.root).some((group) => group.chatIds.includes(request.chatId))) {
      return { accepted: false, request, reason: "invalid-source" }
    }
    const opened = reduceChatWorkbench(layout, {
      type: "open-tab",
      groupId: request.targetGroupId,
      chatId: request.chatId,
    })
    if (!opened.accepted) return { accepted: false, request, reason: opened.reason }
    const result =
      request.zone === "tab"
        ? opened
        : reduceChatWorkbench(opened.layout, {
            type: "split",
            groupId: request.targetGroupId,
            chatId: request.chatId,
            zone: request.zone,
          })
    if (!result.accepted) {
      return { accepted: false, request, reason: result.reason, recovery: result.recovery }
    }
    return {
      accepted: true,
      request,
      layout: result.layout,
      announcement:
        request.zone === "tab" ? "Added Chat as a pane tab" : `Created a ${request.zone} Chat pane`,
    }
  }
  if (!source || !source.chatIds.includes(request.chatId)) {
    return { accepted: false, request, reason: "invalid-source" }
  }
  if (!target) return { accepted: false, request, reason: "invalid-target" }
  if (request.zone !== "tab" && !canSplitPresentation(layout, request.chatId)) {
    return {
      accepted: false,
      request,
      reason: "group-limit",
      recovery: { type: "add-as-tab", targetGroupId: target.id },
    }
  }
  const result =
    request.zone === "tab"
      ? reduceChatWorkbench(layout, {
          type: "move-tab",
          fromGroupId: request.sourceGroupId,
          toGroupId: request.targetGroupId,
          chatId: request.chatId,
          toIndex: request.toIndex,
        })
      : reduceChatWorkbench(layout, {
          type: "split",
          groupId: request.targetGroupId,
          chatId: request.chatId,
          zone: request.zone,
        })
  if (!result.accepted)
    return { accepted: false, request, reason: result.reason, recovery: result.recovery }
  return {
    accepted: true,
    request,
    layout: result.layout,
    announcement:
      request.zone === "tab"
        ? `Move Chat to pane ${request.targetGroupId}`
        : `Split ${request.zone} of pane ${request.targetGroupId}`,
  }
}

export function applyChatDrop(
  current: ChatWorkbenchLayout,
  preview: ChatDropPreview,
): ChatWorkbenchResult {
  if (!preview.accepted) {
    return { accepted: false, layout: current, reason: preview.reason, recovery: preview.recovery }
  }
  return accepted(preview.layout, preview.announcement)
}

export function projectResponsiveChatWorkbench(
  layout: ChatWorkbenchLayout,
  viewport: {
    width: number
    height: number
    minPaneWidth: number
    minPaneHeight: number
    dividerSize?: number
  },
): {
  logicalLayout: ChatWorkbenchLayout
  visibleLayout: ChatWorkbenchLayout
  collapsedGroupIds: string[]
} {
  const groups = collectChatGroups(layout.root)
  const required = requiredWorkbenchExtent(
    layout.maximizedGroupId
      ? (findGroup(layout.root, layout.maximizedGroupId) ?? layout.root)
      : layout.root,
    viewport.minPaneWidth,
    viewport.minPaneHeight,
    viewport.dividerSize,
  )
  if (
    groups.length === 1 ||
    (viewport.width >= required.width && viewport.height >= required.height)
  ) {
    return { logicalLayout: layout, visibleLayout: layout, collapsedGroupIds: [] }
  }
  const active = findGroup(layout.root, layout.activeGroupId) ?? groups[0]
  const ordered = [active, ...groups.filter((group) => group.id !== active.id)]
  const chatIds = uniqueIds(ordered.flatMap((group) => group.chatIds))
  const visibleGroup: ChatGroupNode = {
    ...active,
    chatIds,
    activeChatId: active.activeChatId,
  }
  return {
    logicalLayout: layout,
    visibleLayout: validate(
      withoutPaneBounds({
        ...layout,
        root: visibleGroup,
        activeGroupId: visibleGroup.id,
        maximizedGroupId: null,
      }),
    ),
    collapsedGroupIds: groups.filter((group) => group.id !== active.id).map((group) => group.id),
  }
}

function requiredWorkbenchExtent(
  node: ChatGroupNode,
  minPaneWidth: number,
  minPaneHeight: number,
  dividerSize = 0,
): { width: number; height: number } {
  if (node.type === "group") return { width: minPaneWidth, height: minPaneHeight }
  const children = node.children.map((child) =>
    requiredWorkbenchExtent(child, minPaneWidth, minPaneHeight, dividerSize),
  )
  const dividers = Math.max(0, children.length - 1) * dividerSize
  return node.direction === "row"
    ? {
        width: children.reduce((total, child) => total + child.width, 0) + dividers,
        height: Math.max(...children.map((child) => child.height)),
      }
    : {
        width: Math.max(...children.map((child) => child.width)),
        height: children.reduce((total, child) => total + child.height, 0) + dividers,
      }
}

export function restoreChatWorkbenchWindows(sessions: ChatWorkbenchWindowSession[]): {
  live: ChatWorkbenchWindowSession[]
  dormant: ChatWorkbenchWindowSession[]
} {
  const valid = sessions.flatMap((session) => {
    const parsed = chatWorkbenchWindowSessionSchema.safeParse(session)
    return parsed.success ? [parsed.data] : []
  })
  const main = valid.find((session) => session.kind === "main")
  const auxiliary = valid
    .filter((session) => session !== main)
    .sort((left, right) => right.lastFocusedAt - left.lastFocusedAt)
  const live = [...(main ? [main] : []), ...auxiliary].slice(0, CHAT_WORKBENCH_MAX_WINDOWS)
  const liveIds = new Set(live.map((session) => session.stableWindowId))
  return {
    live,
    dormant: auxiliary.filter((session) => !liveIds.has(session.stableWindowId)),
  }
}

function applyPreset(
  layout: ChatWorkbenchLayout,
  preset: ChatWorkbenchPreset,
): ChatWorkbenchLayout {
  const chats = collectChatGroups(layout.root).flatMap((group) => group.chatIds)
  const requested =
    preset === "single"
      ? 1
      : preset === "two-columns" || preset === "two-rows"
        ? 2
        : preset === "three-columns" || preset === "three-rows" || preset.startsWith("two-")
          ? 3
          : 4
  const groupCount = Math.max(1, Math.min(requested, chats.length, CHAT_WORKBENCH_MAX_GROUPS))
  const groupIds = Array.from({ length: groupCount }, (_, index) => `chat-group-${index + 1}`)
  const groups = groupIds.map<Extract<ChatGroupNode, { type: "group" }>>((id, index) => {
    const chatIds = index === groupCount - 1 ? chats.slice(index) : [chats[index]]
    return { type: "group", id, chatIds, activeChatId: chatIds[0] }
  })
  let root: ChatGroupNode
  if (groupCount === 1) root = groups[0]
  else if (preset === "grid-2x2" && groupCount === 4) {
    root = split("preset-root", "column", [
      split("preset-top", "row", groups.slice(0, 2)),
      split("preset-bottom", "row", groups.slice(2)),
    ])
  } else if (preset === "two-rows-right" && groupCount === 3) {
    root = split("preset-root", "row", [
      groups[0],
      split("preset-right", "column", groups.slice(1)),
    ])
  } else if (preset === "two-columns-bottom" && groupCount === 3) {
    root = split("preset-root", "column", [
      groups[0],
      split("preset-bottom", "row", groups.slice(1)),
    ])
  } else {
    const direction =
      preset === "two-rows" || preset === "three-rows" || preset === "four-rows" ? "column" : "row"
    root = split("preset-root", direction, groups)
  }
  return validate({
    version: CHAT_WORKBENCH_LAYOUT_VERSION,
    root,
    activeGroupId: groups[0].id,
    maximizedGroupId: null,
  })
}

function moveTab(
  layout: ChatWorkbenchLayout,
  action: Extract<ChatWorkbenchAction, { type: "move-tab" }>,
): ChatWorkbenchResult {
  const source = findGroup(layout.root, action.fromGroupId)
  const target = findGroup(layout.root, action.toGroupId)
  if (!source || !source.chatIds.includes(action.chatId)) return rejected(layout, "invalid-source")
  if (!target) return rejected(layout, "invalid-target")
  if (source.id === target.id) {
    const chatIds = source.chatIds.filter((id) => id !== action.chatId)
    const sourceIndex = source.chatIds.indexOf(action.chatId)
    let targetIndex = clampIndex(action.toIndex, source.chatIds.length)
    if (sourceIndex < targetIndex) targetIndex -= 1
    chatIds.splice(clampIndex(targetIndex, chatIds.length), 0, action.chatId)
    const root = mapNode(layout.root, (node) =>
      node.type === "group" && node.id === source.id
        ? { ...node, chatIds, activeChatId: action.chatId }
        : node,
    )
    return accepted(validate({ ...layout, root, activeGroupId: source.id }))
  }
  const withoutSource = removeChat(layout.root, source.id, action.chatId)
  if (!withoutSource) return rejected(layout, "invalid-source")
  const root = mapNode(withoutSource, (node) => {
    if (node.type !== "group" || node.id !== target.id) return node
    const chatIds = [...node.chatIds]
    chatIds.splice(clampIndex(action.toIndex, chatIds.length), 0, action.chatId)
    return { ...node, chatIds, activeChatId: action.chatId }
  })
  if (!findGroup(root, target.id)?.chatIds.includes(action.chatId))
    return rejected(layout, "invalid-target")
  return accepted(validate(withoutPaneBounds({ ...layout, root, activeGroupId: target.id })))
}

function moveGroup(
  layout: ChatWorkbenchLayout,
  action: Extract<ChatWorkbenchAction, { type: "move-group" }>,
): ChatWorkbenchResult {
  const source = findGroup(layout.root, action.fromGroupId)
  const target = findGroup(layout.root, action.toGroupId)
  if (!source) return rejected(layout, "invalid-source")
  if (!target || source.id === target.id) return rejected(layout, "invalid-target")

  const withoutSource = removeGroup(layout.root, source.id)
  if (!withoutSource) return rejected(layout, "invalid-source")
  const liveTarget = findGroup(withoutSource, target.id)
  if (!liveTarget) return rejected(layout, "invalid-target")

  if (action.zone === "tab") {
    const root = mapNode(withoutSource, (node) =>
      node.type === "group" && node.id === liveTarget.id
        ? {
            ...node,
            chatIds: uniqueIds([...node.chatIds, ...source.chatIds]),
            activeChatId: source.activeChatId,
          }
        : node,
    )
    return accepted(
      validate(
        withoutPaneBounds({
          ...layout,
          root,
          activeGroupId: liveTarget.id,
          maximizedGroupId: null,
        }),
      ),
      "Merged Chat pane tabs",
    )
  }

  const before = action.zone === "left" || action.zone === "top"
  const direction = action.zone === "left" || action.zone === "right" ? "row" : "column"
  const root = mapNode(withoutSource, (node) =>
    node.id === liveTarget.id
      ? split(
          nextId(withoutSource, "chat-split"),
          direction,
          before ? [source, node] : [node, source],
        )
      : node,
  )
  return accepted(
    validate(
      withoutPaneBounds({
        ...layout,
        root,
        activeGroupId: source.id,
        maximizedGroupId: null,
      }),
    ),
    `Moved Chat pane ${action.zone}`,
  )
}

function splitChat(
  layout: ChatWorkbenchLayout,
  action: Extract<ChatWorkbenchAction, { type: "split" }>,
): ChatWorkbenchResult {
  const target = findGroup(layout.root, action.groupId)
  const source = collectChatGroups(layout.root).find((group) =>
    group.chatIds.includes(action.chatId),
  )
  if (!source) return rejected(layout, "invalid-source")
  if (!target) return rejected(layout, "invalid-target")
  if (!canSplitPresentation(layout, action.chatId)) {
    return {
      accepted: false,
      layout,
      reason: "group-limit",
      recovery: { type: "add-as-tab", targetGroupId: target.id },
    }
  }
  const withoutSource = removeChat(layout.root, source.id, action.chatId)
  if (!withoutSource) return rejected(layout, "invalid-source")
  const liveTarget = findGroup(withoutSource, target.id)
  if (!liveTarget) return rejected(layout, "invalid-target")
  const newGroup: Extract<ChatGroupNode, { type: "group" }> = {
    type: "group",
    id: nextId(withoutSource, "chat-group"),
    chatIds: [action.chatId],
    activeChatId: action.chatId,
  }
  const before = action.zone === "left" || action.zone === "top"
  const direction = action.zone === "left" || action.zone === "right" ? "row" : "column"
  const root = mapNode(withoutSource, (node) =>
    node.id === liveTarget.id
      ? split(
          nextId(withoutSource, "chat-split"),
          direction,
          before ? [newGroup, node] : [node, newGroup],
        )
      : node,
  )
  return accepted(
    validate(
      withoutPaneBounds({
        ...layout,
        root,
        activeGroupId: newGroup.id,
        maximizedGroupId: null,
      }),
    ),
  )
}

function canSplitPresentation(layout: ChatWorkbenchLayout, presentationId: string): boolean {
  const groups = collectChatGroups(layout.root)
  if (groups.length >= CHAT_WORKBENCH_MAX_PRESENTATION_GROUPS) return false
  if (getTerminalPresentationChatId(presentationId)) {
    return (
      groups.filter((group) =>
        group.chatIds.some((id) => getTerminalPresentationChatId(id) !== null),
      ).length <= CHAT_WORKBENCH_MAX_TERMINALS
    )
  }
  return (
    groups.filter((group) => group.chatIds.some((id) => getTerminalPresentationChatId(id) === null))
      .length < CHAT_WORKBENCH_MAX_GROUPS
  )
}

function removeChat(node: ChatGroupNode, groupId: string, chatId: string): ChatGroupNode | null {
  if (node.type === "group") {
    if (node.id !== groupId) return node
    const chatIds = node.chatIds.filter((id) => id !== chatId)
    if (chatIds.length === node.chatIds.length) return node
    if (chatIds.length === 0) return null
    return {
      ...node,
      chatIds,
      activeChatId: node.activeChatId === chatId ? chatIds[0] : node.activeChatId,
    }
  }
  const retained = node.children.flatMap((child, index) => {
    const result = removeChat(child, groupId, chatId)
    return result ? [{ child: result, size: node.sizes[index] }] : []
  })
  const children = retained.map(({ child }) => child)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...node, children, sizes: normalizeSizes(retained.map(({ size }) => size)) }
}

function removeGroup(node: ChatGroupNode, groupId: string): ChatGroupNode | null {
  if (node.id === groupId) return null
  if (node.type === "group") return node
  const retained = node.children.flatMap((child, index) => {
    const result = removeGroup(child, groupId)
    return result ? [{ child: result, size: node.sizes[index] }] : []
  })
  const children = retained.map(({ child }) => child)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...node, children, sizes: normalizeSizes(retained.map(({ size }) => size)) }
}

function split(id: string, direction: "row" | "column", children: ChatGroupNode[]): ChatGroupNode {
  return { type: "split", id, direction, children, sizes: children.map(() => 1 / children.length) }
}

function findNode(node: ChatGroupNode, id: string): ChatGroupNode | null {
  if (node.id === id) return node
  if (node.type === "group") return null
  for (const child of node.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

function findLinkedSplitIds(root: ChatGroupNode, splitId: string): Set<string> {
  if (root.id === splitId) return new Set([splitId])
  if (root.type === "group") return new Set([splitId])
  const target = root.children.find((child) => child.id === splitId)
  if (target?.type === "split") {
    return new Set(
      root.children
        .filter(
          (child) =>
            child.type === "split" &&
            child.direction === target.direction &&
            child.children.length === target.children.length,
        )
        .map((child) => child.id),
    )
  }
  for (const child of root.children) {
    if (!findNode(child, splitId)) continue
    return findLinkedSplitIds(child, splitId)
  }
  return new Set([splitId])
}

function findGroup(
  node: ChatGroupNode,
  id: string,
): Extract<ChatGroupNode, { type: "group" }> | null {
  const found = findNode(node, id)
  return found?.type === "group" ? found : null
}

function mapNode(
  node: ChatGroupNode,
  mapper: (node: ChatGroupNode) => ChatGroupNode,
): ChatGroupNode {
  const withChildren =
    node.type === "split"
      ? { ...node, children: node.children.map((child) => mapNode(child, mapper)) }
      : node
  return mapper(withChildren)
}

function normalizeSizes(sizes: number[]): number[] {
  const minimum = 0.05
  const safe = sizes.map((size) => (Number.isFinite(size) ? Math.max(0, size) : 1))
  const total = safe.reduce((sum, size) => sum + size, 0)
  const normalized = total > 0 ? safe.map((size) => size / total) : safe.map(() => 1 / safe.length)
  const deficit = normalized.reduce((sum, size) => sum + (size < minimum ? minimum - size : 0), 0)
  if (deficit === 0) return normalized
  const adjustable = normalized.reduce(
    (sum, size) => sum + (size > minimum ? size - minimum : 0),
    0,
  )
  return normalized.map((size) =>
    size <= minimum ? minimum : size - deficit * ((size - minimum) / adjustable),
  )
}

function nextId(root: ChatGroupNode, prefix: string): string {
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = `${prefix}-${index}`
    if (!findNode(root, candidate)) return candidate
  }
  throw new Error(`Unable to allocate ${prefix} identity.`)
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))]
}

function clampIndex(index: number | undefined, length: number): number {
  return Math.max(0, Math.min(index === undefined ? length : Math.trunc(index), length))
}

function withoutPaneBounds(layout: ChatWorkbenchLayout): ChatWorkbenchLayout {
  const { paneBounds: _paneBounds, ...rest } = layout
  return rest
}

function validate(layout: ChatWorkbenchLayout): ChatWorkbenchLayout {
  return chatWorkbenchLayoutSchema.parse(layout)
}

function accepted(layout: ChatWorkbenchLayout, announcement?: string): ChatWorkbenchResult {
  return { accepted: true, layout, ...(announcement ? { announcement } : {}) }
}

function rejected(
  layout: ChatWorkbenchLayout,
  reason: Extract<ChatWorkbenchResult, { accepted: false }>["reason"],
): ChatWorkbenchResult {
  return { accepted: false, layout, reason }
}
