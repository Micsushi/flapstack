"use client"

import {
  Children,
  Fragment,
  isValidElement,
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { cn } from "../../../lib/utils"
import { Folder, GitBranch } from "lucide-react"
import { ProviderChipIcon } from "../components/provider-chip-icon"
import { OpenInButton } from "../../../components/open-in-button"
import { ProgressiveOverflowRow } from "../../../components/progressive-overflow-row"
import { ChatTagChip, type ChatTagView } from "../../sidebar/chat-tag-menu"
import {
  capProjectLabel,
  resolveChatHeaderTagMode,
  type ChatHeaderTagMode,
} from "./chat-header-responsive"

interface ChatTitleEditorProps {
  name: string
  placeholder?: string
  onSave: (newName: string) => Promise<void>
  isMobile?: boolean
  disabled?: boolean
  chatId?: string
  hasMessages?: boolean
  isSidebarOpen?: boolean
  provider?: string
  providerName?: string
  providerClassName?: string
  projectLabel?: string | null
  projectColor?: string | null
  chatTags?: ChatTagView[]
  workspaceBranch?: string | null
  localFolderPath?: string
  headerActions?: ReactNode
}

function flattenOverflowChildren(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) => {
    if (isValidElement(child) && child.type === Fragment) {
      return flattenOverflowChildren(
        (child as ReactElement<{ children?: ReactNode }>).props.children,
      )
    }
    return [child]
  })
}

// Custom comparison to prevent re-renders during streaming
function areTitlePropsEqual(prev: ChatTitleEditorProps, next: ChatTitleEditorProps): boolean {
  return (
    prev.name === next.name &&
    prev.placeholder === next.placeholder &&
    prev.isMobile === next.isMobile &&
    prev.disabled === next.disabled &&
    prev.chatId === next.chatId &&
    prev.hasMessages === next.hasMessages &&
    prev.isSidebarOpen === next.isSidebarOpen &&
    prev.provider === next.provider &&
    prev.providerName === next.providerName &&
    prev.providerClassName === next.providerClassName &&
    prev.projectLabel === next.projectLabel &&
    prev.projectColor === next.projectColor &&
    prev.chatTags === next.chatTags &&
    prev.workspaceBranch === next.workspaceBranch &&
    prev.localFolderPath === next.localFolderPath &&
    prev.headerActions === next.headerActions
  )
}

export const ChatTitleEditor = memo(function ChatTitleEditor({
  name,
  placeholder = "New Chat",
  onSave,
  isMobile = false,
  disabled = false,
  hasMessages = false,
  isSidebarOpen = true,
  provider,
  providerName,
  providerClassName,
  projectLabel,
  projectColor,
  chatTags = [],
  workspaceBranch,
  localFolderPath,
  headerActions,
}: ChatTitleEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(name)
  const [isSaving, setIsSaving] = useState(false)
  const [tagMode, setTagMode] = useState<ChatHeaderTagMode>("full")
  const [controlsContentWidth, setControlsContentWidth] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const headerTailRef = useRef<HTMLDivElement>(null)
  const fullTagsMeasureRef = useRef<HTMLDivElement>(null)
  const compactTagsMeasureRef = useRef<HTMLDivElement>(null)

  // Sync editValue when name changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditValue(name)
    }
  }, [name, isEditing])

  // Auto-focus and select text when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      const timeoutId = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          inputRef.current.select()
        }
      }, 0)
      return () => clearTimeout(timeoutId)
    }
  }, [isEditing])

  const handleSave = useCallback(async () => {
    const trimmedValue = editValue.trim()

    // If empty or unchanged, just cancel
    if (!trimmedValue || trimmedValue === name) {
      setEditValue(name)
      setIsEditing(false)
      return
    }

    setIsSaving(true)
    try {
      await onSave(trimmedValue)
      setIsEditing(false)
    } catch {
      // On error, revert to original name
      setEditValue(name)
      setIsEditing(false)
    } finally {
      setIsSaving(false)
    }
  }, [editValue, name, onSave])

  const handleCancel = useCallback(() => {
    setEditValue(name)
    setIsEditing(false)
  }, [name])

  // Handle clicks outside to save
  useEffect(() => {
    if (!isEditing) return

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        handleSave()
      }
    }

    // Add delay to avoid immediate trigger
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isEditing, handleSave])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      handleSave()
    } else if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      handleCancel()
    }
  }

  const hasRealName = name && name !== placeholder
  const handleClick = () => {
    // Don't allow editing if disabled or if it's a placeholder (not saved to DB yet)
    if (!disabled && !isEditing && hasRealName) {
      setIsEditing(true)
    }
  }

  // Fixed height to prevent layout shift when switching between view/edit modes
  const heightClass = isMobile ? "h-7" : "h-8"
  const headerActionItems = flattenOverflowChildren(headerActions)
  const headerControlItems = [
    localFolderPath
      ? {
          key: "open-in",
          node: <OpenInButton path={localFolderPath} label="Open in" />,
        }
      : null,
    ...headerActionItems.map((node, index) => ({ key: `action-${index}`, node })),
  ].filter((item): item is NonNullable<typeof item> => item !== null)
  const headerCollapseOrder = headerControlItems.map((_, index) => index).reverse()
  const projectDisplayLabel = useMemo(
    () => (projectLabel ? capProjectLabel(projectLabel) : null),
    [projectLabel],
  )
  const tagMeasurementSignature = [
    projectLabel,
    provider,
    providerName,
    workspaceBranch,
    ...chatTags.map((tag) => `${tag.id}:${tag.name}:${tag.color}:${tag.icon ?? ""}`),
  ].join("|")

  useLayoutEffect(() => {
    const updateTagMode = () => {
      const availableWidth = headerTailRef.current?.getBoundingClientRect().width ?? 0
      if (availableWidth <= 0) return
      setTagMode(
        resolveChatHeaderTagMode({
          availableWidth,
          fullTagsWidth: fullTagsMeasureRef.current?.getBoundingClientRect().width ?? 0,
          compactTagsWidth: compactTagsMeasureRef.current?.getBoundingClientRect().width ?? 0,
          controlsWidth: controlsContentWidth,
          controlCount: headerControlItems.length,
        }),
      )
    }

    updateTagMode()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(updateTagMode)
    if (headerTailRef.current) observer.observe(headerTailRef.current)
    if (fullTagsMeasureRef.current) observer.observe(fullTagsMeasureRef.current)
    if (compactTagsMeasureRef.current) observer.observe(compactTagsMeasureRef.current)
    return () => observer.disconnect()
  }, [controlsContentWidth, headerControlItems.length, tagMeasurementSignature])

  const renderHeaderTags = (mode: ChatHeaderTagMode) => (
    <>
      {projectLabel && projectDisplayLabel && (
        <span
          title={projectLabel}
          className={cn(
            "inline-flex h-7 items-center justify-center rounded-md border text-[13px] font-medium leading-none",
            mode === "compact" ? "w-7 shrink-0 p-0" : "min-w-0 gap-1.5 px-2.5",
            mode === "minimal" ? "max-w-full" : mode === "full" && "max-w-[30ch] shrink-0",
          )}
          style={{
            color: projectColor ?? undefined,
            borderColor: projectColor
              ? `color-mix(in srgb, ${projectColor} 45%, transparent)`
              : undefined,
            backgroundColor: projectColor
              ? `color-mix(in srgb, ${projectColor} 14%, transparent)`
              : undefined,
          }}
        >
          <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {mode !== "compact" && <span className="min-w-0 truncate">{projectDisplayLabel}</span>}
        </span>
      )}
      {mode !== "minimal" &&
        chatTags.map((tag) => (
          <ChatTagChip key={tag.id} tag={tag} header iconOnly={mode === "compact"} />
        ))}
      {mode !== "minimal" && providerName && (
        <span
          title={providerName}
          className={cn(
            "inline-flex h-7 shrink-0 items-center justify-center rounded-md border text-[13px] font-medium leading-none",
            mode === "compact" ? "w-7 p-0" : "gap-1.5 px-2.5",
            providerClassName,
          )}
        >
          <ProviderChipIcon provider={provider} className="h-4 w-4 shrink-0" />
          {mode === "full" && <span>{providerName}</span>}
        </span>
      )}
      {mode !== "minimal" && workspaceBranch && (
        <span
          title={workspaceBranch}
          className={cn(
            "inline-flex h-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/30 text-[13px] font-medium leading-none text-foreground/70",
            mode === "compact" ? "w-7 p-0" : "max-w-32 gap-1.5 px-2.5",
          )}
        >
          <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {mode === "full" && <span className="min-w-0 truncate">{workspaceBranch}</span>}
        </span>
      )}
    </>
  )

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex items-center gap-2",
        isMobile ? "max-w-2xl mx-auto px-4" : cn("w-full pr-3", isSidebarOpen ? "pl-5" : "pl-12"),
        heightClass,
      )}
    >
      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSaving}
          placeholder={placeholder}
          className={cn(
            "min-w-0 h-full bg-transparent border-0 outline-none",
            isMobile ? "flex-1" : "w-[40%] max-w-[40%] flex-none",
            isMobile ? "text-base" : "text-lg",
            "font-medium leading-none text-foreground",
          )}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        />
      ) : (
        <div
          onClick={handleClick}
          className={cn(
            "flex h-full min-w-0 items-center text-left",
            isMobile ? "flex-1" : "w-[40%] max-w-[40%] flex-none",
            isMobile ? "text-base" : "text-lg",
            "font-medium leading-none",
            hasRealName ? "text-foreground cursor-pointer" : "cursor-default",
          )}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <span
            className={cn(
              "block truncate leading-none",
              !hasRealName && hasMessages && "text-muted-foreground/50",
            )}
            title={name}
          >
            {hasRealName ? name : hasMessages ? placeholder : ""}
          </span>
        </div>
      )}
      {!isMobile && !isEditing && (
        <div
          ref={headerTailRef}
          className="relative ml-auto flex h-full min-w-0 flex-1 items-center justify-end gap-2 leading-none"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div
            className={cn(
              "flex items-center gap-2",
              tagMode === "minimal" ? "min-w-0 flex-1" : "shrink-0",
            )}
          >
            {renderHeaderTags(tagMode)}
          </div>
          <ProgressiveOverflowRow
            usageRatio={1}
            menuLabel="More chat actions"
            className={cn(
              "justify-end leading-none",
              tagMode === "minimal" ? "shrink-0" : "min-w-0 flex-1",
            )}
            contentClassName="justify-end"
            gap={8}
            collapseOrder={headerCollapseOrder}
            onContentWidthChange={setControlsContentWidth}
            forceOverflow={tagMode === "minimal"}
          >
            {headerControlItems.map(({ key, node }) => (
              <Fragment key={key}>{node}</Fragment>
            ))}
          </ProgressiveOverflowRow>
          <div
            ref={fullTagsMeasureRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute left-0 top-0 flex w-max items-center gap-2"
          >
            {renderHeaderTags("full")}
          </div>
          <div
            ref={compactTagsMeasureRef}
            aria-hidden="true"
            className="pointer-events-none invisible absolute left-0 top-0 flex w-max items-center gap-2"
          >
            {renderHeaderTags("compact")}
          </div>
        </div>
      )}
    </div>
  )
}, areTitlePropsEqual)
