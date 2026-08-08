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
  useRef,
  useState,
} from "react"
import { cn } from "../../../lib/utils"
import { Folder } from "lucide-react"
import { ProviderChipIcon } from "../components/provider-chip-icon"
import { OpenInButton } from "../../../components/open-in-button"
import { ProgressiveOverflowRow } from "../../../components/progressive-overflow-row"

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
  workspaceBranch,
  localFolderPath,
  headerActions,
}: ChatTitleEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(name)
  const [isSaving, setIsSaving] = useState(false)
  const [hiddenHeaderIndexes, setHiddenHeaderIndexes] = useState<number[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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
  const actionKeys = headerActionItems.map((_, index) => `action-${index}`)
  const headerOverflowItems = [
    workspaceBranch
      ? {
          key: "branch",
          node: (
            <span className="max-w-32 truncate text-xs text-foreground/60">{workspaceBranch}</span>
          ),
        }
      : null,
    projectLabel
      ? {
          key: "project",
          node: (
            <span
              className="inline-flex h-7 shrink-0 items-center justify-center rounded-md border px-2.5 text-[13px] font-medium leading-none"
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
              {projectLabel}
            </span>
          ),
        }
      : null,
    providerName
      ? {
          key: "provider",
          node: (
            <span
              className={cn(
                "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium leading-none",
                providerClassName,
              )}
            >
              <ProviderChipIcon provider={provider} className="h-4 w-4" />
              {providerName}
            </span>
          ),
        }
      : null,
    localFolderPath
      ? {
          key: "open-in",
          node: <OpenInButton path={localFolderPath} label="Open in" />,
        }
      : null,
    ...headerActionItems.map((node, index) => ({ key: actionKeys[index], node })),
  ].filter((item): item is NonNullable<typeof item> => item !== null)
  const headerCollapseOrder = ["provider", "project", "branch", ...actionKeys.reverse(), "open-in"]
    .map((key) => headerOverflowItems.findIndex((item) => item.key === key))
    .filter((index) => index >= 0)
  const displayChipIndexes = ["project", "provider"]
    .map((key) => headerOverflowItems.findIndex((item) => item.key === key))
    .filter((index) => index >= 0)
  const hideHeadingIcon =
    !isEditing &&
    displayChipIndexes.length > 0 &&
    displayChipIndexes.every((index) => hiddenHeaderIndexes.includes(index))

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex items-center gap-2",
        isMobile ? "max-w-2xl mx-auto px-4" : cn("w-full pr-3", isSidebarOpen ? "pl-5" : "pl-12"),
        heightClass,
      )}
    >
      {!isMobile && !hideHeadingIcon && (
        <Folder className="h-[18px] w-[18px] shrink-0 text-foreground/80" aria-hidden />
      )}
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
            "min-w-0 flex-1 h-full bg-transparent border-0 outline-none",
            isMobile ? "text-base" : "text-lg",
            "font-medium leading-none text-foreground",
          )}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        />
      ) : (
        <div
          onClick={handleClick}
          className={cn(
            "flex h-full min-w-0 flex-1 items-center text-left",
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
        <ProgressiveOverflowRow
          usageRatio={1}
          menuLabel="More chat actions"
          className="ml-auto w-full max-w-[68%] justify-end leading-none"
          contentClassName="justify-end"
          gap={8}
          collapseOrder={headerCollapseOrder}
          onHiddenIndexesChange={setHiddenHeaderIndexes}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {headerOverflowItems.map(({ key, node }) => (
            <Fragment key={key}>{node}</Fragment>
          ))}
        </ProgressiveOverflowRow>
      )}
    </div>
  )
}, areTitlePropsEqual)
