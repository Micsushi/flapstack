import { NativeSelect } from "../../../components/ui/native-select"
import React, { useState, useEffect, useCallback, useRef, useMemo, useId, memo } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { toast } from "sonner"
import { useAtom } from "jotai"
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

export type QuickOpenItem = {
  id: string
  label: string
  context: string
  kind: "Chat" | "Project" | "Worktree" | "Settings" | "Command"
  onSelect: () => void | Promise<boolean>
}

interface FileSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string
  onSelectFile: (filePath: string) => void
  getNavigationItems?: (query: string) => QuickOpenItem[]
  navigationBusy?: boolean
  providerErrors?: Array<{ label: string; message: string; retry: () => void }>
}

export const FileSearchDialog = memo(function FileSearchDialog({
  open,
  onOpenChange,
  projectPath,
  onSelectFile,
  getNavigationItems,
  providerErrors = [],
  navigationBusy = false,
}: FileSearchDialogProps) {
  const [scope, setScope] = useState("All")
  const includeFiles = scope === "All" || scope === "File"
  const unified = Boolean(getNavigationItems)
  const resultsId = useId()
  const optionId = (path: string) =>
    `${resultsId}-${encodeURIComponent(fileSearchPathKey(projectPath, path))}`
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [selection, setSelection] = useState<{ scope: string; path: string } | null>(null)
  const selectionScope = JSON.stringify([projectPath, query, scope])
  const searchInputRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
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
      setScope("All")
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
      enabled: open && !!projectPath && !streamed && includeFiles,
    },
  )
  const streamedSearch = useStreamedFileSearch(
    projectPath,
    debouncedQuery,
    streamed && open && !!projectPath && includeFiles && query === debouncedQuery,
  )
  const { data: results, error, refetch } = streamed ? streamedSearch : legacySearch
  const isFetching =
    includeFiles &&
    Boolean(projectPath) &&
    ((streamed ? streamedSearch.isFetching : legacySearch.isFetching) || query !== debouncedQuery)

  // Build recent file items directly from atom (independent of search results)
  const recentItems = useMemo(
    () =>
      includeFiles && projectPath
        ? recentFileSearchItems(projectPath, recentlyOpenedFiles, query)
        : [],
    [recentlyOpenedFiles, projectPath, query, includeFiles],
  )

  const recentPathsSet = useMemo(
    () => new Set(recentItems.map((f) => fileSearchPathKey(projectPath, f.path))),
    [recentItems, projectPath],
  )

  // Search results excluding recently opened files
  const otherFiles = useMemo(() => {
    if (!includeFiles || !projectPath || query !== debouncedQuery) return []
    const allFiles = (results ?? []).filter((item) => item.type === "file")
    return allFiles.filter((file) => !recentPathsSet.has(fileSearchPathKey(projectPath, file.path)))
  }, [results, recentPathsSet, projectPath, query, debouncedQuery, includeFiles])

  // Flat list for keyboard navigation: recent first, then rest
  const navigationItems = useMemo(
    () =>
      (getNavigationItems?.(query) ?? []).filter((item) => scope === "All" || item.kind === scope),
    [getNavigationItems, query, scope],
  )
  const allItems = useMemo(() => {
    const files = [...recentItems, ...otherFiles].slice(0, 50).map((item) => ({
      ...item,
      kind: "File",
      context: item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "",
    }))
    const items = [
      ...files,
      ...navigationItems.map((item) => ({ ...item, path: `quick-open:${item.id}` })),
    ]
    if (!unified || !query.trim()) return items.slice(0, 100)
    const term = query.trim().toLowerCase()
    const score = (item: (typeof items)[number]) =>
      item.label.toLowerCase() === term ? 0 : item.label.toLowerCase().startsWith(term) ? 1 : 2
    return items.sort((a, b) => score(a) - score(b)).slice(0, 100)
  }, [recentItems, otherFiles, navigationItems, unified, query])
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
      const navigation = navigationItems.find((item) => `quick-open:${item.id}` === relativePath)
      if (navigation) {
        const result = navigation.onSelect()
        if (result instanceof Promise) {
          void result
            .then((opened) => {
              if (opened) {
                onOpenChange(false)
              }
            })
            .catch(() => toast.error("This item could not be opened. Try again."))
        } else {
          onOpenChange(false)
        }
        return
      }
      const absolutePath = joinFileSearchPath(projectPath, relativePath)
      onSelectFile(absolutePath)
      onOpenChange(false)
    },
    [projectPath, onSelectFile, onOpenChange, navigationItems],
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

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-3 z-50 -translate-x-1/2",
            "w-[600px] max-w-[calc(100vw-32px)]",
            "beta-surface rounded-xl border border-border bg-popover shadow-lg",
            "p-0 flex flex-col overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            openerRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null
            searchInputRef.current?.focus()
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            if (
              openerRef.current?.isConnected &&
              (document.activeElement === document.body || document.activeElement === null)
            )
              openerRef.current.focus()
          }}
        >
          <DialogPrimitive.Title className="sr-only">
            {unified ? "Quick Open" : "Go to file"}
          </DialogPrimitive.Title>
          {/* Search */}
          <div className="mx-1 my-1">
            <div className="relative flex items-center gap-1.5 h-7 px-1.5 rounded-md bg-muted/50">
              <SearchIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                ref={searchInputRef}
                placeholder={unified ? "Quick Open..." : "Go to file..."}
                aria-label={unified ? "Quick Open" : "Search workspace files"}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={true}
                aria-controls={resultsId}
                aria-activedescendant={
                  allItems[selectedIndex] ? optionId(allItems[selectedIndex].path) : undefined
                }
                onKeyDown={handleKeyDown}
                value={query}
                onChange={handleSearchChange}
                className="h-auto p-0 border-0 rounded-none bg-transparent text-sm placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          </div>

          {unified && (
            <NativeSelect
              aria-label="Quick Open scope"
              value={scope}
              onChange={(event) => {
                setScope(event.target.value)
                setSelection(null)
                searchInputRef.current?.focus()
              }}
              className="rounded-none border-x-0"
            >
              {["All", "File", "Chat", "Project", "Worktree", "Settings", "Command"].map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "All" ? "All sources" : kind}
                </option>
              ))}
            </NativeSelect>
          )}
          {/* File List */}
          <div className="flex-1 overflow-y-auto py-1 max-h-[min(400px,calc(100dvh-150px))] border-t scrollbar-hide">
            <FileSearchFeedback
              error={includeFiles ? error?.message : undefined}
              busy={isFetching}
              onRetry={() => {
                void refetch()
              }}
            />
            {navigationBusy && (
              <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
                Loading results…
              </p>
            )}
            {providerErrors.map((failure) => (
              <div
                key={failure.label}
                className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                role="alert"
              >
                <span>
                  {failure.label}: {failure.message}
                </span>
                <button type="button" className="underline" onClick={failure.retry}>
                  Retry
                </button>
              </div>
            ))}
            <div
              id={resultsId}
              role="listbox"
              aria-label={unified ? "Quick Open results" : "Workspace files"}
              aria-busy={isFetching || navigationBusy}
            >
              {allItems.length === 0 &&
                !isFetching &&
                !navigationBusy &&
                !(includeFiles && error) &&
                providerErrors.length === 0 && (
                  <div role="status" className="px-3 py-2 text-sm text-muted-foreground">
                    {unified && scope === "File" && !projectPath
                      ? "Open a local chat with a workspace to search files."
                      : unified
                        ? "No matching items"
                        : "No files found"}
                  </div>
                )}
              {allItems.map((item, index) => (
                <FileSearchItem
                  key={`${item.kind}:${item.id}`}
                  optionId={optionId(item.path)}
                  label={item.label}
                  dirPath={item.context}
                  index={index}
                  isSelected={index === selectedIndex}
                  onSelect={() => handleSelect(item.path)}
                  setRef={handleSetRef}
                  query={query}
                  navigation={item.kind !== "File"}
                  recentLabel={
                    item.kind !== "File"
                      ? item.kind
                      : recentPathsSet.has(fileSearchPathKey(projectPath, item.path))
                        ? "Recent"
                        : unified
                          ? "File"
                          : undefined
                  }
                />
              ))}
            </div>
          </div>
          {recentItems.length > 0 && (
            <NativeSelect
              aria-label="Remove recent file"
              value=""
              className="rounded-none border-x-0 border-b-0 text-xs"
              onChange={(event) => {
                handleRemoveRecent(event.target.value)
                searchInputRef.current?.focus()
              }}
            >
              <option value="" disabled>
                Remove recent file...
              </option>
              {recentItems.map((item) => (
                <option key={item.id} value={item.path}>
                  {item.path}
                </option>
              ))}
            </NativeSelect>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
})

interface FileSearchItemProps {
  optionId: string
  label: string
  dirPath: string
  index: number
  isSelected: boolean
  onSelect: () => void
  setRef: (index: number, el: HTMLDivElement | null) => void
  query?: string
  recentLabel?: string
  navigation?: boolean
}

const FileSearchItem = memo(function FileSearchItem({
  optionId,
  label,
  dirPath,
  index,
  isSelected,
  onSelect,
  setRef,
  query,
  recentLabel,
  navigation,
}: FileSearchItemProps) {
  const handleRef = useCallback(
    (el: HTMLDivElement | null) => {
      setRef(index, el)
    },
    [setRef, index],
  )

  const Icon = navigation ? SearchIcon : (getFileIconByExtension(label) ?? UnknownFileIcon)

  return (
    <div
      ref={handleRef}
      id={optionId}
      role="option"
      aria-selected={isSelected}
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
        <span className="min-w-0 truncate">
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
        </span>
      )}
    </div>
  )
})
