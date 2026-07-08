import type React from "react"

export interface SidebarChat {
  id: string
  name: string | null
  branch: string | null
  updatedAt: Date | null
  projectId: string | null
  isRemote: boolean
  meta?: { repository?: string; branch?: string | null } | null
  remoteStats?: SidebarFileStats | null
}

export interface SidebarProjectSummary {
  gitOwner?: string | null
  gitProvider?: string | null
  gitRepo?: string | null
  name?: string | null
}

export interface SidebarFileStats {
  fileCount: number
  additions: number
  deletions: number
}

export interface SidebarChatActionHandlers {
  onChatClick: (chatId: string, e?: React.MouseEvent, globalIndex?: number) => void
  onCheckboxClick: (e: React.MouseEvent, chatId: string) => void
  onMouseEnter: (
    chatId: string,
    chatName: string | null,
    element: HTMLElement,
    globalIndex: number,
  ) => void
  onMouseLeave: () => void
  onArchive: (chatId: string) => void
  onTogglePin: (chatId: string) => void
  onRenameClick: (chat: { id: string; name: string | null; isRemote?: boolean }) => void
  onCopyBranch: (branch: string) => void
  onArchiveAllBelow: (chatId: string) => void
  onArchiveOthers: (chatId: string) => void
  onOpenLocally: (chatId: string) => void
  onBulkPin: () => void
  onBulkUnpin: () => void
  onBulkArchive: () => void
}

export interface SidebarChatListState {
  selectedChatId: string | null
  selectedChatIsRemote: boolean
  focusedChatIndex: number
  loadingChatIds: Set<string>
  unseenChanges: Set<string>
  workspacePendingPlans: Set<string>
  workspacePendingQuestions: Set<string>
  isMultiSelectMode: boolean
  selectedChatIds: Set<string>
  isMobileFullscreen: boolean
  isDesktop: boolean
  pinnedChatIds: Set<string>
  projectsMap: Map<string, SidebarProjectSummary>
  workspaceFileStats: Map<string, SidebarFileStats>
  filteredChats: Array<{ id: string }>
  canShowPinOption: boolean
  areAllSelectedPinned: boolean
  showIcon: boolean
  archivePending: boolean
  archiveBatchPending: boolean
  justCreatedIds: Set<string>
}

export interface SidebarChatListSectionProps
  extends SidebarChatListState, SidebarChatActionHandlers {
  title: string
  chats: SidebarChat[]
  nameRefCallback: (chatId: string, el: HTMLSpanElement | null) => void
  formatTime: (dateStr: string) => string
}
