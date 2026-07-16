"use client"

import { useState, useRef, useEffect, useCallback, memo } from "react"
import { useAtomValue } from "jotai"
import { cn } from "../../../lib/utils"
import { TypewriterText } from "../../../components/ui/typewriter-text"
import { CopyIcon } from "../../../components/ui/icons"
import { justCreatedIdsAtom } from "../atoms"
import { Folder } from "lucide-react"
import { ProviderChipIcon } from "../components/provider-chip-icon"
import { OpenInButton } from "../../../components/open-in-button"

const MAX_VISIBLE_CHAT_NAME_LENGTH = 40

interface ChatTitleEditorProps {
  name: string
  placeholder?: string
  onSave: (newName: string) => Promise<void>
  isMobile?: boolean
  disabled?: boolean
  chatId?: string
  copyChatId?: string
  hasMessages?: boolean
  onCopyChat?: () => void
  isSidebarOpen?: boolean
  provider?: string
  providerName?: string
  providerClassName?: string
  projectLabel?: string | null
  projectColor?: string | null
  workspaceBranch?: string | null
  localFolderPath?: string
  reserveRestoreSpace?: boolean
}

// Custom comparison to prevent re-renders during streaming
function areTitlePropsEqual(prev: ChatTitleEditorProps, next: ChatTitleEditorProps): boolean {
  return (
    prev.name === next.name &&
    prev.placeholder === next.placeholder &&
    prev.isMobile === next.isMobile &&
    prev.disabled === next.disabled &&
    prev.chatId === next.chatId &&
    prev.copyChatId === next.copyChatId &&
    prev.hasMessages === next.hasMessages &&
    prev.onCopyChat === next.onCopyChat &&
    prev.isSidebarOpen === next.isSidebarOpen &&
    prev.provider === next.provider &&
    prev.providerName === next.providerName &&
    prev.providerClassName === next.providerClassName &&
    prev.projectLabel === next.projectLabel &&
    prev.projectColor === next.projectColor &&
    prev.workspaceBranch === next.workspaceBranch &&
    prev.localFolderPath === next.localFolderPath &&
    prev.reserveRestoreSpace === next.reserveRestoreSpace
  )
}

export const ChatTitleEditor = memo(function ChatTitleEditor({
  name,
  placeholder = "New Chat",
  onSave,
  isMobile = false,
  disabled = false,
  chatId,
  copyChatId,
  hasMessages = false,
  onCopyChat,
  isSidebarOpen = true,
  provider,
  providerName,
  providerClassName,
  projectLabel,
  projectColor,
  workspaceBranch,
  localFolderPath,
  reserveRestoreSpace = false,
}: ChatTitleEditorProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(name)
  const [isSaving, setIsSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const justCreatedIds = useAtomValue(justCreatedIdsAtom)

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

  const isJustCreated = chatId ? justCreatedIds.has(chatId) : false
  const hasRealName = name && name !== placeholder
  const visibleName =
    name.length > MAX_VISIBLE_CHAT_NAME_LENGTH
      ? `${name.slice(0, MAX_VISIBLE_CHAT_NAME_LENGTH)}...`
      : name

  const handleClick = () => {
    // Don't allow editing if disabled or if it's a placeholder (not saved to DB yet)
    if (!disabled && !isEditing && hasRealName) {
      setIsEditing(true)
    }
  }

  // Fixed height to prevent layout shift when switching between view/edit modes
  const heightClass = isMobile ? "h-7" : "h-8"

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex items-center gap-2",
        isMobile
          ? "max-w-2xl mx-auto px-4"
          : cn("w-full", reserveRestoreSpace ? "pr-48" : "pr-20", isSidebarOpen ? "pl-5" : "pl-12"),
        heightClass,
      )}
    >
      {!isMobile && <Folder className="h-4 w-4 shrink-0 text-foreground/80" aria-hidden />}
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
            "font-medium text-foreground",
          )}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        />
      ) : (
        <div
          onClick={handleClick}
          className={cn(
            "flex h-full min-w-0 flex-1 items-center text-left",
            isMobile ? "text-base" : "text-lg",
            "font-medium",
            hasRealName ? "text-foreground cursor-pointer" : "cursor-default",
          )}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <span className="block truncate" title={name}>
            <TypewriterText
              text={visibleName}
              placeholder={placeholder}
              id={chatId}
              isJustCreated={isJustCreated}
              showPlaceholder={hasMessages}
            />
          </span>
        </div>
      )}
      {!isMobile && !isEditing && workspaceBranch && (
        <span className="min-w-0 truncate text-xs text-foreground/60">{workspaceBranch}</span>
      )}
      {!isMobile && !isEditing && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {projectLabel && (
            <span
              className="inline-flex h-7 shrink-0 items-center rounded-md border px-2.5 text-sm font-medium"
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
          )}
          {providerName && (
            <span
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium",
                providerClassName,
              )}
            >
              <ProviderChipIcon provider={provider} className="h-4 w-4" />
              {providerName}
            </span>
          )}
          <OpenInButton path={localFolderPath} label="Open in" />
          {onCopyChat && (
            <button
              type="button"
              onClick={onCopyChat}
              className="relative z-30 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md p-0 text-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground"
              style={{
                // @ts-expect-error - WebKit-specific property for Electron window dragging
                WebkitAppRegion: "no-drag",
              }}
              aria-label="Copy full chat"
              title="Copy full chat"
              data-dev-chat-copy-source="active-header"
              data-chat-id={copyChatId}
            >
              <CopyIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}, areTitlePropsEqual)
