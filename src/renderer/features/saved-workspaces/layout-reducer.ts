import {
  SAVED_WORKSPACE_LAYOUT_VERSION,
  MAX_SAVED_WORKSPACE_LAYOUT_NODES,
  savedWorkspaceLayoutSchema,
  savedWorkspacePaneBindingSchema,
  type SavedWorkspaceLayout,
  type SavedWorkspaceLayoutNode,
  type SavedWorkspacePaneBinding,
  type SavedWorkspacePinnedContext,
} from "../../../shared/saved-workspaces"

export const MAX_VISIBLE_WORKSPACE_CHATS = 4

export type SavedWorkspacePane = {
  id: string
  title?: string
  binding: SavedWorkspacePaneBinding
  pinnedContext?: SavedWorkspacePinnedContext[]
}

type SavedWorkspaceTabGroup = Extract<SavedWorkspaceLayoutNode, { type: "tabs" }>

export type WorkspaceLayoutAction =
  | { type: "activate-pane"; groupId: string; paneId: string }
  | { type: "resize-split"; splitId: string; sizes: number[] }
  | {
      type: "move-pane"
      paneId: string
      fromGroupId: string
      toGroupId: string
      toIndex: number
    }
  | {
      type: "split-group"
      groupId: string
      direction: "row" | "column"
      splitId: string
      newGroupId: string
      newPaneId: string
    }
  | { type: "duplicate-tab"; groupId: string; paneId: string; newPaneId: string }
  | { type: "add-pane"; groupId: string; pane: SavedWorkspacePane }
  | { type: "remove-pane"; groupId: string; paneId: string }
  | { type: "replace-binding"; paneId: string; binding: SavedWorkspacePaneBinding }
  | { type: "pin-context"; paneId: string; context: SavedWorkspacePinnedContext }
  | { type: "unpin-context"; paneId: string; contextId: string }

export function createSingleChatWorkspaceLayout(
  chatId: string,
  ids: { groupId: string; paneId: string },
): SavedWorkspaceLayout {
  return {
    version: SAVED_WORKSPACE_LAYOUT_VERSION,
    root: {
      type: "tabs",
      id: ids.groupId,
      activePaneId: ids.paneId,
      panes: [{ id: ids.paneId, title: "Chat", binding: { type: "chat", chatId } }],
    },
  }
}

export function reduceWorkspaceLayout(
  layout: SavedWorkspaceLayout,
  action: WorkspaceLayoutAction,
): SavedWorkspaceLayout {
  let root: SavedWorkspaceLayoutNode = layout.root

  if (action.type === "activate-pane") {
    root = mapNode(root, (node) => {
      if (node.type !== "tabs" || node.id !== action.groupId) return node
      return node.panes.some((pane) => pane.id === action.paneId)
        ? { ...node, activePaneId: action.paneId }
        : node
    })
  }

  if (action.type === "resize-split") {
    root = mapNode(root, (node) => {
      if (node.type !== "split" || node.id !== action.splitId) return node
      if (action.sizes.length !== node.children.length) return node
      return { ...node, sizes: normalizeSizes(action.sizes) }
    })
  }

  if (action.type === "duplicate-tab") {
    root = mapNode(root, (node) => {
      if (node.type !== "tabs" || node.id !== action.groupId) return node
      const source = node.panes.find((pane) => pane.id === action.paneId)
      if (!source || hasIdentity(root, action.newPaneId)) return node
      return {
        ...node,
        activePaneId: action.newPaneId,
        panes: [...node.panes, clonePane(source, action.newPaneId, root)],
      }
    })
  }

  if (action.type === "add-pane" && !hasAnyIdentity(root, paneIdentities(action.pane))) {
    root = mapNode(root, (node) => {
      if (node.type !== "tabs" || node.id !== action.groupId) return node
      return { ...node, activePaneId: action.pane.id, panes: [...node.panes, action.pane] }
    })
  }

  if (action.type === "remove-pane") {
    const group = findGroup(root, action.groupId)
    if (group && group.panes.length > 1)
      root = removePane(root, action.groupId, action.paneId) ?? root
  }

  if (action.type === "replace-binding") {
    const binding = savedWorkspacePaneBindingSchema.parse(action.binding)
    root = mapNode(root, (node) =>
      node.type === "tabs"
        ? {
            ...node,
            panes: node.panes.map((pane) =>
              pane.id === action.paneId ? { ...pane, binding } : pane,
            ),
          }
        : node,
    )
  }

  if (action.type === "pin-context" && !hasIdentity(root, action.context.id)) {
    root = mapNode(root, (node) =>
      node.type === "tabs"
        ? {
            ...node,
            panes: node.panes.map((pane) =>
              pane.id === action.paneId
                ? { ...pane, pinnedContext: [...(pane.pinnedContext ?? []), action.context] }
                : pane,
            ),
          }
        : node,
    )
  }

  if (action.type === "unpin-context") {
    root = mapNode(root, (node) =>
      node.type === "tabs"
        ? {
            ...node,
            panes: node.panes.map((pane) =>
              pane.id === action.paneId
                ? {
                    ...pane,
                    pinnedContext: (pane.pinnedContext ?? []).filter(
                      (item) => item.id !== action.contextId,
                    ),
                  }
                : pane,
            ),
          }
        : node,
    )
  }

  if (
    action.type === "split-group" &&
    !hasAnyIdentity(root, [action.splitId, action.newGroupId, action.newPaneId])
  ) {
    root = mapNode(root, (node) => {
      if (node.type !== "tabs" || node.id !== action.groupId) return node
      const active = node.panes.find((pane) => pane.id === node.activePaneId)
      if (!active) return node
      return {
        type: "split",
        id: action.splitId,
        direction: action.direction,
        sizes: [1, 1],
        children: [
          node,
          {
            type: "tabs",
            id: action.newGroupId,
            activePaneId: action.newPaneId,
            panes: [clonePane(active, action.newPaneId, root)],
          },
        ],
      }
    })
  }

  if (action.type === "move-pane") {
    root = movePane(root, action)
  }

  return enforceWorkspaceChatCap({ version: SAVED_WORKSPACE_LAYOUT_VERSION, root })
}

export function enforceWorkspaceChatCap(layout: SavedWorkspaceLayout): SavedWorkspaceLayout {
  let root = layout.root
  let activeChatGroups = collectActiveChatGroups(root)
  while (activeChatGroups.length > MAX_VISIBLE_WORKSPACE_CHATS) {
    const target = activeChatGroups[MAX_VISIBLE_WORKSPACE_CHATS - 1]
    const overflow = activeChatGroups[MAX_VISIBLE_WORKSPACE_CHATS]
    const moved = movePane(root, {
      type: "move-pane",
      paneId: overflow.pane.id,
      fromGroupId: overflow.groupId,
      toGroupId: target.groupId,
      toIndex: Number.MAX_SAFE_INTEGER,
    })
    if (moved === root) break
    root = moved
    activeChatGroups = collectActiveChatGroups(root)
  }
  return savedWorkspaceLayoutSchema.parse({ version: SAVED_WORKSPACE_LAYOUT_VERSION, root })
}

export function getVisibleWorkspaceChatPaneIds(layout: SavedWorkspaceLayout): string[] {
  return collectActiveChatGroups(layout.root).map(({ pane }) => pane.id)
}

export function getWorkspaceGroups(layout: SavedWorkspaceLayout): Array<{
  id: string
  activePaneId: string
  panes: SavedWorkspacePane[]
}> {
  const groups: Array<{ id: string; activePaneId: string; panes: SavedWorkspacePane[] }> = []
  visit(layout.root, (node) => {
    if (node.type === "tabs") groups.push(node)
  })
  return groups
}

function collectActiveChatGroups(root: SavedWorkspaceLayoutNode): Array<{
  groupId: string
  pane: SavedWorkspacePane
}> {
  const groups: Array<{ groupId: string; pane: SavedWorkspacePane }> = []
  visit(root, (node) => {
    if (node.type !== "tabs") return
    const active = node.panes.find((pane) => pane.id === node.activePaneId)
    if (active?.binding.type === "chat") groups.push({ groupId: node.id, pane: active })
  })
  return groups
}

function movePane(
  root: SavedWorkspaceLayoutNode,
  action: Extract<WorkspaceLayoutAction, { type: "move-pane" }>,
): SavedWorkspaceLayoutNode {
  const sourceGroup = findGroup(root, action.fromGroupId)
  const targetGroup = findGroup(root, action.toGroupId)
  const pane = sourceGroup?.panes.find((candidate) => candidate.id === action.paneId)
  if (!sourceGroup || !targetGroup || !pane) return root

  if (sourceGroup.id === targetGroup.id) {
    const fromIndex = sourceGroup.panes.findIndex((candidate) => candidate.id === action.paneId)
    const nextPanes = [...sourceGroup.panes]
    nextPanes.splice(fromIndex, 1)
    const index = clampIndex(action.toIndex, nextPanes.length)
    nextPanes.splice(index, 0, pane)
    return mapNode(root, (node) =>
      node.type === "tabs" && node.id === sourceGroup.id ? { ...node, panes: nextPanes } : node,
    )
  }

  const withoutSource = removePane(root, sourceGroup.id, pane.id)
  if (!withoutSource) return root
  let inserted = false
  const nextRoot = mapNode(withoutSource, (node) => {
    if (node.type !== "tabs" || node.id !== targetGroup.id) return node
    const panes = [...node.panes]
    panes.splice(clampIndex(action.toIndex, panes.length), 0, pane)
    inserted = true
    return { ...node, panes }
  })
  return inserted ? nextRoot : root
}

function removePane(
  node: SavedWorkspaceLayoutNode,
  groupId: string,
  paneId: string,
): SavedWorkspaceLayoutNode | null {
  if (node.type === "tabs") {
    if (node.id !== groupId) return node
    const panes = node.panes.filter((pane) => pane.id !== paneId)
    if (panes.length === node.panes.length) return node
    if (panes.length === 0) return null
    return {
      ...node,
      panes,
      activePaneId:
        node.activePaneId === paneId ? (panes[0]?.id ?? node.activePaneId) : node.activePaneId,
    }
  }

  const surviving = node.children
    .map((child, index) => ({
      child: removePane(child, groupId, paneId),
      size: node.sizes[index],
    }))
    .filter(
      (entry): entry is { child: SavedWorkspaceLayoutNode; size: number } => entry.child !== null,
    )
  const children = surviving.map((entry) => entry.child)
  if (
    children.length === node.children.length &&
    children.every((child, index) => child === node.children[index])
  ) {
    return node
  }
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...node, children, sizes: normalizeSizes(surviving.map((entry) => entry.size)) }
}

function normalizeSizes(sizes: number[]): number[] {
  const safe = sizes.map((size) => (Number.isFinite(size) ? Math.max(0.05, size) : 1))
  const total = safe.reduce((sum, size) => sum + size, 0)
  return safe.map((size) => size / total)
}

function clonePane(
  pane: SavedWorkspacePane,
  id: string,
  root: SavedWorkspaceLayoutNode,
): SavedWorkspacePane {
  const claimed = new Set<string>()
  return {
    ...pane,
    id,
    title: pane.title ? `${pane.title} copy` : "Copy",
    binding: savedWorkspacePaneBindingSchema.parse(pane.binding),
    pinnedContext: pane.pinnedContext?.map((item, index) => ({
      ...item,
      id: duplicateContextId(root, id, index, claimed),
    })),
  }
}

function duplicateContextId(
  root: SavedWorkspaceLayoutNode,
  paneId: string,
  index: number,
  claimed: Set<string>,
): string {
  for (let attempt = 0; attempt <= MAX_SAVED_WORKSPACE_LAYOUT_NODES; attempt += 1) {
    const suffix = `-context-${index + 1}-${attempt}`
    const candidate = `${paneId.slice(0, Math.max(1, 200 - suffix.length))}${suffix}`
    if (!hasIdentity(root, candidate) && !claimed.has(candidate)) {
      claimed.add(candidate)
      return candidate
    }
  }
  throw new Error("Unable to allocate a unique pinned-context identity.")
}

function paneIdentities(pane: SavedWorkspacePane): string[] {
  return [pane.id, ...(pane.pinnedContext ?? []).map((item) => item.id)]
}

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : length, length))
}

function findGroup(node: SavedWorkspaceLayoutNode, groupId: string): SavedWorkspaceTabGroup | null {
  if (node.type === "tabs") return node.id === groupId ? node : null
  for (const child of node.children) {
    const group: SavedWorkspaceTabGroup | null = findGroup(child, groupId)
    if (group) return group
  }
  return null
}

function mapNode(
  node: SavedWorkspaceLayoutNode,
  mapper: (node: SavedWorkspaceLayoutNode) => SavedWorkspaceLayoutNode,
): SavedWorkspaceLayoutNode {
  const withChildren =
    node.type === "split"
      ? { ...node, children: node.children.map((child) => mapNode(child, mapper)) }
      : node
  return mapper(withChildren)
}

function visit(node: SavedWorkspaceLayoutNode, visitor: (node: SavedWorkspaceLayoutNode) => void) {
  visitor(node)
  if (node.type === "split") node.children.forEach((child) => visit(child, visitor))
}

function hasIdentity(root: SavedWorkspaceLayoutNode, id: string): boolean {
  let found = false
  visit(root, (node) => {
    if (node.id === id || (node.type === "tabs" && node.panes.some((pane) => pane.id === id))) {
      found = true
    }
  })
  return found
}

function hasAnyIdentity(root: SavedWorkspaceLayoutNode, ids: string[]): boolean {
  return ids.some((id) => hasIdentity(root, id))
}
