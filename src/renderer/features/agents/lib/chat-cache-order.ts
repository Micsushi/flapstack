type OrderedChat = {
  id: string
  pinnedAt?: Date | string | number | null
  updatedAt?: Date | string | number | null
}

function timestamp(value: OrderedChat["updatedAt"]): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number") return value
  return value ? Date.parse(value) || 0 : 0
}

export function upsertChatInSidebarOrder<T extends OrderedChat>(
  chats: T[] | undefined,
  chat: T,
): T[] {
  return [chat, ...(chats ?? []).filter((candidate) => candidate.id !== chat.id)].sort(
    (left, right) =>
      Number(Boolean(right.pinnedAt)) - Number(Boolean(left.pinnedAt)) ||
      timestamp(right.pinnedAt) - timestamp(left.pinnedAt) ||
      timestamp(right.updatedAt) - timestamp(left.updatedAt),
  )
}
