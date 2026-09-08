"use client"

import { lazy, Suspense, useMemo, useState, useSyncExternalStore } from "react"
import { useAtomValue } from "jotai"
import { loadingSubChatsAtom } from "../atoms"
import { Play, AlignJustify, FolderDown, History } from "lucide-react"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "../../../components/ui/dialog"
import {
  IconSpinner,
  PlanIcon,
  AgentIcon,
  DiffIcon,
  CustomTerminalIcon,
  IconTextUndo,
} from "../../../components/ui/icons"
import { Button } from "../../../components/ui/button"
import { useBetaFeatures } from "../../settings/use-beta-features"
import {
  getAppActionHistorySnapshot,
  subscribeAppActionHistory,
  undoAppAction,
  redoAppAction,
} from "../../../lib/app-action-history"
import { cn } from "../../../lib/utils"
import { useAgentSubChatStore } from "../stores/sub-chat-store"

interface DiffStats {
  fileCount: number
  additions: number
  deletions: number
  isLoading: boolean
  hasChanges: boolean
}

type ReviewScopeProps = {
  projectId?: string | null
  taskId?: string | null
  onNavigate?: (chatId: string) => void
}

interface MobileChatHeaderProps extends ReviewScopeProps {
  historyChatId?: string
  onBackToChats?: () => void
  onOpenPreview?: () => void
  canOpenPreview?: boolean
  onOpenDiff?: () => void
  canOpenDiff?: boolean
  diffStats?: DiffStats
  onOpenTerminal?: () => void
  canOpenTerminal?: boolean
  isTerminalOpen?: boolean
  isArchived?: boolean
  onRestore?: () => void
  onOpenLocally?: () => void
  showOpenLocally?: boolean
}

export function MobileChatHeader({
  historyChatId,
  projectId,
  taskId,
  onNavigate,
  onBackToChats,
  onOpenPreview,
  canOpenPreview = false,
  onOpenDiff,
  canOpenDiff = false,
  diffStats,
  onOpenTerminal,
  canOpenTerminal = false,
  isTerminalOpen = false,
  isArchived = false,
  onRestore,
  onOpenLocally,
  showOpenLocally = false,
}: MobileChatHeaderProps) {
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  const allSubChats = useAgentSubChatStore((state) => state.allSubChats)
  const loadingSubChatsAtomValue = useAtomValue(loadingSubChatsAtom)

  // Find active sub-chat metadata
  const activeSubChat = useMemo(() => {
    return allSubChats.find((sc) => sc.id === activeSubChatId)
  }, [allSubChats, activeSubChatId])

  const isLoading = activeSubChatId ? loadingSubChatsAtomValue.has(activeSubChatId) : false
  const mode = activeSubChat?.mode || "write"

  return (
    <div
      className="flex items-center gap-1.5 h-7 w-full min-w-0"
      style={{
        // @ts-expect-error - WebKit-specific property for Electron window dragging
        WebkitAppRegion: "drag",
      }}
    >
      {/* Burger button - opens all projects */}
      {onBackToChats && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onBackToChats}
          className="h-7 w-7 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0 rounded-md"
          aria-label="All projects"
          style={{
            // @ts-expect-error - WebKit-specific property
            WebkitAppRegion: "no-drag",
          }}
        >
          <AlignJustify className="h-4 w-4" />
        </Button>
      )}

      <div className="flex min-w-0 items-center gap-1.5 px-2 text-sm">
        {isLoading ? (
          <IconSpinner className="h-3.5 w-3.5 text-muted-foreground" />
        ) : mode === "plan" ? (
          <PlanIcon className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <AgentIcon className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="truncate">{activeSubChat?.name || "New Chat"}</span>
      </div>

      {/* Spacer to push buttons to the right */}
      <div className="flex-1" />

      {/* Action buttons - always on the right */}
      <div
        className="flex items-center gap-1 flex-shrink-0"
        style={{
          // @ts-expect-error - WebKit-specific property
          WebkitAppRegion: "no-drag",
        }}
      >
        {historyChatId && (
          <MobileRunHistory
            key={historyChatId}
            chatId={historyChatId}
            projectId={projectId}
            taskId={taskId}
            onNavigate={onNavigate}
          />
        )}
        {/* Open Locally - only for sandbox chats */}
        {showOpenLocally && onOpenLocally && (
          <Button
            variant="default"
            size="sm"
            onClick={onOpenLocally}
            className="h-7 px-2.5 gap-1.5 text-xs font-medium"
          >
            <FolderDown className="h-3.5 w-3.5" />
            Open Locally
          </Button>
        )}

        {/* Terminal button - hidden when terminal is already open */}
        {onOpenTerminal && canOpenTerminal && !isTerminalOpen && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenTerminal}
            className="h-7 w-7 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] rounded-md"
          >
            <CustomTerminalIcon className="h-4 w-4" />
          </Button>
        )}

        {/* Diff button */}
        {onOpenDiff && canOpenDiff && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenDiff}
            disabled={!diffStats?.hasChanges || diffStats?.isLoading}
            className={cn(
              "h-7 w-7 p-0 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] rounded-md",
              diffStats?.hasChanges && !diffStats?.isLoading
                ? "hover:bg-foreground/10"
                : "text-muted-foreground",
            )}
          >
            {diffStats?.isLoading ? (
              <IconSpinner className="h-4 w-4" />
            ) : (
              <DiffIcon className="h-4 w-4" />
            )}
          </Button>
        )}

        {/* Preview button */}
        {onOpenPreview && canOpenPreview && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenPreview}
            className="h-7 w-7 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] rounded-md"
          >
            <Play className="h-4 w-4" />
          </Button>
        )}

        {/* Restore button - only when viewing archived workspace */}
        {isArchived && onRestore && (
          <Button
            variant="ghost"
            onClick={onRestore}
            className="h-7 px-2 gap-1.5 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] rounded-md flex items-center"
          >
            <IconTextUndo className="h-4 w-4" />
            <span className="text-xs">Restore</span>
          </Button>
        )}
      </div>
    </div>
  )
}

const RunHistoryWidget = lazy(() =>
  import("../../details-sidebar/sections/run-history-widget").then((module) => ({
    default: module.RunHistoryWidget,
  })),
)

const ReviewPanel = lazy(() =>
  import("./orchestration-review-panel").then((module) => ({
    default: module.OrchestrationReviewPanel,
  })),
)

const WorktreeAccess = lazy(() =>
  import("./mobile-worktree-access").then((module) => ({ default: module.MobileWorktreeAccess })),
)

/** The caller keys this local disclosure by chat, so an open history never follows a chat switch. */
export function MobileRunHistory({
  chatId,
  projectId,
  taskId,
  onNavigate,
}: { chatId: string } & ReviewScopeProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"history" | "reviews" | "worktree">("history")
  const beta = useBetaFeatures()
  const canReview = Boolean(beta.orchestration && projectId && taskId && onNavigate)
  const worktreeOpen = view === "worktree" && canReview
  const reviewsOpen = view === "reviews" && canReview
  const history = useSyncExternalStore(
    subscribeAppActionHistory,
    getAppActionHistorySnapshot,
    getAppActionHistorySnapshot,
  )
  const [historyError, setHistoryError] = useState<string | null>(null)
  const applyHistory = async (redo: boolean) => {
    setHistoryError(null)
    try {
      await (redo ? redoAppAction() : undoAppAction())
    } catch (error) {
      setHistoryError(
        `${redo ? "Redo" : "Undo"} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 p-0" aria-label="Run history">
          <History aria-hidden="true" className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 p-4">
        <DialogTitle className="pr-6">Run history</DialogTitle>
        <DialogDescription>Saved runs and their recorded evidence for this chat.</DialogDescription>
        {canReview && (
          <div role="group" aria-label="Run history view" className="flex flex-wrap gap-2">
            <Button
              variant={reviewsOpen || worktreeOpen ? "outline" : "secondary"}
              aria-pressed={!reviewsOpen && !worktreeOpen}
              onClick={() => setView("history")}
            >
              History
            </Button>
            <Button
              variant={reviewsOpen ? "secondary" : "outline"}
              aria-pressed={reviewsOpen}
              onClick={() => setView("reviews")}
            >
              Run reviews
            </Button>
            <Button
              variant={worktreeOpen ? "secondary" : "outline"}
              aria-pressed={worktreeOpen}
              onClick={() => setView("worktree")}
            >
              Worktree access
            </Button>
          </div>
        )}
        {reviewsOpen && (
          <div className="space-y-2">
            <div role="group" aria-label="Shared action history" className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-auto whitespace-normal break-words text-left"
                disabled={!history.canUndo}
                onClick={() => void applyHistory(false)}
              >
                {history.undoLabel ? `Undo ${history.undoLabel}` : "Undo"}
              </Button>
              <Button
                variant="outline"
                className="h-auto whitespace-normal break-words text-left"
                disabled={!history.canRedo}
                onClick={() => void applyHistory(true)}
              >
                {history.redoLabel ? `Redo ${history.redoLabel}` : "Redo"}
              </Button>
            </div>
            {historyError && (
              <p role="alert" className="text-sm break-words">
                {historyError}
              </p>
            )}
          </div>
        )}
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain break-words">
          {open && (
            <Suspense fallback={<p role="status">Loading run history…</p>}>
              {worktreeOpen && projectId && taskId && onNavigate ? (
                <WorktreeAccess
                  key={JSON.stringify([projectId, taskId])}
                  projectId={projectId}
                  taskId={taskId}
                  onNavigate={(target) => {
                    setOpen(false)
                    onNavigate(target)
                  }}
                />
              ) : reviewsOpen && projectId && taskId && onNavigate ? (
                <ReviewPanel
                  key={JSON.stringify([projectId, taskId])}
                  projectId={projectId}
                  taskId={taskId}
                  onNavigate={(target) => {
                    setOpen(false)
                    onNavigate(target)
                  }}
                />
              ) : (
                <RunHistoryWidget chatId={chatId} />
              )}
            </Suspense>
          )}
        </div>
        <DialogClose asChild>
          <Button variant="outline" className="shrink-0">
            Back to chat
          </Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
