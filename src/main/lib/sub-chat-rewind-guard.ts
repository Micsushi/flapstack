const rewindingSubChats = new Set<string>()

export function isSubChatRewinding(subChatId: string): boolean {
  return rewindingSubChats.has(subChatId)
}

export function assertSubChatNotRewinding(subChatId: string): void {
  if (isSubChatRewinding(subChatId)) {
    throw new Error("Message history is being rewound; retry after it finishes")
  }
}

export function withSubChatRewindGuard<T>(
  subChatId: string,
  operation: () => Promise<T>,
): Promise<T> {
  assertSubChatNotRewinding(subChatId)
  rewindingSubChats.add(subChatId)
  try {
    return operation().finally(() => rewindingSubChats.delete(subChatId))
  } catch (error) {
    rewindingSubChats.delete(subChatId)
    return Promise.reject(error)
  }
}
