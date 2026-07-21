"use client"

import { memo, useState, useCallback, useEffect } from "react"
import { ChevronDown, ArrowUp, GripVertical, Pencil, X } from "lucide-react"
import { motion, AnimatePresence } from "motion/react"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip"
import { cn } from "../../../lib/utils"
import type { AgentQueueItem } from "../lib/queue-utils"
import { RenderFileMentions } from "../mentions/render-file-mentions"
import { getWindowId } from "../../../contexts/WindowContext"

// Window-scoped key so each window has its own queue expanded state
const getQueueExpandedKey = () => `${getWindowId()}:agent-queue-expanded`

// Queue item row component
const QueueItemRow = memo(function QueueItemRow({
  item,
  onRemove,
  onSendNow,
  onEdit,
  onMove,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  item: AgentQueueItem
  onRemove?: (itemId: string) => void
  onSendNow?: (itemId: string) => void
  onEdit?: (itemId: string) => void
  onMove?: (itemId: string, direction: -1 | 1) => void
  isDragging?: boolean
  isDragOver?: boolean
  onDragStart?: (itemId: string) => void
  onDragOver?: (itemId: string) => void
  onDrop?: (itemId: string) => void
  onDragEnd?: () => void
}) {
  const [dragEnabled, setDragEnabled] = useState(false)
  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onRemove?.(item.id)
    },
    [item.id, onRemove],
  )

  const handleSendNow = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onSendNow?.(item.id)
    },
    [item.id, onSendNow],
  )

  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onEdit?.(item.id)
    },
    [item.id, onEdit],
  )

  // Build attachment summary parts by type (matching sent message bubble style)
  const attachmentParts: string[] = []
  const imageCount = item.images?.length || 0
  const fileCount = item.files?.length || 0
  const quoteCount = item.textContexts?.length || 0
  const diffCount = item.diffTextContexts?.length || 0
  const pastedCount = item.pastedTexts?.length || 0

  if (imageCount > 0) {
    attachmentParts.push(imageCount === 1 ? "image" : `${imageCount} images`)
  }
  if (fileCount > 0) {
    attachmentParts.push(fileCount === 1 ? "file" : `${fileCount} files`)
  }
  if (quoteCount > 0) {
    attachmentParts.push(quoteCount === 1 ? "selected text" : `${quoteCount} text selections`)
  }
  if (pastedCount > 0) {
    attachmentParts.push(pastedCount === 1 ? "pasted text" : `${pastedCount} pasted texts`)
  }
  if (diffCount > 0) {
    attachmentParts.push(diffCount === 1 ? "code selection" : `${diffCount} code selections`)
  }

  return (
    <div
      draggable={dragEnabled}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move"
        event.dataTransfer.setData("text/plain", item.id)
        onDragStart?.(item.id)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        onDragOver?.(item.id)
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop?.(item.id)
      }}
      onDragEnd={() => {
        setDragEnabled(false)
        onDragEnd?.()
      }}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-muted/50 transition-colors cursor-default",
        isDragging && "opacity-50",
        isDragOver && "bg-muted/80 ring-1 ring-inset ring-primary/40",
      )}
    >
      {onMove && (
        <button
          type="button"
          className="shrink-0 cursor-grab rounded p-1 text-muted-foreground/60 hover:bg-foreground/10 hover:text-foreground active:cursor-grabbing"
          aria-label="Drag to reorder queued message"
          onMouseDown={() => setDragEnabled(true)}
          onMouseUp={() => setDragEnabled(false)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault()
              onMove(item.id, event.key === "ArrowUp" ? -1 : 1)
            }
          }}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      {item.message ? (
        <span className="truncate flex-1 text-foreground">
          <RenderFileMentions text={item.message} />
        </span>
      ) : attachmentParts.length > 0 ? (
        <span className="truncate flex-1 text-muted-foreground italic">
          Using {attachmentParts.join(", ")}
        </span>
      ) : null}
      {attachmentParts.length > 0 && (
        <span className="flex-shrink-0 text-muted-foreground text-[10px]">
          +{attachmentParts.join(", ")}
        </span>
      )}
      <div className="flex items-center gap-1">
        {onEdit && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleEdit}
                className="flex-shrink-0 p-1 hover:bg-foreground/10 rounded text-muted-foreground hover:text-foreground transition-all"
                aria-label="Edit queued message"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Edit</TooltipContent>
          </Tooltip>
        )}
        {onSendNow && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleSendNow}
                className="flex-shrink-0 p-1 hover:bg-foreground/10 rounded text-muted-foreground hover:text-foreground transition-all"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Send now</TooltipContent>
          </Tooltip>
        )}
        {onRemove && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleRemove}
                className="flex-shrink-0 p-1 hover:bg-foreground/10 rounded text-muted-foreground hover:text-foreground transition-all"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Remove</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
})

interface AgentQueueIndicatorProps {
  queue: AgentQueueItem[]
  onRemoveItem?: (itemId: string) => void
  onSendNow?: (itemId: string) => void
  onEditItem?: (itemId: string) => void
  onReorderItem?: (itemId: string, targetItemId: string) => void
  isStreaming?: boolean
  /** Whether there's a status card below this one - affects border radius */
  hasStatusCardBelow?: boolean
}

export const AgentQueueIndicator = memo(function AgentQueueIndicator({
  queue,
  onRemoveItem,
  onSendNow,
  onEditItem,
  onReorderItem,
  isStreaming = false,
  hasStatusCardBelow = false,
}: AgentQueueIndicatorProps) {
  // Load expanded state from localStorage (window-scoped)
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window === "undefined") return true
    const saved = localStorage.getItem(getQueueExpandedKey())
    return saved !== null ? saved === "true" : true // Default to expanded
  })
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null)

  const moveItem = useCallback(
    (itemId: string, direction: -1 | 1) => {
      const index = queue.findIndex((item) => item.id === itemId)
      const target = queue[index + direction]
      if (index === -1 || !target) return
      onReorderItem?.(itemId, target.id)
    },
    [onReorderItem, queue],
  )

  // Save expanded state to localStorage (window-scoped)
  useEffect(() => {
    localStorage.setItem(getQueueExpandedKey(), String(isExpanded))
  }, [isExpanded])

  if (queue.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        "border border-border bg-muted/30 overflow-hidden flex flex-col rounded-t-xl",
        // If status card below - no bottom border/radius, no padding
        // If no status card - need pb-6 for input overlap
        hasStatusCardBelow ? "border-b-0" : "border-b-0 pb-6",
      )}
    >
      {/* Header - at top */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setIsExpanded(!isExpanded)
          }
        }}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} queue`}
        className="flex items-center justify-between pr-1 pl-3 h-8 cursor-pointer hover:bg-muted/50 transition-colors duration-150 focus:outline-none rounded-sm"
      >
        <div className="flex items-center gap-2 text-xs flex-1 min-w-0">
          <ChevronDown
            className={cn(
              "w-4 h-4 text-muted-foreground transition-transform duration-200",
              !isExpanded && "-rotate-90",
            )}
          />
          <span className="text-xs text-muted-foreground">{queue.length} in queue</span>
        </div>
      </div>

      {/* Expanded content - queue items */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border max-h-[200px] overflow-y-auto">
              {queue.map((item) => (
                <QueueItemRow
                  key={item.id}
                  item={item}
                  onRemove={onRemoveItem}
                  onSendNow={onSendNow}
                  onEdit={onEditItem}
                  onMove={onReorderItem ? moveItem : undefined}
                  isDragging={draggedItemId === item.id}
                  isDragOver={dragOverItemId === item.id && draggedItemId !== item.id}
                  onDragStart={setDraggedItemId}
                  onDragOver={setDragOverItemId}
                  onDrop={(targetItemId) => {
                    if (draggedItemId) onReorderItem?.(draggedItemId, targetItemId)
                    setDraggedItemId(null)
                    setDragOverItemId(null)
                  }}
                  onDragEnd={() => {
                    setDraggedItemId(null)
                    setDragOverItemId(null)
                  }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
