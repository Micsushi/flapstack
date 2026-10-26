"use client"

import {
  WorkspacePage,
  WorkspaceHeader,
  WorkspaceTitle,
  WorkspaceContent,
} from "../../components/ui/workspace"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { NativeSelect } from "../../components/ui/native-select"
import "./automations-styles.css"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtom, useSetAtom } from "jotai"
import { AlignJustify, Inbox, Plus } from "lucide-react"
import { trpc } from "../../lib/trpc"
import { useIsMobile } from "../../lib/hooks/use-mobile"
import { FeatureHelpPopover } from "../../components/feature-explanation"
import {
  agentsMobileViewModeAtom,
  agentsSidebarOpenAtom,
  automationDetailIdAtom,
  desktopViewAtom,
} from "../agents/atoms"
import { AutomationCard } from "./_components"
import {
  AUTOMATION_A11Y,
  filterAutomationRecords,
  type AutomationUiState,
} from "./automation-ui-model"

type StateFilter = "all" | "active" | "draft" | "paused" | "error"

export function AutomationsView() {
  const setDesktopView = useSetAtom(desktopViewAtom)
  const setAutomationDetailId = useSetAtom(automationDetailIdAtom)
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const setMobileViewMode = useSetAtom(agentsMobileViewModeAtom)
  const isMobile = useIsMobile()
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [stateFilter, setStateFilter] = useState<StateFilter>("all")
  const [includeArchived, setIncludeArchived] = useState(false)

  const automations = trpc.automations.list.useInfiniteQuery(
    { includeArchived, limit: 100 },
    { refetchInterval: 5_000, getNextPageParam: (page) => page.nextCursor ?? undefined },
  )
  const inbox = trpc.automations.inbox.useQuery(
    { unreadOnly: true, limit: 1 },
    { refetchInterval: 5_000 },
  )

  const filtered = useMemo(
    () =>
      filterAutomationRecords(
        [
          ...new Map(
            automations.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item]) ??
              [],
          ).values(),
        ],
        { query, state: stateFilter },
      ),
    [automations.data?.pages, query, stateFilter],
  )

  const openDetail = useCallback(
    (id: string) => {
      setAutomationDetailId(id)
      setDesktopView("automations-detail")
    },
    [setAutomationDetailId, setDesktopView],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault()
        openDetail("new")
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [openDetail])

  const toggleSidebar = () => {
    if (isMobile) {
      setDesktopView(null)
      setMobileViewMode("chats")
    } else setSidebarOpen(true)
  }

  return (
    <WorkspacePage className="overflow-y-auto" aria-labelledby="automation-page-title">
      <WorkspaceContent>
        <WorkspaceHeader>
          <div className="flex min-w-0 items-start gap-2">
            {(!sidebarOpen || isMobile) && (
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={toggleSidebar}
                aria-label={isMobile ? "Back to chats" : "Open sidebar"}
              >
                <AlignJustify className="h-4 w-4" />
              </Button>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <WorkspaceTitle id="automation-page-title">
                {AUTOMATION_A11Y.pageTitle}
              </WorkspaceTitle>

              <FeatureHelpPopover featureId="automations" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="workspace"
              type="button"
              onClick={() => setDesktopView("inbox")}
              className="gap-2"
              aria-label={`Open automation inbox, ${inbox.data?.unreadCount ?? 0} unread`}
            >
              <Inbox className="h-4 w-4" />
              Inbox
              {(inbox.data?.unreadCount ?? 0) > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-xs text-foreground">
                  {inbox.data!.unreadCount}
                </span>
              )}
            </Button>
            <Button
              variant="default"
              size="workspace"
              type="button"
              onClick={() => openDetail("new")}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> New
            </Button>
          </div>
        </WorkspaceHeader>

        <section className="mt-4" aria-label="Automation filters">
          <div className="flex flex-wrap gap-2">
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, trigger, provider…"
              aria-label={AUTOMATION_A11Y.search}
              className="min-w-56 flex-1"
            />
            <NativeSelect
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value as StateFilter)}
              aria-label="Filter automations by state"
            >
              <option value="all">All states</option>
              <option value="active">Active</option>
              <option value="draft">Drafts</option>
              <option value="paused">Paused</option>
              <option value="error">Denied or revoked</option>
            </NativeSelect>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            Include archived automations
          </label>
        </section>

        <div className="sr-only" aria-live="polite">
          {automations.isFetching
            ? "Refreshing local automations"
            : `${filtered.length} automations shown`}
        </div>
        {automations.isLoading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            Loading local automations…
          </p>
        ) : automations.error && !automations.data ? (
          <ErrorState
            message={automations.error.message}
            retry={() => void automations.refetch()}
          />
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium">
              {automations.hasNextPage
                ? "No matches in loaded automations"
                : query || stateFilter !== "all"
                  ? "No matching automations"
                  : "No automations yet"}
            </p>
            <Button
              variant="outline"
              size="workspace"
              type="button"
              className="mt-3"
              onClick={() => {
                if (query || stateFilter !== "all") {
                  setQuery("")
                  setStateFilter("all")
                  searchRef.current?.focus()
                } else openDetail("new")
              }}
            >
              {query || stateFilter !== "all" ? "Clear filters" : "New automation"}
            </Button>
          </div>
        ) : (
          <ul className="mt-5 divide-y" aria-label={AUTOMATION_A11Y.list}>
            {filtered.map((record) => (
              <li key={record.id}>
                <AutomationCard automation={record} onClick={() => openDetail(record.id)} />
              </li>
            ))}
          </ul>
        )}
        {automations.error && automations.data && (
          <ErrorState
            message={automations.error.message}
            retry={() =>
              void (automations.isFetchNextPageError
                ? automations.fetchNextPage()
                : automations.refetch())
            }
          />
        )}
        {automations.hasNextPage && (
          <div className="mt-5 space-y-2">
            <p className="text-sm text-muted-foreground">
              Search and filters cover loaded automations. Load more to include older records.
            </p>
            <Button
              variant="outline"
              size="workspace"
              disabled={automations.isFetching}
              onClick={() => void automations.fetchNextPage()}
            >
              {automations.isFetchingNextPage ? "Loading more…" : "Load more automations"}
            </Button>
          </div>
        )}
      </WorkspaceContent>
    </WorkspacePage>
  )
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert" className="mt-6 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
      <p className="font-medium">Automations could not be loaded.</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      <Button variant="outline" size="workspace" type="button" onClick={retry} className="mt-3">
        Retry
      </Button>
    </div>
  )
}
