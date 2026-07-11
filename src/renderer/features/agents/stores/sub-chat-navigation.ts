export function resolveQueuedSubChatNavigation(
  openSubChatIds: string[],
  subChatId: string,
): { openSubChatIds: string[]; activeSubChatId: string } {
  return {
    openSubChatIds: openSubChatIds.includes(subChatId)
      ? openSubChatIds
      : [...openSubChatIds, subChatId],
    activeSubChatId: subChatId,
  }
}
