export type DragInsertPosition = "before" | "after"
export type SidebarDropPosition = DragInsertPosition | "inside"

export function resolveBoundaryHighlightIds({
  items,
  targetId,
  position,
}: {
  items: Array<{ id: string; groupId: string | null }>
  targetId: string | null
  position: SidebarDropPosition | null
}) {
  if (!targetId || (position !== "before" && position !== "after")) {
    return []
  }

  const targetIndex = items.findIndex((item) => item.id === targetId)
  if (targetIndex === -1) return []

  const highlightedIds = [targetId]
  const adjacentIndex = position === "before" ? targetIndex - 1 : targetIndex + 1
  const target = items[targetIndex]
  const adjacent = items[adjacentIndex]
  if (adjacent?.id && adjacent.groupId === target?.groupId) {
    highlightedIds.push(adjacent.id)
  }
  return highlightedIds
}

export function resolveTaskGroupDropTarget({
  draggingKind,
  draggingId,
  targetTaskId,
  relativeY,
  offsetY,
}: {
  draggingKind: string
  draggingId: string
  targetTaskId: string | undefined
  relativeY: number
  offsetY: number
}) {
  if (!targetTaskId) return null

  const isDraggedTask = draggingKind === "project-child" && draggingId.startsWith("task:")
  if (isDraggedTask) {
    return {
      kind: "project-child" as const,
      id: `task:${targetTaskId}`,
      position: relativeY < 0.5 ? ("before" as const) : ("after" as const),
    }
  }

  const isDraggedChat =
    draggingKind.endsWith("chat") ||
    (draggingKind === "project-child" && draggingId.startsWith("chat:"))
  if (!isDraggedChat || offsetY > 8) return null

  return { kind: "project-child" as const, id: `task:${targetTaskId}`, position: "before" as const }
}

export function resolveTaskHeaderDropPosition({
  isTaskHeader,
  splitAfterTaskZone,
  relativeY,
}: {
  isTaskHeader: boolean
  splitAfterTaskZone: boolean
  relativeY: number
}): SidebarDropPosition | null {
  if (!isTaskHeader) return null
  return splitAfterTaskZone && relativeY >= 0.5 ? "after" : "inside"
}

export function resolveTaskEndDropTarget({
  taskId,
  targetKind,
  targetId,
  isOnlyTaskChat,
  relativeY,
}: {
  taskId: string | undefined
  targetKind: string
  targetId: string
  isOnlyTaskChat: boolean
  relativeY: number
}) {
  if (!taskId) return null
  if (relativeY < 0.5) {
    return {
      kind: targetKind,
      id: targetId,
      position: isOnlyTaskChat ? ("before" as const) : ("after" as const),
    }
  }
  return {
    kind: "project-child" as const,
    id: `task:${taskId}`,
    position: "after" as const,
  }
}

export function resolveSidebarDragCursor({
  hasValidDropTarget,
  isInsertionTarget,
}: {
  hasValidDropTarget: boolean
  isInsertionTarget: boolean
}): "grabbing" | "move" | "copy" {
  if (isInsertionTarget) return "copy"
  if (hasValidDropTarget) return "move"
  return "grabbing"
}

export function resolveMoveIndicatorIds({
  targetScope,
  targetProjectId,
  targetTaskId,
  sourceProjectId,
}: {
  targetScope: "project" | "task" | null
  targetProjectId: string | null
  targetTaskId: string | null
  sourceProjectId: string | null
}) {
  return {
    taskId: targetScope === "task" ? targetTaskId : null,
    projectId:
      targetScope === "project" || (targetScope === "task" && targetProjectId !== sourceProjectId)
        ? targetProjectId
        : null,
  }
}

export function buildOrderedIds(currentOrder: string[], activeIds: string[]) {
  const activeIdSet = new Set(activeIds)
  const ordered = currentOrder.filter((id) => activeIdSet.has(id))

  for (const id of activeIds) {
    if (!ordered.includes(id)) ordered.push(id)
  }

  return ordered
}

export function moveIdInOrder(
  currentOrder: string[],
  activeIds: string[],
  fromId: string,
  toId: string,
  position: DragInsertPosition,
) {
  const ordered = buildOrderedIds(currentOrder, activeIds)
  const fromIndex = ordered.indexOf(fromId)
  const toIndex = ordered.indexOf(toId)
  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return ordered

  const [moved] = ordered.splice(fromIndex, 1)
  if (!moved) return ordered

  const targetIndex = ordered.indexOf(toId)
  ordered.splice(position === "after" ? targetIndex + 1 : targetIndex, 0, moved)
  return ordered
}
