type ProjectRow = { id: string }
type ChatRow = { id: string; projectId?: string | null }

export type DevSelectionSnapshot<P extends ProjectRow, C extends ChatRow> = {
  projects: P[]
  chats: C[]
  targetChat: C | null
}

/** Refresh direct-DB fixture state before renderer atoms can be validated
 * against stale query data. Exact chat refresh also evicts stale content. */
export async function refreshDevSelectionSnapshot<P extends ProjectRow, C extends ChatRow>(
  deps: {
    invalidateProjects(): Promise<unknown>
    fetchProjects(): Promise<P[]>
    invalidateChats(): Promise<unknown>
    fetchChats(): Promise<C[]>
    invalidateChat?(chatId: string): Promise<unknown>
    fetchChat?(chatId: string): Promise<C | null | undefined>
  },
  targetChatId?: string,
): Promise<DevSelectionSnapshot<P, C>> {
  await Promise.all([
    deps.invalidateProjects(),
    deps.invalidateChats(),
    targetChatId && deps.invalidateChat ? deps.invalidateChat(targetChatId) : Promise.resolve(),
  ])
  const [projects, chats, exactChat] = await Promise.all([
    deps.fetchProjects(),
    deps.fetchChats(),
    targetChatId && deps.fetchChat ? deps.fetchChat(targetChatId) : Promise.resolve(null),
  ])
  return {
    projects,
    chats,
    targetChat:
      exactChat ?? (targetChatId ? chats.find((chat) => chat.id === targetChatId) : null) ?? null,
  }
}

export function chatBelongsToProject(
  chats: ChatRow[],
  chatId: string | null,
  projectId: string | null,
): boolean {
  if (!chatId || !projectId) return false
  return chats.some((chat) => chat.id === chatId && chat.projectId === projectId)
}
