"use client"

import { Search, CornerDownRight } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Button } from "../../components/ui/button"
import { Checkbox } from "../../components/ui/checkbox"
import { Input } from "../../components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { isNavigableScopedSearchResult } from "./scoped-search-navigation"

type Scope = "all" | "project" | "task" | "chat"

type ScopedSearchPanelProps = {
  selectedChatId?: string | null
  selectedProjectId?: string | null
  selectedTaskId?: string | null
  onNavigateChat?: (
    chatId: string,
    subChatId?: string | null,
    messageId?: string | null,
    query?: string,
  ) => void
}

const RESULT_PAGE_SIZE = 20

function resultLabel(type: string) {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

export function ScopedSearchPanel({
  selectedChatId,
  selectedProjectId,
  selectedTaskId,
  onNavigateChat,
}: ScopedSearchPanelProps) {
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState<Scope>("all")
  const [includeArchived, setIncludeArchived] = useState(false)
  const [visibleCount, setVisibleCount] = useState(RESULT_PAGE_SIZE)

  const scopeId = useMemo(() => {
    if (scope === "project") return selectedProjectId ?? undefined
    if (scope === "task") return selectedTaskId ?? undefined
    if (scope === "chat") return selectedChatId ?? undefined
    return undefined
  }, [scope, selectedChatId, selectedProjectId, selectedTaskId])

  const trimmedQuery = query.trim()
  const canSearch = trimmedQuery.length > 0 && (scope === "all" || !!scopeId)

  // Reset paging when the search inputs change.
  useEffect(() => {
    setVisibleCount(RESULT_PAGE_SIZE)
  }, [trimmedQuery, scope, scopeId, includeArchived])
  const { data: results = [], isFetching } = trpc.search.query.useQuery(
    { query: trimmedQuery, scope, scopeId, includeArchived },
    { enabled: canSearch },
  )

  return (
    <div className="rounded-lg border border-border/70 bg-background/90 p-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search all context..."
            className="h-8 rounded-md pl-7 text-xs"
          />
        </div>
        <Select value={scope} onValueChange={(value) => setScope(value as Scope)}>
          <SelectTrigger className="h-8 w-24 rounded-md text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="project" disabled={!selectedProjectId}>
              Project
            </SelectItem>
            <SelectItem value="task" disabled={!selectedTaskId}>
              Task
            </SelectItem>
            <SelectItem value="chat" disabled={!selectedChatId}>
              Chat
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <label className="mt-2 flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
        <Checkbox
          checked={includeArchived}
          onCheckedChange={(value) => setIncludeArchived(!!value)}
        />
        <span>Include archived</span>
      </label>
      {trimmedQuery && !canSearch && (
        <div className="px-1 pt-2 text-[11px] text-muted-foreground">
          Select an available scope for this workspace.
        </div>
      )}
      {canSearch && (
        <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
          {isFetching && results.length === 0 ? (
            <div className="px-1 py-2 text-xs text-muted-foreground">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-1 py-2 text-xs text-muted-foreground">No results</div>
          ) : (
            results.slice(0, visibleCount).map((result, index) => {
              const key = `${result.type}-${result.chatId ?? result.projectId ?? result.taskId}-${index}`
              const navigable = isNavigableScopedSearchResult(result)
              const content = (
                <>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{resultLabel(result.type)}</span>
                    {navigable && <CornerDownRight className="h-3 w-3" />}
                    <span className="truncate">
                      {[result.projectId, result.taskId, result.chatId, result.subChatId]
                        .filter(Boolean)
                        .map((value) => String(value).slice(-6))
                        .join(" / ")}
                    </span>
                  </div>
                  <div className="truncate text-xs font-medium text-foreground">{result.title}</div>
                  {result.snippet && (
                    <div className="line-clamp-2 text-[11px] text-muted-foreground">
                      {result.snippet}
                    </div>
                  )}
                </>
              )

              if (!navigable) {
                return (
                  <div
                    key={key}
                    className="w-full rounded-md border border-transparent px-2 py-1.5 text-left"
                  >
                    {content}
                  </div>
                )
              }

              return (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    "w-full rounded-md border border-transparent px-2 py-1.5 text-left",
                    "hover:border-border hover:bg-muted/50",
                  )}
                  onClick={() =>
                    onNavigateChat?.(
                      result.chatId!,
                      result.subChatId,
                      result.messageId,
                      trimmedQuery,
                    )
                  }
                >
                  {content}
                </button>
              )
            })
          )}
        </div>
      )}
      {canSearch && results.length > visibleCount && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 h-7 w-full text-xs"
          onClick={() => setVisibleCount((count) => count + RESULT_PAGE_SIZE)}
        >
          Show more ({results.length - visibleCount} more)
        </Button>
      )}
    </div>
  )
}
