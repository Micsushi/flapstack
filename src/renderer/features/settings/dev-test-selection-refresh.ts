type ProjectRow = { id: string }
type ChatRow = { id: string; projectId?: string | null }
type VisibleChatState = {
  chatId: string
  subChatId: string
  messageCount: number
  details?: Record<string, unknown>
}

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

export function validateDevChatSelectionSnapshot(
  snapshot: DevSelectionSnapshot<ProjectRow, ChatRow>,
  projectId: string,
  chatId: string,
): void {
  if (!snapshot.projects.some((project) => project.id === projectId)) {
    throw new Error("Fixture project is missing from the renderer project cache.")
  }
  if (!snapshot.targetChat || snapshot.targetChat.id !== chatId) {
    throw new Error("Fixture chat is missing from the renderer chat cache.")
  }
  if (snapshot.targetChat.projectId !== projectId) {
    throw new Error("Fixture chat does not belong to the selected project.")
  }
}

export async function refreshDevChatUntilVisible(
  input: {
    chatId: string
    subChatId: string
    messages: readonly unknown[]
  },
  deps: {
    timeoutMs: number
    now(): number
    nextFrame(): Promise<void>
    prepareSelection(): void | Promise<void>
    dispatchRefresh(input: { subChatId: string; messages: readonly unknown[] }): void
    readVisibleState(): VisibleChatState | null
  },
): Promise<VisibleChatState> {
  const deadline = deps.now() + deps.timeoutMs
  let lastVisible: VisibleChatState | null = null
  do {
    await deps.prepareSelection()
    deps.dispatchRefresh({ subChatId: input.subChatId, messages: input.messages })
    await deps.nextFrame()
    const visible = deps.readVisibleState()
    lastVisible = visible
    if (
      visible?.chatId === input.chatId &&
      visible.subChatId === input.subChatId &&
      visible.messageCount === input.messages.length
    ) {
      return visible
    }
  } while (deps.now() < deadline)
  throw new Error(
    `Timed out waiting for the exact persisted chat transcript to become visible; last observed state: ${JSON.stringify(lastVisible)}`,
  )
}
