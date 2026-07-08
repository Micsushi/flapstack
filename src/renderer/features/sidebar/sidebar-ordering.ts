export type DragInsertPosition = "before" | "after"

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
