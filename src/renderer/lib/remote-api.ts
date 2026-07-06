/**
 * Disabled compatibility layer for the inherited hosted sandbox API.
 * Flapstack is local-first, so these methods do not call a web backend.
 */

// Re-export types for convenience
export type Team = {
  id: string
  name: string
  slug?: string
}

export type RemoteChat = {
  id: string
  name: string
  sandbox_id: string | null
  meta: {
    repository?: string
    github_repo?: string // Automation-created chats use this field
    branch?: string | null
    originalSandboxId?: string | null
    isQuickSetup?: boolean
    isPublicImport?: boolean
  } | null
  created_at: string
  updated_at: string
  stats: { fileCount: number; additions: number; deletions: number } | null
}

export type RemoteSubChat = {
  id: string
  name: string
  mode: string
  messages: unknown[]
  stream_id: string | null
  created_at: string
  updated_at: string
}

export type RemoteChatWithSubChats = RemoteChat & {
  subChats: RemoteSubChat[]
}

export const remoteApi = {
  async getTeams(): Promise<Team[]> {
    return []
  },

  async getAgentChats(teamId: string): Promise<RemoteChat[]> {
    void teamId
    return []
  },

  async getAgentChat(chatId: string): Promise<RemoteChatWithSubChats> {
    void chatId
    throw new Error("Hosted sandbox chats are disabled in Flapstack")
  },

  async getArchivedChats(teamId: string): Promise<RemoteChat[]> {
    void teamId
    return []
  },

  async archiveChat(chatId: string): Promise<void> {
    void chatId
  },

  async archiveChatsBatch(chatIds: string[]): Promise<{ archivedCount: number }> {
    return { archivedCount: chatIds.length }
  },

  async restoreChat(chatId: string): Promise<void> {
    void chatId
  },

  async renameSubChat(subChatId: string, name: string): Promise<void> {
    void subChatId
    void name
  },

  async renameChat(chatId: string, name: string): Promise<void> {
    void chatId
    void name
  },

  async getSandboxDiff(sandboxId: string): Promise<{ diff: string }> {
    void sandboxId
    throw new Error("Hosted sandbox diffs are disabled in Flapstack")
  },

  async getSandboxFile(sandboxId: string, path: string): Promise<{ content: string }> {
    void sandboxId
    void path
    throw new Error("Hosted sandbox files are disabled in Flapstack")
  },
}
