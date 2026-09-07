import React, { useState, useEffect, useCallback, useRef, useMemo, memo } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { useAtom } from "jotai"
import { X } from "lucide-react"
import { cn } from "../../../lib/utils"
import { trpc } from "../../../lib/trpc"
import { recordAppAction } from "../../../lib/app-action-history"
import { Input } from "../../../components/ui/input"
import { SearchIcon } from "../../../components/ui/icons"
import { UnknownFileIcon } from "../../../icons/framework-icons"
import { getFileIconByExtension } from "../../agents/mentions/agents-file-mention"
import { recentlyOpenedFilesAtom } from "../../agents/atoms"
import { FileSearchFeedback } from "./file-search-feedback"
import { fileSearchPathKey, joinFileSearchPath, recentFileSearchItems } from "./file-search-paths"
import { useBetaFeatures } from "../../settings/use-beta-features"
import { useStreamedFileSearch } from "./use-streamed-file-search"

// ============================================================================
// Highlight helper - splits text into segments with matching parts marked
// ============================================================================

function highlightMatches(
  text: string,
  query: string,
): Array<{ text: string; highlight: boolean }> {
  if (!query) return [{ text, highlight: false }]
  const lower = text.toLowerCase()
  const qLower = query.toLowerCase()
  const segments: Array<{ text: string; highlight: boolean }> = []
  let cursor = 0
  while (cursor < text.length) {
    const idx = lower.indexOf(qLower, cursor)
    if (idx === -1) {
      segments.push({ text: text.slice(cursor), highlight: false })
      break
    }
    if (idx > cursor) {
      segments.push({ text: text.slice(cursor, idx), highlight: false })
    }
    segments.push({ text: text.slice(idx, idx + query.length), highlight: true })
    cursor = idx + query.length
  }
  return segments
}

interface FileSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string
  onSelectFile: (filePath: string) => void
}

export const FileSearchDialog = memo(function FileSearchDialog({
  open,
  onOpenChange,
  projectPath,
  onSelectFile,
}: FileSearchDialogProps) {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [selection, setSelection] = useState<{ scope: string; path: string } | null>(null)
  const selectionScope = JSON.stringify([projectPath, query])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [recentlyOpenedFiles, setRecentlyOpenedFiles] = useAtom(recentlyOpenedFilesAtom)

  // Debounce the query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setQuery("")
      setDebouncedQuery("")
      setSelection(null)
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 0)
    }
  }, [open])

  const streamed = useBetaFeatures().streamedFileSearch
  const legacySearch = trpc.files.search.useQuery(
    {
      projectPath,
      query: debouncedQuery,
      limit: 50,
    },
    {
      enabled: open && !!projectPath && !streamed,
    },
  )
  const streamedSearch = useStreamedFileSearch(
    projectPath,
    debouncedQuery,
    streamed && open && !!projectPath && query === debouncedQuery,
  )
  const { data: results, error, refetch } = streamed ? streamedSearch : legacySearch
  const isFetching = streamed
    ? streamedSearch.isFetching || query !== debouncedQuery
    : legacySearch.isFetching

  // Build recent file items directly from atom (independent of search results)
  const recentItems = useMemo(
    () => recentFileSearchItems(projectPath, recentlyOpenedFiles, debouncedQuery),
    [recentlyOpenedFiles, projectPath, debouncedQuery],
  )

  const recentPathsSet = useMemo(
    () => new Set(recentItems.map((f) => fileSearchPathKey(projectPath, f.path))),
    [recentItems, projectPath],
  )

  // Search results excluding recently opened files
  const otherFiles = useMemo(() => {
    const allFiles = (results ?? []).filter((item) => item.type === "file")
    return allFiles.filter((file) => !recentPathsSet.has(fileSearchPathKey(projectPath, file.path)))
  }, [results, recentPathsSet, projectPath])

  // Flat list for keyboard navigation: recent first, then rest
  const allItems = useMemo(() => [...recentItems, ...otherFiles], [recentItems, otherFiles])
  const matchingIndex =
    selection?.scope === selectionScope
      ? allItems.findIndex((item) => fileSearchPathKey(projectPath, item.path) === selection.path)
      : -1
  const selectedIndex = Math.max(0, matchingIndex)

  // A streamed batch may reorder rows. Keep explicit keyboard choice by identity.
  // If it leaves the capped results, fall back to the first row without reviving it later.
  useEffect(() => {
    if (selection && matchingIndex < 0) setSelection(null)
  }, [selection, matchingIndex])

  // Reset selection when results change
  useEffect(() => {
    setSelection(null)
    itemRefs.current = []
  }, [debouncedQuery])

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current[selectedIndex]
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }, [selectedIndex])

  const handleSelect = useCallback(
    (relativePath: string) => {
      const absolutePath = joinFileSearchPath(projectPath, relativePath)
      onSelectFile(absolutePath)
      onOpenChange(false)
    },
    [projectPath, onSelectFile, onOpenChange],
  )

  const handleRemoveRecent = useCallback(
    (relativePath: string) => {
      const absolutePath = joinFileSearchPath(projectPath, relativePath)
      const key = fileSearchPathKey(projectPath, absolutePath)
      const before = recentlyOpenedFiles
      const after = before.filter((p) => fileSearchPathKey(projectPath, p) !== key)
      const removed = before.filter((p) => fileSearchPathKey(projectPath, p) === key)
      if (!removed.length) return
      setRecentlyOpenedFiles(after)
      recordAppAction({
        label: "Remove recent file",
        undo: () =>
          setRecentlyOpenedFiles((current) =>
            current === after
              ? before
              : [
                  ...removed.filter(
                    (p) =>
                      !current.some(
                        (entry) =>
                          fileSearchPathKey(projectPath, entry) ===
                          fileSearchPathKey(projectPath, p),
                      ),
                  ),
                  ...current,
                ].slice(0, 50),
          ),
        redo: () =>
          setRecentlyOpenedFiles((current) =>
            current.filter((p) => fileSearchPathKey(projectPath, p) !== key),
          ),
      })
    },
    [projectPath, recentlyOpenedFiles, setRecentlyOpenedFiles],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (allItems.length === 0) return

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelection({
          scope: selectionScope,
          path: fileSearchPathKey(
            projectPath,
            allItems[(selectedIndex + 1) % allItems.length].path,
          ),
        })
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelection({
          scope: selectionScope,
          path: fileSearchPathKey(
            projectPath,
            allItems[(selectedIndex - 1 + allItems.length) % allItems.length].path,
          ),
        })
      } else if (e.key === "Enter") {
        e.preventDefault()
        const file = allItems[selectedIndex]
        if (file) {
          handleSelect(file.path)
        }
      }
    },
    [allItems, selectedIndex, handleSelect, selectionScope, projectPath],
  )

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
  }, [])

  const handleSetRef = useCallback((index: number, el: HTMLDivElement | null) => {
    itemRefs.current[index] = el
  }, [])

  const recentCount = recentItems.length

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-3 z-50 -translate-x-1/2",
            "w-[600px] max-w-[calc(100vw-32px)]",
            "rounded-[10px] border border-border bg-popover shadow-lg",
            "p-0 flex flex-col overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onKeyDown={handleKeyDown}
        >
          <DialogPrimitive.Title className="sr-only">Go to file</DialogPrimitive.Title>
          {/* Search */}
          <div className="mx-1 my-1">
            <div className="relative flex items-center gap-1.5 h-7 px-1.5 rounded-md bg-muted/50">
              <SearchIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                ref={searchInputRef}
                placeholder="Go to file..."
                aria-label="Search workspace files"
                value={query}
                onChange={handleSearchChange}
                className="h-auto p-0 border-0 rounded-none bg-transparent text-sm placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          </div>

          {/* File List */}
          <div className="flex-1 overflow-y-auto py-1 max-h-[400px] border-t scrollbar-hide">
            <FileSearchFeedback
              error={error?.message}
              busy={isFetching}
              onRetry={() => {
                void refetch()
              }}
            />
            {allItems.length === 0 && debouncedQuery && !error && !isFetching ? (
              <div className="min-h-[32px] py-[5px] px-1.5 mx-1 flex items-center text-sm text-muted-foreground">
                No files found
              </div>
            ) : (
              <>
                {/* Recently opened files (shown at top, no section header) */}
                {recentItems.map((item, i) => {
                  const dirPath = item.path.includes("/")
                    ? item.path.slice(0, item.path.lastIndexOf("/"))
                    : ""
                  return (
                    <FileSearchItem
                      key={item.id}
                      label={item.label}
                      dirPath={dirPath}
                      index={i}
                      isSelected={i === selectedIndex}
                      onSelect={() => handleSelect(item.path)}
                      setRef={handleSetRef}
                      query={debouncedQuery}
                      recentLabel="recently opened"
                      onRemoveRecent={() => handleRemoveRecent(item.path)}
                    />
                  )
                })}

                {/* Other files section */}
                {otherFiles.length > 0 && (
                  <>
                    {otherFiles.map((item, i) => {
                      const flatIndex = recentCount + i
                      const dirPath = item.path.includes("/")
                        ? item.path.slice(0, item.path.lastIndexOf("/"))
                        : ""
                      return (
                        <FileSearchItem
                          key={item.id}
                          label={item.label}
                          dirPath={dirPath}
                          index={flatIndex}
                          isSelected={flatIndex === selectedIndex}
                          onSelect={() => handleSelect(item.path)}
                          setRef={handleSetRef}
                          query={debouncedQuery}
                        />
                      )
                    })}
                  </>
                )}
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
})

interface FileSearchItemProps {
  label: string
  dirPath: string
  index: number
  isSelected: boolean
  onSelect: () => void
  setRef: (index: number, el: HTMLDivElement | null) => void
  query?: string
  recentLabel?: string
  onRemoveRecent?: () => void
}

const FileSearchItem = memo(function FileSearchItem({
  label,
  dirPath,
  index,
  isSelected,
  onSelect,
  setRef,
  query,
  recentLabel,
  onRemoveRecent,
}: FileSearchItemProps) {
  const handleRef = useCallback(
    (el: HTMLDivElement | null) => {
      setRef(index, el)
    },
    [setRef, index],
  )

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onRemoveRecent?.()
    },
    [onRemoveRecent],
  )

  const Icon = getFileIconByExtension(label) ?? UnknownFileIcon

  return (
    <div
      ref={handleRef}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-1.5 min-h-[32px] py-[5px] px-1.5 mx-1 w-[calc(100%-8px)]",
        "rounded-md text-sm cursor-default select-none outline-none",
        "transition-colors group",
        isSelected
          ? "dark:bg-neutral-800 bg-accent text-foreground"
          : "text-muted-foreground dark:hover:bg-neutral-800 hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <span className="flex items-center gap-1.5 w-full min-w-0">
        <span className="shrink-0 whitespace-nowrap">
          {query
            ? highlightMatches(label, query).map((seg, i) =>
                seg.highlight ? (
                  <mark key={i} className="bg-transparent text-foreground font-semibold">
                    {seg.text}
                  </mark>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )
            : label}
        </span>
        {dirPath && (
          <span
            className="text-muted-foreground flex-1 min-w-0 ml-1 font-mono overflow-hidden text-xs"
            style={{
              direction: "rtl",
              textAlign: "left",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ direction: "ltr" }}>
              {query
                ? highlightMatches(dirPath, query).map((seg, i) =>
                    seg.highlight ? (
                      <mark key={i} className="bg-transparent text-foreground font-semibold">
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    ),
                  )
                : dirPath}
            </span>
          </span>
        )}
      </span>
      {recentLabel && (
        <span className="flex items-center gap-1 ml-auto shrink-0">
          <span className="text-xs text-muted-foreground/60">{recentLabel}</span>
          <button
            type="button"
            aria-label={`Remove ${label} from recent files`}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") event.stopPropagation()
            }}
            onClick={handleRemove}
            className="h-4 w-4 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
    </div>
  )
})
