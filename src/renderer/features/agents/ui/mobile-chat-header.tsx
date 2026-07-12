"use client"

import { useMemo } from "react"
import { useAtomValue } from "jotai"
import { loadingSubChatsAtom } from "../atoms"
import { Play, AlignJustify, FolderDown } from "lucide-react"
import {
  IconSpinner,
  PlanIcon,
  AgentIcon,
  DiffIcon,
  CustomTerminalIcon,
  IconTextUndo,
} from "../../../components/ui/icons"
import { Button } from "../../../components/ui/button"
import { cn } from "../../../lib/utils"
import { useAgentSubChatStore } from "../stores/sub-chat-store"

interface DiffStats {
  fileCount: number
  additions: number
  deletions: number
  isLoading: boolean
  hasChanges: boolean
}

interface MobileChatHeaderProps {
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
  const mode = activeSubChat?.mode || "agent"

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
