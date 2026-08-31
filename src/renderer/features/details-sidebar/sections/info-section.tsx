"use client"

import { memo, useState, useCallback, useEffect, useMemo } from "react"
import { useAtomValue } from "jotai"
import {
  Bot,
  CalendarDays,
  Coins,
  Cpu,
  Gauge,
  Layers3,
  MessageSquareText,
  RefreshCw,
  Tags,
} from "lucide-react"
import {
  GitBranchFilledIcon,
  FolderFilledIcon,
  GitPullRequestFilledIcon,
  ExternalLinkIcon,
} from "@/components/ui/icons"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { trpc } from "@/lib/trpc"
import { preferredEditorAtom } from "@/lib/atoms"
import { useResolvedHotkeyDisplay } from "@/lib/hotkeys"
import { getFileManagerName } from "@/lib/utils/platform"
import { APP_META } from "../../../../shared/external-apps"
import { EDITOR_ICONS } from "@/lib/editor-icons"
import { ProviderChipIcon } from "@/features/agents/components/provider-chip-icon"
import { ChatTagChip, type ChatTagView } from "@/features/sidebar/chat-tag-menu"

interface InfoSectionProps {
  chatId: string
  activeSubChatId?: string | null
  worktreePath: string | null
  isExpanded?: boolean
  /** Remote chat data for sandbox workspaces */
  remoteInfo?: {
    repository?: string
    branch?: string | null
    sandboxId?: string
  } | null
}

/** Property row component - Notion-style with icon, label, and value */
function PropertyRow({
  icon: Icon,
  label,
  value,
  title,
  onClick,
  copyable,
  tooltip,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  title?: string
  onClick?: () => void
  copyable?: boolean
  /** Tooltip to show on hover (for clickable items) */
  tooltip?: string
}) {
  const [showCopied, setShowCopied] = useState(false)

  const handleClick = useCallback(() => {
    if (copyable) {
      navigator.clipboard.writeText(value)
      setShowCopied(true)
      setTimeout(() => setShowCopied(false), 1500)
    } else if (onClick) {
      onClick()
    }
  }, [copyable, value, onClick])

  const isClickable = onClick || copyable

  const valueEl = isClickable ? (
    <button
      type="button"
      className="text-xs text-foreground cursor-pointer rounded px-1.5 py-0.5 -ml-1.5 truncate hover:bg-accent hover:text-accent-foreground transition-colors"
      title={!tooltip ? title : undefined}
      onClick={handleClick}
    >
      {value}
    </button>
  ) : (
    <span className="text-xs text-foreground truncate" title={!tooltip ? title : undefined}>
      {value}
    </span>
  )

  return (
    <div className="flex items-center min-h-[28px]">
      {/* Label column - fixed width */}
      <div className="flex items-center gap-1.5 w-[100px] flex-shrink-0">
        <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{label}</span>
      </div>
      {/* Value column - flexible */}
      <div className="flex-1 min-w-0 pl-2 truncate">
        {copyable ? (
          <Tooltip open={showCopied ? true : undefined}>
            <TooltipTrigger asChild>{valueEl}</TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {showCopied ? "Copied" : "Click to copy"}
            </TooltipContent>
          </Tooltip>
        ) : tooltip ? (
          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>{valueEl}</TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        ) : (
          valueEl
        )}
      </div>
    </div>
  )
}

function PropertyContentRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-7 items-start py-1">
      <div className="flex w-[100px] shrink-0 items-center gap-1.5 pt-0.5">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 pl-2 text-xs">
        {children}
      </div>
    </div>
  )
}

const countFormatter = new Intl.NumberFormat()
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

function formatProvider(provider?: string | null): string {
  switch (provider) {
    case "claude-code":
      return "Anthropic"
    case "codex":
      return "OpenAI"
    case "cursor-agent":
      return "Cursor"
    case "openrouter":
      return "OpenRouter"
    case "nanogpt":
      return "NanoGPT"
    case "local":
      return "Local"
    default:
      return provider || "Not set"
  }
}

function formatDate(value?: Date | string | null): string {
  return value ? dateFormatter.format(new Date(value)) : "Unknown"
}

/**
 * Info Section for Details Sidebar
 * Shows workspace info: branch, PR, path
 * Memoized to prevent re-renders when parent updates
 */
export const InfoSection = memo(function InfoSection({
  chatId,
  activeSubChatId,
  worktreePath,
  isExpanded = false,
  remoteInfo,
}: InfoSectionProps) {
  // Extract folder name from path
  const folderName = worktreePath?.split("/").pop() || "Unknown"

  // Preferred editor from settings
  const preferredEditor = useAtomValue(preferredEditorAtom)
  const editorMeta = APP_META[preferredEditor]

  // Mutations
  const openInFinderMutation = trpc.external.openInFinder.useMutation()
  const openInAppMutation = trpc.external.openInApp.useMutation()

  // Check if this is a remote sandbox chat (no local worktree)
  const isRemoteChat = !worktreePath && !!remoteInfo

  const { data: chatMetadata, isLoading: isMetadataLoading } = trpc.chats.getMetadata.useQuery(
    { id: chatId },
    { enabled: !!chatId && !isRemoteChat },
  )
  const { data: chatStats } = trpc.chats.getChatStats.useQuery(
    { chatId },
    { enabled: !!chatId && !isRemoteChat },
  )
  const { data: tagAssignments = [] } = trpc.chats.listTagAssignments.useQuery(undefined, {
    enabled: !!chatId && !isRemoteChat,
  })
  const assignedTags = useMemo(
    () =>
      tagAssignments
        .filter((assignment) => assignment.chatId === chatId)
        .map((assignment) => assignment.tag as ChatTagView),
    [chatId, tagAssignments],
  )
  const selectedSubChat =
    chatMetadata?.subChats.find((subChat) => subChat.id === activeSubChatId) ??
    chatMetadata?.subChats.at(-1)
  const provider = selectedSubChat?.harness ?? chatMetadata?.harness
  const model = selectedSubChat?.model ?? chatMetadata?.model
  const totalTokens = chatStats?.totalTokens ?? 0

  // Fetch branch data directly (only for local chats)
  const { data: branchData, isLoading: isBranchLoading } = trpc.changes.getBranches.useQuery(
    { worktreePath: worktreePath || "" },
    { enabled: !!worktreePath },
  )

  // Get PR status for current branch (only for local chats)
  const { data: prStatus } = trpc.chats.getPrStatus.useQuery(
    { chatId },
    {
      refetchInterval: 30000, // Poll every 30 seconds
      enabled: !!chatId && !!worktreePath, // Only enable for local chats
    },
  )

  // For local chats: use fetched branch data
  // For remote chats: use remoteInfo from props
  const branchName = isRemoteChat ? remoteInfo?.branch : branchData?.current
  const pr = prStatus?.pr

  // Extract repo name from repository URL (e.g., "owner/repo" from "github.com/owner/repo")
  const repositoryName = remoteInfo?.repository
    ? remoteInfo.repository.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "")
    : null

  const handleOpenFolder = () => {
    if (worktreePath) {
      openInFinderMutation.mutate(worktreePath)
    }
  }

  const isWorktree = !!worktreePath && worktreePath.includes(".flapstack/worktrees")
  const openInEditorHotkey = useResolvedHotkeyDisplay("open-in-editor")

  const handleOpenInEditor = useCallback(() => {
    if (worktreePath) {
      openInAppMutation.mutate({ path: worktreePath, app: preferredEditor })
    }
  }, [worktreePath, preferredEditor, openInAppMutation])

  // Listen for ⌘O hotkey event
  useEffect(() => {
    if (!isWorktree) return
    const handler = () => handleOpenInEditor()
    window.addEventListener("open-in-editor", handler)
    return () => window.removeEventListener("open-in-editor", handler)
  }, [isWorktree, handleOpenInEditor])

  const handleOpenPr = () => {
    if (pr?.url) {
      window.desktopApi.openExternal(pr.url)
    }
  }

  const handleOpenRepository = () => {
    if (remoteInfo?.repository) {
      const repoUrl = remoteInfo.repository.startsWith("http")
        ? remoteInfo.repository
        : `https://github.com/${remoteInfo.repository}`
      window.desktopApi.openExternal(repoUrl)
    }
  }

  const handleOpenSandbox = () => {
    if (remoteInfo?.sandboxId) {
      const sandboxUrl = `https://3003-${remoteInfo.sandboxId}.e2b.app`
      window.desktopApi.openExternal(sandboxUrl)
    }
  }

  // Show loading state while branch data is loading (only for local chats)
  if (!isRemoteChat && (isBranchLoading || isMetadataLoading)) {
    return (
      <div className="px-2 py-1.5 flex flex-col gap-0.5">
        <div className="flex items-center min-h-[28px]">
          <div className="flex items-center gap-1.5 w-[100px] flex-shrink-0">
            <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
            <div className="h-3 w-12 rounded bg-muted animate-pulse" />
          </div>
          <div className="flex-1 min-w-0 pl-2">
            <div className="h-3 w-32 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <div className="flex items-center min-h-[28px]">
          <div className="flex items-center gap-1.5 w-[100px] flex-shrink-0">
            <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
            <div className="h-3 w-8 rounded bg-muted animate-pulse" />
          </div>
          <div className="flex-1 min-w-0 pl-2">
            <div className="h-3 w-24 rounded bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="px-2 py-1.5 flex flex-col gap-0.5">
      {!isRemoteChat && (
        <>
          <PropertyRow
            icon={Layers3}
            label="Project"
            value={chatMetadata?.project?.name ?? "Global"}
          />
          <PropertyContentRow icon={Bot} label="Provider">
            <ProviderChipIcon provider={provider} className="h-3.5 w-3.5 shrink-0" />
            <span>{formatProvider(provider)}</span>
          </PropertyContentRow>
          <PropertyRow icon={Cpu} label="Model" value={model || "Provider default"} />
          <PropertyContentRow icon={Tags} label="Tags">
            {assignedTags.length > 0 ? (
              assignedTags.map((tag) => <ChatTagChip key={tag.id} tag={tag} />)
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </PropertyContentRow>
          <PropertyRow
            icon={MessageSquareText}
            label="Messages"
            value={countFormatter.format(chatStats?.messageCount ?? 0)}
          />
          <PropertyRow
            icon={Coins}
            label="Tokens used"
            value={countFormatter.format(totalTokens)}
          />
          <PropertyRow
            icon={Gauge}
            label="Context"
            value={
              chatStats?.contextWindow
                ? `${countFormatter.format(chatStats.latestContextTokens)} / ${countFormatter.format(chatStats.contextWindow)}`
                : "Unavailable"
            }
          />
          <PropertyRow
            icon={CalendarDays}
            label="Created"
            value={formatDate(chatMetadata?.createdAt)}
          />
          <PropertyRow
            icon={RefreshCw}
            label="Updated"
            value={formatDate(chatMetadata?.updatedAt)}
          />
        </>
      )}
      {/* Repository - only for remote chats */}
      {repositoryName && (
        <PropertyRow
          icon={FolderFilledIcon}
          label="Repository"
          value={repositoryName}
          title={remoteInfo?.repository}
          onClick={handleOpenRepository}
          tooltip="Open in GitHub"
        />
      )}
      {/* Branch - for both local and remote */}
      {branchName && (
        <PropertyRow icon={GitBranchFilledIcon} label="Branch" value={branchName} copyable />
      )}
      {/* PR - only for local chats */}
      {pr && (
        <PropertyRow
          icon={GitPullRequestFilledIcon}
          label="Pull Request"
          value={`#${pr.number}`}
          title={pr.title}
          onClick={handleOpenPr}
          tooltip="Open in GitHub"
        />
      )}
      {/* Path - only for local chats */}
      {worktreePath && (
        <PropertyRow
          icon={FolderFilledIcon}
          label="Path"
          value={folderName}
          title={worktreePath}
          onClick={handleOpenFolder}
          tooltip={`Open in ${getFileManagerName()}`}
        />
      )}
      {/* Open in Editor - only for actual git worktrees (under ~/.flapstack/worktrees/) */}
      {isWorktree && (
        <div className="flex items-center min-h-[28px]">
          <div className="flex items-center gap-1.5 w-[100px] flex-shrink-0">
            <ExternalLinkIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground truncate">Open in</span>
          </div>
          <div className="flex-1 min-w-0 pl-2">
            <Tooltip delayDuration={500}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleOpenInEditor}
                  className="flex items-center gap-1.5 text-xs text-foreground cursor-pointer rounded px-1.5 py-0.5 -ml-1.5 hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {EDITOR_ICONS[preferredEditor] && (
                    <img
                      src={EDITOR_ICONS[preferredEditor]}
                      alt=""
                      className="h-3.5 w-3.5 flex-shrink-0"
                    />
                  )}
                  {editorMeta.label}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                Open in {editorMeta.label}
                {openInEditorHotkey && (
                  <Kbd className="normal-case font-sans">{openInEditorHotkey}</Kbd>
                )}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
    </div>
  )
})
