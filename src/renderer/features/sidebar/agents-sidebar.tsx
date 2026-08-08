"use client"

import React from "react"
import { useState, useRef, useMemo, useEffect, useCallback, memo } from "react"
import { createPortal, flushSync } from "react-dom"
import { motion, AnimatePresence } from "motion/react"
import { Button as ButtonCustom } from "../../components/ui/button"
import { cn } from "../../lib/utils"
import { useSetAtom, useAtom, useAtomValue } from "jotai"
import {
  autoAdvanceTargetAtom,
  crossScopeMoveEnabledAtom,
  createTeamDialogOpenAtom,
  agentsSettingsDialogActiveTabAtom,
  agentsSidebarOpenAtom,
  agentsHelpPopoverOpenAtom,
  selectedAgentChatIdsAtom,
  isAgentMultiSelectModeAtom,
  toggleAgentChatSelectionAtom,
  selectAllAgentChatsAtom,
  clearAgentChatSelectionAtom,
  selectedAgentChatsCountAtom,
  isDesktopAtom,
  isFullscreenAtom,
  chatSourceModeAtom,
  selectedTeamIdAtom,
  type ChatSourceMode,
  showWorkspaceIconAtom,
  newChatDraftReminderEnabledAtom,
} from "../../lib/atoms"
import {
  useRemoteChats,
  useUserTeams,
  usePrefetchRemoteChat,
  useArchiveRemoteChat,
  useArchiveRemoteChatsBatch,
  useRestoreRemoteChat,
  useRenameRemoteChat,
} from "../../lib/hooks/use-remote-chats"
import { usePrefetchLocalChat } from "../../lib/hooks/use-prefetch-local-chat"
import { isReservedArchivedAccentColor } from "../agents/lib/open-chat-tabs"
import { configureChatDragFeedback } from "../agents/lib/chat-drag-feedback"
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pin,
  MessageSquarePlus,
  ListPlus,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitFork,
  MessageSquare,
  ClipboardList,
  Activity,
  BookOpenText,
  BookOpen,
  Star,
  Plus,
  SquarePen,
  ArrowRightLeft,
  Copy,
  Inbox,
  Workflow,
  Network,
  LayoutGrid,
  PanelsTopLeft,
  Check,
  FilePenLine,
  Library,
  Zap,
  Trees,
} from "lucide-react"
// import { useRouter } from "next/navigation" // Desktop doesn't use next/navigation
// Desktop: archive is handled inline, not via hook
// import { DiscordIcon } from "@/components/icons"
import { DiscordIcon } from "../../icons"
import { AgentsRenameSubChatDialog } from "../agents/components/agents-rename-subchat-dialog"
import { RenameDialog } from "../../components/rename-dialog"
import { OpenLocallyDialog } from "../agents/components/open-locally-dialog"
import { useAutoImport } from "../agents/hooks/use-auto-import"
import { ConfirmArchiveDialog } from "../../components/confirm-archive-dialog"
import { trpc } from "../../lib/trpc"
import { toast } from "sonner"
import {
  asWorkbenchWindowCreationFailure,
  showWorkbenchWindowCreationFeedback,
} from "../../lib/workbench-window-limit"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip"
import { Kbd } from "../../components/ui/kbd"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "../../components/ui/context-menu"
import {
  IconDoubleChevronLeft,
  SettingsIcon,
  PlusIcon,
  PublisherStudioIcon,
  SearchIcon,
  GitHubLogo,
  LoadingDot,
  ArchiveIcon,
  UnarchiveIcon,
  TrashIcon,
  DiffIcon,
  QuestionCircleIcon,
  QuestionIcon,
  KeyboardIcon,
  CloudIcon,
} from "../../components/ui/icons"
import { Input } from "../../components/ui/input"
import { Button } from "../../components/ui/button"
import {
  selectedAgentChatIdAtom,
  openAgentChatIdsAtom,
  selectedChatIsRemoteAtom,
  previousAgentChatIdAtom,
  selectedDraftIdAtom,
  showNewChatFormAtom,
  loadingSubChatsAtom,
  agentsUnseenChangesAtom,
  agentsDebugModeAtom,
  selectedChatScopeAtom,
  selectedProjectAtom,
  newChatFormSessionAtom,
  justCreatedIdsAtom,
  undoStackAtom,
  pendingUserQuestionsAtom,
  desktopViewAtom,
  type SelectedChatScope,
  type UndoItem,
} from "../agents/atoms"
import { useAgentSubChatStore, OPEN_SUB_CHATS_CHANGE_EVENT } from "../agents/stores/sub-chat-store"
import { getWindowId } from "../../contexts/WindowContext"
import {
  CHAT_WORKBENCH_DRAG_MIME,
  CHAT_WORKBENCH_DRAG_SESSION_KEY,
  CHAT_WORKBENCH_EXTERNAL_GROUP_ID,
} from "../../../shared/chat-workbench"
import {
  CHAT_WORKBENCH_NAVIGATION_CHANGE_EVENT,
  CHAT_WORKBENCH_SELECT_CHAT_EVENT,
  chatWorkbenchNavigationStorageKey,
  getGroupedChatIds,
  parseChatWorkbenchNavigation,
  type ChatWorkbenchNavigation,
} from "../../../shared/chat-workbench-navigation"
import { AgentsHelpPopover } from "../agents/components/agents-help-popover"
import { getPlatform, getShortcutKey, isDesktopApp } from "../../lib/utils/platform"
import { useResolvedHotkeyDisplay, useResolvedHotkeyDisplayWithAlt } from "../../lib/hotkeys"
import { pluralize } from "../agents/utils/pluralize"
import {
  countVisibleNewChatDraftsForProject,
  useNewChatDrafts,
  deleteNewChatDraft,
  openNewChatDraft,
  type NewChatDraft,
} from "../agents/lib/drafts"
import { TrafficLightSpacer, TrafficLights } from "../agents/components/traffic-light-spacer"
import { useHotkeys } from "react-hotkeys-hook"
import { Checkbox } from "../../components/ui/checkbox"
import { useHaptic } from "./hooks/use-haptic"
import { resolveSectionHeaderScopeSelection } from "./section-header-scope"
import { TypewriterText } from "../../components/ui/typewriter-text"
import { exportChat, copyChat, type ExportFormat } from "../agents/lib/export-chat"
import { ScopedSearchPanel } from "../search/scoped-search-panel"
import { StartAgentDialog } from "../agent-profiles/start-agent-dialog"
import { getModelChipMeta } from "../agents/constants"
import { ProviderChipIcon } from "../agents/components/provider-chip-icon"
import { focusScopedSearchResultAtom } from "../agents/search/chat-search-atoms"
import { useBetaFeatures } from "../settings/use-beta-features"
import { useFeatureVisibility } from "../settings/use-feature-visibility"
import {
  buildChatMoveDestinations,
  chatMoveTargetKey,
  isCurrentChatMoveTarget,
  toChatMoveMutationInput,
  type ChatMoveTarget,
} from "./chat-move-destinations"
import {
  moveIdInOrder,
  orderSidebarProjects,
  resolveBoundaryHighlightIds,
  resolveMoveIndicatorIds,
  resolveSidebarDragCursor,
  resolveTaskEndDropTarget,
  resolveTaskGroupDropTarget,
  resolveTaskHeaderDropPosition,
  type DragInsertPosition,
  type SidebarProjectOrder,
  type SidebarDropPosition,
} from "./sidebar-ordering"
import { getNonMainWorktreeLabel } from "./worktree-chip"
import { ChatTagChip, ChatTagSubmenu, type ChatTagView } from "./chat-tag-menu"
import { RepositoryOverviewDialog } from "./repository-overview-dialog"
import {
  assignStableProjectColors,
  DEFAULT_PROJECT_COLOR,
  normalizeHexColor,
  PROJECT_COLOR_PRESETS,
} from "./project-colors"

// GitHub avatar with loading placeholder
const GitHubAvatar = React.memo(function GitHubAvatar({
  gitOwner,
  className = "h-4 w-4",
}: {
  gitOwner: string
  className?: string
}) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  const handleLoad = useCallback(() => setIsLoaded(true), [])
  const handleError = useCallback(() => setHasError(true), [])

  if (hasError) {
    return <GitHubLogo className={cn(className, "text-muted-foreground flex-shrink-0")} />
  }

  return (
    <div className={cn(className, "relative flex-shrink-0")}>
      {/* Placeholder background while loading */}
      {!isLoaded && <div className="absolute inset-0 rounded-sm bg-muted" />}
      <img
        src={`https://github.com/${gitOwner}.png?size=64`}
        alt={gitOwner}
        className={cn(
          className,
          "rounded-sm flex-shrink-0",
          isLoaded ? "opacity-100" : "opacity-0",
        )}
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  )
})

const SidebarChip = React.memo(function SidebarChip({
  className,
  title,
  children,
}: {
  className?: string
  title?: string
  children: React.ReactNode
}) {
  // Ellipsis must live on an inner block element: text-overflow does not
  // render on the flex container itself, so `truncate` here would hard-clip.
  return (
    <span
      title={title}
      className={cn(
        "inline-flex min-w-0 max-w-full items-center rounded border px-1.5 py-0 text-[10px] font-medium leading-4",
        className,
      )}
    >
      <span className="inline-flex min-w-0 items-center whitespace-nowrap">{children}</span>
    </span>
  )
})

const GLOBAL_SECTION_COLOR = "#64748b"
const ACTIVE_CHAT_BORDER_COLOR = "#a78bfa"
const SCOPED_SECTION_BACKGROUND_OPACITY = 0.25
const TASK_SECTION_BACKGROUND_OPACITY = 0.34
const SCOPED_CHAT_BACKGROUND_OPACITY = 0.09
const SCOPED_CHAT_BACKGROUND_HOVER_OPACITY = 0.14
const SIDEBAR_POINTER_DRAG_THRESHOLD = 4

function clampColorChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function hexToRgb(color?: string | null) {
  const hex = normalizeHexColor(color).slice(1)
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }) {
  return `#${[r, g, b]
    .map((channel) => clampColorChannel(channel).toString(16).padStart(2, "0"))
    .join("")}`
}

function mixHexColor(color: string, target: "#000000" | "#ffffff", amount: number) {
  const source = hexToRgb(color)
  const destination = hexToRgb(target)
  return rgbToHex({
    r: source.r + (destination.r - source.r) * amount,
    g: source.g + (destination.g - source.g) * amount,
    b: source.b + (destination.b - source.b) * amount,
  })
}

function rgbaFromHex(color: string, alpha: number) {
  const { r, g, b } = hexToRgb(color)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function getProjectTint(baseColor?: string | null) {
  const base = mixHexColor(normalizeHexColor(baseColor), "#000000", 0.38)
  const chat = mixHexColor(base, "#ffffff", 0.3)
  const task = mixHexColor(base, "#000000", 0.34)
  const taskChat = mixHexColor(base, "#ffffff", 0.18)
  return { base, task, chat, taskChat }
}

function getElementInsertPosition(element: HTMLElement, clientY: number): DragInsertPosition {
  const rect = element.getBoundingClientRect()
  return clientY > rect.top + rect.height / 2 ? "after" : "before"
}

function getDragInsertPosition(event: React.DragEvent<HTMLElement>): DragInsertPosition {
  return getElementInsertPosition(event.currentTarget, event.clientY)
}

function findSidebarPointerDropTarget(
  clientX: number,
  clientY: number,
  draggingKind: string,
  draggingId: string,
): { kind: string; id: string; position: SidebarDropPosition } | null {
  const target = document.elementFromPoint(clientX, clientY)
  if (!(target instanceof HTMLElement)) return null

  const taskGroup = target.closest<HTMLElement>("[data-sidebar-task-group-id]")
  if (taskGroup) {
    const rect = taskGroup.getBoundingClientRect()
    const taskGroupDropTarget = resolveTaskGroupDropTarget({
      draggingKind,
      draggingId,
      targetTaskId: taskGroup.dataset.sidebarTaskGroupId,
      relativeY: (clientY - rect.top) / rect.height,
      offsetY: clientY - rect.top,
    })
    if (taskGroupDropTarget) return taskGroupDropTarget
  }

  const dropElement = target.closest<HTMLElement>(
    "[data-sidebar-drag-target-kind][data-sidebar-drag-target-id]",
  )
  if (!dropElement) return null

  const kind = dropElement.dataset.sidebarDragTargetKind
  const id = dropElement.dataset.sidebarDragTargetId
  if (!kind || !id) return null

  const rect = dropElement.getBoundingClientRect()
  const relativeY = (clientY - rect.top) / rect.height
  const taskHeaderDropPosition = resolveTaskHeaderDropPosition({
    isTaskHeader: dropElement.dataset.sidebarTaskHeader === "true",
    splitAfterTaskZone: dropElement.dataset.sidebarTaskHeaderSplit === "true",
    relativeY,
  })
  if (taskHeaderDropPosition) return { kind, id, position: taskHeaderDropPosition }
  const taskEndDropTarget = resolveTaskEndDropTarget({
    taskId: dropElement.dataset.sidebarTaskEndTargetId,
    targetKind: kind,
    targetId: id,
    isOnlyTaskChat: dropElement.dataset.sidebarOnlyTaskChat === "true",
    relativeY,
  })
  if (taskEndDropTarget) return taskEndDropTarget
  const position: SidebarDropPosition =
    dropElement.dataset.sidebarDropContainer === "true" && relativeY >= 0.25 && relativeY <= 0.75
      ? "inside"
      : getElementInsertPosition(dropElement, clientY)

  return {
    kind,
    id,
    position,
  }
}

function useSidebarPointerDragSource({
  disabled,
  kind,
  id,
  blockSelector,
  onDragStartItem,
  onDragOverItem,
  onDropItem,
  onDragEndItem,
  onDragStarted,
  onDragFinished,
}: {
  disabled: boolean
  kind: string
  id: string
  blockSelector: string
  onDragStartItem: (kind: string, id: string) => void
  onDragOverItem: (kind: string, id: string, position: SidebarDropPosition) => void
  onDropItem: (kind: string, id: string, position: SidebarDropPosition) => void
  onDragEndItem: () => void
  onDragStarted?: () => void
  onDragFinished?: () => void
}) {
  return useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (disabled || event.button !== 0) return
      if (event.target instanceof HTMLElement && event.target.closest(blockSelector)) return

      const sourceElement = event.currentTarget
      const startX = event.clientX
      const startY = event.clientY
      let dragStarted = false
      document.body.dataset.sidebarPointerDragging = "true"

      const cleanup = () => {
        document.removeEventListener("pointermove", handlePointerMove, true)
        document.removeEventListener("pointerup", handlePointerUp, true)
        document.removeEventListener("pointercancel", handlePointerCancel, true)
        sourceElement.removeAttribute("data-pointer-drag-source")
        delete document.body.dataset.sidebarPointerDragging
        delete document.body.dataset.sidebarPointerDragCursor
        document.body.style.cursor = ""
      }

      const startDrag = (pointerEvent: PointerEvent) => {
        dragStarted = true
        onDragStarted?.()
        sourceElement.setAttribute("data-pointer-drag-source", "true")
        document.body.style.cursor = "grabbing"
        onDragStartItem(kind, id)

        const target = findSidebarPointerDropTarget(
          pointerEvent.clientX,
          pointerEvent.clientY,
          kind,
          id,
        )
        if (target) onDragOverItem(target.kind, target.id, target.position)
        else onDragOverItem(kind, id, "inside")
      }

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        const movedX = pointerEvent.clientX - startX
        const movedY = pointerEvent.clientY - startY
        if (!dragStarted) {
          if (Math.hypot(movedX, movedY) < SIDEBAR_POINTER_DRAG_THRESHOLD) return
          startDrag(pointerEvent)
        }

        pointerEvent.preventDefault()
        const target = findSidebarPointerDropTarget(
          pointerEvent.clientX,
          pointerEvent.clientY,
          kind,
          id,
        )
        if (target) onDragOverItem(target.kind, target.id, target.position)
        else onDragOverItem(kind, id, "inside")
      }

      const handlePointerUp = (pointerEvent: PointerEvent) => {
        cleanup()
        if (!dragStarted) return

        pointerEvent.preventDefault()
        const target = findSidebarPointerDropTarget(
          pointerEvent.clientX,
          pointerEvent.clientY,
          kind,
          id,
        )
        if (target) {
          onDropItem(target.kind, target.id, target.position)
        } else {
          onDragEndItem()
        }
        onDragFinished?.()
      }

      const handlePointerCancel = () => {
        cleanup()
        if (dragStarted) {
          onDragEndItem()
          onDragFinished?.()
        }
      }

      document.addEventListener("pointermove", handlePointerMove, true)
      document.addEventListener("pointerup", handlePointerUp, true)
      document.addEventListener("pointercancel", handlePointerCancel, true)
    },
    [
      blockSelector,
      disabled,
      id,
      kind,
      onDragEndItem,
      onDragOverItem,
      onDragStartItem,
      onDragFinished,
      onDragStarted,
      onDropItem,
    ],
  )
}

function DropSeparator({
  className,
  // Vertical nudge (applied to the outer wrapper) to center the line in the gap
  // between the two items. It must live here, not on the inner line: the line is
  // a framer-motion element whose animated `transform` overrides any Tailwind
  // translate class. A chat item's visible content is inset ~13px inside its
  // box, so the line sits ~5px below the visual center of the gap without a
  // nudge; callers pass the offset that recenters their context.
  offsetClassName = "-translate-y-[2px]",
  onDragEnter,
  onDragOver,
  onDrop,
}: {
  className?: string
  offsetClassName?: string
  onDragEnter?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void
  onDrop?: (event: React.DragEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className={cn("pointer-events-none relative z-10 h-0", offsetClassName, className)}
      aria-hidden="true"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <motion.div
        initial={{ opacity: 0, scaleX: 0.2 }}
        animate={{ opacity: 1, scaleX: 1 }}
        transition={{ type: "spring", stiffness: 560, damping: 34, mass: 0.55 }}
        className="absolute left-0 right-0 top-0 h-px origin-left rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.35)]"
      />
    </div>
  )
}

function ExpandedSectionIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, scaleX: 0.2 }}
      animate={{ opacity: 1, scaleX: 1 }}
      exit={{ opacity: 0, scaleX: 0.2 }}
      transition={{ type: "spring", stiffness: 560, damping: 34, mass: 0.55 }}
      className="pointer-events-none absolute bottom-0 left-2 right-2 h-px origin-left rounded-full bg-foreground/20 shadow-[0_0_6px_hsl(var(--foreground)/0.15)]"
      aria-hidden="true"
    />
  )
}

function SidebarDisclosure({
  isCollapsed,
  className,
}: {
  isCollapsed: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        "ml-auto mr-10 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover/disclosure:opacity-100 group-focus-within/disclosure:opacity-100",
        className,
      )}
      aria-hidden="true"
    >
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 flex-shrink-0 transition-transform",
          isCollapsed && "-rotate-90",
        )}
      />
    </span>
  )
}

// Component to render chat icon with loading status
const ChatIcon = React.memo(function ChatIcon({
  isSelected,
  isLoading,
  hasUnseenChanges = false,
  hasPendingPlan = false,
  hasPendingQuestion = false,
  isMultiSelectMode = false,
  isChecked = false,
  onCheckboxClick,
  showIcon = true,
}: {
  isSelected: boolean
  isLoading: boolean
  hasUnseenChanges?: boolean
  hasPendingPlan?: boolean
  hasPendingQuestion?: boolean
  isMultiSelectMode?: boolean
  isChecked?: boolean
  onCheckboxClick?: (e: React.MouseEvent) => void
  showIcon?: boolean
}) {
  const renderMainIcon = () => {
    return (
      <MessageSquare
        className={cn(
          "h-4 w-4 flex-shrink-0 transition-colors",
          isSelected ? "text-foreground" : "text-muted-foreground",
        )}
      />
    )
  }

  // When icon is hidden and not in multi-select mode, render nothing
  // The loader/status will be rendered inline by the parent component
  if (!showIcon && !isMultiSelectMode) {
    return null
  }

  return (
    <div className="relative flex-shrink-0 w-4 h-4">
      {/* Checkbox slides in from left, icon slides out */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center transition-[opacity,transform] duration-150 ease-out",
          isMultiSelectMode ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none",
        )}
        onClick={onCheckboxClick}
      >
        <Checkbox
          checked={isChecked}
          className="cursor-pointer h-4 w-4"
          tabIndex={isMultiSelectMode ? 0 : -1}
        />
      </div>
      {/* Main icon fades out when multi-select is active or when showIcon is false */}
      <div
        className={cn(
          "transition-[opacity,transform] duration-150 ease-out",
          isMultiSelectMode || !showIcon
            ? "opacity-0 scale-95 pointer-events-none"
            : "opacity-100 scale-100",
        )}
      >
        {renderMainIcon()}
      </div>
      {/* Badge in bottom-right corner: question > loader > amber dot > blue dot - hidden during multi-select or when icon is hidden */}
      <AnimatePresence mode="wait">
        {(hasPendingQuestion || isLoading || hasUnseenChanges || hasPendingPlan) &&
          !isMultiSelectMode &&
          showIcon && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.15 }}
              className={cn(
                "absolute -bottom-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center",
                isSelected
                  ? "bg-[#E8E8E8] dark:bg-[#1B1B1B]"
                  : "bg-[#F4F4F4] group-hover:bg-[#E8E8E8] dark:bg-[#101010] dark:group-hover:bg-[#1B1B1B]",
              )}
            >
              {/* Priority: question > loader > amber dot (pending plan) > blue dot (unseen) */}
              <AnimatePresence mode="wait">
                {hasPendingQuestion ? (
                  <motion.div
                    key="question"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                  >
                    <QuestionIcon className="w-2.5 h-2.5 text-blue-500" />
                  </motion.div>
                ) : isLoading ? (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                  >
                    <LoadingDot isLoading={true} className="w-2.5 h-2.5 text-muted-foreground" />
                  </motion.div>
                ) : hasPendingPlan ? (
                  <motion.div
                    key="plan"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                    className="w-1.5 h-1.5 rounded-full bg-amber-500"
                  />
                ) : (
                  <motion.div
                    key="unseen"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.15 }}
                  >
                    <LoadingDot isLoading={false} className="w-2.5 h-2.5 text-muted-foreground" />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
      </AnimatePresence>
    </div>
  )
})

// Memoized Draft Item component to prevent re-renders on hover
const DraftItem = React.memo(function DraftItem({
  draftId,
  draftText,
  draftUpdatedAt,
  projectGitOwner,
  projectGitProvider,
  projectGitRepo,
  projectName,
  projectColor,
  isSelected,
  isMultiSelectMode,
  isMobileFullscreen,
  showIcon,
  onSelect,
  onDelete,
  formatTime,
}: {
  draftId: string
  draftText: string
  draftUpdatedAt: number
  projectGitOwner: string | null | undefined
  projectGitProvider: string | null | undefined
  projectGitRepo: string | null | undefined
  projectName: string | null | undefined
  projectColor: string | null | undefined
  isSelected: boolean
  isMultiSelectMode: boolean
  isMobileFullscreen: boolean
  showIcon: boolean
  onSelect: (draftId: string) => void
  onDelete: (draftId: string) => void
  formatTime: (dateStr: string) => string
}) {
  const normalizedProjectColor = projectColor ? normalizeHexColor(projectColor) : null

  return (
    <div
      onClick={() => onSelect(draftId)}
      className={cn(
        "w-full text-left py-1.5 cursor-pointer group relative",
        "transition-colors duration-75",
        "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
        isMultiSelectMode ? "px-3" : normalizedProjectColor ? "pl-4 pr-2" : "pl-2 pr-2",
        !isMultiSelectMode && "rounded-md",
        isSelected
          ? "bg-foreground/5 text-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      {normalizedProjectColor && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1.5 top-1.5 bottom-1.5 w-[2px] rounded-full"
          style={{
            backgroundColor: rgbaFromHex(normalizedProjectColor, 0.78),
            boxShadow: `0 0 0 1px ${rgbaFromHex(normalizedProjectColor, 0.18)}`,
          }}
        />
      )}
      <div className="flex items-start gap-2.5">
        {showIcon && (
          <div className="pt-0.5">
            <div className="relative flex-shrink-0 w-4 h-4">
              {projectGitOwner && projectGitProvider === "github" ? (
                <GitHubAvatar gitOwner={projectGitOwner} />
              ) : (
                <GitHubLogo className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              )}
            </div>
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <span className="truncate block text-sm leading-tight flex-1">
              {draftText.slice(0, 50)}
              {draftText.length > 50 ? "..." : ""}
            </span>
            {/* Delete button - shown on hover */}
            {!isMultiSelectMode && !isMobileFullscreen && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(draftId)
                }}
                tabIndex={-1}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground active:text-foreground transition-[opacity,transform,color] duration-150 ease-out opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto active:scale-[0.97]"
                aria-label="Delete draft"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground/60 truncate">
              <span className="text-blue-500">Draft</span>
              {projectGitRepo ? ` • ${projectGitRepo}` : projectName ? ` • ${projectName}` : ""}
            </span>
            <span className="text-[11px] text-muted-foreground/60 flex-shrink-0">
              {formatTime(new Date(draftUpdatedAt).toISOString())}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
})

// Memoized Agent Chat Item component to prevent re-renders on hover
const AgentChatItem = React.memo(function AgentChatItem({
  chatId,
  chatName,
  chatBranch,
  chatUpdatedAt,
  chatProjectId,
  chatTaskId,
  parentChatId,
  chatScope,
  chatTags,
  globalIndex,
  isSelected,
  isLoading,
  hasUnseenChanges,
  hasPendingPlan,
  hasPendingQuestion,
  isMultiSelectMode,
  isChecked,
  isFocused,
  isMobileFullscreen,
  isDesktop,
  isPinned,
  isStarred,
  isInWorkbenchGroup,
  harness,
  model,
  hasCustomWorktree,
  worktreeLabel,
  displayText,
  stats,
  selectedChatIdsSize,
  canShowPinOption,
  areAllSelectedPinned,
  isRemote,
  showIcon,
  onChatClick,
  onCheckboxClick,
  onMouseEnter,
  onMouseLeave,
  onArchive,
  onTogglePin,
  onToggleStar,
  onRenameClick,
  onCopyBranch,
  onOpenLocally,
  moveDestinations,
  movePending,
  onMoveChat,
  onBulkPin,
  onBulkUnpin,
  onBulkArchive,
  archivePending,
  archiveBatchPending,
  nameRefCallback,
  formatTime,
  isJustCreated,
  dragKind,
  dragItemId,
  taskEndTargetId,
  isOnlyTaskChat,
  tintColor,
  isDragging,
  isDragOver,
  isBoundaryHighlighted,
  dragOverPosition,
  onDragStartItem,
  onDragOverItem,
  onDropItem,
  onDragEndItem,
}: {
  chatId: string
  chatName: string | null
  chatBranch: string | null
  chatUpdatedAt: Date | null
  chatProjectId: string
  chatTaskId: string | null
  parentChatId?: string | null
  chatScope?: "global" | "project" | "task" | null
  chatTags: ChatTagView[]
  globalIndex: number
  isSelected: boolean
  isLoading: boolean
  hasUnseenChanges: boolean
  hasPendingPlan: boolean
  hasPendingQuestion: boolean
  isMultiSelectMode: boolean
  isChecked: boolean
  isFocused: boolean
  isMobileFullscreen: boolean
  isDesktop: boolean
  isPinned: boolean
  isStarred: boolean
  isInWorkbenchGroup: boolean
  harness?: string | null
  model?: string | null
  hasCustomWorktree: boolean
  worktreeLabel?: string | null
  displayText: string
  stats: { fileCount: number; additions: number; deletions: number } | undefined
  selectedChatIdsSize: number
  canShowPinOption: boolean
  areAllSelectedPinned: boolean
  filteredChatsLength: number
  isLastInFilteredChats: boolean
  isRemote: boolean
  showIcon: boolean
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
  onToggleStar: (chatId: string) => void
  onRenameClick: (chat: { id: string; name: string | null; isRemote?: boolean }) => void
  onCopyBranch: (branch: string) => void
  onArchiveAllBelow: (chatId: string) => void
  onArchiveOthers: (chatId: string) => void
  onOpenLocally: (chatId: string) => void
  moveDestinations: readonly ChatMoveTarget[]
  movePending: boolean
  onMoveChat: (chatId: string, target: ChatMoveTarget) => void
  onBulkPin: () => void
  onBulkUnpin: () => void
  onBulkArchive: () => void
  archivePending: boolean
  archiveBatchPending: boolean
  nameRefCallback: (chatId: string, el: HTMLSpanElement | null) => void
  formatTime: (dateStr: string) => string
  isJustCreated: boolean
  dragKind:
    | "global-chat"
    | "project-chat"
    | "project-child"
    | "task-chat"
    | "remote-chat"
    | "pinned-chat"
    | "starred-chat"
  dragItemId?: string
  taskEndTargetId?: string
  isOnlyTaskChat: boolean
  tintColor?: string | null
  isDragging: boolean
  isDragOver: boolean
  isBoundaryHighlighted: boolean
  dragOverPosition?: SidebarDropPosition | null
  onDragStartItem: (kind: string, id: string) => void
  onDragOverItem: (kind: string, id: string, position: SidebarDropPosition) => void
  onDropItem: (kind: string, id: string, position: SidebarDropPosition) => void
  onDragEndItem: () => void
}) {
  const modelLabel = model?.trim()
  const harnessChip = getModelChipMeta(modelLabel, harness)
  const identityChipLabel = harness ? harnessChip.name : null
  const hasInlineStatus = hasPendingQuestion || isLoading || hasUnseenChanges || hasPendingPlan
  const effectiveDragItemId = dragItemId ?? chatId
  const suppressClickRef = useRef(false)
  const handlePointerDragStart = useSidebarPointerDragSource({
    disabled: isMultiSelectMode,
    kind: dragKind,
    id: effectiveDragItemId,
    blockSelector: "button,a,input,textarea,select,[role='menuitem']",
    onDragStartItem,
    onDragOverItem,
    onDropItem,
    onDragEndItem,
    onDragStarted: () => {
      suppressClickRef.current = true
    },
    onDragFinished: () => {
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    },
  })
  const normalizedTint = tintColor ? normalizeHexColor(tintColor) : null
  const tintStyle: React.CSSProperties | undefined = normalizedTint
    ? ({
        "--sidebar-chat-bg": rgbaFromHex(normalizedTint, SCOPED_CHAT_BACKGROUND_OPACITY),
        "--sidebar-chat-bg-hover": rgbaFromHex(
          normalizedTint,
          SCOPED_CHAT_BACKGROUND_HOVER_OPACITY,
        ),
      } as React.CSSProperties)
    : undefined
  const tintMarkerStyle: React.CSSProperties | undefined = normalizedTint
    ? {
        backgroundColor: rgbaFromHex(normalizedTint, 0.78),
        boxShadow: `0 0 0 1px ${rgbaFromHex(normalizedTint, 0.18)}`,
      }
    : undefined
  const chatItemStyle: React.CSSProperties | undefined =
    tintStyle || isSelected
      ? {
          ...tintStyle,
          ...(isSelected
            ? {
                borderColor: ACTIVE_CHAT_BORDER_COLOR,
                boxShadow: `0 0 0 1px ${rgbaFromHex(ACTIVE_CHAT_BORDER_COLOR, 0.28)}`,
              }
            : null),
        }
      : undefined

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-chat-item
          data-chat-id={chatId}
          data-pending-question={hasPendingQuestion ? "true" : undefined}
          data-chat-index={globalIndex}
          data-sidebar-drag-source
          data-sidebar-drag-target-kind={dragKind}
          data-sidebar-drag-target-id={effectiveDragItemId}
          data-sidebar-task-end-target-id={taskEndTargetId}
          data-sidebar-only-task-chat={isOnlyTaskChat || undefined}
          draggable={!isRemote && !isMultiSelectMode}
          onDragStart={(event) => {
            if (isRemote || isMultiSelectMode) {
              event.preventDefault()
              return
            }
            configureChatDragFeedback(event.dataTransfer, chatName || "New Chat")
            const source = {
              chatId,
              groupId: CHAT_WORKBENCH_EXTERNAL_GROUP_ID,
              sourceWindowId: getWindowId(),
            }
            const serialized = JSON.stringify(source)
            event.dataTransfer.setData(CHAT_WORKBENCH_DRAG_MIME, serialized)
            localStorage.setItem(CHAT_WORKBENCH_DRAG_SESSION_KEY, serialized)
          }}
          onDragEnd={() => localStorage.removeItem(CHAT_WORKBENCH_DRAG_SESSION_KEY)}
          onPointerDown={handlePointerDragStart}
          onClick={(e) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false
              return
            }
            // On real mobile (touch devices), onTouchEnd handles the click
            // In desktop app with narrow window, we still use mouse clicks
            if (isMobileFullscreen && !isDesktop) return
            onChatClick(chatId, e, globalIndex)
          }}
          onTouchEnd={(e) => {
            // On real mobile touch devices, use touchEnd directly to bypass ContextMenu's click delay
            if (isMobileFullscreen && !isDesktop) {
              e.preventDefault()
              onChatClick(chatId, undefined, globalIndex)
            }
          }}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onChatClick(chatId, undefined, globalIndex)
            }
          }}
          onMouseEnter={(e) => {
            onMouseEnter(chatId, chatName, e.currentTarget, globalIndex)
          }}
          onMouseLeave={onMouseLeave}
          className={cn(
            "w-full mb-0.5 last:mb-0 text-left pt-px pb-[3px] cursor-pointer group relative",
            "transition-[background-color,border-color,box-shadow,opacity,transform] duration-150 ease-out",
            "border border-transparent text-foreground",
            "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
            // In multi-select: px-3 compensates for removed container px-2, keeping text aligned
            isMultiSelectMode ? "px-3" : normalizedTint ? "pl-4 pr-1.5" : "pl-2 pr-1.5",
            !isMultiSelectMode && "rounded-md",
            isSelected
              ? "bg-violet-500/[0.055]"
              : isFocused
                ? "bg-foreground/5"
                : // On mobile, no hover effect to prevent double-tap issue
                  isMobileFullscreen
                  ? ""
                  : "hover:bg-foreground/5",
            isChecked &&
              (isMobileFullscreen ? "bg-primary/10" : "bg-primary/10 hover:bg-primary/15"),
            dragKind === "project-chat" && "bg-foreground/[0.018] hover:bg-foreground/[0.04]",
            dragKind === "project-child" && "bg-foreground/[0.018] hover:bg-foreground/[0.04]",
            dragKind === "task-chat" &&
              (normalizedTint
                ? "bg-[var(--sidebar-chat-bg)] hover:bg-[var(--sidebar-chat-bg-hover)]"
                : "bg-foreground/[0.018] hover:bg-foreground/[0.04]"),
            dragKind === "global-chat" &&
              (normalizedTint
                ? "bg-foreground/[0.018] hover:bg-foreground/[0.04]"
                : "hover:bg-slate-500/[0.035]"),
            isDragOver && "translate-x-0.5 border-primary/35 bg-primary/[0.055] shadow-sm",
            isBoundaryHighlighted && "ring-1 ring-inset ring-primary/60",
            isDragging && "scale-[0.985] opacity-55 shadow-sm ring-1 ring-primary/25",
          )}
          style={chatItemStyle}
        >
          {normalizedTint && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-1.5 top-0.5 bottom-0.5 w-[2px] rounded-full"
              style={tintMarkerStyle}
            />
          )}
          <div className="flex items-start gap-2">
            {/* Icon container - only render if showIcon or in multi-select mode */}
            {(showIcon || isMultiSelectMode) && (
              <div className="pt-[2px]">
                <ChatIcon
                  isSelected={isSelected}
                  isLoading={isLoading}
                  hasUnseenChanges={hasUnseenChanges}
                  hasPendingPlan={hasPendingPlan}
                  hasPendingQuestion={hasPendingQuestion}
                  isMultiSelectMode={isMultiSelectMode}
                  isChecked={isChecked}
                  onCheckboxClick={(e) => onCheckboxClick(e, chatId)}
                  showIcon={showIcon}
                />
              </div>
            )}
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <div className="flex items-center gap-1">
                {isInWorkbenchGroup && (
                  <PanelsTopLeft
                    aria-label="In Chat group"
                    role="img"
                    className="h-3 w-3 flex-shrink-0 text-muted-foreground"
                  />
                )}
                {isPinned && <Pin className="h-3 w-3 flex-shrink-0 text-sky-400" />}
                {isStarred && (
                  <Star className="h-3 w-3 flex-shrink-0 fill-amber-400 text-amber-400" />
                )}
                {parentChatId && (
                  <button
                    type="button"
                    className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-violet-300 hover:bg-violet-500/15 hover:text-violet-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                    title="Open parent agent chat"
                    aria-label="Open parent agent chat"
                    onClick={(event) => {
                      event.stopPropagation()
                      onChatClick(parentChatId, event)
                    }}
                  >
                    <GitFork aria-hidden="true" className="h-3 w-3" />
                  </button>
                )}
                <span
                  ref={(el) => nameRefCallback(chatId, el)}
                  className="truncate block text-sm leading-5 flex-1 text-white"
                >
                  <TypewriterText
                    text={chatName || ""}
                    placeholder="New chat"
                    id={chatId}
                    isJustCreated={isJustCreated}
                    showPlaceholder={true}
                  />
                </span>
                {/* Hover actions or inline loader/status when icon is hidden */}
                {!isMultiSelectMode && !isMobileFullscreen && (
                  <div
                    className={cn(
                      "relative flex h-5 flex-shrink-0 items-center justify-end overflow-hidden group-hover:w-[4.25rem] focus-within:w-[4.25rem]",
                      hasInlineStatus ? "w-5" : "w-0",
                    )}
                  >
                    {/* Inline loader/status when icon is hidden - always visible, hides on hover */}
                    {!showIcon &&
                      (hasPendingQuestion || isLoading || hasUnseenChanges || hasPendingPlan) && (
                        <div className="absolute right-0 top-0 bottom-0 w-5 flex items-center justify-center transition-opacity duration-150 group-hover:opacity-0">
                          <AnimatePresence mode="wait">
                            {hasPendingQuestion ? (
                              <motion.div
                                key="question"
                                initial={{ opacity: 0, scale: 0.5 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.5 }}
                                transition={{ duration: 0.15 }}
                              >
                                <QuestionIcon className="w-2.5 h-2.5 text-blue-500" />
                                <span className="sr-only">Input required</span>
                              </motion.div>
                            ) : isLoading ? (
                              <motion.div
                                key="loading"
                                initial={{ opacity: 0, scale: 0.5 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.5 }}
                                transition={{ duration: 0.15 }}
                              >
                                <LoadingDot
                                  isLoading={true}
                                  className="w-2.5 h-2.5 text-muted-foreground"
                                />
                              </motion.div>
                            ) : hasPendingPlan ? (
                              <motion.div
                                key="plan"
                                initial={{ opacity: 0, scale: 0.5 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.5 }}
                                transition={{ duration: 0.15 }}
                                className="w-1.5 h-1.5 rounded-full bg-amber-500"
                              />
                            ) : (
                              <motion.div
                                key="unseen"
                                initial={{ opacity: 0, scale: 0.5 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.5 }}
                                transition={{ duration: 0.15 }}
                              >
                                <LoadingDot
                                  isLoading={false}
                                  className="w-2.5 h-2.5 text-muted-foreground"
                                />
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onTogglePin(chatId)
                          }}
                          tabIndex={-1}
                          className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground active:text-foreground transition-[opacity,transform,color] duration-150 ease-out opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto active:scale-[0.97]"
                          aria-label={isPinned ? "Unpin chat" : "Pin chat"}
                        >
                          <Pin className={cn("h-3.5 w-3.5", isPinned && "text-sky-400")} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{isPinned ? "Unpin chat" : "Pin chat"}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onArchive(chatId)
                          }}
                          tabIndex={-1}
                          disabled={archivePending}
                          className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground active:text-foreground transition-[opacity,transform,color] duration-150 ease-out opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                          aria-label="Archive chat"
                        >
                          <ArchiveIcon className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Archive chat</TooltipContent>
                    </Tooltip>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          tabIndex={-1}
                          className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground active:text-foreground transition-[opacity,transform,color] duration-150 ease-out opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto active:scale-[0.97] data-[state=open]:opacity-100 data-[state=open]:scale-100 data-[state=open]:pointer-events-auto"
                          aria-label="Chat actions"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48" sideOffset={4}>
                        {isRemote && (
                          <>
                            <DropdownMenuItem onSelect={() => onOpenLocally(chatId)}>
                              Fork Locally
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                          </>
                        )}
                        <DropdownMenuItem onSelect={() => onToggleStar(chatId)} className="gap-2">
                          <Star className="h-3.5 w-3.5 text-muted-foreground" />
                          {isStarred ? "Unstar chat" : "Star chat"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => onRenameClick({ id: chatId, name: chatName, isRemote })}
                        >
                          Rename chat
                        </DropdownMenuItem>
                        {!isRemote && <ChatTagSubmenu chatId={chatId} assignedTags={chatTags} />}
                        {!isRemote && (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger className="gap-2">
                              <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                              Move to...
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent
                              sideOffset={6}
                              alignOffset={-4}
                              className="max-h-80 w-64 overflow-y-auto"
                            >
                              {moveDestinations.map((target) => {
                                const isCurrent = isCurrentChatMoveTarget(
                                  {
                                    scope: chatScope,
                                    projectId: chatProjectId || null,
                                    taskId: chatTaskId,
                                  },
                                  target,
                                )
                                return (
                                  <DropdownMenuItem
                                    key={chatMoveTargetKey(target)}
                                    disabled={movePending || isCurrent}
                                    aria-current={isCurrent ? "location" : undefined}
                                    onSelect={() => onMoveChat(chatId, target)}
                                    className="gap-2"
                                  >
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate">{target.label}</span>
                                      <span className="block truncate text-[10px] text-muted-foreground">
                                        {target.detail}
                                      </span>
                                    </span>
                                    {isCurrent && (
                                      <span className="text-[10px] text-muted-foreground">
                                        Current
                                      </span>
                                    )}
                                  </DropdownMenuItem>
                                )
                              })}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )}
                        {chatBranch && (
                          <DropdownMenuItem onSelect={() => onCopyBranch(chatBranch)}>
                            Copy branch name
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="gap-2"
                          onSelect={() =>
                            copyChat({
                              chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                              format: "handoff",
                              isRemote,
                            })
                          }
                        >
                          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                          Copy full chat history
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>Export chat</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent sideOffset={6} alignOffset={-4}>
                            <DropdownMenuItem
                              onSelect={() =>
                                exportChat({
                                  chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                                  format: "markdown",
                                  isRemote,
                                })
                              }
                            >
                              Download as Markdown
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                exportChat({
                                  chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                                  format: "json",
                                  isRemote,
                                })
                              }
                            >
                              Download as JSON
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                exportChat({
                                  chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                                  format: "text",
                                  isRemote,
                                })
                              }
                            >
                              Download as Text
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() =>
                                copyChat({
                                  chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                                  format: "markdown",
                                  isRemote,
                                })
                              }
                            >
                              Copy as Markdown
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                copyChat({
                                  chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                                  format: "json",
                                  isRemote,
                                })
                              }
                            >
                              Copy as JSON
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                copyChat({
                                  chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                                  format: "text",
                                  isRemote,
                                })
                              }
                            >
                              Copy as Text
                            </DropdownMenuItem>
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        {isDesktop && (
                          <DropdownMenuItem
                            onSelect={async () => {
                              const result = await window.desktopApi?.newWindow({ chatId })
                              if (result?.blocked) {
                                const creationFailure = asWorkbenchWindowCreationFailure(result)
                                if (creationFailure) {
                                  showWorkbenchWindowCreationFeedback(creationFailure)
                                } else if (result.reason === "already-open") {
                                  toast.info("This chat is already open in another window", {
                                    description: "Switching to the existing window.",
                                    duration: 3000,
                                  })
                                }
                              }
                            }}
                          >
                            Open in new window
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground/60">
                {isRemote && <CloudIcon className="h-2.5 w-2.5 flex-shrink-0" />}
                {(identityChipLabel || hasCustomWorktree) && (
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {identityChipLabel && (
                      <SidebarChip
                        className={harnessChip.className}
                        title={harness ? `${harnessChip.name} · ${modelLabel}` : modelLabel}
                      >
                        <ProviderChipIcon
                          provider={harness}
                          className="mr-1 h-2.5 w-2.5 shrink-0"
                        />
                        {identityChipLabel}
                      </SidebarChip>
                    )}
                    {hasCustomWorktree && (
                      <SidebarChip className="border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300">
                        {worktreeLabel ?? "Worktree"}
                      </SidebarChip>
                    )}
                  </div>
                )}
                {chatTags.slice(0, 2).map((tag) => (
                  <ChatTagChip key={tag.id} tag={tag} compact />
                ))}
                {chatTags.length > 2 && (
                  <span className="text-[9px] text-muted-foreground">+{chatTags.length - 2}</span>
                )}
                {displayText && <span className="truncate min-w-0">{displayText}</span>}
                <span className="flex-1 min-w-0" />
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {stats && (stats.additions > 0 || stats.deletions > 0) && (
                    <>
                      <span className="text-green-600 dark:text-green-400">+{stats.additions}</span>
                      <span className="text-red-600 dark:text-red-400">-{stats.deletions}</span>
                    </>
                  )}
                  <span>
                    {formatTime(chatUpdatedAt?.toISOString() ?? new Date().toISOString())}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {/* Multi-select context menu */}
        {isMultiSelectMode && isChecked ? (
          <>
            {canShowPinOption && (
              <>
                <ContextMenuItem onClick={areAllSelectedPinned ? onBulkUnpin : onBulkPin}>
                  {areAllSelectedPinned
                    ? `Unpin ${selectedChatIdsSize} ${pluralize(selectedChatIdsSize, "chat")}`
                    : `Pin ${selectedChatIdsSize} ${pluralize(selectedChatIdsSize, "chat")}`}
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem onClick={onBulkArchive} disabled={archiveBatchPending}>
              {archiveBatchPending
                ? "Archiving..."
                : `Archive ${selectedChatIdsSize} ${pluralize(selectedChatIdsSize, "chat")}`}
            </ContextMenuItem>
          </>
        ) : (
          <>
            {isRemote && (
              <>
                <ContextMenuItem onClick={() => onOpenLocally(chatId)}>
                  Fork Locally
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem onClick={() => onToggleStar(chatId)}>
              {isStarred ? "Unstar chat" : "Star chat"}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => onRenameClick({ id: chatId, name: chatName, isRemote })}
            >
              Rename chat
            </ContextMenuItem>
            {!isRemote && (
              <ContextMenuSub>
                <ContextMenuSubTrigger className="gap-2">
                  <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                  Move to...
                </ContextMenuSubTrigger>
                <ContextMenuSubContent
                  sideOffset={6}
                  alignOffset={-4}
                  className="max-h-80 w-64 overflow-y-auto"
                >
                  {moveDestinations.map((target) => {
                    const isCurrent = isCurrentChatMoveTarget(
                      {
                        scope: chatScope,
                        projectId: chatProjectId || null,
                        taskId: chatTaskId,
                      },
                      target,
                    )
                    return (
                      <ContextMenuItem
                        key={chatMoveTargetKey(target)}
                        disabled={movePending || isCurrent}
                        aria-current={isCurrent ? "location" : undefined}
                        onClick={() => onMoveChat(chatId, target)}
                        className="gap-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{target.label}</span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {target.detail}
                          </span>
                        </span>
                        {isCurrent && (
                          <span className="text-[10px] text-muted-foreground">Current</span>
                        )}
                      </ContextMenuItem>
                    )
                  })}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            {chatBranch && (
              <ContextMenuItem onClick={() => onCopyBranch(chatBranch)}>
                Copy branch name
              </ContextMenuItem>
            )}
            <ContextMenuItem
              className="gap-2"
              data-dev-chat-copy-source="sidebar-menu"
              data-chat-id={chatId}
              onClick={() =>
                copyChat({
                  chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                  format: "handoff",
                  isRemote,
                })
              }
            >
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              Copy full chat history
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger>Export chat</ContextMenuSubTrigger>
              <ContextMenuSubContent sideOffset={6} alignOffset={-4}>
                <ContextMenuItem
                  onClick={() =>
                    exportChat({
                      chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                      format: "markdown",
                      isRemote,
                    })
                  }
                >
                  Download as Markdown
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() =>
                    exportChat({
                      chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                      format: "json",
                      isRemote,
                    })
                  }
                >
                  Download as JSON
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() =>
                    exportChat({
                      chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                      format: "text",
                      isRemote,
                    })
                  }
                >
                  Download as Text
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onClick={() =>
                    copyChat({
                      chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                      format: "markdown",
                      isRemote,
                    })
                  }
                >
                  Copy as Markdown
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() =>
                    copyChat({
                      chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                      format: "json",
                      isRemote,
                    })
                  }
                >
                  Copy as JSON
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() =>
                    copyChat({
                      chatId: isRemote ? chatId.replace(/^remote_/, "") : chatId,
                      format: "text",
                      isRemote,
                    })
                  }
                >
                  Copy as Text
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            {isDesktop && (
              <ContextMenuItem
                onClick={async () => {
                  const result = await window.desktopApi?.newWindow({ chatId })
                  if (result?.blocked) {
                    const creationFailure = asWorkbenchWindowCreationFailure(result)
                    if (creationFailure) {
                      showWorkbenchWindowCreationFeedback(creationFailure)
                    } else if (result.reason === "already-open") {
                      toast.info("This chat is already open in another window", {
                        description: "Switching to the existing window.",
                        duration: 3000,
                      })
                    }
                  }
                }}
              >
                Open in new window
              </ContextMenuItem>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
})

// Custom comparator for ChatListSection to handle Set/Map props correctly
// Sets and Maps from Jotai atoms are stable by reference when unchanged,
// but we add explicit size checks for extra safety
function chatListSectionPropsAreEqual(
  prevProps: ChatListSectionProps,
  nextProps: ChatListSectionProps,
): boolean {
  // Quick checks for primitive props that change often
  if (prevProps.selectedChatId !== nextProps.selectedChatId) return false
  if (prevProps.selectedChatIsRemote !== nextProps.selectedChatIsRemote) return false
  if (prevProps.focusedChatIndex !== nextProps.focusedChatIndex) return false
  if (prevProps.isMultiSelectMode !== nextProps.isMultiSelectMode) return false
  if (prevProps.canShowPinOption !== nextProps.canShowPinOption) return false
  if (prevProps.areAllSelectedPinned !== nextProps.areAllSelectedPinned) return false
  if (prevProps.archivePending !== nextProps.archivePending) return false
  if (prevProps.archiveBatchPending !== nextProps.archiveBatchPending) return false
  if (prevProps.lifecyclePending !== nextProps.lifecyclePending) return false
  if (prevProps.title !== nextProps.title) return false
  if (prevProps.lifecycleTarget?.type !== nextProps.lifecycleTarget?.type) return false
  if (prevProps.lifecycleTarget?.id !== nextProps.lifecycleTarget?.id) return false
  if (prevProps.lifecycleTarget?.isPinned !== nextProps.lifecycleTarget?.isPinned) return false
  if (prevProps.lifecycleTarget?.isStarred !== nextProps.lifecycleTarget?.isStarred) return false
  if (prevProps.sectionId !== nextProps.sectionId) return false
  if (prevProps.sectionDragId !== nextProps.sectionDragId) return false
  if (prevProps.hideHeader !== nextProps.hideHeader) return false
  if (prevProps.parentProjectId !== nextProps.parentProjectId) return false
  if (prevProps.isCollapsed !== nextProps.isCollapsed) return false
  if (prevProps.isDraggingSection !== nextProps.isDraggingSection) return false
  if (prevProps.isDragOverSection !== nextProps.isDragOverSection) return false
  if (prevProps.isSectionBoundaryHighlighted !== nextProps.isSectionBoundaryHighlighted)
    return false
  if (prevProps.isMoveIntoSection !== nextProps.isMoveIntoSection) return false
  if (prevProps.draggingKind !== nextProps.draggingKind) return false
  if (prevProps.draggingId !== nextProps.draggingId) return false
  if (prevProps.dragOverKind !== nextProps.dragOverKind) return false
  if (prevProps.dragOverId !== nextProps.dragOverId) return false
  if (prevProps.dragOverPosition !== nextProps.dragOverPosition) return false
  if (prevProps.dragOverSectionPosition !== nextProps.dragOverSectionPosition) return false
  if (prevProps.projectColor !== nextProps.projectColor) return false
  if (prevProps.projectColorsById !== nextProps.projectColorsById) return false
  if (prevProps.showWhenEmpty !== nextProps.showWhenEmpty) return false
  if (prevProps.showEmptyState !== nextProps.showEmptyState) return false
  if (prevProps.hasOpenChats !== nextProps.hasOpenChats) return false
  if (prevProps.isMobileFullscreen !== nextProps.isMobileFullscreen) return false
  if (prevProps.isDesktop !== nextProps.isDesktop) return false
  if (prevProps.showIcon !== nextProps.showIcon) return false
  if (prevProps.movePending !== nextProps.movePending) return false

  // Check arrays by reference (they're stable from useMemo in parent)
  if (prevProps.chats !== nextProps.chats) return false
  if (prevProps.filteredChats !== nextProps.filteredChats) return false
  if (prevProps.moveDestinations !== nextProps.moveDestinations) return false

  // Check Sets by reference - Jotai atoms return same reference if unchanged
  if (prevProps.loadingChatIds !== nextProps.loadingChatIds) return false
  if (prevProps.unseenChanges !== nextProps.unseenChanges) return false
  if (prevProps.workspacePendingPlans !== nextProps.workspacePendingPlans) return false
  if (prevProps.workspacePendingQuestions !== nextProps.workspacePendingQuestions) return false
  if (prevProps.selectedChatIds !== nextProps.selectedChatIds) return false
  if (prevProps.pinnedChatIds !== nextProps.pinnedChatIds) return false
  if (prevProps.starredChatIds !== nextProps.starredChatIds) return false
  if (prevProps.groupedChatIds !== nextProps.groupedChatIds) return false
  if (prevProps.justCreatedIds !== nextProps.justCreatedIds) return false

  // Check Maps by reference
  if (prevProps.projectsMap !== nextProps.projectsMap) return false
  if (prevProps.workspaceFileStats !== nextProps.workspaceFileStats) return false

  // Callback functions are stable from useCallback in parent
  // No need to compare them - they only change when their deps change

  return true
}

interface ChatListSectionProps {
  title: string
  kind?: "pinned" | "starred" | "remote" | "global" | "project" | "task"
  sectionId?: string
  sectionDragId?: string
  hideHeader?: boolean
  parentProjectId?: string | null
  projectColor?: string | null
  projectColorsById?: Record<string, string>
  showWhenEmpty?: boolean
  showEmptyState?: boolean
  hasOpenChats?: boolean
  isCollapsed?: boolean
  isDraggingSection?: boolean
  isDragOverSection?: boolean
  isSectionBoundaryHighlighted?: boolean
  isMoveIntoSection?: boolean
  dragOverSectionPosition?: SidebarDropPosition | null
  draggingKind?: string | null
  draggingId?: string | null
  dragOverKind?: string | null
  dragOverId?: string | null
  dragOverPosition?: SidebarDropPosition | null
  lifecycleTarget?: {
    type: "project" | "task"
    id: string
    isPinned: boolean
    isStarred?: boolean
  }
  chats: Array<{
    id: string
    name: string | null
    branch: string | null
    updatedAt: Date | null
    projectId: string | null
    taskId: string | null
    parentChatId?: string | null
    scope?: "global" | "project" | "task" | null
    isRemote: boolean
    harness?: string | null
    model?: string | null
    worktreePath?: string | null
    meta?: { repository?: string; branch?: string | null } | null
    tags: ChatTagView[]
  }>
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
  groupedChatIds: ReadonlySet<string>
  projectsMap: Map<
    string,
    {
      gitOwner?: string | null
      gitProvider?: string | null
      gitRepo?: string | null
      name?: string | null
      path?: string | null
    }
  >
  workspaceFileStats: Map<string, { fileCount: number; additions: number; deletions: number }>
  filteredChats: Array<{ id: string }>
  canShowPinOption: boolean
  areAllSelectedPinned: boolean
  showIcon: boolean
  moveDestinations: readonly ChatMoveTarget[]
  movePending: boolean
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
  onToggleStar: (chatId: string) => void
  onRenameClick: (chat: { id: string; name: string | null; isRemote?: boolean }) => void
  onCopyBranch: (branch: string) => void
  onArchiveAllBelow: (chatId: string) => void
  onArchiveOthers: (chatId: string) => void
  onOpenLocally: (chatId: string) => void
  onMoveChat: (chatId: string, target: ChatMoveTarget) => void
  onBulkPin: () => void
  onBulkUnpin: () => void
  onBulkArchive: () => void
  onCreateGlobalChat?: () => void
  onCreateProjectChat?: (projectId: string) => void
  onCreateProjectTask?: (projectId: string) => void
  onCreateTaskChat?: (taskId: string) => void
  onOpenRepositoryOverview?: (projectId: string) => void
  planningEnabled?: boolean
  onChangeProjectColor?: (projectId: string, color: string) => void
  onToggleSection?: (sectionId: string) => void
  onSelectScope?: (scope: SelectedChatScope) => void
  onDragStartItem: (kind: string, id: string) => void
  onDragOverItem: (kind: string, id: string, position: SidebarDropPosition) => void
  onDropItem: (kind: string, id: string, position: SidebarDropPosition) => void
  onDragEndItem: () => void
  onToggleLifecyclePin: (type: "project" | "task", id: string, isPinned: boolean) => void
  onToggleLifecycleStar: (type: "project" | "task", id: string) => void
  onArchiveLifecycle: (type: "project" | "task", id: string) => void
  archivePending: boolean
  archiveBatchPending: boolean
  lifecyclePending: boolean
  nameRefCallback: (chatId: string, el: HTMLSpanElement | null) => void
  formatTime: (dateStr: string) => string
  justCreatedIds: Set<string>
  starredChatIds: Set<string>
}

// Memoized Chat List Section component
const ChatListSection = React.memo(function ChatListSection({
  title,
  kind = "global",
  sectionId,
  sectionDragId,
  hideHeader = false,
  parentProjectId,
  projectColor,
  projectColorsById,
  showWhenEmpty = false,
  showEmptyState = false,
  hasOpenChats = false,
  isCollapsed = false,
  isDraggingSection = false,
  isDragOverSection = false,
  isSectionBoundaryHighlighted = false,
  isMoveIntoSection = false,
  dragOverSectionPosition,
  draggingKind,
  draggingId,
  dragOverKind,
  dragOverId,
  dragOverPosition,
  lifecycleTarget,
  chats,
  selectedChatId,
  selectedChatIsRemote,
  focusedChatIndex,
  loadingChatIds,
  unseenChanges,
  workspacePendingPlans,
  workspacePendingQuestions,
  isMultiSelectMode,
  selectedChatIds,
  isMobileFullscreen,
  isDesktop,
  pinnedChatIds,
  groupedChatIds,
  projectsMap,
  workspaceFileStats,
  filteredChats,
  canShowPinOption,
  areAllSelectedPinned,
  showIcon,
  moveDestinations,
  movePending,
  onChatClick,
  onCheckboxClick,
  onMouseEnter,
  onMouseLeave,
  onArchive,
  onTogglePin,
  onToggleStar,
  onRenameClick,
  onCopyBranch,
  onArchiveAllBelow,
  onArchiveOthers,
  onOpenLocally,
  onMoveChat,
  onBulkPin,
  onBulkUnpin,
  onBulkArchive,
  onCreateGlobalChat,
  onCreateProjectChat,
  onCreateProjectTask,
  onCreateTaskChat,
  onOpenRepositoryOverview,
  planningEnabled = false,
  onChangeProjectColor,
  onToggleSection,
  onSelectScope,
  onDragStartItem,
  onDragOverItem,
  onDropItem,
  onDragEndItem,
  onToggleLifecyclePin,
  onToggleLifecycleStar,
  onArchiveLifecycle,
  archivePending,
  archiveBatchPending,
  lifecyclePending,
  nameRefCallback,
  formatTime,
  justCreatedIds,
  starredChatIds,
}: ChatListSectionProps) {
  const isGlobalSection = kind === "global"
  const isProjectSection = kind === "project"
  const isTaskSection = kind === "task"
  const isReferenceSection = kind === "pinned" || kind === "starred"
  const [startAgentDialogOpen, setStartAgentDialogOpen] = useState(false)
  const isTopLevelScopedSection = isGlobalSection || isProjectSection
  const sectionDragKind =
    lifecycleTarget?.type === "project"
      ? "project"
      : lifecycleTarget?.type === "task" && parentProjectId
        ? "project-child"
        : "task"
  const effectiveSectionDragId = sectionDragId ?? lifecycleTarget?.id
  const suppressSectionClickRef = useRef(false)
  const handleSectionPointerDragStart = useSidebarPointerDragSource({
    disabled: !lifecycleTarget || isMultiSelectMode || !effectiveSectionDragId,
    kind: sectionDragKind,
    id: effectiveSectionDragId ?? "",
    blockSelector:
      "[data-section-action],a,input,textarea,select,[role='menuitem'],[data-radix-collection-item]",
    onDragStartItem,
    onDragOverItem,
    onDropItem,
    onDragEndItem,
    onDragStarted: () => {
      suppressSectionClickRef.current = true
    },
    onDragFinished: () => {
      window.setTimeout(() => {
        suppressSectionClickRef.current = false
      }, 0)
    },
  })
  const chatDragKind =
    kind === "project" && hideHeader && parentProjectId
      ? "project-child"
      : kind === "project"
        ? "project-chat"
        : kind === "task"
          ? "task-chat"
          : kind === "remote"
            ? "remote-chat"
            : kind === "pinned"
              ? "pinned-chat"
              : kind === "starred"
                ? "starred-chat"
                : "global-chat"
  const scopedTint = getProjectTint(
    isGlobalSection || isReferenceSection ? GLOBAL_SECTION_COLOR : projectColor,
  )
  const sectionTint = isTaskSection ? scopedTint.task : scopedTint.base
  const chatTint = isTaskSection
    ? scopedTint.taskChat
    : isTopLevelScopedSection
      ? scopedTint.chat
      : null
  const sectionStyle: React.CSSProperties | undefined =
    isTopLevelScopedSection || isTaskSection || isReferenceSection
      ? {
          backgroundColor: rgbaFromHex(
            sectionTint,
            isTaskSection ? TASK_SECTION_BACKGROUND_OPACITY : SCOPED_SECTION_BACKGROUND_OPACITY,
          ),
        }
      : undefined

  // Pre-compute global indices map to avoid O(n²) findIndex in map()
  const globalIndexMap = useMemo(() => {
    const map = new Map<string, number>()
    filteredChats.forEach((c, i) => map.set(c.id, i))
    return map
  }, [filteredChats])

  const canCollapse = Boolean(
    sectionId &&
    (isTopLevelScopedSection || isTaskSection || kind === "pinned" || kind === "starred"),
  )
  const headerIcon = isProjectSection ? (
    <FolderGit2 className="h-3.5 w-3.5 flex-shrink-0 text-white/90" />
  ) : isGlobalSection ? (
    <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-white/90" />
  ) : isTaskSection ? (
    <ClipboardList className="h-3.5 w-3.5 flex-shrink-0 text-white/90" />
  ) : kind === "remote" ? (
    <CloudIcon className="h-3.5 w-3.5 flex-shrink-0 text-violet-400" />
  ) : kind === "pinned" ? (
    <Pin className="h-3.5 w-3.5 flex-shrink-0 text-white/90" />
  ) : kind === "starred" ? (
    <Star className="h-3.5 w-3.5 flex-shrink-0 text-white/90" />
  ) : (
    <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
  )

  if (chats.length === 0 && !lifecycleTarget && !showWhenEmpty) return null

  const showBeforeSectionDrop =
    isDragOverSection && !isMoveIntoSection && dragOverSectionPosition === "before"
  const showAfterSectionDrop =
    isDragOverSection && !isMoveIntoSection && dragOverSectionPosition === "after"
  const highlightWholeTaskEdgeDrop =
    isTaskSection && (isSectionBoundaryHighlighted || showBeforeSectionDrop || showAfterSectionDrop)
  const isTaskScopedDrag = draggingKind === "task-chat"
  // During any drag, the cursor passing over a header still fires CSS :hover,
  // which reveals the header's "+" (add chat) and "⋯" buttons. That looks like
  // "adding a chat to this task" and is misleading mid-drag, so hide them while
  // a drag is active.
  const isAnyDragActive = Boolean(draggingKind)
  const sectionDropSeparatorClass =
    isTaskSection && isTaskScopedDrag ? (isMultiSelectMode ? "ml-6 mr-3" : "ml-6") : ""
  const usesSectionDropSeparator = hideHeader && Boolean(sectionDragId)
  const chatBoundaryHighlightIds = new Set(
    !usesSectionDropSeparator && dragOverKind === chatDragKind
      ? resolveBoundaryHighlightIds({
          items: chats.map((chat) => ({
            id: chat.id,
            groupId: chat.taskId ?? chat.projectId ?? kind,
          })),
          targetId: dragOverId ?? null,
          position: dragOverPosition ?? null,
        })
      : [],
  )
  const getHeaderScope = useCallback((): NonNullable<SelectedChatScope> | null => {
    if (lifecycleTarget?.type === "project") {
      return { type: "project", id: lifecycleTarget.id, name: title }
    }
    if (lifecycleTarget?.type === "task" && parentProjectId) {
      return {
        type: "task",
        id: lifecycleTarget.id,
        name: title,
        projectId: parentProjectId,
      }
    }
    if (kind === "global") {
      return { type: "global", id: "global", name: title }
    }
    return null
  }, [kind, lifecycleTarget, parentProjectId, title])
  const handleHeaderClick = useCallback(() => {
    if (suppressSectionClickRef.current) {
      suppressSectionClickRef.current = false
      return
    }

    if (canCollapse && sectionId) {
      const willExpand = isCollapsed
      onToggleSection?.(sectionId)
      const scopeSelection = resolveSectionHeaderScopeSelection({
        isProjectSection,
        hasOpenChats,
        willExpand,
        scope: getHeaderScope(),
      })
      if (scopeSelection !== undefined) onSelectScope?.(scopeSelection)
      return
    }

    onSelectScope?.(getHeaderScope())
  }, [
    canCollapse,
    getHeaderScope,
    hasOpenChats,
    isCollapsed,
    isProjectSection,
    onSelectScope,
    onToggleSection,
    sectionId,
  ])
  const handleSeparatorDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])
  const handleSeparatorDragOver = useCallback(
    (
      event: React.DragEvent<HTMLDivElement>,
      kind: string,
      id: string,
      position: DragInsertPosition,
    ) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
      onDragOverItem(kind, id, position)
    },
    [onDragOverItem],
  )
  const handleSeparatorDrop = useCallback(
    (
      event: React.DragEvent<HTMLDivElement>,
      kind: string,
      id: string,
      position: DragInsertPosition,
    ) => {
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
      onDropItem(kind, id, position)
    },
    [onDropItem],
  )

  const dropdownLifecycleMenu = lifecycleTarget ? (
    <>
      {lifecycleTarget.type === "project" && (
        <>
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => onCreateProjectChat?.(lifecycleTarget.id)}
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-muted-foreground" />
            New chat
          </DropdownMenuItem>
          {planningEnabled && (
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => onCreateProjectTask?.(lifecycleTarget.id)}
            >
              <ListPlus className="h-3.5 w-3.5 text-muted-foreground" />
              New task
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => onOpenRepositoryOverview?.(lifecycleTarget.id)}
          >
            <Trees className="h-3.5 w-3.5 text-muted-foreground" />
            Branches and worktrees
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div
            className="px-2 py-1.5"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              Project color
            </div>
            <div className="grid grid-cols-7 gap-1">
              {PROJECT_COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="h-5 w-5 rounded-full border border-foreground/15 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  style={{
                    backgroundColor: color,
                    boxShadow:
                      normalizeHexColor(projectColor) === color
                        ? `0 0 0 2px ${rgbaFromHex(color, 0.75)}`
                        : undefined,
                  }}
                  onClick={() => onChangeProjectColor?.(lifecycleTarget.id, color)}
                  aria-label={`Set project color ${color}`}
                />
              ))}
              <label
                className="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-foreground/20 bg-background text-[10px] text-muted-foreground hover:text-foreground"
                title="Custom color"
              >
                <input
                  type="color"
                  value={normalizeHexColor(projectColor)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  onChange={(event) =>
                    onChangeProjectColor?.(lifecycleTarget.id, event.target.value)
                  }
                />
                +
              </label>
            </div>
          </div>
          <DropdownMenuSeparator />
        </>
      )}
      {lifecycleTarget.type === "task" && (
        <>
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => onCreateTaskChat?.(lifecycleTarget.id)}
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-muted-foreground" />
            New chat
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2" onSelect={() => setStartAgentDialogOpen(true)}>
            <Network className="h-3.5 w-3.5 text-muted-foreground" />
            Start named agent
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem
        className="gap-2"
        onSelect={() =>
          onToggleLifecyclePin(lifecycleTarget.type, lifecycleTarget.id, lifecycleTarget.isPinned)
        }
        disabled={lifecyclePending}
      >
        <Pin className="h-3.5 w-3.5 text-muted-foreground" />
        {lifecycleTarget.isPinned ? "Unpin" : "Pin"}
      </DropdownMenuItem>
      <DropdownMenuItem
        className="gap-2"
        onSelect={() => onToggleLifecycleStar(lifecycleTarget.type, lifecycleTarget.id)}
      >
        <Star className="h-3.5 w-3.5 text-muted-foreground" />
        {lifecycleTarget.isStarred ? "Unstar" : "Star"}
      </DropdownMenuItem>
      <DropdownMenuItem
        className="gap-2"
        onSelect={() => onArchiveLifecycle(lifecycleTarget.type, lifecycleTarget.id)}
        disabled={lifecyclePending}
      >
        <ArchiveIcon className="h-3.5 w-3.5 text-muted-foreground" />
        Archive
      </DropdownMenuItem>
    </>
  ) : null

  const contextLifecycleMenu = lifecycleTarget ? (
    <>
      {lifecycleTarget.type === "project" && (
        <>
          <ContextMenuItem
            className="gap-2"
            onClick={() => onCreateProjectChat?.(lifecycleTarget.id)}
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-muted-foreground" />
            New chat
          </ContextMenuItem>
          {planningEnabled && (
            <ContextMenuItem
              className="gap-2"
              onClick={() => onCreateProjectTask?.(lifecycleTarget.id)}
            >
              <ListPlus className="h-3.5 w-3.5 text-muted-foreground" />
              New task
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="gap-2"
            onClick={() => onOpenRepositoryOverview?.(lifecycleTarget.id)}
          >
            <Trees className="h-3.5 w-3.5 text-muted-foreground" />
            Branches and worktrees
          </ContextMenuItem>
          <ContextMenuSeparator />
          <div
            className="px-2 py-1.5"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              Project color
            </div>
            <div className="grid grid-cols-7 gap-1">
              {PROJECT_COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="h-5 w-5 rounded-full border border-foreground/15 transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  style={{
                    backgroundColor: color,
                    boxShadow:
                      normalizeHexColor(projectColor) === color
                        ? `0 0 0 2px ${rgbaFromHex(color, 0.75)}`
                        : undefined,
                  }}
                  onClick={() => onChangeProjectColor?.(lifecycleTarget.id, color)}
                  aria-label={`Set project color ${color}`}
                />
              ))}
              <label
                className="relative flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-foreground/20 bg-background text-[10px] text-muted-foreground hover:text-foreground"
                title="Custom color"
              >
                <input
                  type="color"
                  value={normalizeHexColor(projectColor)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  onChange={(event) =>
                    onChangeProjectColor?.(lifecycleTarget.id, event.target.value)
                  }
                />
                +
              </label>
            </div>
          </div>
          <ContextMenuSeparator />
        </>
      )}
      {lifecycleTarget.type === "task" && (
        <>
          <ContextMenuItem className="gap-2" onClick={() => onCreateTaskChat?.(lifecycleTarget.id)}>
            <MessageSquarePlus className="h-3.5 w-3.5 text-muted-foreground" />
            New chat
          </ContextMenuItem>
          <ContextMenuItem className="gap-2" onClick={() => setStartAgentDialogOpen(true)}>
            <Network className="h-3.5 w-3.5 text-muted-foreground" />
            Start named agent
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem
        className="gap-2"
        onClick={() =>
          onToggleLifecyclePin(lifecycleTarget.type, lifecycleTarget.id, lifecycleTarget.isPinned)
        }
        disabled={lifecyclePending}
      >
        <Pin className="h-3.5 w-3.5 text-muted-foreground" />
        {lifecycleTarget.isPinned ? "Unpin" : "Pin"}
      </ContextMenuItem>
      <ContextMenuItem
        className="gap-2"
        onClick={() => onToggleLifecycleStar(lifecycleTarget.type, lifecycleTarget.id)}
      >
        <Star className="h-3.5 w-3.5 text-muted-foreground" />
        {lifecycleTarget.isStarred ? "Unstar" : "Star"}
      </ContextMenuItem>
      <ContextMenuItem
        className="gap-2"
        onClick={() => onArchiveLifecycle(lifecycleTarget.type, lifecycleTarget.id)}
        disabled={lifecyclePending}
      >
        <ArchiveIcon className="h-3.5 w-3.5 text-muted-foreground" />
        Archive
      </ContextMenuItem>
    </>
  ) : null

  return (
    <>
      {lifecycleTarget?.type === "task" && (
        <StartAgentDialog
          open={startAgentDialogOpen}
          onOpenChange={setStartAgentDialogOpen}
          source={{ kind: "task", taskId: lifecycleTarget.id }}
          projectId={parentProjectId ?? null}
        />
      )}
      {showBeforeSectionDrop && effectiveSectionDragId && (
        <DropSeparator
          className={sectionDropSeparatorClass}
          onDragEnter={handleSeparatorDragEnter}
          onDragOver={(event) =>
            handleSeparatorDragOver(event, sectionDragKind, effectiveSectionDragId, "before")
          }
          onDrop={(event) =>
            handleSeparatorDrop(event, sectionDragKind, effectiveSectionDragId, "before")
          }
        />
      )}
      <div
        data-sidebar-task-group-id={
          isTaskSection && lifecycleTarget?.type === "task" ? lifecycleTarget.id : undefined
        }
        className={cn(
          isTaskSection ? "relative ml-6 rounded-md pt-1" : "contents",
          highlightWholeTaskEdgeDrop &&
            "bg-primary/[0.025] ring-2 ring-inset ring-primary/60 shadow-sm",
        )}
      >
        {!hideHeader && (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                data-sidebar-drag-source
                data-sidebar-drag-target-kind={sectionDragKind}
                data-sidebar-drag-target-id={effectiveSectionDragId}
                data-sidebar-drop-container={Boolean(lifecycleTarget)}
                data-sidebar-task-header={isTaskSection || undefined}
                data-sidebar-task-header-split={
                  (isTaskSection && (isCollapsed || chats.length === 0)) || undefined
                }
                onPointerDown={handleSectionPointerDragStart}
                onClick={handleHeaderClick}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  handleHeaderClick()
                }}
                role={canCollapse || getHeaderScope() ? "button" : undefined}
                tabIndex={canCollapse || getHeaderScope() ? 0 : undefined}
                className={cn(
                  "group group/disclosure group/section relative flex items-center gap-1",
                  "transition-[background-color,box-shadow,filter,opacity,transform] duration-150 ease-out",
                  isTaskSection
                    ? "h-7 mb-0.5 rounded-md pl-2 pr-1"
                    : isProjectSection
                      ? "h-7 mt-0.5 mb-0 rounded-md pl-2 pr-1"
                      : isTopLevelScopedSection || isReferenceSection
                        ? "h-7 mt-1 mb-0.5 rounded-md pl-2 pr-1"
                        : "h-5 mb-0.5",
                  isTaskSection
                    ? isMultiSelectMode
                      ? "pr-3"
                      : ""
                    : isTopLevelScopedSection || isReferenceSection
                      ? ""
                      : isMultiSelectMode
                        ? "pl-3 pr-3"
                        : "pl-2 pr-1",
                  Boolean(lifecycleTarget) &&
                    !isMultiSelectMode &&
                    "cursor-grab active:cursor-grabbing",
                  (canCollapse || getHeaderScope()) && "cursor-pointer",
                  isDragOverSection &&
                    !highlightWholeTaskEdgeDrop &&
                    "brightness-110 ring-1 ring-primary/30 shadow-sm",
                  isDraggingSection && "scale-[0.985] opacity-55 shadow-sm ring-1 ring-primary/25",
                )}
                style={sectionStyle}
              >
                {isMoveIntoSection && (
                  <span className="pointer-events-none absolute right-2 top-1/2 z-20 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                )}
                <div
                  className={cn(
                    "pointer-events-none flex min-w-0 flex-1 items-center gap-1.5 text-left",
                    canCollapse ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  {headerIcon}
                  {lifecycleTarget?.isPinned && (
                    <Pin className="h-3 w-3 flex-shrink-0 text-sky-400" />
                  )}
                  {lifecycleTarget?.isStarred && (
                    <Star className="h-3 w-3 flex-shrink-0 fill-amber-400 text-amber-400" />
                  )}
                  <h3
                    className={cn(
                      "whitespace-nowrap truncate flex-1",
                      isTopLevelScopedSection || isTaskSection || isReferenceSection
                        ? cn(
                            "text-[11px] font-semibold tracking-wide text-white",
                            !isProjectSection && "uppercase",
                          )
                        : "text-xs font-medium text-muted-foreground",
                    )}
                  >
                    {title}
                  </h3>
                </div>
                {canCollapse && (
                  <SidebarDisclosure
                    isCollapsed={isCollapsed}
                    className={cn(
                      isTopLevelScopedSection || isTaskSection || isReferenceSection
                        ? "text-white/80"
                        : "text-muted-foreground",
                    )}
                  />
                )}
                {(lifecycleTarget || isGlobalSection) && !isMultiSelectMode && (
                  <button
                    type="button"
                    data-section-action
                    onClick={(event) => {
                      event.stopPropagation()
                      if (isGlobalSection) {
                        onCreateGlobalChat?.()
                      } else if (lifecycleTarget?.type === "project") {
                        // Ctrl/Cmd+click creates a task instead of a chat
                        if (event.ctrlKey || event.metaKey) {
                          onCreateProjectTask?.(lifecycleTarget.id)
                        } else {
                          onCreateProjectChat?.(lifecycleTarget.id)
                        }
                      } else {
                        onCreateTaskChat?.(lifecycleTarget!.id)
                      }
                    }}
                    onContextMenu={(event) => {
                      // macOS turns Ctrl+click into a contextmenu event instead of a click
                      if (lifecycleTarget?.type === "project" && event.ctrlKey) {
                        event.preventDefault()
                        event.stopPropagation()
                        onCreateProjectTask?.(lifecycleTarget.id)
                      }
                    }}
                    className={cn(
                      "absolute top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm opacity-0 transition-[opacity,background-color,color,transform] duration-150 ease-out active:scale-[0.97] group-hover/section:opacity-100 focus-visible:opacity-100 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
                      lifecycleTarget ? "right-1" : "right-6",
                      isTopLevelScopedSection || isTaskSection
                        ? "text-white/75 hover:bg-white/10 hover:text-white"
                        : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                      isAnyDragActive && "!opacity-0 pointer-events-none",
                      "group-data-[pointer-drag-source=true]/section:!opacity-0",
                      "group-data-[pressing=true]/sidebar:!opacity-0 group-data-[pressing=true]/sidebar:pointer-events-none",
                    )}
                    aria-label={
                      isGlobalSection
                        ? "New global chat"
                        : lifecycleTarget?.type === "project"
                          ? "New project chat (Ctrl/Cmd+click: new task)"
                          : "New task chat"
                    }
                    title={
                      lifecycleTarget?.type === "project"
                        ? "New chat · Ctrl/Cmd+click for new task"
                        : undefined
                    }
                  >
                    {lifecycleTarget?.type === "project" ? (
                      <SquarePen className="h-3.5 w-3.5" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
                {(lifecycleTarget || isGlobalSection) && !isMultiSelectMode && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        data-section-action
                        onClick={(event) => event.stopPropagation()}
                        className={cn(
                          "absolute top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm opacity-0 transition-[opacity,background-color,color,transform] duration-150 ease-out active:scale-[0.97] group-hover/section:opacity-100 data-[state=open]:opacity-100 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
                          lifecycleTarget ? "right-6" : "right-1",
                          isTopLevelScopedSection || isTaskSection
                            ? "text-white/75 hover:bg-white/10 hover:text-white"
                            : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
                          isAnyDragActive && "!opacity-0 pointer-events-none",
                          "group-data-[pointer-drag-source=true]/section:!opacity-0",
                          "group-data-[pressing=true]/sidebar:!opacity-0 group-data-[pressing=true]/sidebar:pointer-events-none",
                        )}
                        aria-label={
                          isGlobalSection
                            ? "Global chat actions"
                            : `${lifecycleTarget!.type} actions`
                        }
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52" sideOffset={4}>
                      {isGlobalSection ? (
                        <DropdownMenuItem className="gap-2" onSelect={onCreateGlobalChat}>
                          <MessageSquarePlus className="h-3.5 w-3.5 text-muted-foreground" />
                          New chat
                        </DropdownMenuItem>
                      ) : (
                        dropdownLifecycleMenu
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </ContextMenuTrigger>
            {lifecycleTarget && (
              <ContextMenuContent className="w-52">{contextLifecycleMenu}</ContextMenuContent>
            )}
          </ContextMenu>
        )}
        {!isCollapsed && showEmptyState && (
          <div
            data-sidebar-empty-state="chats"
            className="mb-0.5 ml-9 flex h-7 items-center text-xs text-muted-foreground/60"
          >
            No chats
          </div>
        )}
        {!isCollapsed && chats.length > 0 && (
          <div
            className={cn(
              "list-none p-0 m-0",
              isTaskSection
                ? "mb-1 ml-3 pl-2"
                : isProjectSection
                  ? "mb-0.5 ml-4 pl-2"
                  : isTopLevelScopedSection || isReferenceSection
                    ? "mb-1 ml-4 pl-2"
                    : "mb-2",
            )}
          >
            {chats.map((chat) => {
              const itemChatTint =
                isReferenceSection && chat.projectId
                  ? getProjectTint(projectColorsById?.[chat.projectId] ?? DEFAULT_PROJECT_COLOR)[
                      chat.taskId ? "taskChat" : "chat"
                    ]
                  : chatTint
              const isLoading = loadingChatIds.has(chat.id)
              // For remote chats, compare without prefix; for local, compare directly
              // Remote chat IDs in list have "remote_" prefix, but selectedChatId is the original ID
              const chatOriginalId = chat.isRemote ? chat.id.replace(/^remote_/, "") : chat.id
              const isSelected =
                selectedChatId === chatOriginalId && selectedChatIsRemote === chat.isRemote
              const isPinned = pinnedChatIds.has(chat.id)
              const globalIndex = globalIndexMap.get(chat.id) ?? -1
              const isFocused = focusedChatIndex === globalIndex && focusedChatIndex >= 0

              // For remote chats, get repo info from meta; for local, from projectsMap
              const project = chat.projectId ? projectsMap.get(chat.projectId) : null
              const repoName = chat.isRemote
                ? chat.meta?.repository
                : project?.gitRepo || project?.name
              const displayText = chat.isRemote ? chat.meta?.repository || "Remote project" : ""

              const isChecked = selectedChatIds.has(chat.id)
              // Local-first: only cheap local workspace stats are shown. Remote
              // chats intentionally have no stats (remote stat computation was
              // removed - it caused 50s+ sidebar loads).
              const stats = chat.isRemote ? null : workspaceFileStats.get(chat.id)
              const hasPendingPlan = workspacePendingPlans.has(chat.id)
              const hasPendingQuestion = workspacePendingQuestions.has(chat.id)
              const isLastInFilteredChats = globalIndex === filteredChats.length - 1
              const isLastInSection = chat.id === chats.at(-1)?.id
              const isJustCreated = justCreatedIds.has(chat.id)
              const isStarred = starredChatIds.has(chat.id)
              const worktreeLabel = getNonMainWorktreeLabel({
                projectPath: project?.path,
                worktreePath: chat.worktreePath,
              })
              const hasCustomWorktree = worktreeLabel !== null
              const itemDragId = hideHeader ? (sectionDragId ?? chat.id) : chat.id
              const showBeforeChatDrop =
                !usesSectionDropSeparator &&
                dragOverKind === chatDragKind &&
                dragOverId === itemDragId &&
                dragOverPosition === "before"
              const showAfterChatDrop =
                !usesSectionDropSeparator &&
                dragOverKind === chatDragKind &&
                dragOverId === itemDragId &&
                dragOverPosition === "after"

              return (
                <React.Fragment key={chat.id}>
                  {showBeforeChatDrop && (
                    <DropSeparator
                      onDragEnter={handleSeparatorDragEnter}
                      onDragOver={(event) =>
                        handleSeparatorDragOver(event, chatDragKind, itemDragId, "before")
                      }
                      onDrop={(event) =>
                        handleSeparatorDrop(event, chatDragKind, itemDragId, "before")
                      }
                    />
                  )}
                  <AgentChatItem
                    key={chat.id}
                    chatId={chat.id}
                    chatName={chat.name}
                    chatBranch={chat.branch}
                    chatUpdatedAt={chat.updatedAt}
                    chatProjectId={chat.projectId ?? ""}
                    chatTaskId={chat.taskId}
                    parentChatId={chat.parentChatId}
                    chatScope={chat.scope}
                    chatTags={chat.tags ?? []}
                    globalIndex={globalIndex}
                    isSelected={isSelected}
                    isLoading={isLoading}
                    hasUnseenChanges={unseenChanges.has(chat.id)}
                    hasPendingPlan={hasPendingPlan}
                    hasPendingQuestion={hasPendingQuestion}
                    isMultiSelectMode={isMultiSelectMode}
                    isChecked={isChecked}
                    isFocused={isFocused}
                    isMobileFullscreen={isMobileFullscreen}
                    isDesktop={isDesktop}
                    isPinned={isPinned}
                    isStarred={isStarred}
                    isInWorkbenchGroup={groupedChatIds.has(chatOriginalId)}
                    harness={chat.harness}
                    model={chat.model}
                    hasCustomWorktree={hasCustomWorktree}
                    worktreeLabel={worktreeLabel}
                    displayText={displayText}
                    stats={stats ?? undefined}
                    selectedChatIdsSize={selectedChatIds.size}
                    canShowPinOption={canShowPinOption}
                    areAllSelectedPinned={areAllSelectedPinned}
                    filteredChatsLength={filteredChats.length}
                    isLastInFilteredChats={isLastInFilteredChats}
                    showIcon={showIcon}
                    onChatClick={onChatClick}
                    onCheckboxClick={onCheckboxClick}
                    onMouseEnter={onMouseEnter}
                    onMouseLeave={onMouseLeave}
                    onArchive={onArchive}
                    onTogglePin={onTogglePin}
                    onToggleStar={onToggleStar}
                    onRenameClick={onRenameClick}
                    onCopyBranch={onCopyBranch}
                    onArchiveAllBelow={onArchiveAllBelow}
                    onArchiveOthers={onArchiveOthers}
                    onOpenLocally={onOpenLocally}
                    moveDestinations={moveDestinations}
                    movePending={movePending}
                    onMoveChat={onMoveChat}
                    onBulkPin={onBulkPin}
                    onBulkUnpin={onBulkUnpin}
                    onBulkArchive={onBulkArchive}
                    archivePending={archivePending}
                    archiveBatchPending={archiveBatchPending}
                    isRemote={chat.isRemote}
                    nameRefCallback={nameRefCallback}
                    formatTime={formatTime}
                    isJustCreated={isJustCreated}
                    dragKind={chatDragKind}
                    dragItemId={hideHeader ? sectionDragId : undefined}
                    taskEndTargetId={
                      isTaskSection && isLastInSection && lifecycleTarget?.type === "task"
                        ? lifecycleTarget.id
                        : undefined
                    }
                    isOnlyTaskChat={isTaskSection && chats.length === 1}
                    tintColor={itemChatTint}
                    isDragging={draggingKind === chatDragKind && draggingId === itemDragId}
                    isDragOver={dragOverKind === chatDragKind && dragOverId === itemDragId}
                    isBoundaryHighlighted={
                      (!isTaskSection && isSectionBoundaryHighlighted) ||
                      chatBoundaryHighlightIds.has(chat.id)
                    }
                    dragOverPosition={
                      dragOverKind === chatDragKind && dragOverId === itemDragId
                        ? dragOverPosition
                        : null
                    }
                    onDragStartItem={onDragStartItem}
                    onDragOverItem={onDragOverItem}
                    onDropItem={onDropItem}
                    onDragEndItem={onDragEndItem}
                  />
                  {showAfterChatDrop && (
                    <DropSeparator
                      onDragEnter={handleSeparatorDragEnter}
                      onDragOver={(event) =>
                        handleSeparatorDragOver(event, chatDragKind, itemDragId, "after")
                      }
                      onDrop={(event) =>
                        handleSeparatorDrop(event, chatDragKind, itemDragId, "after")
                      }
                    />
                  )}
                </React.Fragment>
              )
            })}
          </div>
        )}
      </div>
      {showAfterSectionDrop && effectiveSectionDragId && (
        <DropSeparator
          className={sectionDropSeparatorClass}
          onDragEnter={handleSeparatorDragEnter}
          onDragOver={(event) =>
            handleSeparatorDragOver(event, sectionDragKind, effectiveSectionDragId, "after")
          }
          onDrop={(event) =>
            handleSeparatorDrop(event, sectionDragKind, effectiveSectionDragId, "after")
          }
        />
      )}
    </>
  )
}, chatListSectionPropsAreEqual)

interface AgentsSidebarProps {
  userId?: string | null | undefined
  clerkUser?: any
  desktopUser?: { id: string; email: string; name?: string } | null
  onSignOut?: () => void
  onToggleSidebar?: () => void
  isMobileFullscreen?: boolean
  onChatSelect?: () => void
}

// Isolated macOS sidebar header for native traffic lights
interface SidebarHeaderProps {
  isDesktop: boolean
  isFullscreen: boolean | null
}

const SidebarHeader = memo(function SidebarHeader({ isDesktop, isFullscreen }: SidebarHeaderProps) {
  return (
    <div className="relative flex-shrink-0">
      {/* Draggable area for window movement - background layer (hidden in fullscreen) */}
      {isDesktop && !isFullscreen && (
        <div
          className="absolute inset-x-0 top-0 h-[32px] z-0"
          style={{
            // @ts-expect-error - WebKit-specific property
            WebkitAppRegion: "drag",
          }}
          data-sidebar-content
        />
      )}

      {/* No-drag zone over native traffic lights */}
      <TrafficLights
        isFullscreen={isFullscreen}
        isDesktop={isDesktop}
        className="absolute left-[15px] top-[12px] z-20"
      />

      {/* Spacer for macOS traffic lights */}
      <TrafficLightSpacer isFullscreen={isFullscreen} isDesktop={isDesktop} />
    </div>
  )
})

const SidebarGroupHeader = memo(function SidebarGroupHeader({
  title,
  icon: Icon,
  isCollapsed,
  onToggle,
  actions,
  className,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  isCollapsed: boolean
  onToggle: () => void
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "group group/disclosure group/header relative flex h-7 w-full items-center gap-1 rounded-lg px-1 text-muted-foreground transition-colors hover:bg-foreground/5",
        !isCollapsed && "mb-2",
        className,
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 w-full items-center gap-2 rounded-lg px-1 text-left"
        aria-expanded={!isCollapsed}
      >
        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="truncate text-xs font-medium">{title}</span>
        <SidebarDisclosure isCollapsed={isCollapsed} className="mr-12" />
      </button>
      {actions && (
        <div className="pointer-events-none absolute right-1 top-1/2 flex w-10 -translate-y-1/2 items-center justify-end opacity-0 transition-opacity group-hover/header:pointer-events-auto group-hover/header:opacity-100">
          {actions}
        </div>
      )}
      <AnimatePresence>{!isCollapsed && <ExpandedSectionIndicator />}</AnimatePresence>
    </div>
  )
})

// Isolated Help Section - subscribes to agentsHelpPopoverOpenAtom internally
// to prevent sidebar re-renders when popover opens/closes
interface HelpSectionProps {
  isMobile: boolean
}

const HelpSection = memo(function HelpSection({ isMobile }: HelpSectionProps) {
  const [helpPopoverOpen, setHelpPopoverOpen] = useAtom(agentsHelpPopoverOpenAtom)
  const [blockHelpTooltip, setBlockHelpTooltip] = useState(false)
  const prevHelpPopoverOpen = useRef(false)
  const helpButtonRef = useRef<HTMLButtonElement>(null)

  // Handle tooltip blocking when popover closes
  useEffect(() => {
    if (prevHelpPopoverOpen.current && !helpPopoverOpen) {
      helpButtonRef.current?.blur()
      setBlockHelpTooltip(true)
      const timer = setTimeout(() => setBlockHelpTooltip(false), 300)
      prevHelpPopoverOpen.current = helpPopoverOpen
      return () => clearTimeout(timer)
    }
    prevHelpPopoverOpen.current = helpPopoverOpen
  }, [helpPopoverOpen])

  return (
    <Tooltip delayDuration={500} open={helpPopoverOpen || blockHelpTooltip ? false : undefined}>
      <TooltipTrigger asChild>
        <div>
          <AgentsHelpPopover
            open={helpPopoverOpen}
            onOpenChange={setHelpPopoverOpen}
            isMobile={isMobile}
          >
            <button
              ref={helpButtonRef}
              type="button"
              className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
              suppressHydrationWarning
            >
              <QuestionCircleIcon className="h-4 w-4" />
            </button>
          </AgentsHelpPopover>
        </div>
      </TooltipTrigger>
      <TooltipContent>Help</TooltipContent>
    </Tooltip>
  )
})

export function AgentsSidebar({
  clerkUser = null,
  onToggleSidebar,
  isMobileFullscreen = false,
  onChatSelect,
}: AgentsSidebarProps) {
  const stableWindowId = useMemo(() => getWindowId(), [])
  const [groupedChatIds, setGroupedChatIds] = useState(() =>
    getGroupedChatIds(
      parseChatWorkbenchNavigation(
        localStorage.getItem(chatWorkbenchNavigationStorageKey(stableWindowId)),
      ),
    ),
  )
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const openChatIds = useAtomValue(openAgentChatIdsAtom)
  const [selectedChatIsRemote, setSelectedChatIsRemote] = useAtom(selectedChatIsRemoteAtom)
  const focusScopedSearchResult = useSetAtom(focusScopedSearchResultAtom)
  const previousChatId = useAtomValue(previousAgentChatIdAtom)
  const autoAdvanceTarget = useAtomValue(autoAdvanceTargetAtom)
  const [selectedDraftId, setSelectedDraftId] = useAtom(selectedDraftIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const startNewChatFormSession = useSetAtom(newChatFormSessionAtom)
  const [newChatDraftReminderEnabled, setNewChatDraftReminderEnabled] = useAtom(
    newChatDraftReminderEnabledAtom,
  )
  const desktopView = useAtomValue(desktopViewAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const [loadingSubChats] = useAtom(loadingSubChatsAtom)
  const pendingQuestions = useAtomValue(pendingUserQuestionsAtom)
  const betaFeatures = useBetaFeatures()
  const featureVisibility = useFeatureVisibility()
  const [searchQuery, setSearchQuery] = useState("")
  const [repositoryOverviewProjectId, setRepositoryOverviewProjectId] = useState<string | null>(
    null,
  )
  const [isSearchFocused, setIsSearchFocused] = useState(false)
  const [isArchiveOpen, setIsArchiveOpen] = useState(false)
  const [archiveSearchQuery, setArchiveSearchQuery] = useState("")
  const [isArchiveSelectMode, setIsArchiveSelectMode] = useState(false)
  const [selectedArchivedChatIds, setSelectedArchivedChatIds] = useState<Set<string>>(new Set())
  const [focusedChatIndex, setFocusedChatIndex] = useState<number>(-1) // -1 means no focus
  const hoveredChatIndexRef = useRef<number>(-1) // Track hovered chat for X hotkey - ref to avoid re-renders

  useEffect(() => {
    const handleNavigationChange = (event: Event) => {
      const navigation = (event as CustomEvent<ChatWorkbenchNavigation>).detail
      setGroupedChatIds(getGroupedChatIds(navigation))
    }
    window.addEventListener(CHAT_WORKBENCH_NAVIGATION_CHANGE_EVENT, handleNavigationChange)
    return () =>
      window.removeEventListener(CHAT_WORKBENCH_NAVIGATION_CHANGE_EVENT, handleNavigationChange)
  }, [])

  // Global desktop/fullscreen state from atoms (initialized in AgentsLayout)
  const isDesktop = useAtomValue(isDesktopAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)

  // Multi-select state
  const [selectedChatIds, setSelectedChatIds] = useAtom(selectedAgentChatIdsAtom)
  const isMultiSelectMode = useAtomValue(isAgentMultiSelectModeAtom)
  const selectedChatsCount = useAtomValue(selectedAgentChatsCountAtom)
  const toggleChatSelection = useSetAtom(toggleAgentChatSelectionAtom)
  const selectAllChats = useSetAtom(selectAllAgentChatsAtom)
  const clearChatSelection = useSetAtom(clearAgentChatSelectionAtom)

  // Scroll gradient refs - use DOM manipulation to avoid re-renders
  const topGradientRef = useRef<HTMLDivElement>(null)
  const bottomGradientRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Multiple drafts state - uses event-based sync instead of polling
  const drafts = useNewChatDrafts()
  const remindAboutProjectDrafts = useCallback(
    (project: { id: string; name: string }) => {
      if (!newChatDraftReminderEnabled) return
      window.setTimeout(() => {
        const draftCount = countVisibleNewChatDraftsForProject(project.id)
        if (draftCount === 0) return

        toast.info(`${draftCount} unsent draft${draftCount === 1 ? "" : "s"} for ${project.name}`, {
          description: "They remain available in Quick access > Drafts.",
          action: {
            label: "Don't remind me",
            onClick: () => setNewChatDraftReminderEnabled(false),
          },
        })
      }, 0)
    },
    [newChatDraftReminderEnabled, setNewChatDraftReminderEnabled],
  )

  // Read unseen changes from global atoms
  const unseenChanges = useAtomValue(agentsUnseenChangesAtom)
  const justCreatedIds = useAtomValue(justCreatedIdsAtom)

  // Haptic feedback
  const { trigger: triggerHaptic } = useHaptic()

  // Resolved hotkeys for tooltips
  const { primary: newWorkspaceHotkey } = useResolvedHotkeyDisplayWithAlt("new-workspace")
  const settingsHotkey = useResolvedHotkeyDisplay("open-settings")

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renamingChat, setRenamingChat] = useState<{
    id: string
    name: string
    isRemote?: boolean
  } | null>(null)
  const [renameLoading, setRenameLoading] = useState(false)
  const [newTaskProject, setNewTaskProject] = useState<{
    id: string
    name: string
  } | null>(null)

  // Confirm archive dialog state
  const [confirmArchiveDialogOpen, setConfirmArchiveDialogOpen] = useState(false)
  const [archivingChatId, setArchivingChatId] = useState<string | null>(null)
  const [activeProcessCount, setActiveProcessCount] = useState(0)

  // Import sandbox dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importingChatId, setImportingChatId] = useState<string | null>(null)

  // Track initial mount to skip footer animation on load
  const hasFooterAnimated = useRef(false)

  // Remote pinned chats stay local because sandbox chats are not backed by the local DB.
  const [remotePinnedChatIds, setRemotePinnedChatIds] = useState<Set<string>>(new Set())
  const [starredChatIds, setStarredChatIds] = useState<Set<string>>(new Set())
  const [starredProjectIds, setStarredProjectIds] = useState<Set<string>>(new Set())
  const [starredTaskIds, setStarredTaskIds] = useState<Set<string>>(new Set())
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set())
  const [hiddenNavigationItems, setHiddenNavigationItems] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("flapstack-sidebar-hidden-navigation-items")
      return stored ? new Set<string>(JSON.parse(stored) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })
  const [manualOrderByKey, setManualOrderByKey] = useState<Record<string, string[]>>({})
  const [projectColorsById, setProjectColorsById] = useState<Record<string, string>>(() => {
    try {
      const storedProjectColors = localStorage.getItem("flapstack-sidebar-project-colors")
      return storedProjectColors ? JSON.parse(storedProjectColors) : {}
    } catch {
      return {}
    }
  })
  const [manualProjectColorIds, setManualProjectColorIds] = useState<Set<string>>(() => {
    try {
      const storedManualProjectColorIds = localStorage.getItem(
        "flapstack-sidebar-manual-project-colors",
      )
      return storedManualProjectColorIds
        ? new Set<string>(JSON.parse(storedManualProjectColorIds) as string[])
        : new Set()
    } catch {
      return new Set()
    }
  })
  const crossScopeMoveEnabled = useAtomValue(crossScopeMoveEnabledAtom)
  const [draggingItem, setDraggingItem] = useState<{ kind: string; id: string } | null>(null)
  // True while the mouse is pressed in the sidebar (but not on a header action
  // button). Used to hide the section header "+"/"⋯" buttons the instant a drag
  // gesture begins, before dragstart fires - otherwise the header's hover "+"
  // flashes as the pointer crosses it at the start of a drag.
  const [isSidebarPressed, setIsSidebarPressed] = useState(false)
  const [dragOverItem, setDragOverItem] = useState<{
    kind: string
    id: string
    position: SidebarDropPosition
  } | null>(null)
  const draggingItemRef = useRef<{ kind: string; id: string } | null>(null)
  const dragOverItemRef = useRef<{
    kind: string
    id: string
    position: SidebarDropPosition
  } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Agent name tooltip refs (for truncated names) - using DOM manipulation to avoid re-renders
  const agentTooltipRef = useRef<HTMLDivElement>(null)
  const nameRefs = useRef<Map<string, HTMLSpanElement>>(new Map())
  const agentTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const setDesktopViewForSettings = useSetAtom(desktopViewAtom)
  const setSidebarOpenForSettings = useSetAtom(agentsSidebarOpenAtom)
  // Navigate to settings page instead of opening a dialog
  const setSettingsDialogOpen = useCallback(
    (open: boolean) => {
      if (open) {
        setDesktopViewForSettings("settings")
        setSidebarOpenForSettings(true)
      } else {
        setDesktopViewForSettings(null)
      }
    },
    [setDesktopViewForSettings, setSidebarOpenForSettings],
  )
  const setCreateTeamDialogOpen = useSetAtom(createTeamDialogOpenAtom)

  // Debug mode for testing first-time user experience
  const debugMode = useAtomValue(agentsDebugModeAtom)

  // Sidebar appearance settings
  const showWorkspaceIcon = useAtomValue(showWorkspaceIconAtom)

  // Desktop: use selectedProject instead of teams
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const setSelectedChatScope = useSetAtom(selectedChatScopeAtom)

  // Keep chatSourceModeAtom for backwards compatibility (used in other places)
  const [chatSourceMode, setChatSourceMode] = useAtom(chatSourceModeAtom)
  const teamId = useAtomValue(selectedTeamIdAtom)

  // Sync chatSourceMode with selectedChatIsRemote on startup
  // This fixes the race condition where atoms load independently from localStorage
  const hasRunStartupSync = useRef(false)
  useEffect(() => {
    if (hasRunStartupSync.current) return
    hasRunStartupSync.current = true

    const correctMode = selectedChatIsRemote ? "sandbox" : "local"
    if (chatSourceMode !== correctMode) {
      setChatSourceMode(correctMode)
    }
  }, [])

  // Fetch all local chats (no project filter)
  const { data: localChats } = trpc.chats.list.useQuery({})
  const { data: tagAssignments = [] } = trpc.chats.listTagAssignments.useQuery()
  const chatTagsByChat = useMemo(() => {
    const result = new Map<string, ChatTagView[]>()
    for (const assignment of tagAssignments) {
      const tags = result.get(assignment.chatId) ?? []
      tags.push(assignment.tag)
      result.set(assignment.chatId, tags)
    }
    return result
  }, [tagAssignments])
  const { data: automationInbox } = trpc.automations.inbox.useQuery(
    { unreadOnly: true, limit: 1 },
    { refetchInterval: 5_000, enabled: betaFeatures.automations },
  )

  // Fetch user's teams (same as web) - always enabled to allow merged list
  const { data: teams, isLoading: isTeamsLoading, isError: isTeamsError } = useUserTeams(true)

  // Fetch remote sandbox chats (same as web) - requires teamId
  const { data: remoteChats } = useRemoteChats()

  // Prefetch individual chat data on hover
  const prefetchRemoteChat = usePrefetchRemoteChat()
  const prefetchLocalChat = usePrefetchLocalChat()
  const ENABLE_CHAT_HOVER_PREFETCH = false

  // Merge local and remote chats into unified list
  const agentChats = useMemo(() => {
    const unified: Array<{
      id: string
      name: string | null
      createdAt: Date | null
      updatedAt: Date | null
      archivedAt: Date | null
      projectId: string | null
      taskId: string | null
      parentChatId: string | null
      scope?: "global" | "project" | "task" | null
      harness?: string | null
      model?: string | null
      worktreePath: string | null
      branch: string | null
      baseBranch: string | null
      prUrl: string | null
      prNumber: number | null
      sandboxId?: string | null
      meta?: { repository?: string; branch?: string | null } | null
      isRemote: boolean
      pinnedAt?: Date | null
      tags: ChatTagView[]
    }> = []

    // Add local chats
    if (localChats) {
      for (const chat of localChats) {
        unified.push({
          id: chat.id,
          name: chat.name,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          archivedAt: chat.archivedAt,
          projectId: chat.projectId,
          taskId: chat.taskId,
          parentChatId: chat.parentChatId,
          scope: chat.scope as "global" | "project" | "task" | null,
          harness: chat.harness,
          model: chat.model,
          worktreePath: chat.worktreePath,
          branch: chat.branch,
          baseBranch: chat.baseBranch,
          prUrl: chat.prUrl,
          prNumber: chat.prNumber,
          pinnedAt: chat.pinnedAt,
          tags: chatTagsByChat.get(chat.id) ?? [],
          isRemote: false,
        })
      }
    }

    // Add remote chats with prefixed IDs to avoid collisions
    if (remoteChats) {
      for (const chat of remoteChats) {
        unified.push({
          id: `remote_${chat.id}`,
          name: chat.name,
          createdAt: new Date(chat.created_at),
          updatedAt: new Date(chat.updated_at),
          archivedAt: null,
          projectId: null,
          taskId: null,
          parentChatId: null,
          scope: null,
          harness: null,
          model: null,
          worktreePath: null,
          branch: chat.meta?.branch ?? null,
          baseBranch: null,
          prUrl: null,
          prNumber: null,
          sandboxId: chat.sandbox_id,
          meta: chat.meta,
          isRemote: true,
          pinnedAt: null,
          tags: [],
        })
      }
    }

    // Sort by updatedAt descending (newest first)
    unified.sort((a, b) => {
      const aTime = a.updatedAt?.getTime() ?? 0
      const bTime = b.updatedAt?.getTime() ?? 0
      return bTime - aTime
    })

    return unified
  }, [chatTagsByChat, localChats, remoteChats])

  // Track open sub-chat changes for reactivity
  const [openSubChatsVersion, setOpenSubChatsVersion] = useState(0)
  useEffect(() => {
    const handleChange = () => setOpenSubChatsVersion((v) => v + 1)
    window.addEventListener(OPEN_SUB_CHATS_CHANGE_EVENT, handleChange)
    return () => window.removeEventListener(OPEN_SUB_CHATS_CHANGE_EVENT, handleChange)
  }, [])

  // Store previous value to avoid unnecessary React Query refetches
  const prevOpenSubChatIdsRef = useRef<string[]>([])

  // Collect all open sub-chat IDs from localStorage for all workspaces
  const allOpenSubChatIds = useMemo(() => {
    // openSubChatsVersion is used to trigger recalculation when sub-chats change
    void openSubChatsVersion
    if (!agentChats) return prevOpenSubChatIdsRef.current

    const windowId = getWindowId()
    const allIds: string[] = []
    for (const chat of agentChats) {
      try {
        // Use window-prefixed key (matches sub-chat-store.ts)
        const stored = localStorage.getItem(`${windowId}:agent-open-sub-chats-${chat.id}`)
        if (stored) {
          const ids = JSON.parse(stored) as string[]
          allIds.push(...ids)
        }
      } catch {
        // Skip invalid JSON
      }
    }

    // Compare with previous - if content is same, return old reference
    // This prevents React Query from refetching when array content hasn't changed
    const prev = prevOpenSubChatIdsRef.current
    const sorted = [...allIds].sort()
    const prevSorted = [...prev].sort()
    if (sorted.length === prevSorted.length && sorted.every((id, i) => id === prevSorted[i])) {
      return prev
    }

    prevOpenSubChatIdsRef.current = allIds
    return allIds
  }, [agentChats, openSubChatsVersion])

  // File changes stats from DB - only for open sub-chats
  const { data: fileStatsData } = trpc.chats.getFileStats.useQuery(
    { openSubChatIds: allOpenSubChatIds },
    {
      refetchInterval: 5000,
      enabled: allOpenSubChatIds.length > 0,
      placeholderData: (prev) => prev,
    },
  )

  // Pending plan approvals from DB - only for open sub-chats
  const { data: pendingPlanApprovalsData } = trpc.chats.getPendingPlanApprovals.useQuery(
    { openSubChatIds: allOpenSubChatIds },
    {
      refetchInterval: 5000,
      enabled: allOpenSubChatIds.length > 0,
      placeholderData: (prev) => prev,
    },
  )

  // Fetch all projects for git info
  const { data: projects } = trpc.projects.list.useQuery()
  const { data: tasks } = trpc.tasks.list.useQuery({ includeArchived: false })
  const { data: archivedProjects } = trpc.projects.listArchived.useQuery()
  const { data: archivedTasks } = trpc.tasks.listArchived.useQuery()
  const moveDestinations = useMemo(
    () => buildChatMoveDestinations(projects ?? [], tasks ?? []),
    [projects, tasks],
  )

  // Auto-import hook for "Open Locally" functionality
  const { getMatchingProjects, autoImport, isImporting } = useAutoImport()

  // Create map for quick project lookup by id
  const projectsMap = useMemo(() => {
    if (!projects) return new Map()
    return new Map(projects.map((p) => [p.id, p]))
  }, [projects])

  // Fetch all archived chats (to get count)
  const { data: archivedChats } = trpc.chats.listArchived.useQuery({})
  // Get utils outside of callbacks - hooks must be called at top level
  const utils = trpc.useUtils()

  // Unified undo stack for workspaces and sub-chats (Jotai atom)
  const [undoStack, setUndoStack] = useAtom(undoStackAtom)

  // Restore chat mutation (for undo)
  const restoreChatMutation = trpc.chats.restore.useMutation({
    onSuccess: (_, variables) => {
      utils.chats.list.invalidate()
      utils.chats.listArchived.invalidate()
      // Select the restored chat
      setSelectedChatId(variables.id)
    },
  })

  const restoreProjectMutation = trpc.projects.restore.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
      utils.projects.listArchived.invalidate()
      utils.chats.list.invalidate()
      utils.tasks.list.invalidate()
      utils.tasks.listArchived.invalidate()
    },
    onError: () => toast.error("Failed to restore project"),
  })

  const restoreTaskMutation = trpc.tasks.restore.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
      utils.tasks.listArchived.invalidate()
      utils.chats.list.invalidate()
    },
    onError: () => toast.error("Failed to restore task"),
  })

  const deleteArchivedChatsMutation = trpc.chats.deleteArchived.useMutation({
    onSuccess: ({ deletedCount }) => {
      utils.chats.list.invalidate()
      utils.chats.listArchived.invalidate()
      utils.chats.getFileStats.invalidate()
      setSelectedArchivedChatIds(new Set())
      setIsArchiveSelectMode(false)
      toast.success(
        deletedCount === 1 ? "Deleted 1 archived chat" : `Deleted ${deletedCount} archived chats`,
      )
    },
    onError: () => toast.error("Failed to delete archived chats"),
  })

  const openProjectMutation = trpc.projects.openFolder.useMutation({
    onSuccess: (project) => {
      if (!project) return
      utils.projects.list.invalidate()
      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl,
        gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
        gitOwner: project.gitOwner,
        gitRepo: project.gitRepo,
      })
    },
    onError: () => toast.error("Failed to add project"),
  })

  const cloneProjectMutation = trpc.projects.cloneFromGitHub.useMutation({
    onSuccess: (project) => {
      if (!project) return
      utils.projects.list.invalidate()
      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl,
        gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
        gitOwner: project.gitOwner,
        gitRepo: project.gitRepo,
      })
      toast.success("Project cloned")
    },
    onError: (error) => toast.error(error.message || "Failed to clone project"),
  })

  const createTaskMutation = trpc.tasks.create.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
      toast.success("Task created")
    },
    onError: () => toast.error("Failed to create task"),
  })

  // Remove workspace item from stack by chatId
  const removeWorkspaceFromStack = useCallback(
    (chatId: string) => {
      setUndoStack((prev) => {
        const index = prev.findIndex((item) => item.type === "workspace" && item.chatId === chatId)
        if (index !== -1) {
          clearTimeout(prev[index].timeoutId)
          return [...prev.slice(0, index), ...prev.slice(index + 1)]
        }
        return prev
      })
    },
    [setUndoStack],
  )

  const removeLifecycleFromStack = useCallback(
    (type: "project" | "task", id: string) => {
      setUndoStack((prev) => {
        const index = prev.findIndex((item) => {
          if (type === "project") return item.type === "project" && item.projectId === id
          return item.type === "task" && item.taskId === id
        })
        if (index !== -1) {
          clearTimeout(prev[index].timeoutId)
          return [...prev.slice(0, index), ...prev.slice(index + 1)]
        }
        return prev
      })
    },
    [setUndoStack],
  )

  // Remote archive mutations (for sandbox mode)
  const archiveRemoteChatMutation = useArchiveRemoteChat()
  const archiveRemoteChatsBatchMutation = useArchiveRemoteChatsBatch()
  const restoreRemoteChatMutation = useRestoreRemoteChat()
  const renameRemoteChatMutation = useRenameRemoteChat()

  // Archive chat mutation
  const archiveChatMutation = trpc.chats.archive.useMutation({
    onSuccess: (_, variables) => {
      // Hide tooltip if visible (element may be removed from DOM before mouseLeave fires)
      if (agentTooltipTimerRef.current) {
        clearTimeout(agentTooltipTimerRef.current)
        agentTooltipTimerRef.current = null
      }
      if (agentTooltipRef.current) {
        agentTooltipRef.current.style.display = "none"
      }

      utils.chats.list.invalidate()
      utils.chats.listArchived.invalidate()

      // If archiving the currently selected chat, navigate based on auto-advance setting
      if (selectedChatId === variables.id) {
        const currentIndex = agentChats?.findIndex((c) => c.id === variables.id) ?? -1

        if (autoAdvanceTarget === "next") {
          // Find next workspace in list (after current index)
          const nextChat = agentChats?.find((c, i) => i > currentIndex && c.id !== variables.id)
          if (nextChat) {
            setSelectedChatId(nextChat.id)
          } else {
            // No next workspace, go to new workspace view
            setSelectedChatId(null)
          }
        } else if (autoAdvanceTarget === "previous") {
          // Go to previously selected workspace
          const isPreviousAvailable =
            previousChatId &&
            agentChats?.some((c) => c.id === previousChatId && c.id !== variables.id)
          if (isPreviousAvailable) {
            setSelectedChatId(previousChatId)
          } else {
            setSelectedChatId(null)
          }
        } else {
          // Close: go to new workspace view
          setSelectedChatId(null)
        }
      }

      // Clear after 10 seconds (Cmd+Z window)
      const timeoutId = setTimeout(() => {
        removeWorkspaceFromStack(variables.id)
      }, 10000)

      // Add to unified undo stack for Cmd+Z
      setUndoStack((prev) => [
        ...prev,
        {
          type: "workspace",
          chatId: variables.id,
          timeoutId,
        },
      ])
    },
  })

  // Cmd+Z to undo archive (supports multiple undos for workspaces AND sub-chats)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && undoStack.length > 0) {
        e.preventDefault()
        // Get the most recent item
        const lastItem = undoStack[undoStack.length - 1]
        if (!lastItem) return

        // Clear timeout and remove from stack
        clearTimeout(lastItem.timeoutId)
        setUndoStack((prev) => prev.slice(0, -1))

        if (lastItem.type === "workspace") {
          // Restore workspace from archive
          if (lastItem.isRemote) {
            // Strip remote_ prefix before calling API (stored with prefix for undo stack identification)
            const originalId = lastItem.chatId.replace(/^remote_/, "")
            restoreRemoteChatMutation.mutate(originalId, {
              onSuccess: () => {
                setSelectedChatId(originalId)
                setSelectedChatIsRemote(true)
                setChatSourceMode("sandbox")
              },
              onError: (error) => {
                console.error("[handleUndo] Failed to restore remote chat:", error)
                toast.error("Failed to restore chat")
              },
            })
          } else {
            restoreChatMutation.mutate({ id: lastItem.chatId })
          }
        } else if (lastItem.type === "subchat") {
          // Restore sub-chat tab (re-add to open tabs)
          const store = useAgentSubChatStore.getState()
          store.addToOpenSubChats(lastItem.subChatId)
          store.setActiveSubChat(lastItem.subChatId)
        } else if (lastItem.type === "project") {
          restoreProjectMutation.mutate({ id: lastItem.projectId })
        } else if (lastItem.type === "task") {
          restoreTaskMutation.mutate({ id: lastItem.taskId })
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [
    undoStack,
    setUndoStack,
    restoreChatMutation,
    restoreRemoteChatMutation,
    restoreProjectMutation,
    restoreTaskMutation,
    setSelectedChatId,
  ])

  // Batch archive mutation
  const archiveChatsBatchMutation = trpc.chats.archiveBatch.useMutation({
    onSuccess: (_, variables) => {
      // Hide tooltip if visible (element may be removed from DOM before mouseLeave fires)
      if (agentTooltipTimerRef.current) {
        clearTimeout(agentTooltipTimerRef.current)
        agentTooltipTimerRef.current = null
      }
      if (agentTooltipRef.current) {
        agentTooltipRef.current.style.display = "none"
      }

      utils.chats.list.invalidate()
      utils.chats.listArchived.invalidate()

      // Add each chat to unified undo stack for Cmd+Z
      const newItems: UndoItem[] = variables.chatIds.map((chatId) => {
        const timeoutId = setTimeout(() => {
          removeWorkspaceFromStack(chatId)
        }, 10000)
        return { type: "workspace" as const, chatId, timeoutId }
      })
      setUndoStack((prev) => [...prev, ...newItems])
    },
  })

  // Reset selected chat when project changes (but not on initial load)
  const prevProjectIdRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    // Skip on initial mount (prevProjectIdRef is undefined)
    if (prevProjectIdRef.current === undefined) {
      prevProjectIdRef.current = selectedProject?.id ?? null
      return
    }
    // Only reset if project actually changed from a real value (not from null/initial load)
    if (
      prevProjectIdRef.current !== null &&
      prevProjectIdRef.current !== selectedProject?.id &&
      selectedChatId
    ) {
      setSelectedChatId(null)
    }
    prevProjectIdRef.current = selectedProject?.id ?? null
  }, [selectedProject?.id]) // Don't include selectedChatId in deps to avoid loops

  // Load remote pinned IDs from localStorage. Local chat pins come from chats.pinnedAt.
  useEffect(() => {
    try {
      const stored = localStorage.getItem("agent-pinned-remote-chats")
      setRemotePinnedChatIds(stored ? new Set(JSON.parse(stored)) : new Set())
      const storedStars = localStorage.getItem("flapstack-starred-chats")
      setStarredChatIds(storedStars ? new Set(JSON.parse(storedStars)) : new Set())
      const storedProjectStars = localStorage.getItem("flapstack-starred-projects")
      setStarredProjectIds(storedProjectStars ? new Set(JSON.parse(storedProjectStars)) : new Set())
      const storedTaskStars = localStorage.getItem("flapstack-starred-tasks")
      setStarredTaskIds(storedTaskStars ? new Set(JSON.parse(storedTaskStars)) : new Set())
      const storedCollapsed = localStorage.getItem("flapstack-sidebar-collapsed-sections")
      setCollapsedSectionIds(storedCollapsed ? new Set(JSON.parse(storedCollapsed)) : new Set())
      const storedOrder = localStorage.getItem("flapstack-sidebar-manual-order")
      setManualOrderByKey(storedOrder ? JSON.parse(storedOrder) : {})
      const storedProjectColors = localStorage.getItem("flapstack-sidebar-project-colors")
      setProjectColorsById(storedProjectColors ? JSON.parse(storedProjectColors) : {})
      const storedManualProjectColorIds = localStorage.getItem(
        "flapstack-sidebar-manual-project-colors",
      )
      setManualProjectColorIds(
        storedManualProjectColorIds
          ? new Set<string>(JSON.parse(storedManualProjectColorIds) as string[])
          : new Set(),
      )
    } catch {
      setRemotePinnedChatIds(new Set())
      setStarredChatIds(new Set())
      setStarredProjectIds(new Set())
      setStarredTaskIds(new Set())
      setCollapsedSectionIds(new Set())
      setManualOrderByKey({})
      setProjectColorsById({})
      setManualProjectColorIds(new Set())
    }
  }, [])

  // Save remote pinned IDs to localStorage when they change
  const prevRemotePinnedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    // Only save if remotePinnedChatIds actually changed (avoid saving on load)
    if (
      (remotePinnedChatIds !== prevRemotePinnedRef.current && remotePinnedChatIds.size > 0) ||
      prevRemotePinnedRef.current.size > 0
    ) {
      localStorage.setItem("agent-pinned-remote-chats", JSON.stringify([...remotePinnedChatIds]))
    }
    prevRemotePinnedRef.current = remotePinnedChatIds
  }, [remotePinnedChatIds])

  useEffect(() => {
    localStorage.setItem("flapstack-starred-chats", JSON.stringify([...starredChatIds]))
  }, [starredChatIds])

  useEffect(() => {
    localStorage.setItem("flapstack-starred-projects", JSON.stringify([...starredProjectIds]))
  }, [starredProjectIds])

  useEffect(() => {
    localStorage.setItem("flapstack-starred-tasks", JSON.stringify([...starredTaskIds]))
  }, [starredTaskIds])

  useEffect(() => {
    localStorage.setItem(
      "flapstack-sidebar-collapsed-sections",
      JSON.stringify([...collapsedSectionIds]),
    )
  }, [collapsedSectionIds])

  useEffect(() => {
    localStorage.setItem(
      "flapstack-sidebar-hidden-navigation-items",
      JSON.stringify([...hiddenNavigationItems]),
    )
  }, [hiddenNavigationItems])

  useEffect(() => {
    localStorage.setItem("flapstack-sidebar-manual-order", JSON.stringify(manualOrderByKey))
  }, [manualOrderByKey])

  useEffect(() => {
    if (!projects?.length) return
    setProjectColorsById((current) => assignStableProjectColors(projects, current))
  }, [projects])

  useEffect(() => {
    localStorage.setItem("flapstack-sidebar-project-colors", JSON.stringify(projectColorsById))
  }, [projectColorsById])

  useEffect(() => {
    localStorage.setItem(
      "flapstack-sidebar-manual-project-colors",
      JSON.stringify([...manualProjectColorIds]),
    )
  }, [manualProjectColorIds])

  // Rename mutation
  const renameChatMutation = trpc.chats.rename.useMutation({
    onSuccess: () => {
      utils.chats.list.invalidate()
    },
    onError: () => {
      toast.error("Failed to rename agent")
    },
  })

  const pinChatMutation = trpc.chats.pin.useMutation({
    onSuccess: () => {
      utils.chats.list.invalidate()
    },
    onError: () => toast.error("Failed to pin chat"),
  })

  const unpinChatMutation = trpc.chats.unpin.useMutation({
    onSuccess: () => {
      utils.chats.list.invalidate()
    },
    onError: () => toast.error("Failed to unpin chat"),
  })

  const moveChatMutation = trpc.chats.move.useMutation({
    onSuccess: async (movedChat, variables) => {
      await Promise.all([
        utils.chats.list.invalidate(),
        utils.chats.get.invalidate({ id: variables.id }),
      ])

      if (selectedChatId === variables.id && !selectedChatIsRemote) {
        if (variables.scope === "global") {
          setSelectedChatScope({ type: "global", id: "global", name: "Global chats" })
          setSelectedProject(null)
        } else if (variables.scope === "project" && variables.projectId) {
          const project = projects?.find((candidate) => candidate.id === variables.projectId)
          setSelectedChatScope({
            type: "project",
            id: variables.projectId,
            name: project?.name ?? "Project",
          })
          setSelectedProject(
            project
              ? {
                  id: project.id,
                  name: project.name,
                  path: project.path,
                  gitRemoteUrl: project.gitRemoteUrl,
                  gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
                  gitOwner: project.gitOwner,
                  gitRepo: project.gitRepo,
                }
              : null,
          )
        } else if (variables.scope === "task" && variables.taskId) {
          const task = tasks?.find((candidate) => candidate.id === variables.taskId)
          const project = task
            ? projects?.find((candidate) => candidate.id === task.projectId)
            : null
          setSelectedChatScope({
            type: "task",
            id: variables.taskId,
            name: task?.name ?? "Task",
            projectId: task?.projectId ?? movedChat.projectId ?? "",
            projectName: project?.name ?? null,
          })
          setSelectedProject(
            project
              ? {
                  id: project.id,
                  name: project.name,
                  path: project.path,
                  gitRemoteUrl: project.gitRemoteUrl,
                  gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
                  gitOwner: project.gitOwner,
                  gitRepo: project.gitRepo,
                }
              : null,
          )
        }
      }

      const destination = moveDestinations.find((target) => {
        if (target.scope !== variables.scope) return false
        if (target.scope === "global") return true
        if (target.scope === "project") return target.projectId === variables.projectId
        return target.taskId === variables.taskId
      })
      toast.success(destination ? `Chat moved to ${destination.label}` : "Chat moved")
    },
    onError: (error) => toast.error(error.message || "Failed to move chat"),
  })

  const handleMoveChat = useCallback(
    (chatId: string, requestedTarget: ChatMoveTarget) => {
      const chat = agentChats.find((candidate) => candidate.id === chatId)
      if (!chat || chat.isRemote) {
        toast.error("Only local chats can be moved")
        return
      }

      const requestedTargetKey = chatMoveTargetKey(requestedTarget)
      const target = moveDestinations.find(
        (candidate) => chatMoveTargetKey(candidate) === requestedTargetKey,
      )
      if (!target) {
        toast.error("That destination is no longer available")
        return
      }
      if (
        isCurrentChatMoveTarget(
          { scope: chat.scope, projectId: chat.projectId, taskId: chat.taskId },
          target,
        )
      ) {
        return
      }

      moveChatMutation.mutate(toChatMoveMutationInput(chatId, target))
    },
    [agentChats, moveChatMutation, moveDestinations],
  )

  const pinProjectMutation = trpc.projects.pin.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
    },
    onError: () => toast.error("Failed to pin project"),
  })

  const unpinProjectMutation = trpc.projects.unpin.useMutation({
    onSuccess: () => {
      utils.projects.list.invalidate()
    },
    onError: () => toast.error("Failed to unpin project"),
  })

  const archiveProjectMutation = trpc.projects.archive.useMutation({
    onSuccess: (_, variables) => {
      utils.projects.list.invalidate()
      utils.projects.listArchived.invalidate()
      utils.tasks.list.invalidate()
      utils.tasks.listArchived.invalidate()
      utils.chats.list.invalidate()

      const selectedChat = selectedChatId
        ? agentChats.find((chat) => chat.id === selectedChatId && !chat.isRemote)
        : null
      if (selectedChat?.projectId === variables.id) {
        setSelectedChatId(null)
      }

      const timeoutId = setTimeout(() => {
        removeLifecycleFromStack("project", variables.id)
      }, 10000)
      setUndoStack((prev) => [...prev, { type: "project", projectId: variables.id, timeoutId }])

      toast.success("Project archived", {
        action: {
          label: "Undo",
          onClick: () => {
            removeLifecycleFromStack("project", variables.id)
            restoreProjectMutation.mutate({ id: variables.id })
          },
        },
      })
    },
    onError: () => toast.error("Failed to archive project"),
  })

  const pinTaskMutation = trpc.tasks.pin.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
    },
    onError: () => toast.error("Failed to pin task"),
  })

  const unpinTaskMutation = trpc.tasks.unpin.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate()
    },
    onError: () => toast.error("Failed to unpin task"),
  })

  const archiveTaskMutation = trpc.tasks.archive.useMutation({
    onSuccess: (_, variables) => {
      utils.tasks.list.invalidate()
      utils.tasks.listArchived.invalidate()
      utils.chats.list.invalidate()

      const selectedChat = selectedChatId
        ? agentChats.find((chat) => chat.id === selectedChatId && !chat.isRemote)
        : null
      if (selectedChat?.taskId === variables.id) {
        setSelectedChatId(null)
      }

      const timeoutId = setTimeout(() => {
        removeLifecycleFromStack("task", variables.id)
      }, 10000)
      setUndoStack((prev) => [...prev, { type: "task", taskId: variables.id, timeoutId }])

      toast.success("Task archived", {
        action: {
          label: "Undo",
          onClick: () => {
            removeLifecycleFromStack("task", variables.id)
            restoreTaskMutation.mutate({ id: variables.id })
          },
        },
      })
    },
    onError: () => toast.error("Failed to archive task"),
  })

  const handleToggleLifecyclePin = useCallback(
    (type: "project" | "task", id: string, isPinned: boolean) => {
      if (type === "project") {
        if (isPinned) {
          unpinProjectMutation.mutate({ id })
        } else {
          pinProjectMutation.mutate({ id })
        }
        return
      }

      if (isPinned) {
        unpinTaskMutation.mutate({ id })
      } else {
        pinTaskMutation.mutate({ id })
      }
    },
    [pinProjectMutation, unpinProjectMutation, pinTaskMutation, unpinTaskMutation],
  )

  const handleToggleLifecycleStar = useCallback((type: "project" | "task", id: string) => {
    const setter = type === "project" ? setStarredProjectIds : setStarredTaskIds
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const handleArchiveLifecycle = useCallback(
    (type: "project" | "task", id: string) => {
      if (type === "project") {
        archiveProjectMutation.mutate({ id })
      } else {
        archiveTaskMutation.mutate({ id })
      }
    },
    [archiveProjectMutation, archiveTaskMutation],
  )

  const pinnedChatIds = useMemo(() => {
    const ids = new Set(remotePinnedChatIds)
    for (const chat of agentChats) {
      if (!chat.isRemote && chat.pinnedAt) ids.add(chat.id)
    }
    return ids
  }, [agentChats, remotePinnedChatIds])

  const handleTogglePin = useCallback(
    (chatId: string) => {
      const chat = agentChats.find((candidate) => candidate.id === chatId)
      if (chat?.isRemote) {
        setRemotePinnedChatIds((prev) => {
          const next = new Set(prev)
          if (next.has(chatId)) {
            next.delete(chatId)
          } else {
            next.add(chatId)
          }
          return next
        })
        return
      }

      if (pinnedChatIds.has(chatId)) {
        utils.chats.list.setData({}, (old) =>
          old?.map((item) => (item.id === chatId ? { ...item, pinnedAt: null } : item)),
        )
        unpinChatMutation.mutate({ id: chatId })
      } else {
        const pinnedAt = new Date()
        utils.chats.list.setData({}, (old) =>
          old?.map((item) => (item.id === chatId ? { ...item, pinnedAt } : item)),
        )
        pinChatMutation.mutate({ id: chatId })
      }
    },
    [agentChats, pinnedChatIds, pinChatMutation, unpinChatMutation, utils.chats.list],
  )

  const handleToggleStar = useCallback((chatId: string) => {
    setStarredChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(chatId)) {
        next.delete(chatId)
      } else {
        next.add(chatId)
      }
      return next
    })
  }, [])

  const handleToggleSection = useCallback((sectionId: string) => {
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }, [])

  const handleChangeProjectColor = useCallback((projectId: string, color: string) => {
    const normalizedColor = normalizeHexColor(color)
    setProjectColorsById((prev) => ({
      ...prev,
      [projectId]: isReservedArchivedAccentColor(normalizedColor)
        ? DEFAULT_PROJECT_COLOR
        : normalizedColor,
    }))
    setManualProjectColorIds((prev) => new Set(prev).add(projectId))
  }, [])

  const handleRenameClick = useCallback(
    (chat: { id: string; name: string | null; isRemote?: boolean }) => {
      setRenamingChat(chat as { id: string; name: string; isRemote?: boolean })
      setRenameDialogOpen(true)
    },
    [],
  )

  const handleRenameSave = async (newName: string) => {
    if (!renamingChat) return

    const chatId = renamingChat.id
    const oldName = renamingChat.name
    const isRemote = renamingChat.isRemote

    setRenameLoading(true)

    try {
      if (isRemote) {
        // Remote chat rename
        await renameRemoteChatMutation.mutateAsync({
          chatId,
          name: newName,
        })
      } else {
        // Local chat rename - optimistically update the query cache
        utils.chats.list.setData({}, (old) => {
          if (!old) return old
          return old.map((c) => (c.id === chatId ? { ...c, name: newName } : c))
        })
        utils.chats.get.setData({ id: chatId }, (old) =>
          old
            ? {
                ...old,
                name: newName,
                subChats: old.subChats.map((subChat, index) =>
                  index === 0 ? { ...subChat, name: newName } : subChat,
                ),
              }
            : old,
        )
        const subChatStore = useAgentSubChatStore.getState()
        if (subChatStore.chatId === chatId && subChatStore.allSubChats[0]) {
          subChatStore.updateSubChatName(subChatStore.allSubChats[0].id, newName)
        }

        try {
          await renameChatMutation.mutateAsync({
            id: chatId,
            name: newName,
          })
        } catch {
          // Rollback on error
          utils.chats.list.setData({}, (old) => {
            if (!old) return old
            return old.map((c) => (c.id === chatId ? { ...c, name: oldName } : c))
          })
          await utils.chats.get.invalidate({ id: chatId })
          throw new Error("Failed to rename local chat")
        }
      }
      setRenameDialogOpen(false)
    } catch (error) {
      console.error("[handleRenameSave] Rename failed:", error)
      toast.error(isRemote ? "Failed to rename remote chat" : "Failed to rename chat")
    } finally {
      setRenameLoading(false)
      setRenamingChat(null)
    }
  }

  // Check if all selected chats are pinned
  const areAllSelectedPinned = useMemo(() => {
    if (selectedChatIds.size === 0) return false
    return Array.from(selectedChatIds).every((id) => pinnedChatIds.has(id))
  }, [selectedChatIds, pinnedChatIds])

  // Check if all selected chats are unpinned
  const areAllSelectedUnpinned = useMemo(() => {
    if (selectedChatIds.size === 0) return false
    return Array.from(selectedChatIds).every((id) => !pinnedChatIds.has(id))
  }, [selectedChatIds, pinnedChatIds])

  // Show pin option only if all selected have same pin state
  const canShowPinOption = areAllSelectedPinned || areAllSelectedUnpinned

  // Handle bulk pin of selected chats
  const handleBulkPin = useCallback(() => {
    const chatIdsToPin = Array.from(selectedChatIds)
    if (chatIdsToPin.length > 0) {
      const localIds: string[] = []
      const remoteIds: string[] = []
      for (const chatId of chatIdsToPin) {
        const chat = agentChats.find((candidate) => candidate.id === chatId)
        if (chat?.isRemote) {
          remoteIds.push(chatId)
        } else if (!pinnedChatIds.has(chatId)) {
          localIds.push(chatId)
        }
      }

      setRemotePinnedChatIds((prev) => {
        const next = new Set(prev)
        remoteIds.forEach((id) => next.add(id))
        return next
      })
      localIds.forEach((id) => pinChatMutation.mutate({ id }))
      clearChatSelection()
    }
  }, [selectedChatIds, agentChats, pinnedChatIds, pinChatMutation, clearChatSelection])

  // Handle bulk unpin of selected chats
  const handleBulkUnpin = useCallback(() => {
    const chatIdsToUnpin = Array.from(selectedChatIds)
    if (chatIdsToUnpin.length > 0) {
      const localIds: string[] = []
      const remoteIds: string[] = []
      for (const chatId of chatIdsToUnpin) {
        const chat = agentChats.find((candidate) => candidate.id === chatId)
        if (chat?.isRemote) {
          remoteIds.push(chatId)
        } else if (pinnedChatIds.has(chatId)) {
          localIds.push(chatId)
        }
      }

      setRemotePinnedChatIds((prev) => {
        const next = new Set(prev)
        remoteIds.forEach((id) => next.delete(id))
        return next
      })
      localIds.forEach((id) => unpinChatMutation.mutate({ id }))
      clearChatSelection()
    }
  }, [selectedChatIds, agentChats, pinnedChatIds, unpinChatMutation, clearChatSelection])

  // Get clerk username
  const clerkUsername = clerkUser?.username

  // Filter and group chats. Pinned chats stay in their parent, then appear again in the reference group.
  const { pinnedAgents, starredAgents, pinnedTasks, starredTasks, chatSections, filteredChats } =
    useMemo(() => {
      if (!agentChats) {
        return {
          pinnedAgents: [],
          starredAgents: [],
          pinnedTasks: [],
          starredTasks: [],
          chatSections: [],
          filteredChats: [],
        }
      }

      const filtered = searchQuery.trim()
        ? agentChats.filter((chat) => {
            const query = searchQuery.toLocaleLowerCase()
            return (
              (chat.name ?? "").toLocaleLowerCase().includes(query) ||
              chat.tags.some((tag) => tag.name.toLocaleLowerCase().includes(query))
            )
          })
        : agentChats

      const activeProjectIds = new Set((projects ?? []).map((project) => project.id))
      const activeTaskIds = new Set((tasks ?? []).map((task) => task.id))
      const activeFiltered = filtered.filter((chat) => {
        if (chat.isRemote) return true
        if (projects && chat.projectId && !activeProjectIds.has(chat.projectId)) return false
        if (tasks && chat.taskId && !activeTaskIds.has(chat.taskId)) return false
        return true
      })
      const prioritySort = <T extends { id: string; updatedAt: Date | null }>(
        items: T[],
        orderKey: string,
      ) =>
        [...items].sort((a, b) => {
          const pinDelta = Number(pinnedChatIds.has(b.id)) - Number(pinnedChatIds.has(a.id))
          if (pinDelta !== 0) return pinDelta
          const order = new Map((manualOrderByKey[orderKey] ?? []).map((id, index) => [id, index]))
          const aOrder = order.get(a.id) ?? Number.MAX_SAFE_INTEGER
          const bOrder = order.get(b.id) ?? Number.MAX_SAFE_INTEGER
          if (aOrder !== bOrder) return aOrder - bOrder
          const aTime = a.updatedAt?.getTime() ?? 0
          const bTime = b.updatedAt?.getTime() ?? 0
          return bTime - aTime
        })

      const pinned = activeFiltered.filter((chat) => pinnedChatIds.has(chat.id))
      const starred = activeFiltered.filter((chat) => starredChatIds.has(chat.id))
      const remote = activeFiltered.filter((chat) => chat.isRemote)
      const local = activeFiltered.filter((chat) => !chat.isRemote)
      const global = local.filter(
        (chat) => chat.scope === "global" || (!chat.projectId && !chat.taskId),
      )
      const tasksList = tasks ?? []
      const projectsList = projects ?? []
      const tasksById = new Map(tasksList.map((task) => [task.id, task]))
      const taskOrder = new Map(tasksList.map((task, index) => [task.id, index]))
      const projectOrder = new Map(projectsList.map((project, index) => [project.id, index]))
      const projectChats = local.filter((chat) => chat.projectId)
      const chatsByProject = new Map<string, typeof projectChats>()

      for (const chat of projectChats) {
        const projectId = chat.projectId
        if (!projectId) continue
        const chats = chatsByProject.get(projectId) ?? []
        chats.push(chat)
        chatsByProject.set(projectId, chats)
      }

      const projectIds = new Set<string>([
        ...projectsList.map((project) => project.id),
        ...Array.from(chatsByProject.keys()),
      ])

      const groupedProjects = Array.from(projectIds)
        .map((projectId) => {
          const chats = chatsByProject.get(projectId) ?? []
          const directChats = prioritySort(
            chats.filter((chat) => !chat.taskId),
            `project:${projectId}:chats`,
          )
          const groupedTaskChats = new Map<string, typeof chats>()

          for (const chat of chats) {
            if (!chat.taskId) continue
            const taskChats = groupedTaskChats.get(chat.taskId) ?? []
            taskChats.push(chat)
            groupedTaskChats.set(chat.taskId, taskChats)
          }

          const taskIds = new Set<string>([
            ...tasksList.filter((task) => task.projectId === projectId).map((task) => task.id),
            ...Array.from(groupedTaskChats.keys()),
          ])

          const taskGroups = Array.from(taskIds)
            .map((taskId) => ({
              taskId,
              title: tasksById.get(taskId)?.name ?? "Task",
              isPinned: Boolean(tasksById.get(taskId)?.pinnedAt),
              isStarred: starredTaskIds.has(taskId),
              chats: prioritySort(groupedTaskChats.get(taskId) ?? [], `task:${taskId}:chats`),
            }))
            .sort((a, b) => {
              const pinDelta = Number(b.isPinned) - Number(a.isPinned)
              if (pinDelta !== 0) return pinDelta
              const aOrder = taskOrder.get(a.taskId) ?? Number.MAX_SAFE_INTEGER
              const bOrder = taskOrder.get(b.taskId) ?? Number.MAX_SAFE_INTEGER
              if (aOrder !== bOrder) return aOrder - bOrder
              return a.title.localeCompare(b.title)
            })

          const project = projectsMap.get(projectId)
          return {
            projectId,
            title: project?.name || project?.gitRepo || "Project",
            isPinned: Boolean(project?.pinnedAt),
            isStarred: starredProjectIds.has(projectId),
            chats: directChats,
            taskGroups,
          }
        })
        .sort((a, b) => {
          const pinDelta = Number(b.isPinned) - Number(a.isPinned)
          if (pinDelta !== 0) return pinDelta
          const manualProjectOrder = new Map(
            (manualOrderByKey.projects ?? []).map((id, index) => [id, index]),
          )
          const aManual = manualProjectOrder.get(a.projectId) ?? Number.MAX_SAFE_INTEGER
          const bManual = manualProjectOrder.get(b.projectId) ?? Number.MAX_SAFE_INTEGER
          if (aManual !== bManual) return aManual - bManual
          const aOrder = projectOrder.get(a.projectId) ?? Number.MAX_SAFE_INTEGER
          const bOrder = projectOrder.get(b.projectId) ?? Number.MAX_SAFE_INTEGER
          if (aOrder !== bOrder) return aOrder - bOrder
          return a.title.localeCompare(b.title)
        })

      const sections: Array<{
        id: string
        title: string
        chats: typeof activeFiltered
        kind?: "pinned" | "starred" | "remote" | "global" | "project" | "task"
        lifecycleTarget?: {
          type: "project" | "task"
          id: string
          isPinned: boolean
          isStarred?: boolean
        }
        parentProjectId?: string
        sectionDragId?: string
        hideHeader?: boolean
        projectColor?: string | null
        showEmptyState?: boolean
      }> = []
      if (remote.length > 0)
        sections.push({
          id: "remote",
          title: "Remote sandboxes",
          chats: prioritySort(remote, "remote:chats"),
          kind: "remote",
        })
      if (global.length > 0)
        sections.push({
          id: "global",
          title: "Global chats",
          chats: prioritySort(global, "global:chats"),
          kind: "global",
        })
      for (const projectGroup of groupedProjects) {
        sections.push({
          id: `project-${projectGroup.projectId}`,
          title: projectGroup.title,
          chats: [],
          kind: "project",
          lifecycleTarget: {
            type: "project",
            id: projectGroup.projectId,
            isPinned: projectGroup.isPinned,
            isStarred: projectGroup.isStarred,
          },
          projectColor: projectColorsById[projectGroup.projectId] ?? DEFAULT_PROJECT_COLOR,
          showEmptyState:
            !searchQuery.trim() &&
            projectGroup.chats.length === 0 &&
            projectGroup.taskGroups.length === 0,
        })
        const childItems = [
          ...projectGroup.chats.map((chat) => ({
            id: `chat:${chat.id}`,
            type: "chat" as const,
            updatedAt: chat.updatedAt,
            isPinned: pinnedChatIds.has(chat.id),
            chat,
          })),
          ...projectGroup.taskGroups.map((taskGroup) => ({
            id: `task:${taskGroup.taskId}`,
            type: "task" as const,
            updatedAt:
              taskGroup.chats.reduce<Date | null>((latest, chat) => {
                if (!chat.updatedAt) return latest
                if (!latest || chat.updatedAt.getTime() > latest.getTime()) return chat.updatedAt
                return latest
              }, null) ?? null,
            isPinned: taskGroup.isPinned,
            taskGroup,
          })),
        ].sort((a, b) => {
          const pinDelta = Number(b.isPinned) - Number(a.isPinned)
          if (pinDelta !== 0) return pinDelta

          const order = new Map(
            (manualOrderByKey[`project:${projectGroup.projectId}:children`] ?? []).map(
              (id, index) => [id, index],
            ),
          )
          const aManual = order.get(a.id) ?? Number.MAX_SAFE_INTEGER
          const bManual = order.get(b.id) ?? Number.MAX_SAFE_INTEGER
          if (aManual !== bManual) return aManual - bManual
          const aTime = a.updatedAt?.getTime() ?? 0
          const bTime = b.updatedAt?.getTime() ?? 0
          return bTime - aTime
        })
        for (const childItem of childItems) {
          if (childItem.type === "chat") {
            sections.push({
              id: `project-chat-${childItem.chat.id}`,
              title: "",
              chats: [childItem.chat],
              kind: "project",
              parentProjectId: projectGroup.projectId,
              sectionDragId: childItem.id,
              hideHeader: true,
              projectColor: projectColorsById[projectGroup.projectId] ?? DEFAULT_PROJECT_COLOR,
            })
            continue
          }
          const { taskGroup } = childItem
          sections.push({
            id: `task-${taskGroup.taskId}`,
            title: taskGroup.title,
            chats: taskGroup.chats,
            kind: "task",
            lifecycleTarget: {
              type: "task",
              id: taskGroup.taskId,
              isPinned: taskGroup.isPinned,
              isStarred: taskGroup.isStarred,
            },
            parentProjectId: projectGroup.projectId,
            sectionDragId: childItem.id,
            projectColor: projectColorsById[projectGroup.projectId] ?? DEFAULT_PROJECT_COLOR,
            showEmptyState: !searchQuery.trim() && taskGroup.chats.length === 0,
          })
        }
      }

      const referenceTasks = groupedProjects.flatMap((projectGroup) =>
        projectGroup.taskGroups.map((taskGroup) => ({
          ...taskGroup,
          projectId: projectGroup.projectId,
          projectColor: projectColorsById[projectGroup.projectId] ?? DEFAULT_PROJECT_COLOR,
        })),
      )

      return {
        pinnedAgents: prioritySort(pinned, "pinned:chats"),
        starredAgents: prioritySort(starred, "starred:chats"),
        pinnedTasks: referenceTasks.filter((task) => task.isPinned),
        starredTasks: referenceTasks.filter((task) => task.isStarred),
        chatSections: sections,
        filteredChats: sections.flatMap((section) => section.chats),
      }
    }, [
      searchQuery,
      agentChats,
      pinnedChatIds,
      starredChatIds,
      tasks,
      projects,
      projectsMap,
      manualOrderByKey,
      projectColorsById,
      starredProjectIds,
      starredTaskIds,
    ])

  const selectedLocalChat = useMemo(() => {
    if (!selectedChatId) return null
    return agentChats.find((chat) => chat.id === selectedChatId && !chat.isRemote) ?? null
  }, [agentChats, selectedChatId])

  const getDraggedLocalChat = useCallback(
    (item: { kind: string; id: string } | null) => {
      if (!item || (!item.kind.endsWith("chat") && item.kind !== "project-child")) return null
      if (item.kind === "project-child" && !item.id.startsWith("chat:")) return null
      const chatId = item.id.startsWith("chat:") ? item.id.slice("chat:".length) : item.id
      const chat = agentChats.find((candidate) => candidate.id === chatId)
      if (!chat || chat.isRemote) return null
      return chat
    },
    [agentChats],
  )

  const getCrossScopeDropTarget = useCallback(
    (targetKind: string, targetId: string, position: SidebarDropPosition = "inside") => {
      if (targetKind === "project") {
        const project = projects?.find((candidate) => candidate.id === targetId)
        return project ? ({ scope: "project" as const, projectId: project.id } as const) : null
      }

      if (targetKind === "project-child" && targetId.startsWith("task:")) {
        const taskId = targetId.slice("task:".length)
        const task = tasks?.find((candidate) => candidate.id === taskId)
        if (!task) return null
        return position === "inside"
          ? ({ scope: "task" as const, taskId: task.id } as const)
          : ({ scope: "project" as const, projectId: task.projectId } as const)
      }

      if (targetKind === "project-child" && targetId.startsWith("chat:")) {
        const chatId = targetId.slice("chat:".length)
        const chat = agentChats.find((candidate) => candidate.id === chatId)
        return chat?.projectId && !chat.taskId
          ? ({ scope: "project" as const, projectId: chat.projectId } as const)
          : null
      }

      if (targetKind === "task") {
        const task = tasks?.find((candidate) => candidate.id === targetId)
        return task ? ({ scope: "task" as const, taskId: task.id } as const) : null
      }

      if (targetKind === "task-chat") {
        const chat = agentChats.find((candidate) => candidate.id === targetId)
        return chat?.taskId ? ({ scope: "task" as const, taskId: chat.taskId } as const) : null
      }

      if (targetKind === "project-chat") {
        const chat = agentChats.find((candidate) => candidate.id === targetId)
        return chat?.projectId && !chat.taskId
          ? ({ scope: "project" as const, projectId: chat.projectId } as const)
          : null
      }

      return null
    },
    [agentChats, projects, tasks],
  )

  const canMoveChatAcrossScope = useCallback(
    (
      item: { kind: string; id: string } | null,
      targetKind: string,
      targetId: string,
      position: SidebarDropPosition = "inside",
    ) => {
      if (!crossScopeMoveEnabled) return false
      const chat = getDraggedLocalChat(item)
      const target = getCrossScopeDropTarget(targetKind, targetId, position)
      if (!chat || !target) return false

      if (target.scope === "project") {
        return (
          chat.scope !== "project" || chat.projectId !== target.projectId || chat.taskId !== null
        )
      }

      return chat.scope !== "task" || chat.taskId !== target.taskId
    },
    [crossScopeMoveEnabled, getCrossScopeDropTarget, getDraggedLocalChat],
  )

  const getReorderContext = useCallback(
    (kind: string, fromId: string, toId: string): { key: string; activeIds: string[] } | null => {
      const samePinGroup = (fromPinned: boolean, toPinned: boolean) => fromPinned === toPinned
      const chatIsPinned = (chatId: string) => pinnedChatIds.has(chatId)

      if (kind === "project") {
        const fromProject = projects?.find((project) => project.id === fromId)
        const toProject = projects?.find((project) => project.id === toId)
        if (!fromProject || !toProject) return null
        const fromPinned = Boolean(fromProject.pinnedAt)
        const toPinned = Boolean(toProject.pinnedAt)
        if (!samePinGroup(fromPinned, toPinned)) return null
        const activeIds = chatSections
          .filter((section) => section.kind === "project" && section.lifecycleTarget)
          .filter((section) => Boolean(section.lifecycleTarget?.isPinned) === fromPinned)
          .map((section) => section.lifecycleTarget!.id)
        return { key: "projects", activeIds }
      }

      if (kind === "task") {
        const fromTask = tasks?.find((task) => task.id === fromId)
        const toTask = tasks?.find((task) => task.id === toId)
        if (!fromTask || !toTask || fromTask.projectId !== toTask.projectId) return null
        const fromPinned = Boolean(fromTask.pinnedAt)
        const toPinned = Boolean(toTask.pinnedAt)
        if (!samePinGroup(fromPinned, toPinned)) return null
        const activeIds = tasks
          ?.filter((task) => task.projectId === fromTask.projectId)
          .filter((task) => Boolean(task.pinnedAt) === fromPinned)
          .map((task) => task.id)
        return activeIds ? { key: `project:${fromTask.projectId}:tasks`, activeIds } : null
      }

      if (kind === "project-child") {
        const resolveProjectId = (id: string) => {
          if (id.startsWith("task:")) {
            return tasks?.find((task) => task.id === id.slice("task:".length))?.projectId ?? null
          }
          const chatId = id.startsWith("chat:") ? id.slice("chat:".length) : id
          const chat = agentChats.find((candidate) => candidate.id === chatId)
          return chat?.projectId && !chat.taskId ? chat.projectId : null
        }
        const resolvePinned = (id: string) => {
          if (id.startsWith("task:")) {
            return Boolean(tasks?.find((task) => task.id === id.slice("task:".length))?.pinnedAt)
          }
          const chatId = id.startsWith("chat:") ? id.slice("chat:".length) : id
          return chatIsPinned(chatId)
        }
        const projectId = resolveProjectId(fromId)
        if (!projectId || resolveProjectId(toId) !== projectId) return null
        const fromPinned = resolvePinned(fromId)
        if (!samePinGroup(fromPinned, resolvePinned(toId))) return null
        const activeIds = chatSections
          .filter((section) => section.parentProjectId === projectId && section.sectionDragId)
          .filter((section) => resolvePinned(section.sectionDragId!) === fromPinned)
          .map((section) => section.sectionDragId!)
        return { key: `project:${projectId}:children`, activeIds }
      }

      if (kind === "pinned-chat") {
        return { key: "pinned:chats", activeIds: pinnedAgents.map((chat) => chat.id) }
      }

      if (kind === "starred-chat") {
        const fromPinned = chatIsPinned(fromId)
        if (!samePinGroup(fromPinned, chatIsPinned(toId))) return null
        return {
          key: "starred:chats",
          activeIds: starredAgents
            .filter((chat) => chatIsPinned(chat.id) === fromPinned)
            .map((chat) => chat.id),
        }
      }

      const fromChat = agentChats.find((chat) => chat.id === fromId)
      const toChat = agentChats.find((chat) => chat.id === toId)
      if (!fromChat || !toChat) return null
      const fromPinned = chatIsPinned(fromId)
      if (!samePinGroup(fromPinned, chatIsPinned(toId))) return null

      if (kind === "global-chat") {
        const bothGlobal =
          !fromChat.projectId && !fromChat.taskId && !toChat.projectId && !toChat.taskId
        if (!bothGlobal) return null
        return {
          key: "global:chats",
          activeIds: agentChats
            .filter((chat) => !chat.isRemote && !chat.projectId && !chat.taskId)
            .filter((chat) => chatIsPinned(chat.id) === fromPinned)
            .map((chat) => chat.id),
        }
      }

      if (kind === "remote-chat") {
        if (!fromChat.isRemote || !toChat.isRemote) return null
        return {
          key: "remote:chats",
          activeIds: agentChats
            .filter((chat) => chat.isRemote)
            .filter((chat) => chatIsPinned(chat.id) === fromPinned)
            .map((chat) => chat.id),
        }
      }

      if (kind === "project-chat") {
        if (
          !fromChat.projectId ||
          fromChat.projectId !== toChat.projectId ||
          fromChat.taskId ||
          toChat.taskId
        ) {
          return null
        }
        return {
          key: `project:${fromChat.projectId}:chats`,
          activeIds: agentChats
            .filter(
              (chat) => !chat.isRemote && chat.projectId === fromChat.projectId && !chat.taskId,
            )
            .filter((chat) => chatIsPinned(chat.id) === fromPinned)
            .map((chat) => chat.id),
        }
      }

      if (kind === "task-chat") {
        if (!fromChat.taskId || fromChat.taskId !== toChat.taskId) return null
        return {
          key: `task:${fromChat.taskId}:chats`,
          activeIds: agentChats
            .filter((chat) => !chat.isRemote && chat.taskId === fromChat.taskId)
            .filter((chat) => chatIsPinned(chat.id) === fromPinned)
            .map((chat) => chat.id),
        }
      }

      return null
    },
    [agentChats, chatSections, pinnedAgents, pinnedChatIds, projects, starredAgents, tasks],
  )

  const getProjectChildHeaderDropTarget = useCallback(
    (fromId: string, projectId: string) => {
      const childIds = chatSections
        .filter((section) => section.parentProjectId === projectId && section.sectionDragId)
        .map((section) => section.sectionDragId!)
      if (!childIds.includes(fromId)) return null

      const isPinnedChild = (id: string) => {
        if (id.startsWith("task:")) {
          return Boolean(tasks?.find((task) => task.id === id.slice("task:".length))?.pinnedAt)
        }
        const chatId = id.startsWith("chat:") ? id.slice("chat:".length) : id
        return pinnedChatIds.has(chatId)
      }
      const fromPinned = isPinnedChild(fromId)
      const activeIds = childIds.filter((id) => isPinnedChild(id) === fromPinned)
      const firstTarget = activeIds.find((id) => id !== fromId)
      if (!firstTarget) return null

      return {
        kind: "project-child",
        id: firstTarget,
        position: "before" as const,
      }
    },
    [chatSections, pinnedChatIds, tasks],
  )

  const resolveProjectIdFromDropTarget = useCallback(
    (kind: string, id: string) => {
      if (kind === "project") return projects?.some((project) => project.id === id) ? id : null

      if (kind === "project-child") {
        if (id.startsWith("task:")) {
          return tasks?.find((task) => task.id === id.slice("task:".length))?.projectId ?? null
        }
        const chatId = id.startsWith("chat:") ? id.slice("chat:".length) : id
        return agentChats.find((chat) => chat.id === chatId)?.projectId ?? null
      }

      if (kind === "project-chat") {
        return agentChats.find((chat) => chat.id === id)?.projectId ?? null
      }

      if (kind === "task" || kind === "task-chat") {
        const taskId =
          kind === "task" ? id : (agentChats.find((chat) => chat.id === id)?.taskId ?? null)
        return taskId ? (tasks?.find((task) => task.id === taskId)?.projectId ?? null) : null
      }

      return null
    },
    [agentChats, projects, tasks],
  )

  const getTaskDropTarget = useCallback(
    (targetKind: string, targetId: string, position: SidebarDropPosition) => {
      const taskId =
        targetKind === "task"
          ? targetId
          : targetKind === "project-child" && targetId.startsWith("task:")
            ? targetId.slice("task:".length)
            : targetKind === "task-chat"
              ? agentChats.find((chat) => chat.id === targetId)?.taskId
              : null
      if (!taskId) return null
      return { kind: "project-child", id: `task:${taskId}`, position }
    },
    [agentChats],
  )

  const normalizeDropTarget = useCallback(
    (
      dragged: { kind: string; id: string },
      targetKind: string,
      targetId: string,
      position: SidebarDropPosition,
    ) => {
      if (
        dragged.kind === "project-child" &&
        !getDraggedLocalChat(dragged) &&
        targetKind === "project"
      ) {
        return getProjectChildHeaderDropTarget(dragged.id, targetId)
      }

      if (
        dragged.kind === "project-child" &&
        !getDraggedLocalChat(dragged) &&
        targetKind === "task-chat"
      ) {
        return getTaskDropTarget(targetKind, targetId, position)
      }

      if (dragged.kind === "project" && targetKind !== "project") {
        const projectId = resolveProjectIdFromDropTarget(targetKind, targetId)
        return projectId ? { kind: "project", id: projectId, position } : null
      }

      return { kind: targetKind, id: targetId, position }
    },
    [
      getDraggedLocalChat,
      getProjectChildHeaderDropTarget,
      getTaskDropTarget,
      resolveProjectIdFromDropTarget,
    ],
  )

  const setDragOverItemState = useCallback(
    (item: { kind: string; id: string; position: SidebarDropPosition } | null) => {
      dragOverItemRef.current = item
      setDragOverItem(item)
    },
    [],
  )

  const clearDragState = useCallback(() => {
    draggingItemRef.current = null
    dragOverItemRef.current = null
    setDraggingItem(null)
    setDragOverItem(null)
  }, [])

  const clearPressedState = useCallback(() => {
    setIsSidebarPressed(false)
  }, [])

  const handleDragStartItem = useCallback((kind: string, id: string) => {
    draggingItemRef.current = { kind, id }
    dragOverItemRef.current = null
    setDraggingItem({ kind, id })
    setDragOverItem(null)
  }, [])

  const handleDragOverItem = useCallback(
    (kind: string, id: string, position: SidebarDropPosition) => {
      const activeDraggingItem = draggingItemRef.current ?? draggingItem
      if (!activeDraggingItem) return
      if (activeDraggingItem.id === id) {
        setDragOverItemState(null)
        return
      }
      const normalizedTarget = normalizeDropTarget(activeDraggingItem, kind, id, position)
      if (!normalizedTarget || activeDraggingItem.id === normalizedTarget.id) {
        setDragOverItemState(null)
        return
      }
      if (
        canMoveChatAcrossScope(
          activeDraggingItem,
          normalizedTarget.kind,
          normalizedTarget.id,
          normalizedTarget.position,
        )
      ) {
        setDragOverItemState(normalizedTarget)
        return
      }
      if (activeDraggingItem.kind !== normalizedTarget.kind) return
      const context = getReorderContext(
        normalizedTarget.kind,
        activeDraggingItem.id,
        normalizedTarget.id,
      )
      if (!context) {
        setDragOverItemState(null)
        return
      }

      if (
        !context.activeIds.includes(activeDraggingItem.id) ||
        !context.activeIds.includes(normalizedTarget.id)
      ) {
        setDragOverItemState(null)
        return
      }

      setDragOverItemState(normalizedTarget)
    },
    [
      canMoveChatAcrossScope,
      draggingItem,
      getReorderContext,
      normalizeDropTarget,
      setDragOverItemState,
    ],
  )

  const commitDropTarget = useCallback(
    (
      draggedItem: { kind: string; id: string },
      dropTarget: {
        kind: string
        id: string
        position: SidebarDropPosition
      },
    ) => {
      if (draggedItem.id === dropTarget.id) return

      const crossScopeTarget = getCrossScopeDropTarget(
        dropTarget.kind,
        dropTarget.id,
        dropTarget.position,
      )
      const draggedChat = getDraggedLocalChat(draggedItem)
      if (
        crossScopeMoveEnabled &&
        draggedChat &&
        crossScopeTarget &&
        canMoveChatAcrossScope(draggedItem, dropTarget.kind, dropTarget.id, dropTarget.position)
      ) {
        if (dropTarget.position !== "inside") {
          const targetPosition = dropTarget.position
          if (crossScopeTarget.scope === "project" && dropTarget.kind === "project-child") {
            const activeIds = chatSections
              .filter(
                (section) =>
                  section.parentProjectId === crossScopeTarget.projectId && section.sectionDragId,
              )
              .map((section) => section.sectionDragId!)
            const movedId = `chat:${draggedChat.id}`
            setManualOrderByKey((prev) => ({
              ...prev,
              [`project:${crossScopeTarget.projectId}:children`]: moveIdInOrder(
                prev[`project:${crossScopeTarget.projectId}:children`] ?? [],
                [...activeIds.filter((id) => id !== movedId), movedId],
                movedId,
                dropTarget.id,
                targetPosition,
              ),
            }))
          } else if (crossScopeTarget.scope === "task" && dropTarget.kind === "task-chat") {
            const activeIds = agentChats
              .filter((chat) => !chat.isRemote && chat.taskId === crossScopeTarget.taskId)
              .map((chat) => chat.id)
            setManualOrderByKey((prev) => ({
              ...prev,
              [`task:${crossScopeTarget.taskId}:chats`]: moveIdInOrder(
                prev[`task:${crossScopeTarget.taskId}:chats`] ?? [],
                [...activeIds.filter((id) => id !== draggedChat.id), draggedChat.id],
                draggedChat.id,
                dropTarget.id,
                targetPosition,
              ),
            }))
          }
        }

        if (crossScopeTarget.scope === "project") {
          moveChatMutation.mutate({
            id: draggedChat.id,
            scope: "project",
            projectId: crossScopeTarget.projectId,
          })
        } else {
          moveChatMutation.mutate({
            id: draggedChat.id,
            scope: "task",
            taskId: crossScopeTarget.taskId,
          })
        }
        return
      }

      if (draggedItem.kind !== dropTarget.kind) return
      if (dropTarget.position === "inside") return
      const reorderPosition = dropTarget.position

      const context = getReorderContext(dropTarget.kind, draggedItem.id, dropTarget.id)
      if (!context) return

      flushSync(() => {
        setManualOrderByKey((prev) => ({
          ...prev,
          [context.key]: moveIdInOrder(
            prev[context.key] ?? [],
            context.activeIds,
            draggedItem.id,
            dropTarget.id,
            reorderPosition,
          ),
        }))
      })
    },
    [
      canMoveChatAcrossScope,
      agentChats,
      chatSections,
      crossScopeMoveEnabled,
      getCrossScopeDropTarget,
      getDraggedLocalChat,
      getReorderContext,
      moveChatMutation,
    ],
  )

  const handleDropItem = useCallback(
    (kind: string, id: string, position: SidebarDropPosition) => {
      const activeDraggingItem = draggingItemRef.current ?? draggingItem
      if (!activeDraggingItem) {
        clearDragState()
        return
      }
      const displayedDropTarget =
        dragOverItemRef.current ??
        dragOverItem ??
        normalizeDropTarget(activeDraggingItem, kind, id, position)
      if (!displayedDropTarget) {
        clearDragState()
        return
      }
      let dropTargetId = displayedDropTarget?.id ?? id
      let dropPosition = displayedDropTarget?.position ?? position
      const dropTargetKind = displayedDropTarget?.kind ?? kind

      if (activeDraggingItem.id === dropTargetId) {
        clearDragState()
        return
      }

      commitDropTarget(activeDraggingItem, {
        kind: dropTargetKind,
        id: dropTargetId,
        position: dropPosition,
      })

      clearDragState()
    },
    [clearDragState, commitDropTarget, dragOverItem, draggingItem, normalizeDropTarget],
  )

  const handleDragEndItem = useCallback(() => {
    const activeDraggingItem = draggingItemRef.current ?? draggingItem
    const activeDragOverItem = dragOverItemRef.current ?? dragOverItem
    if (activeDraggingItem && activeDragOverItem) {
      commitDropTarget(activeDraggingItem, activeDragOverItem)
    }
    clearDragState()
  }, [clearDragState, commitDropTarget, dragOverItem, draggingItem])

  const isCrossScopeDragTarget = Boolean(
    draggingItem &&
    dragOverItem &&
    canMoveChatAcrossScope(draggingItem, dragOverItem.kind, dragOverItem.id, dragOverItem.position),
  )

  const showsCrossScopeAddIndicator = Boolean(
    isCrossScopeDragTarget &&
    dragOverItem &&
    (dragOverItem.position === "inside" ||
      dragOverItem.kind.endsWith("chat") ||
      (dragOverItem.kind === "project-child" && !dragOverItem.id.startsWith("task:"))),
  )

  const crossScopeIndicatorTarget =
    isCrossScopeDragTarget && dragOverItem
      ? getCrossScopeDropTarget(dragOverItem.kind, dragOverItem.id, dragOverItem.position)
      : null
  const indicatorTask =
    crossScopeIndicatorTarget?.scope === "task"
      ? tasks?.find((task) => task.id === crossScopeIndicatorTarget.taskId)
      : null
  const indicatorIds = resolveMoveIndicatorIds({
    targetScope: crossScopeIndicatorTarget?.scope ?? null,
    targetProjectId:
      crossScopeIndicatorTarget?.scope === "project"
        ? crossScopeIndicatorTarget.projectId
        : (indicatorTask?.projectId ?? null),
    targetTaskId:
      crossScopeIndicatorTarget?.scope === "task" ? crossScopeIndicatorTarget.taskId : null,
    sourceProjectId: getDraggedLocalChat(draggingItem)?.projectId ?? null,
  })

  const hasValidDropTarget = Boolean(
    draggingItem && dragOverItem && draggingItem.id !== dragOverItem.id,
  )
  const isTaskInsertionTarget = Boolean(
    hasValidDropTarget &&
    dragOverItem &&
    (dragOverItem.kind === "task-chat" ||
      (dragOverItem.kind === "task" && dragOverItem.position === "inside") ||
      (dragOverItem.kind === "project-child" &&
        dragOverItem.id.startsWith("task:") &&
        dragOverItem.position === "inside")),
  )

  useEffect(() => {
    if (!draggingItem) return
    const cursor = resolveSidebarDragCursor({
      hasValidDropTarget,
      isInsertionTarget: showsCrossScopeAddIndicator || isTaskInsertionTarget,
    })
    document.body.dataset.sidebarPointerDragCursor = cursor
    document.body.style.cursor = cursor
    return () => {
      delete document.body.dataset.sidebarPointerDragCursor
      document.body.style.cursor = ""
    }
  }, [draggingItem, hasValidDropTarget, isTaskInsertionTarget, showsCrossScopeAddIndicator])

  // Clear sidebar drag/press state on releases and app focus changes. Native
  // drag events can miss the source node when a drag ends over another window.
  useEffect(() => {
    if (!isSidebarPressed) return
    document.addEventListener("mouseup", clearPressedState, true)
    document.addEventListener("pointerup", clearPressedState, true)
    document.addEventListener("pointercancel", clearPressedState, true)
    document.addEventListener("dragend", clearPressedState)
    document.addEventListener("drop", clearPressedState)
    window.addEventListener("blur", clearPressedState)
    return () => {
      document.removeEventListener("mouseup", clearPressedState, true)
      document.removeEventListener("pointerup", clearPressedState, true)
      document.removeEventListener("pointercancel", clearPressedState, true)
      document.removeEventListener("dragend", clearPressedState)
      document.removeEventListener("drop", clearPressedState)
      window.removeEventListener("blur", clearPressedState)
    }
  }, [clearPressedState, isSidebarPressed])

  useEffect(() => {
    const clearActiveDrag = () => {
      if (!draggingItemRef.current && !dragOverItemRef.current) return
      clearDragState()
      clearPressedState()
    }

    const clearOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearActiveDrag()
    }

    const clearOnVisibilityChange = () => {
      if (document.visibilityState !== "visible") clearActiveDrag()
    }

    document.addEventListener("dragend", clearActiveDrag)
    document.addEventListener("drop", clearActiveDrag)
    document.addEventListener("keydown", clearOnEscape, true)
    document.addEventListener("visibilitychange", clearOnVisibilityChange)
    window.addEventListener("blur", clearActiveDrag)

    return () => {
      document.removeEventListener("dragend", clearActiveDrag)
      document.removeEventListener("drop", clearActiveDrag)
      document.removeEventListener("keydown", clearOnEscape, true)
      document.removeEventListener("visibilitychange", clearOnVisibilityChange)
      window.removeEventListener("blur", clearActiveDrag)
    }
  }, [clearDragState, clearPressedState])

  const handleSidebarMouseDownCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // Don't hide when the press is on an action button itself - that would break
    // clicking "+" / "⋯".
    if ((e.target as HTMLElement).closest("[data-section-action]")) return
    setIsSidebarPressed(true)
  }, [])

  const archivedLifecycleItems = useMemo(() => {
    const projectItems =
      archivedProjects?.map((project) => ({
        id: project.id,
        type: "project" as const,
        title: project.gitRepo || project.name,
        subtitle: "Project",
        archivedAt: project.archivedAt,
      })) ?? []
    const activeAndArchivedProjects = new Map(
      [...(projects ?? []), ...(archivedProjects ?? [])].map((project) => [project.id, project]),
    )
    const activeAndArchivedTasks = new Map(
      [...(tasks ?? []), ...(archivedTasks ?? [])].map((task) => [task.id, task]),
    )
    const taskItems =
      archivedTasks?.map((task) => {
        const project = activeAndArchivedProjects.get(task.projectId)
        return {
          id: task.id,
          type: "task" as const,
          title: task.name,
          subtitle: project ? `Task / ${project.gitRepo || project.name}` : "Task",
          archivedAt: task.archivedAt,
        }
      }) ?? []
    const chatItems =
      archivedChats?.map((chat) => {
        const project = chat.projectId ? activeAndArchivedProjects.get(chat.projectId) : null
        const task = chat.taskId ? activeAndArchivedTasks.get(chat.taskId) : null
        const scopeLabel =
          chat.scope === "global" || (!chat.projectId && !chat.taskId)
            ? "Global chat"
            : task
              ? `Chat / ${task.name}`
              : project
                ? `Chat / ${project.gitRepo || project.name}`
                : "Chat"
        return {
          id: chat.id,
          type: "chat" as const,
          title: chat.name || "New chat",
          subtitle: scopeLabel,
          archivedAt: chat.archivedAt,
        }
      }) ?? []

    return [...projectItems, ...taskItems, ...chatItems].sort((a, b) => {
      const aTime = a.archivedAt ? new Date(a.archivedAt).getTime() : 0
      const bTime = b.archivedAt ? new Date(b.archivedAt).getTime() : 0
      return bTime - aTime
    })
  }, [archivedChats, archivedProjects, archivedTasks, projects, tasks])

  const visibleArchivedLifecycleItems = useMemo(() => {
    const query = archiveSearchQuery.trim().toLocaleLowerCase()
    if (!query) return archivedLifecycleItems
    return archivedLifecycleItems.filter(
      (item) =>
        item.title.toLocaleLowerCase().includes(query) ||
        item.subtitle.toLocaleLowerCase().includes(query),
    )
  }, [archiveSearchQuery, archivedLifecycleItems])

  const visibleArchivedChatIds = useMemo(
    () =>
      visibleArchivedLifecycleItems.filter((item) => item.type === "chat").map((item) => item.id),
    [visibleArchivedLifecycleItems],
  )
  const allVisibleArchivedChatsSelected =
    visibleArchivedChatIds.length > 0 &&
    visibleArchivedChatIds.every((id) => selectedArchivedChatIds.has(id))

  useEffect(() => {
    const currentIds = new Set(archivedChats?.map((chat) => chat.id) ?? [])
    setSelectedArchivedChatIds((selectedIds) => {
      const nextIds = new Set([...selectedIds].filter((id) => currentIds.has(id)))
      return nextIds.size === selectedIds.size ? selectedIds : nextIds
    })
  }, [archivedChats])

  const handleToggleArchivedChatSelection = useCallback((chatId: string) => {
    setSelectedArchivedChatIds((selectedIds) => {
      const nextIds = new Set(selectedIds)
      if (nextIds.has(chatId)) nextIds.delete(chatId)
      else nextIds.add(chatId)
      return nextIds
    })
  }, [])

  const handleToggleSelectAllArchivedChats = useCallback(() => {
    if (allVisibleArchivedChatsSelected) {
      setSelectedArchivedChatIds(new Set())
      return
    }
    setSelectedArchivedChatIds((selectedIds) => {
      const nextIds = new Set(selectedIds)
      visibleArchivedChatIds.forEach((id) => nextIds.add(id))
      return nextIds
    })
  }, [allVisibleArchivedChatsSelected, visibleArchivedChatIds])

  const handleDeleteArchivedChats = useCallback(() => {
    const selectedIds = [...selectedArchivedChatIds]
    if (selectedIds.length === 0) return
    const confirmed = window.confirm(
      `Permanently delete ${selectedIds.length} selected archived ${
        selectedIds.length === 1 ? "chat" : "chats"
      } and any related worktrees?`,
    )
    if (confirmed) deleteArchivedChatsMutation.mutate({ ids: selectedIds })
  }, [deleteArchivedChatsMutation, selectedArchivedChatIds])

  const handleRestoreLifecycleItem = useCallback(
    (item: (typeof archivedLifecycleItems)[number]) => {
      if (item.type === "project") {
        restoreProjectMutation.mutate({ id: item.id })
      } else if (item.type === "task") {
        restoreTaskMutation.mutate({ id: item.id })
      } else {
        restoreChatMutation.mutate({ id: item.id })
      }
    },
    [restoreChatMutation, restoreProjectMutation, restoreTaskMutation],
  )

  // Handle bulk archive of selected chats
  const handleBulkArchive = useCallback(() => {
    const chatIdsToArchive = Array.from(selectedChatIds)
    if (chatIdsToArchive.length === 0) return

    // Separate remote and local chats
    const remoteIds: string[] = []
    const localIds: string[] = []
    for (const chatId of chatIdsToArchive) {
      const chat = agentChats?.find((c) => c.id === chatId)
      if (chat?.isRemote) {
        // Extract original ID from prefixed remote ID
        remoteIds.push(chatId.replace(/^remote_/, ""))
      } else {
        localIds.push(chatId)
      }
    }

    // If active chat is being archived, navigate to previous or new workspace
    const isArchivingActiveChat = selectedChatId && chatIdsToArchive.includes(selectedChatId)

    const onSuccessCallback = () => {
      if (isArchivingActiveChat) {
        // Check if previous chat is available (exists and not being archived)
        const remainingChats = filteredChats.filter((c) => !chatIdsToArchive.includes(c.id))
        const isPreviousAvailable =
          previousChatId && remainingChats.some((c) => c.id === previousChatId)

        if (isPreviousAvailable) {
          setSelectedChatId(previousChatId)
        } else {
          setSelectedChatId(null)
        }
      }
      clearChatSelection()
    }

    // Track completions for combined callback
    let completedCount = 0
    const expectedCount = (remoteIds.length > 0 ? 1 : 0) + (localIds.length > 0 ? 1 : 0)

    const handlePartialSuccess = (archivedIds: string[], isRemote: boolean) => {
      // Add remote chats to undo stack
      if (isRemote) {
        const newItems: UndoItem[] = archivedIds.map((id) => {
          const timeoutId = setTimeout(() => removeWorkspaceFromStack(`remote_${id}`), 10000)
          return { type: "workspace" as const, chatId: `remote_${id}`, timeoutId, isRemote: true }
        })
        setUndoStack((prev) => [...prev, ...newItems])
      }

      completedCount++
      if (completedCount === expectedCount) {
        onSuccessCallback()
      }
    }

    // Archive remote chats
    if (remoteIds.length > 0) {
      archiveRemoteChatsBatchMutation.mutate(remoteIds, {
        onSuccess: () => handlePartialSuccess(remoteIds, true),
      })
    }

    // Archive local chats
    if (localIds.length > 0) {
      archiveChatsBatchMutation.mutate(
        { chatIds: localIds },
        {
          onSuccess: () => handlePartialSuccess(localIds, false),
        },
      )
    }
  }, [
    selectedChatIds,
    selectedChatId,
    previousChatId,
    filteredChats,
    agentChats,
    archiveChatsBatchMutation,
    archiveRemoteChatsBatchMutation,
    setSelectedChatId,
    clearChatSelection,
    removeWorkspaceFromStack,
    setUndoStack,
  ])

  const handleArchiveAllBelow = useCallback(
    (chatId: string) => {
      const currentIndex = filteredChats.findIndex((c) => c.id === chatId)
      if (currentIndex === -1 || currentIndex === filteredChats.length - 1) return

      const chatsBelow = filteredChats.slice(currentIndex + 1)

      // Separate remote and local chats
      const remoteIds: string[] = []
      const localIds: string[] = []
      for (const chat of chatsBelow) {
        if (chat.isRemote) {
          remoteIds.push(chat.id.replace(/^remote_/, ""))
        } else {
          localIds.push(chat.id)
        }
      }

      // Archive remote chats
      if (remoteIds.length > 0) {
        archiveRemoteChatsBatchMutation.mutate(remoteIds, {
          onSuccess: () => {
            const newItems: UndoItem[] = remoteIds.map((id) => {
              const timeoutId = setTimeout(() => removeWorkspaceFromStack(`remote_${id}`), 10000)
              return {
                type: "workspace" as const,
                chatId: `remote_${id}`,
                timeoutId,
                isRemote: true,
              }
            })
            setUndoStack((prev) => [...prev, ...newItems])
          },
        })
      }

      // Archive local chats
      if (localIds.length > 0) {
        archiveChatsBatchMutation.mutate({ chatIds: localIds })
      }
    },
    [
      filteredChats,
      archiveChatsBatchMutation,
      archiveRemoteChatsBatchMutation,
      removeWorkspaceFromStack,
      setUndoStack,
    ],
  )

  const handleArchiveOthers = useCallback(
    (chatId: string) => {
      const otherChats = filteredChats.filter((c) => c.id !== chatId)

      // Separate remote and local chats
      const remoteIds: string[] = []
      const localIds: string[] = []
      for (const chat of otherChats) {
        if (chat.isRemote) {
          remoteIds.push(chat.id.replace(/^remote_/, ""))
        } else {
          localIds.push(chat.id)
        }
      }

      // Archive remote chats
      if (remoteIds.length > 0) {
        archiveRemoteChatsBatchMutation.mutate(remoteIds, {
          onSuccess: () => {
            const newItems: UndoItem[] = remoteIds.map((id) => {
              const timeoutId = setTimeout(() => removeWorkspaceFromStack(`remote_${id}`), 10000)
              return {
                type: "workspace" as const,
                chatId: `remote_${id}`,
                timeoutId,
                isRemote: true,
              }
            })
            setUndoStack((prev) => [...prev, ...newItems])
          },
        })
      }

      // Archive local chats
      if (localIds.length > 0) {
        archiveChatsBatchMutation.mutate({ chatIds: localIds })
      }
    },
    [
      filteredChats,
      archiveChatsBatchMutation,
      archiveRemoteChatsBatchMutation,
      removeWorkspaceFromStack,
      setUndoStack,
    ],
  )

  // Delete a draft from localStorage
  const handleDeleteDraft = useCallback(
    (draftId: string) => {
      deleteNewChatDraft(draftId)
      // If the deleted draft was selected, clear selection
      if (selectedDraftId === draftId) {
        setSelectedDraftId(null)
      }
    },
    [selectedDraftId, setSelectedDraftId],
  )

  // Select a draft for editing
  const handleDraftSelect = useCallback(
    (draftId: string) => {
      // Navigate to NewChatForm with this draft selected
      openNewChatDraft(draftId)
      setSelectedChatId(null)
      setSelectedDraftId(draftId)
      setShowNewChatForm(false) // Clear explicit new chat state when selecting a draft
      if (isMobileFullscreen && onChatSelect) {
        onChatSelect()
      }
    },
    [setSelectedChatId, setSelectedDraftId, setShowNewChatForm, isMobileFullscreen, onChatSelect],
  )

  // Reset focused index when search query changes
  useEffect(() => {
    setFocusedChatIndex(-1)
  }, [searchQuery, filteredChats.length])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedChatIndex >= 0 && filteredChats.length > 0) {
      const focusedElement = scrollContainerRef.current?.querySelector(
        `[data-chat-index="${focusedChatIndex}"]`,
      ) as HTMLElement
      if (focusedElement) {
        focusedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        })
      }
    }
  }, [focusedChatIndex, filteredChats.length])

  // Derive which chats have loading sub-chats
  const loadingChatIds = useMemo(() => new Set([...loadingSubChats.values()]), [loadingSubChats])

  // Convert file stats to a Map for easy lookup (local chats only; remote chats
  // have no sidebar stats in local-first mode).
  const workspaceFileStats = useMemo(() => {
    const statsMap = new Map<string, { fileCount: number; additions: number; deletions: number }>()

    // For local mode, use stats from DB query
    if (fileStatsData) {
      for (const stat of fileStatsData) {
        statsMap.set(stat.chatId, {
          fileCount: stat.fileCount,
          additions: stat.additions,
          deletions: stat.deletions,
        })
      }
    }

    return statsMap
  }, [fileStatsData])

  // Aggregate pending plan approvals by workspace (chatId) from DB
  const workspacePendingPlans = useMemo(() => {
    const chatIdsWithPendingPlans = new Set<string>()
    if (pendingPlanApprovalsData) {
      for (const { chatId } of pendingPlanApprovalsData) {
        chatIdsWithPendingPlans.add(chatId)
      }
    }
    return chatIdsWithPendingPlans
  }, [pendingPlanApprovalsData])

  // Get workspace IDs that have pending user questions
  const workspacePendingQuestions = useMemo(() => {
    const chatIds = new Set<string>()
    for (const question of pendingQuestions.values()) {
      chatIds.add(question.parentChatId)
    }
    return chatIds
  }, [pendingQuestions])

  const handleAddExistingProject = () => {
    triggerHaptic("light")
    openProjectMutation.mutate()
  }

  const handleCloneProject = () => {
    const repoUrl = window.prompt("GitHub repository URL or owner/repo")
    if (!repoUrl?.trim()) return
    triggerHaptic("light")
    cloneProjectMutation.mutate({ repoUrl: repoUrl.trim() })
  }

  const handleOrderProjects = useCallback(
    (order: SidebarProjectOrder) => {
      setManualOrderByKey((current) => ({
        ...current,
        projects: orderSidebarProjects(projects ?? [], order),
      }))
    },
    [projects],
  )

  const openNewGlobalChat = useCallback(() => {
    triggerHaptic("light")
    localStorage.setItem("flapstack:new-chat-scope", "global")
    localStorage.removeItem("flapstack:new-chat-task-id")
    setSelectedChatScope({ type: "global", id: "global", name: "Global chats" })
    setSelectedChatId(null)
    setSelectedChatIsRemote(false)
    setSelectedDraftId(null)
    startNewChatFormSession((session) => session + 1)
    setShowNewChatForm(true)
    setDesktopView(null)
    setSearchQuery("")
    if (isMobileFullscreen && onChatSelect) {
      onChatSelect()
    }
  }, [
    triggerHaptic,
    setSelectedChatScope,
    setSelectedChatId,
    setSelectedChatIsRemote,
    setSelectedDraftId,
    startNewChatFormSession,
    setShowNewChatForm,
    setDesktopView,
    isMobileFullscreen,
    onChatSelect,
  ])

  const openNewProjectChat = useCallback(
    (projectId: string) => {
      const project = projects?.find((candidate) => candidate.id === projectId)
      if (!project) return

      remindAboutProjectDrafts(project)

      triggerHaptic("light")
      localStorage.setItem("flapstack:new-chat-scope", "project")
      localStorage.removeItem("flapstack:new-chat-task-id")
      setSelectedChatScope({ type: "project", id: project.id, name: project.name })
      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl,
        gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
        gitOwner: project.gitOwner,
        gitRepo: project.gitRepo,
      })
      setSelectedChatId(null)
      setSelectedChatIsRemote(false)
      setSelectedDraftId(null)
      startNewChatFormSession((session) => session + 1)
      setShowNewChatForm(true)
      setDesktopView(null)
      setSearchQuery("")
      if (isMobileFullscreen && onChatSelect) {
        onChatSelect()
      }
    },
    [
      projects,
      remindAboutProjectDrafts,
      triggerHaptic,
      setSelectedChatScope,
      setSelectedProject,
      setSelectedChatId,
      setSelectedChatIsRemote,
      setSelectedDraftId,
      startNewChatFormSession,
      setShowNewChatForm,
      setDesktopView,
      isMobileFullscreen,
      onChatSelect,
    ],
  )

  const createProjectTask = useCallback(
    (projectId: string) => {
      const project = projects?.find((candidate) => candidate.id === projectId)
      if (!project) return

      setNewTaskProject({
        id: project.id,
        name: project.gitRepo || project.name,
      })
    },
    [projects],
  )

  const openNewTaskChat = useCallback(
    (taskId: string) => {
      const task = tasks?.find((candidate) => candidate.id === taskId)
      if (!task) return
      const project = projects?.find((candidate) => candidate.id === task.projectId)
      if (!project) return

      remindAboutProjectDrafts(project)

      triggerHaptic("light")
      localStorage.setItem("flapstack:new-chat-scope", "task")
      localStorage.setItem("flapstack:new-chat-task-id", task.id)
      setSelectedChatScope({
        type: "task",
        id: task.id,
        name: task.name,
        projectId: project.id,
        projectName: project.name,
      })
      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl,
        gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
        gitOwner: project.gitOwner,
        gitRepo: project.gitRepo,
      })
      setSelectedChatId(null)
      setSelectedChatIsRemote(false)
      setSelectedDraftId(null)
      startNewChatFormSession((session) => session + 1)
      setShowNewChatForm(true)
      setDesktopView(null)
      setSearchQuery("")
      if (isMobileFullscreen && onChatSelect) {
        onChatSelect()
      }
    },
    [
      tasks,
      projects,
      remindAboutProjectDrafts,
      triggerHaptic,
      setSelectedChatScope,
      setSelectedProject,
      setSelectedChatId,
      setSelectedChatIsRemote,
      setSelectedDraftId,
      startNewChatFormSession,
      setShowNewChatForm,
      setDesktopView,
      isMobileFullscreen,
      onChatSelect,
    ],
  )

  const handleCreateTaskSave = useCallback(
    async (name: string) => {
      if (!newTaskProject) return

      await createTaskMutation.mutateAsync({
        projectId: newTaskProject.id,
        name,
      })
      setNewTaskProject(null)
    },
    [createTaskMutation, newTaskProject],
  )

  const handleChatClick = useCallback(
    async (chatId: string, e?: React.MouseEvent, globalIndex?: number) => {
      // Shift+click for range selection (works in both normal and multi-select mode)
      if (e?.shiftKey) {
        e.preventDefault()

        const clickedIndex = globalIndex ?? filteredChats.findIndex((c) => c.id === chatId)

        if (clickedIndex === -1) return

        // Find the anchor: use active chat or last selected item
        let anchorIndex = -1

        // First try: use currently active/selected chat as anchor
        if (selectedChatId) {
          anchorIndex = filteredChats.findIndex((c) => c.id === selectedChatId)
        }

        // If no active chat, try to use the last item in selection
        if (anchorIndex === -1 && selectedChatIds.size > 0) {
          // Find the first selected item in the list as anchor
          for (let i = 0; i < filteredChats.length; i++) {
            if (selectedChatIds.has(filteredChats[i]!.id)) {
              anchorIndex = i
              break
            }
          }
        }

        // If still no anchor, just select the clicked item
        if (anchorIndex === -1) {
          if (!selectedChatIds.has(chatId)) {
            toggleChatSelection(chatId)
          }
          return
        }

        // Select range from anchor to clicked item
        const startIndex = Math.min(anchorIndex, clickedIndex)
        const endIndex = Math.max(anchorIndex, clickedIndex)

        // Build new selection set with the range
        const newSelection = new Set(selectedChatIds)
        for (let i = startIndex; i <= endIndex; i++) {
          const chat = filteredChats[i]
          if (chat) {
            newSelection.add(chat.id)
          }
        }
        setSelectedChatIds(newSelection)
        return
      }

      // In multi-select mode, clicking on the item still navigates to the chat
      // Only clicking on the checkbox toggles selection

      // Check if this is a remote chat (has remote_ prefix)
      const isRemote = chatId.startsWith("remote_")
      // Extract original ID for remote chats
      const originalId = isRemote ? chatId.replace(/^remote_/, "") : chatId

      // Prevent opening same chat in multiple windows.
      // Claim new chat BEFORE releasing old one - if claim fails, we keep the current chat.
      if (window.desktopApi?.claimChat) {
        const result = await window.desktopApi.claimChat(originalId)
        if (!result.ok) {
          toast.info("This chat is already open in another window", {
            description: "Switching to the existing window.",
            duration: 3000,
          })
          await window.desktopApi.focusChatOwner(originalId)
          return
        }
      }

      if (!isRemote) {
        window.dispatchEvent(
          new CustomEvent(CHAT_WORKBENCH_SELECT_CHAT_EVENT, {
            detail: { chatId: originalId },
          }),
        )
      }

      setSelectedChatId(originalId)
      setSelectedChatIsRemote(isRemote)
      if (!isRemote) {
        const chat = agentChats.find((candidate) => candidate.id === originalId)
        if (chat?.taskId && chat.projectId) {
          const task = tasks?.find((candidate) => candidate.id === chat.taskId)
          const project = projects?.find((candidate) => candidate.id === chat.projectId)
          setSelectedChatScope({
            type: "task",
            id: chat.taskId,
            name: task?.name ?? "Task",
            projectId: chat.projectId,
            projectName: project?.name ?? null,
          })
        } else if (chat?.projectId) {
          const project = projects?.find((candidate) => candidate.id === chat.projectId)
          setSelectedChatScope({
            type: "project",
            id: chat.projectId,
            name: project?.name ?? "Project",
          })
        } else {
          setSelectedChatScope({ type: "global", id: "global", name: "Global chats" })
        }
      }
      // Sync chatSourceMode for ChatView to load data from correct source
      setChatSourceMode(isRemote ? "sandbox" : "local")
      setShowNewChatForm(false) // Clear new chat form state when selecting a workspace
      setDesktopView(null) // Clear automations/inbox view when selecting a chat
      // On mobile, notify parent to switch to chat mode
      if (isMobileFullscreen && onChatSelect) {
        onChatSelect()
      }
    },
    [
      filteredChats,
      selectedChatId,
      selectedChatIds,
      toggleChatSelection,
      setSelectedChatIds,
      setSelectedChatId,
      setSelectedChatIsRemote,
      setChatSourceMode,
      setSelectedChatScope,
      setShowNewChatForm,
      setDesktopView,
      isMobileFullscreen,
      onChatSelect,
      agentChats,
      projects,
      tasks,
    ],
  )

  const handleSelectScope = useCallback(
    (scope: SelectedChatScope) => {
      triggerHaptic("light")
      setSelectedChatScope(scope)
      if (!scope) {
        localStorage.removeItem("flapstack:new-chat-scope")
        localStorage.removeItem("flapstack:new-chat-task-id")
        setShowNewChatForm(false)
        setDesktopView(null)
        setSearchQuery("")
        return
      }
      localStorage.setItem("flapstack:new-chat-scope", scope.type)
      if (scope.type === "task") {
        localStorage.setItem("flapstack:new-chat-task-id", scope.id)
      } else {
        localStorage.removeItem("flapstack:new-chat-task-id")
      }
      setSelectedChatId(null)
      setSelectedChatIsRemote(false)
      setSelectedDraftId(null)
      setShowNewChatForm(false)
      setDesktopView(null)
      setSearchQuery("")

      const projectId =
        scope.type === "project" ? scope.id : scope.type === "task" ? scope.projectId : null
      const project = projectId ? projects?.find((candidate) => candidate.id === projectId) : null
      if (project) {
        setSelectedProject({
          id: project.id,
          name: project.name,
          path: project.path,
          gitRemoteUrl: project.gitRemoteUrl,
          gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
          gitOwner: project.gitOwner,
          gitRepo: project.gitRepo,
        })
      }

      if (isMobileFullscreen && onChatSelect) {
        onChatSelect()
      }
    },
    [
      triggerHaptic,
      setSelectedChatScope,
      setSelectedChatId,
      setSelectedChatIsRemote,
      setSelectedDraftId,
      setShowNewChatForm,
      setDesktopView,
      projects,
      setSelectedProject,
      isMobileFullscreen,
      onChatSelect,
    ],
  )

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent, chatId: string) => {
      e.stopPropagation()
      toggleChatSelection(chatId)
    },
    [toggleChatSelection],
  )

  const formatTime = useCallback((dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60_000)
    const diffHours = Math.floor(diffMs / 3_600_000)
    const diffDays = Math.floor(diffMs / 86_400_000)

    if (diffMins < 1) return "now"
    if (diffMins < 60) return `${diffMins}m`
    if (diffHours < 24) return `${diffHours}h`
    if (diffDays < 7) return `${diffDays}d`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`
    return `${Math.floor(diffDays / 365)}y`
  }, [])

  // Archive single chat - wrapped for memoized component
  // Checks for active terminal processes and worktree, shows confirmation dialog if needed
  const handleArchiveSingle = useCallback(
    async (chatId: string) => {
      // Check if this specific chat is remote
      const chat = agentChats?.find((c) => c.id === chatId)
      const chatIsRemote = chat?.isRemote ?? false

      // For remote chats, archive directly (no local processes/worktree to check)
      if (chatIsRemote) {
        // Extract original ID from prefixed remote ID (remove "remote_" prefix)
        const originalId = chatId.replace(/^remote_/, "")
        archiveRemoteChatMutation.mutate(originalId, {
          onSuccess: () => {
            // Handle navigation after archive (same logic as local)
            if (selectedChatId === chatId) {
              const currentIndex = agentChats?.findIndex((c) => c.id === chatId) ?? -1

              if (autoAdvanceTarget === "next") {
                const nextChat = agentChats?.find((c, i) => i > currentIndex && c.id !== chatId)
                setSelectedChatId(nextChat?.id ?? null)
              } else if (autoAdvanceTarget === "previous") {
                const isPreviousAvailable =
                  previousChatId &&
                  agentChats?.some((c) => c.id === previousChatId && c.id !== chatId)
                setSelectedChatId(isPreviousAvailable ? previousChatId : null)
              } else {
                setSelectedChatId(null)
              }
            }

            // Add to undo stack for Cmd+Z
            const timeoutId = setTimeout(() => {
              removeWorkspaceFromStack(chatId)
            }, 10000)

            setUndoStack((prev) => [
              ...prev,
              {
                type: "workspace",
                chatId,
                timeoutId,
                isRemote: true,
              },
            ])
          },
          onError: (error) => {
            console.error("[handleArchiveSingle] Failed to archive remote chat:", error)
            toast.error("Failed to archive chat")
          },
        })
        return
      }

      const isLocalMode = !chat?.branch
      const sessionCount = isLocalMode
        ? 0
        : await utils.terminal.getActiveSessionCount.fetch({ workspaceId: chatId })

      const needsConfirmation = sessionCount > 0

      if (needsConfirmation) {
        // Show confirmation dialog
        setArchivingChatId(chatId)
        setActiveProcessCount(sessionCount)
        setConfirmArchiveDialogOpen(true)
      } else {
        // No active processes and no worktree, archive directly
        archiveChatMutation.mutate({ id: chatId })
      }
    },
    [
      agentChats,
      archiveRemoteChatMutation,
      archiveChatMutation,
      utils.terminal.getActiveSessionCount,
      selectedChatId,
      autoAdvanceTarget,
      previousChatId,
      setSelectedChatId,
      removeWorkspaceFromStack,
      setUndoStack,
    ],
  )

  // Confirm archive after user accepts dialog (optimistic - closes immediately)
  const handleConfirmArchive = useCallback(() => {
    if (archivingChatId) {
      archiveChatMutation.mutate({ id: archivingChatId })
      setArchivingChatId(null)
    }
  }, [archiveChatMutation, archivingChatId])

  // Close archive confirmation dialog
  const handleCloseArchiveDialog = useCallback(() => {
    setConfirmArchiveDialogOpen(false)
    setArchivingChatId(null)
  }, [])

  // Handle open locally for sandbox chats
  const handleOpenLocally = useCallback(
    (chatId: string) => {
      const originalId = chatId.replace(/^remote_/, "")
      const remoteChat = remoteChats?.find((c) => c.id === originalId)
      if (!remoteChat) return

      const matchingProjects = getMatchingProjects(projects ?? [], remoteChat)

      if (matchingProjects.length === 1) {
        // Auto-import: single match found
        autoImport(remoteChat, matchingProjects[0]!)
      } else {
        // Show dialog: 0 or 2+ matches
        setImportingChatId(originalId)
        setImportDialogOpen(true)
      }
    },
    [remoteChats, projects, getMatchingProjects, autoImport],
  )

  // Close import sandbox dialog
  const handleCloseImportDialog = useCallback(() => {
    setImportDialogOpen(false)
    setImportingChatId(null)
  }, [])

  // Get the remote chat for import dialog
  const importingRemoteChat = useMemo(() => {
    if (!importingChatId || !remoteChats) return null
    return remoteChats.find((chat) => chat.id === importingChatId) ?? null
  }, [importingChatId, remoteChats])

  // Get matching projects for import dialog (only computed when dialog is open)
  const importMatchingProjects = useMemo(() => {
    if (!importingRemoteChat) return []
    return getMatchingProjects(projects ?? [], importingRemoteChat)
  }, [importingRemoteChat, projects, getMatchingProjects])

  // Copy branch name to clipboard
  const handleCopyBranch = useCallback((branch: string) => {
    navigator.clipboard.writeText(branch)
    toast.success("Branch name copied", { description: branch })
  }, [])

  // Ref callback for name elements
  const nameRefCallback = useCallback((chatId: string, el: HTMLSpanElement | null) => {
    if (el) {
      nameRefs.current.set(chatId, el)
    }
  }, [])

  // Handle agent card hover for truncated name tooltip (1s delay)
  // Uses DOM manipulation instead of state to avoid re-renders
  const handleAgentMouseEnter = useCallback(
    (chatId: string, name: string | null, cardElement: HTMLElement, globalIndex: number) => {
      // Update hovered index ref
      hoveredChatIndexRef.current = globalIndex

      // Prefetch chat data on hover for instant load on click (currently disabled to reduce memory pressure)
      if (ENABLE_CHAT_HOVER_PREFETCH) {
        const chat = agentChats?.find((c) => c.id === chatId)
        if (chat?.isRemote) {
          const originalId = chatId.replace(/^remote_/, "")
          prefetchRemoteChat(originalId)
        } else {
          prefetchLocalChat(chatId)
        }
      }

      // Clear any existing timer
      if (agentTooltipTimerRef.current) {
        clearTimeout(agentTooltipTimerRef.current)
      }

      const nameEl = nameRefs.current.get(chatId)
      if (!nameEl) return

      // Check if name is truncated
      const isTruncated = nameEl.scrollWidth > nameEl.clientWidth
      if (!isTruncated) return

      // Show tooltip after 1 second delay via DOM manipulation (no state update)
      agentTooltipTimerRef.current = setTimeout(() => {
        const tooltip = agentTooltipRef.current
        if (!tooltip) return

        const rect = cardElement.getBoundingClientRect()
        tooltip.style.display = "block"
        tooltip.style.top = `${rect.top + rect.height / 2}px`
        tooltip.style.left = `${rect.right + 8}px`
        tooltip.textContent = name || ""
      }, 1000)
    },
    [agentChats, prefetchRemoteChat, prefetchLocalChat, ENABLE_CHAT_HOVER_PREFETCH],
  )

  const handleAgentMouseLeave = useCallback(() => {
    // Reset hovered index
    hoveredChatIndexRef.current = -1
    // Clear timer if hovering ends before delay
    if (agentTooltipTimerRef.current) {
      clearTimeout(agentTooltipTimerRef.current)
      agentTooltipTimerRef.current = null
    }
    // Hide tooltip via DOM manipulation (no state update)
    const tooltip = agentTooltipRef.current
    if (tooltip) {
      tooltip.style.display = "none"
    }
  }, [])

  // Check if scroll is needed and show/hide gradients via DOM manipulation
  React.useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const checkScroll = () => {
      const needsScroll = container.scrollHeight > container.clientHeight
      if (needsScroll) {
        if (bottomGradientRef.current) bottomGradientRef.current.style.opacity = "1"
        if (topGradientRef.current) topGradientRef.current.style.opacity = "0"
      } else {
        if (bottomGradientRef.current) bottomGradientRef.current.style.opacity = "0"
        if (topGradientRef.current) topGradientRef.current.style.opacity = "0"
      }
    }

    checkScroll()
    // Re-check when content might change
    const resizeObserver = new ResizeObserver(checkScroll)
    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [filteredChats])

  // Direct listener for Cmd+K to focus search input
  useEffect(() => {
    const handleSearchHotkey = (e: KeyboardEvent) => {
      // Check for Cmd+K or Ctrl+K (only for search functionality)
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyK" && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()

        // Focus search input
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }

    window.addEventListener("keydown", handleSearchHotkey, true)

    return () => {
      window.removeEventListener("keydown", handleSearchHotkey, true)
    }
  }, [])

  // Multi-select hotkeys
  // X to toggle selection of hovered or focused chat
  useHotkeys(
    "x",
    () => {
      if (!filteredChats || filteredChats.length === 0) return

      // Prefer hovered, then focused - do NOT fallback to 0 (would conflict with sub-chat sidebar)
      const targetIndex =
        hoveredChatIndexRef.current >= 0
          ? hoveredChatIndexRef.current
          : focusedChatIndex >= 0
            ? focusedChatIndex
            : -1

      if (targetIndex >= 0 && targetIndex < filteredChats.length) {
        const chatId = filteredChats[targetIndex]!.id
        // Toggle selection (both select and deselect)
        toggleChatSelection(chatId)
      }
    },
    [filteredChats, focusedChatIndex, toggleChatSelection],
  )

  // Cmd+A / Ctrl+A to select all chats (only when at least one is already selected)
  useHotkeys(
    "mod+a",
    (e) => {
      if (isMultiSelectMode && filteredChats && filteredChats.length > 0) {
        e.preventDefault()
        selectAllChats(filteredChats.map((c) => c.id))
      }
    },
    [filteredChats, selectAllChats, isMultiSelectMode],
  )

  // Escape to clear selection
  useHotkeys(
    "escape",
    () => {
      if (isMultiSelectMode) {
        clearChatSelection()
        setFocusedChatIndex(-1)
      }
    },
    [isMultiSelectMode, clearChatSelection],
  )

  // Cmd+E to archive current workspace (desktop) or Opt+Cmd+E (web)
  useEffect(() => {
    const handleArchiveHotkey = (e: KeyboardEvent) => {
      const isDesktop = isDesktopApp()

      // Desktop: Cmd+E (without Alt)
      const isDesktopShortcut =
        isDesktop && e.metaKey && e.code === "KeyE" && !e.altKey && !e.shiftKey && !e.ctrlKey
      // Web: Opt+Cmd+E (with Alt)
      const isWebShortcut = e.altKey && e.metaKey && e.code === "KeyE"

      if (isDesktopShortcut || isWebShortcut) {
        e.preventDefault()

        // If multi-select mode, bulk archive selected chats
        if (isMultiSelectMode && selectedChatIds.size > 0) {
          const isPending =
            archiveRemoteChatsBatchMutation.isPending || archiveChatsBatchMutation.isPending
          if (!isPending) {
            handleBulkArchive()
          }
          return
        }

        // Otherwise archive current chat (with confirmation if has active processes)
        const isPending = archiveRemoteChatMutation.isPending || archiveChatMutation.isPending
        if (selectedChatId && !isPending) {
          handleArchiveSingle(selectedChatId)
        }
      }
    }

    window.addEventListener("keydown", handleArchiveHotkey)
    return () => window.removeEventListener("keydown", handleArchiveHotkey)
  }, [
    selectedChatId,
    archiveChatMutation,
    archiveRemoteChatMutation,
    isMultiSelectMode,
    selectedChatIds,
    archiveChatsBatchMutation,
    archiveRemoteChatsBatchMutation,
    handleBulkArchive,
    handleArchiveSingle,
  ])

  // Clear selection when project changes
  useEffect(() => {
    clearChatSelection()
  }, [selectedProject?.id, clearChatSelection])

  // Handle scroll for gradients - use DOM manipulation to avoid re-renders
  const handleAgentsScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    const needsScroll = scrollHeight > clientHeight

    if (!needsScroll) {
      if (topGradientRef.current) topGradientRef.current.style.opacity = "0"
      if (bottomGradientRef.current) bottomGradientRef.current.style.opacity = "0"
      return
    }

    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5
    const isAtTop = scrollTop <= 5

    // Update gradient visibility via DOM (no setState = no re-render)
    if (topGradientRef.current) {
      topGradientRef.current.style.opacity = isAtTop ? "0" : "1"
    }
    if (bottomGradientRef.current) {
      bottomGradientRef.current.style.opacity = isAtBottom ? "0" : "1"
    }
  }, [])

  const visibleChatSections = useMemo(
    () =>
      chatSections.filter(
        (section) =>
          !section.parentProjectId ||
          !collapsedSectionIds.has(`project-${section.parentProjectId}`),
      ),
    [chatSections, collapsedSectionIds],
  )

  const visibleProjectSections = useMemo(
    () =>
      visibleChatSections.filter(
        (section) => section.kind === "project" || section.kind === "task",
      ),
    [visibleChatSections],
  )

  const visibleOtherSections = useMemo(
    () =>
      visibleChatSections.filter(
        (section) => section.kind !== "project" && section.kind !== "task",
      ),
    [visibleChatSections],
  )

  const quickAccessHasChats =
    pinnedAgents.length > 0 ||
    starredAgents.length > 0 ||
    pinnedTasks.some((task) => task.chats.length > 0) ||
    starredTasks.some((task) => task.chats.length > 0) ||
    visibleOtherSections.some((section) => section.chats.length > 0)

  const boundaryHighlightIds = useMemo(
    () =>
      new Set(
        resolveBoundaryHighlightIds({
          items: visibleChatSections.map((section) => ({
            id: section.sectionDragId ?? "",
            groupId: section.parentProjectId ?? null,
          })),
          targetId: dragOverItem?.kind === "project-child" ? dragOverItem.id : null,
          position: dragOverItem?.position ?? null,
        }),
      ),
    [dragOverItem, visibleChatSections],
  )

  const projectAfterDropSectionIndex = useMemo(() => {
    if (dragOverItem?.kind !== "project" || dragOverItem.position !== "after") return -1
    return visibleProjectSections.reduce((lastIndex, section, index) => {
      const isTargetProjectHeader =
        section.lifecycleTarget?.type === "project" &&
        section.lifecycleTarget.id === dragOverItem.id
      const isTargetProjectChild = section.parentProjectId === dragOverItem.id
      return isTargetProjectHeader || isTargetProjectChild ? index : lastIndex
    }, -1)
  }, [dragOverItem, visibleProjectSections])

  const forceSidebarMoveCursor = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!draggingItemRef.current) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  const handleSidebarDropCapture = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      const activeDraggingItem = draggingItemRef.current
      const activeDragOverItem = dragOverItemRef.current
      if (!activeDraggingItem || !activeDragOverItem) return

      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
      commitDropTarget(activeDraggingItem, activeDragOverItem)
      clearDragState()
    },
    [clearDragState, commitDropTarget],
  )

  // While one of our own sidebar items is being dragged, force the "move" cursor
  // across the WHOLE document - not just inside the sidebar element. Otherwise the
  // moment the pointer crosses a gap, a Radix portal, the scroll edge, or leaves
  // the sidebar, Chromium/Electron on macOS reverts to the green "copy" (+) badge
  // stuck to the cursor. The ref guard means external drags (files into chat, etc.)
  // are untouched.
  useEffect(() => {
    const forceMove = (event: DragEvent) => {
      if (!draggingItemRef.current) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move"
    }
    document.addEventListener("dragenter", forceMove, true)
    document.addEventListener("dragover", forceMove, true)
    return () => {
      document.removeEventListener("dragenter", forceMove, true)
      document.removeEventListener("dragover", forceMove, true)
    }
  }, [])

  const sharedChatListSectionProps = {
    selectedChatId,
    selectedChatIsRemote,
    focusedChatIndex,
    loadingChatIds,
    unseenChanges,
    workspacePendingPlans,
    workspacePendingQuestions,
    isMultiSelectMode,
    selectedChatIds,
    isMobileFullscreen,
    isDesktop,
    pinnedChatIds,
    groupedChatIds,
    projectsMap,
    workspaceFileStats,
    filteredChats,
    canShowPinOption,
    areAllSelectedPinned,
    showIcon: showWorkspaceIcon,
    hasOpenChats: openChatIds.length > 0,
    moveDestinations,
    movePending: moveChatMutation.isPending,
    onChatClick: handleChatClick,
    onCheckboxClick: handleCheckboxClick,
    onMouseEnter: handleAgentMouseEnter,
    onMouseLeave: handleAgentMouseLeave,
    onArchive: handleArchiveSingle,
    onTogglePin: handleTogglePin,
    onToggleStar: handleToggleStar,
    onRenameClick: handleRenameClick,
    onCopyBranch: handleCopyBranch,
    onArchiveAllBelow: handleArchiveAllBelow,
    onArchiveOthers: handleArchiveOthers,
    onOpenLocally: handleOpenLocally,
    onMoveChat: handleMoveChat,
    onBulkPin: handleBulkPin,
    onBulkUnpin: handleBulkUnpin,
    onBulkArchive: handleBulkArchive,
    onCreateTaskChat: openNewTaskChat,
    onOpenRepositoryOverview: setRepositoryOverviewProjectId,
    planningEnabled: betaFeatures.planning,
    onToggleSection: handleToggleSection,
    onSelectScope: handleSelectScope,
    onDragStartItem: handleDragStartItem,
    onDragOverItem: handleDragOverItem,
    onDropItem: handleDropItem,
    onDragEndItem: handleDragEndItem,
    onToggleLifecyclePin: handleToggleLifecyclePin,
    onToggleLifecycleStar: handleToggleLifecycleStar,
    onArchiveLifecycle: handleArchiveLifecycle,
    archivePending: archiveChatMutation.isPending || archiveRemoteChatMutation.isPending,
    archiveBatchPending:
      archiveChatsBatchMutation.isPending || archiveRemoteChatsBatchMutation.isPending,
    nameRefCallback,
    formatTime,
    justCreatedIds,
    starredChatIds,
  }

  const renderSidebarSection = (
    section: (typeof visibleChatSections)[number],
    sectionIndex: number,
    sectionCount: number,
  ) => {
    const suppressProjectHeaderAfterDrop =
      section.lifecycleTarget?.type === "project" &&
      dragOverItem?.kind === "project" &&
      dragOverItem.id === section.lifecycleTarget.id &&
      dragOverItem.position === "after"

    return (
      <React.Fragment key={section.id}>
        <ChatListSection
          {...sharedChatListSectionProps}
          title={section.title}
          sectionId={section.id}
          sectionDragId={section.sectionDragId}
          hideHeader={section.hideHeader}
          parentProjectId={section.parentProjectId}
          kind={section.kind}
          projectColor={section.projectColor}
          showEmptyState={section.showEmptyState}
          isCollapsed={collapsedSectionIds.has(section.id)}
          isDraggingSection={
            Boolean(section.sectionDragId || section.lifecycleTarget) &&
            Boolean(draggingItem) &&
            draggingItem!.kind ===
              (section.sectionDragId ? "project-child" : section.lifecycleTarget?.type) &&
            draggingItem!.id === (section.sectionDragId ?? section.lifecycleTarget?.id)
          }
          isDragOverSection={
            Boolean(section.sectionDragId || section.lifecycleTarget) &&
            Boolean(dragOverItem) &&
            dragOverItem!.kind ===
              (section.sectionDragId ? "project-child" : section.lifecycleTarget?.type) &&
            dragOverItem!.id === (section.sectionDragId ?? section.lifecycleTarget?.id)
          }
          isSectionBoundaryHighlighted={
            Boolean(section.sectionDragId) && boundaryHighlightIds.has(section.sectionDragId!)
          }
          isMoveIntoSection={
            (section.lifecycleTarget?.type === "task" &&
              section.lifecycleTarget.id === indicatorIds.taskId) ||
            (section.lifecycleTarget?.type === "project" &&
              section.lifecycleTarget.id === indicatorIds.projectId)
          }
          dragOverSectionPosition={
            !suppressProjectHeaderAfterDrop &&
            Boolean(section.sectionDragId || section.lifecycleTarget) &&
            Boolean(dragOverItem) &&
            dragOverItem!.kind ===
              (section.sectionDragId ? "project-child" : section.lifecycleTarget?.type) &&
            dragOverItem!.id === (section.sectionDragId ?? section.lifecycleTarget?.id)
              ? dragOverItem!.position
              : null
          }
          draggingKind={draggingItem?.kind}
          draggingId={draggingItem?.id}
          dragOverKind={dragOverItem?.kind}
          dragOverId={dragOverItem?.id}
          dragOverPosition={dragOverItem?.position}
          lifecycleTarget={section.lifecycleTarget}
          chats={section.chats}
          onCreateGlobalChat={openNewGlobalChat}
          onCreateProjectChat={openNewProjectChat}
          onCreateProjectTask={createProjectTask}
          onChangeProjectColor={handleChangeProjectColor}
          lifecyclePending={
            pinProjectMutation.isPending ||
            unpinProjectMutation.isPending ||
            archiveProjectMutation.isPending ||
            pinTaskMutation.isPending ||
            unpinTaskMutation.isPending ||
            archiveTaskMutation.isPending
          }
        />
        {section.kind === "global" && sectionIndex < sectionCount - 1 && (
          <div aria-hidden="true" className="h-2.5" />
        )}
        {(section.kind === "project" || section.kind === "task") &&
          sectionIndex === projectAfterDropSectionIndex &&
          dragOverItem && (
            <DropSeparator
              onDragEnter={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = "move"
              }}
              onDragOver={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = "move"
                handleDragOverItem(dragOverItem.kind, dragOverItem.id, dragOverItem.position)
              }}
              onDrop={(event) => {
                event.preventDefault()
                event.dataTransfer.dropEffect = "move"
                handleDropItem(dragOverItem.kind, dragOverItem.id, dragOverItem.position)
              }}
            />
          )}
      </React.Fragment>
    )
  }

  const navigationVisibilityLabels = [
    ...(betaFeatures.automations && featureVisibility.isVisible("automations")
      ? ["Automations", "Inbox"]
      : []),
    ...(betaFeatures.orchestration && featureVisibility.isVisible("orchestration")
      ? ["Orchestration fleet"]
      : []),
    ...(selectedProject && betaFeatures.planning && featureVisibility.isVisible("plan")
      ? ["Plan"]
      : []),
    ...(selectedProject &&
    betaFeatures.projectMemory &&
    featureVisibility.isVisible("knowledge-graph")
      ? ["Project knowledge"]
      : []),
    ...(selectedProject &&
    betaFeatures.savedWorkspaces &&
    featureVisibility.isVisible("saved-workspaces")
      ? ["Saved workspaces"]
      : []),
    ...(betaFeatures.planning ? ["Tasks"] : []),
  ].sort((a, b) => a.localeCompare(b))
  const hasVisibleNavigationItems = navigationVisibilityLabels.some(
    (label) => !hiddenNavigationItems.has(label),
  )

  const handleToggleNavigationVisibility = (label: string) => {
    setHiddenNavigationItems((current) => {
      const next = new Set(current)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  // Mobile fullscreen mode - render without ResizableSidebar wrapper
  const sidebarContent = (
    <div
      className={cn(
        "group/sidebar flex flex-col gap-0 overflow-hidden select-none",
        isMobileFullscreen ? "h-full w-full bg-background" : "h-full bg-tl-background",
      )}
      onDragEnterCapture={forceSidebarMoveCursor}
      onDragOverCapture={forceSidebarMoveCursor}
      onDropCapture={handleSidebarDropCapture}
      onMouseDownCapture={handleSidebarMouseDownCapture}
      data-pressing={isSidebarPressed || undefined}
      data-mobile-fullscreen={isMobileFullscreen || undefined}
      data-sidebar-content
      data-tour="sidebar"
    >
      {getPlatform() === "darwin" && (
        <SidebarHeader isDesktop={isDesktop} isFullscreen={isFullscreen} />
      )}

      {/* Global search stays at the top of the sidebar. */}
      <div className="relative flex flex-shrink-0 items-center gap-1 px-2 pb-2 pt-1">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            aria-label="Search projects and chats"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setIsSearchFocused(false), 120)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                searchInputRef.current?.blur()
                setIsSearchFocused(false)
                setFocusedChatIndex(-1)
                return
              }
              if (event.key === "ArrowDown") {
                event.preventDefault()
                setFocusedChatIndex((current) =>
                  current === -1 ? 0 : Math.min(current + 1, filteredChats.length - 1),
                )
                return
              }
              if (event.key === "ArrowUp") {
                event.preventDefault()
                setFocusedChatIndex((current) =>
                  current === -1 ? filteredChats.length - 1 : Math.max(current - 1, 0),
                )
                return
              }
              if (event.key === "Enter" && focusedChatIndex >= 0) {
                event.preventDefault()
                const focusedChat = filteredChats[focusedChatIndex]
                if (focusedChat) {
                  handleChatClick(focusedChat.id)
                  searchInputRef.current?.blur()
                  setFocusedChatIndex(-1)
                }
              }
            }}
            className={cn(
              "w-full rounded-lg border border-input bg-muted pl-7 text-sm placeholder:text-muted-foreground/40",
              isMobileFullscreen ? "h-10" : "h-7",
            )}
          />
        </div>
        {!isMobileFullscreen && (
          <ButtonCustom
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="h-7 w-7 shrink-0 rounded-md text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            aria-label="Close sidebar"
          >
            <IconDoubleChevronLeft className="h-4 w-4" />
          </ButtonCustom>
        )}
        {(isSearchFocused || searchQuery.trim().length > 0) && (
          <div
            className="absolute inset-x-2 top-full z-30 pt-2"
            onMouseDown={(event) => event.preventDefault()}
          >
            <ScopedSearchPanel
              selectedChatId={selectedLocalChat?.id ?? null}
              selectedProjectId={selectedLocalChat?.projectId ?? null}
              selectedTaskId={selectedLocalChat?.taskId ?? null}
              onNavigateChat={(chatId, subChatId, messageId, query) => {
                if (subChatId) {
                  useAgentSubChatStore.getState().queueNavigation(chatId, subChatId)
                }
                void handleChatClick(chatId).then(() => {
                  window.setTimeout(() => {
                    focusScopedSearchResult({ query: query ?? "", messageId })
                  }, 0)
                })
                searchInputRef.current?.blur()
              }}
            />
          </div>
        )}
      </div>

      {/* Navigation is sorted at render time so new destinations cannot drift out of order. */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn("flex-shrink-0 px-2", hasVisibleNavigationItems ? "min-h-7 pb-1" : "h-0")}
          >
            {[
              ...(betaFeatures.automations && featureVisibility.isVisible("automations")
                ? [
                    {
                      label: "Automations",
                      Icon: Workflow,
                      isActive:
                        desktopView === "automations" || desktopView === "automations-detail",
                      onClick: () => {
                        setSelectedChatId(null)
                        setShowNewChatForm(false)
                        setDesktopView("automations")
                        setSearchQuery("")
                      },
                    },
                    {
                      label: "Inbox",
                      Icon: Inbox,
                      isActive: desktopView === "inbox",
                      ariaLabel: `Automation inbox, ${automationInbox?.unreadCount ?? 0} unread`,
                      suffix:
                        (automationInbox?.unreadCount ?? 0) > 0 ? (
                          <span className="ml-auto rounded-full bg-blue-600 px-1.5 text-[10px] text-white">
                            {automationInbox!.unreadCount}
                          </span>
                        ) : null,
                      onClick: () => {
                        setSelectedChatId(null)
                        setShowNewChatForm(false)
                        setDesktopView("inbox")
                        setSearchQuery("")
                      },
                    },
                  ]
                : []),
              ...(betaFeatures.orchestration && featureVisibility.isVisible("orchestration")
                ? [
                    {
                      label: "Orchestration fleet",
                      Icon: Network,
                      isActive: desktopView === "orchestration-fleet",
                      onClick: () => {
                        setSelectedChatId(null)
                        setShowNewChatForm(false)
                        setDesktopView("orchestration-fleet")
                        setSearchQuery("")
                      },
                    },
                  ]
                : []),
              ...(selectedProject
                ? [
                    ...(betaFeatures.planning && featureVisibility.isVisible("plan")
                      ? [
                          {
                            label: "Plan",
                            Icon: BookOpenText,
                            isActive: desktopView === "plan",
                            onClick: () => {
                              setSelectedDraftId(null)
                              setShowNewChatForm(false)
                              setDesktopView("plan")
                              setSearchQuery("")
                            },
                          },
                        ]
                      : []),
                    ...(betaFeatures.projectMemory && featureVisibility.isVisible("knowledge-graph")
                      ? [
                          {
                            label: "Project knowledge",
                            Icon: BookOpen,
                            isActive: desktopView === "project-vault",
                            onClick: () => {
                              setSelectedChatId(null)
                              setDesktopView("project-vault")
                              setSearchQuery("")
                            },
                          },
                        ]
                      : []),
                    ...(betaFeatures.savedWorkspaces &&
                    featureVisibility.isVisible("saved-workspaces")
                      ? [
                          {
                            label: "Saved workspaces",
                            Icon: LayoutGrid,
                            isActive: desktopView === "saved-workspaces",
                            onClick: () => {
                              setShowNewChatForm(false)
                              setDesktopView("saved-workspaces")
                              setSearchQuery("")
                            },
                          },
                        ]
                      : []),
                  ]
                : []),
              ...(betaFeatures.planning
                ? [
                    {
                      label: "Tasks",
                      Icon: ClipboardList,
                      isActive: desktopView === "tasks",
                      onClick: () => {
                        setSelectedChatId(null)
                        setSelectedDraftId(null)
                        setShowNewChatForm(false)
                        setDesktopView("tasks")
                        setSearchQuery("")
                      },
                    },
                  ]
                : []),
            ]
              .filter(({ label }) => !hiddenNavigationItems.has(label))
              .sort((a, b) => a.label.localeCompare(b.label))
              .map(({ label, Icon, isActive, onClick, ...item }, index) => (
                <ButtonCustom
                  key={label}
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-7 w-full justify-start gap-2 rounded-lg px-2 text-sm",
                    index > 0 && "mt-1",
                  )}
                  aria-current={isActive ? "page" : undefined}
                  aria-label={"ariaLabel" in item ? item.ariaLabel : undefined}
                  onClick={onClick}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                  {"suffix" in item ? item.suffix : null}
                </ButtonCustom>
              ))}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          {navigationVisibilityLabels.map((label) => (
            <ContextMenuItem
              key={label}
              className="gap-2"
              onSelect={() => handleToggleNavigationVisibility(label)}
            >
              <Check
                className={cn("h-3.5 w-3.5", hiddenNavigationItems.has(label) && "opacity-0")}
              />
              {label}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>

      {/* Scrollable Agents List */}
      <div className="flex-1 min-h-0 relative">
        <div
          ref={scrollContainerRef}
          onScroll={handleAgentsScroll}
          className={cn(
            "h-full overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent",
            isMultiSelectMode ? "px-0" : "px-2",
          )}
        >
          {!searchQuery && (
            <SidebarGroupHeader
              title="Quick access"
              icon={Zap}
              className="mt-3.5"
              isCollapsed={collapsedSectionIds.has("quick-access")}
              onToggle={() => handleToggleSection("quick-access")}
            />
          )}

          {!searchQuery && !collapsedSectionIds.has("quick-access") && !quickAccessHasChats && (
            <div
              data-sidebar-empty-state="quick-access"
              className="mb-0.5 ml-9 flex h-7 items-center text-xs text-muted-foreground/60"
            >
              No chats
            </div>
          )}

          {!searchQuery &&
            !collapsedSectionIds.has("quick-access") &&
            [
              {
                title: "Pinned",
                kind: "pinned" as const,
                chats: pinnedAgents,
                tasks: pinnedTasks,
              },
              {
                title: "Starred",
                kind: "starred" as const,
                chats: starredAgents,
                tasks: starredTasks,
              },
            ].map((section) => (
              <div
                key={section.kind}
                className="mx-2 mb-0 animate-in fade-in-0 slide-in-from-top-1 duration-150"
              >
                <ChatListSection
                  {...sharedChatListSectionProps}
                  title={section.title}
                  sectionId={section.kind}
                  kind={section.kind}
                  projectColor={null}
                  projectColorsById={projectColorsById}
                  showWhenEmpty
                  showEmptyState={
                    section.chats.length === 0 &&
                    section.tasks.every((task) => task.chats.length === 0)
                  }
                  isCollapsed={collapsedSectionIds.has(section.kind)}
                  draggingKind={draggingItem?.kind}
                  draggingId={draggingItem?.id}
                  dragOverKind={dragOverItem?.kind}
                  dragOverId={dragOverItem?.id}
                  dragOverPosition={dragOverItem?.position}
                  chats={section.chats}
                  onCreateGlobalChat={openNewGlobalChat}
                  onCreateProjectChat={openNewProjectChat}
                  onCreateProjectTask={createProjectTask}
                  onChangeProjectColor={handleChangeProjectColor}
                  lifecyclePending={
                    pinProjectMutation.isPending ||
                    unpinProjectMutation.isPending ||
                    archiveProjectMutation.isPending ||
                    pinTaskMutation.isPending ||
                    unpinTaskMutation.isPending ||
                    archiveTaskMutation.isPending
                  }
                />
                {!collapsedSectionIds.has(section.kind) &&
                  section.tasks.map((task) => (
                    <ChatListSection
                      {...sharedChatListSectionProps}
                      key={`${section.kind}-task-${task.taskId}`}
                      title={task.title}
                      sectionId={`${section.kind}-task-${task.taskId}`}
                      kind="task"
                      projectColor={task.projectColor}
                      isCollapsed={collapsedSectionIds.has(`${section.kind}-task-${task.taskId}`)}
                      lifecycleTarget={{
                        type: "task",
                        id: task.taskId,
                        isPinned: task.isPinned,
                        isStarred: task.isStarred,
                      }}
                      parentProjectId={task.projectId}
                      chats={task.chats}
                      showEmptyState={task.chats.length === 0}
                      lifecyclePending={
                        pinTaskMutation.isPending ||
                        unpinTaskMutation.isPending ||
                        archiveTaskMutation.isPending
                      }
                    />
                  ))}
              </div>
            ))}

          {/* Drafts Section - always show regardless of chat source mode */}
          {!searchQuery && !collapsedSectionIds.has("quick-access") && (
            <div className="mx-2 mb-0 animate-in fade-in-0 slide-in-from-top-1 duration-150">
              <div
                onClick={() => handleToggleSection("drafts")}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  handleToggleSection("drafts")
                }}
                role="button"
                tabIndex={0}
                aria-expanded={!collapsedSectionIds.has("drafts")}
                className="group group/disclosure relative mt-1 mb-0.5 flex h-7 cursor-pointer items-center gap-1 rounded-md pl-2 pr-1 transition-[background-color] duration-150 ease-out outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                style={{
                  backgroundColor: rgbaFromHex(
                    getProjectTint(GLOBAL_SECTION_COLOR).base,
                    SCOPED_SECTION_BACKGROUND_OPACITY,
                  ),
                }}
              >
                <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  <FilePenLine className="h-3.5 w-3.5 flex-shrink-0 text-white/90" />
                  <h3 className="flex-1 truncate whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-white">
                    Drafts
                  </h3>
                </div>
                <SidebarDisclosure
                  isCollapsed={collapsedSectionIds.has("drafts")}
                  className="text-white/80"
                />
              </div>
              {!collapsedSectionIds.has("drafts") && (
                <div className="list-none p-0 m-0 mb-1 ml-4 pl-2">
                  {drafts.length === 0 && (
                    <div className="flex h-7 items-center text-xs text-muted-foreground/60">
                      No drafts
                    </div>
                  )}
                  {drafts.map((draft) => (
                    <DraftItem
                      key={draft.id}
                      draftId={draft.id}
                      draftText={draft.text}
                      draftUpdatedAt={draft.updatedAt}
                      projectGitOwner={draft.project?.gitOwner}
                      projectGitProvider={draft.project?.gitProvider}
                      projectGitRepo={draft.project?.gitRepo}
                      projectName={draft.project?.name}
                      projectColor={
                        draft.project?.id
                          ? (projectColorsById[draft.project.id] ?? DEFAULT_PROJECT_COLOR)
                          : null
                      }
                      isSelected={selectedDraftId === draft.id && !selectedChatId}
                      isMultiSelectMode={isMultiSelectMode}
                      isMobileFullscreen={isMobileFullscreen}
                      showIcon={showWorkspaceIcon}
                      onSelect={handleDraftSelect}
                      onDelete={handleDeleteDraft}
                      formatTime={formatTime}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Global and remote chat structures live under Quick access. */}
          {(searchQuery || !collapsedSectionIds.has("quick-access")) && (
            <div
              className={cn(
                !searchQuery && "animate-in fade-in-0 slide-in-from-top-1 duration-150",
              )}
            >
              {visibleOtherSections.map((section, index) =>
                renderSidebarSection(section, index, visibleOtherSections.length),
              )}
            </div>
          )}
          {!searchQuery && (
            <SidebarGroupHeader
              title="Projects"
              icon={Library}
              className="mt-3.5"
              isCollapsed={collapsedSectionIds.has("projects-group")}
              onToggle={() => handleToggleSection("projects-group")}
              actions={
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-foreground/10 hover:text-foreground"
                        aria-label="Order projects"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onSelect={() => handleOrderProjects("name-asc")}>
                        Order A to Z
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleOrderProjects("name-desc")}>
                        Order Z to A
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => handleOrderProjects("newest")}>
                        Newest updated first
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleOrderProjects("oldest")}>
                        Oldest updated first
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <Tooltip delayDuration={500}>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex h-5 w-5 items-center justify-center rounded-sm hover:bg-foreground/10 hover:text-foreground"
                            aria-label="Add project"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        Add project
                        {newWorkspaceHotkey && <Kbd>{newWorkspaceHotkey}</Kbd>}
                      </TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem
                        className="gap-2"
                        onSelect={handleAddExistingProject}
                        disabled={openProjectMutation.isPending}
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        Add existing folder
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2"
                        onSelect={handleCloneProject}
                        disabled={cloneProjectMutation.isPending}
                      >
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                        Clone a repo
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              }
            />
          )}
          {(searchQuery || !collapsedSectionIds.has("projects-group")) && (
            <div
              className={cn(
                "mx-2",
                !searchQuery && "animate-in fade-in-0 slide-in-from-top-1 duration-150",
              )}
            >
              {!searchQuery && visibleProjectSections.length === 0 && (
                <div
                  data-sidebar-empty-state="projects"
                  className="mb-0.5 ml-7 flex h-7 items-center text-xs text-muted-foreground/60"
                >
                  No chats
                </div>
              )}
              {visibleProjectSections.map((section, index) =>
                renderSidebarSection(section, index, visibleProjectSections.length),
              )}
            </div>
          )}
          {archivedLifecycleItems.length > 0 && !searchQuery && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => {
                  if (isArchiveOpen) {
                    setIsArchiveSelectMode(false)
                    setSelectedArchivedChatIds(new Set())
                  }
                  setIsArchiveOpen((open) => !open)
                }}
                aria-expanded={isArchiveOpen}
                className={cn(
                  "group group/archive group/disclosure relative mt-3.5 flex h-7 w-full items-center rounded-lg px-2 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
                  isArchiveOpen ? "mb-2" : "mb-1",
                )}
              >
                <DiffIcon className="mr-2 h-3.5 w-3.5" />
                <span className="whitespace-nowrap text-xs font-medium">Archive</span>
                <span className="absolute right-2 text-[11px] tabular-nums text-muted-foreground/60">
                  {archivedLifecycleItems.length}
                </span>
                <SidebarDisclosure isCollapsed={!isArchiveOpen} className="mr-12" />
                <AnimatePresence>{isArchiveOpen && <ExpandedSectionIndicator />}</AnimatePresence>
              </button>
              {isArchiveOpen && (
                <div className="list-none p-0 m-0 animate-in fade-in-0 slide-in-from-top-1 duration-150">
                  <div className="mb-1 flex items-center gap-1">
                    <div className="relative min-w-0 flex-1">
                      <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={archiveSearchQuery}
                        onChange={(event) => setArchiveSearchQuery(event.target.value)}
                        placeholder="Search archive..."
                        aria-label="Search archive"
                        className="h-7 rounded-md bg-muted pl-7 text-xs"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (isArchiveSelectMode) setSelectedArchivedChatIds(new Set())
                        setIsArchiveSelectMode((selecting) => !selecting)
                      }}
                      disabled={(archivedChats?.length ?? 0) === 0}
                      className="flex h-7 flex-shrink-0 items-center justify-center rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    >
                      {isArchiveSelectMode ? "Done" : "Select"}
                    </button>
                  </div>
                  {isArchiveSelectMode && (
                    <div className="mb-1 flex h-7 items-center gap-2 rounded-md bg-foreground/5 px-2">
                      <Checkbox
                        checked={allVisibleArchivedChatsSelected}
                        onCheckedChange={handleToggleSelectAllArchivedChats}
                        aria-label={
                          allVisibleArchivedChatsSelected
                            ? "Unselect all archived chats"
                            : "Select all visible archived chats"
                        }
                        disabled={visibleArchivedChatIds.length === 0}
                        className="h-3.5 w-3.5"
                      />
                      <button
                        type="button"
                        onClick={handleToggleSelectAllArchivedChats}
                        disabled={visibleArchivedChatIds.length === 0}
                        className="min-w-0 whitespace-nowrap text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                      >
                        {allVisibleArchivedChatsSelected ? "Unselect all" : "Select all"}
                      </button>
                      <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground/60">
                        {selectedArchivedChatIds.size} selected
                      </span>
                      <Tooltip delayDuration={500}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={handleDeleteArchivedChats}
                            disabled={
                              selectedArchivedChatIds.size === 0 ||
                              deleteArchivedChatsMutation.isPending
                            }
                            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
                            aria-label={`Delete ${selectedArchivedChatIds.size} selected archived chats`}
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Delete selected chats</TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                  {visibleArchivedLifecycleItems.length === 0 ? (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground/60">
                      No archived items found
                    </div>
                  ) : (
                    visibleArchivedLifecycleItems.map((item) => (
                      <div
                        key={`${item.type}-${item.id}`}
                        onClick={() => {
                          if (isArchiveSelectMode && item.type === "chat") {
                            handleToggleArchivedChatSelection(item.id)
                          }
                        }}
                        className={cn(
                          "w-full text-left py-1.5 group relative transition-colors duration-75",
                          isMultiSelectMode ? "px-3" : "pl-2 pr-2 rounded-md",
                          "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                          isArchiveSelectMode && item.type === "chat" && "cursor-pointer",
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className="pt-0.5">
                            {isArchiveSelectMode && item.type === "chat" ? (
                              <Checkbox
                                checked={selectedArchivedChatIds.has(item.id)}
                                onCheckedChange={() => handleToggleArchivedChatSelection(item.id)}
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Select archived chat ${item.title}`}
                                className="h-4 w-4"
                              />
                            ) : (
                              <ArchiveIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <span className="truncate block text-sm leading-tight flex-1">
                                {item.title}
                              </span>
                              {(!isArchiveSelectMode || item.type !== "chat") && (
                                <button
                                  onClick={() => handleRestoreLifecycleItem(item)}
                                  tabIndex={-1}
                                  className="flex-shrink-0 text-muted-foreground hover:text-foreground active:text-foreground transition-[opacity,transform,color] duration-150 ease-out opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto active:scale-[0.97]"
                                  aria-label={`Restore archived ${item.type}`}
                                >
                                  <UnarchiveIcon className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-muted-foreground/60 truncate">
                                {item.subtitle}
                              </span>
                              <span className="text-[11px] text-muted-foreground/60 flex-shrink-0">
                                {formatTime(
                                  item.archivedAt?.toISOString() ?? new Date().toISOString(),
                                )}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Top gradient fade (appears when scrolled down) */}
        {/* Top gradient fade (appears when scrolled down) */}
        <div
          ref={topGradientRef}
          className="absolute top-0 left-0 right-0 h-10 pointer-events-none bg-gradient-to-b from-tl-background via-tl-background/50 to-transparent transition-opacity duration-200 opacity-0"
        />

        {/* Bottom gradient fade */}
        <div
          ref={bottomGradientRef}
          className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none bg-gradient-to-t from-tl-background via-tl-background/50 to-transparent transition-opacity duration-200 opacity-0"
        />
      </div>

      {/* Footer - Multi-select toolbar or normal footer */}
      <AnimatePresence mode="wait">
        {isMultiSelectMode ? (
          <motion.div
            key="multi-select-footer"
            initial={hasFooterAnimated.current ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0 }}
            onAnimationComplete={() => {
              hasFooterAnimated.current = true
            }}
            className="p-2 flex flex-col gap-2"
          >
            {/* Selection info */}
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">{selectedChatsCount} selected</span>
              <button
                onClick={clearChatSelection}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkArchive}
                disabled={archiveChatsBatchMutation.isPending}
                className="flex-1 h-8 gap-1.5 text-xs rounded-lg"
              >
                <ArchiveIcon className="h-3.5 w-3.5" />
                {archiveChatsBatchMutation.isPending ? "Archiving..." : "Archive"}
              </Button>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="normal-footer"
            initial={hasFooterAnimated.current ? { opacity: 0, y: 8 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0 }}
            onAnimationComplete={() => {
              hasFooterAnimated.current = true
            }}
            className="p-2 pt-2"
          >
            <div className="flex items-center gap-1">
              {/* Settings Button */}
              <Tooltip delayDuration={500}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-tour="settings"
                    aria-label="Settings"
                    onClick={() => {
                      setSettingsActiveTab("preferences")
                      setSettingsDialogOpen(true)
                    }}
                    className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                  >
                    <SettingsIcon className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  Settings
                  {settingsHotkey && (
                    <>
                      {" "}
                      <Kbd>{settingsHotkey}</Kbd>
                    </>
                  )}
                </TooltipContent>
              </Tooltip>

              {/* Usage remains searchable in Settings when its shortcut is hidden. */}
              {featureVisibility.isVisible("usage") && (
                <Tooltip delayDuration={500}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsActiveTab("usage")
                        setSettingsDialogOpen(true)
                      }}
                      className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                      aria-label="Usage"
                    >
                      <Activity className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Usage</TooltipContent>
                </Tooltip>
              )}

              {/* Help Button - isolated component to prevent sidebar re-renders */}
              <HelpSection isMobile={isMobileFullscreen} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      {sidebarContent}

      {/* Agent name tooltip portal - always rendered, visibility controlled via ref/DOM */}
      {typeof document !== "undefined" &&
        createPortal(
          <div
            ref={agentTooltipRef}
            className="fixed z-[100000] max-w-xs px-2 py-1 text-xs bg-popover border border-border rounded-md shadow-lg dark pointer-events-none text-foreground/90 whitespace-nowrap"
            style={{
              display: "none",
              transform: "translateY(-50%)",
            }}
          />,
          document.body,
        )}

      {/* Rename Dialog */}
      <AgentsRenameSubChatDialog
        isOpen={renameDialogOpen}
        onClose={() => {
          setRenameDialogOpen(false)
          setRenamingChat(null)
        }}
        onSave={handleRenameSave}
        currentName={renamingChat?.name || ""}
        isLoading={renameLoading}
      />

      <RenameDialog
        isOpen={Boolean(newTaskProject)}
        onClose={() => setNewTaskProject(null)}
        onSave={handleCreateTaskSave}
        currentName=""
        isLoading={createTaskMutation.isPending}
        title={newTaskProject ? `New task for ${newTaskProject.name}` : "New task"}
        placeholder="Task name"
      />

      {/* Confirm Archive Dialog */}
      <ConfirmArchiveDialog
        isOpen={confirmArchiveDialogOpen}
        onClose={handleCloseArchiveDialog}
        onConfirm={handleConfirmArchive}
        activeProcessCount={activeProcessCount}
      />

      {/* Open Locally Dialog */}
      <OpenLocallyDialog
        isOpen={importDialogOpen}
        onClose={handleCloseImportDialog}
        remoteChat={importingRemoteChat}
        matchingProjects={importMatchingProjects}
        allProjects={projects ?? []}
        remoteSubChatId={null}
      />
      <RepositoryOverviewDialog
        open={Boolean(repositoryOverviewProjectId)}
        onOpenChange={(open) => !open && setRepositoryOverviewProjectId(null)}
        projectName={
          projects?.find((project) => project.id === repositoryOverviewProjectId)?.name ?? "Project"
        }
        projectPath={
          projects?.find((project) => project.id === repositoryOverviewProjectId)?.path ?? null
        }
      />
    </>
  )
}
