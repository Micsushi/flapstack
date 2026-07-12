export interface ConversationRecord {
  id: string
  created_at?: Date | string | null
}

/**
 * A sidebar chat exposes one deterministic conversation. Additional legacy
 * rows remain stored but are not part of normal navigation.
 */
export function resolveCanonicalConversationId(
  conversations: readonly ConversationRecord[],
  _persistedId?: string | null,
): string | null {
  return (
    [...conversations].sort((left, right) => {
      const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0
      const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0
      return leftTime - rightTime || left.id.localeCompare(right.id)
    })[0]?.id ?? null
  )
}
