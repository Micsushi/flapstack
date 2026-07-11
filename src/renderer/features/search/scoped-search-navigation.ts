export type ScopedSearchNavigationResult = {
  chatId?: string | null
}

/** Only results with an owning chat currently have a complete navigation path. */
export function isNavigableScopedSearchResult(result: ScopedSearchNavigationResult): boolean {
  return Boolean(result.chatId)
}
