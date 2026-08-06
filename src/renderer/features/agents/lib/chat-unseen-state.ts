export function markChatUnseen(current: Set<string>, chatId: string): Set<string> {
  if (current.has(chatId)) return current
  const next = new Set(current)
  next.add(chatId)
  return next
}

export function markChatSeen(current: Set<string>, chatId: string): Set<string> {
  if (!current.has(chatId)) return current
  const next = new Set(current)
  next.delete(chatId)
  return next
}
