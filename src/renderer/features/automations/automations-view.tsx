"use client"

import "./automations-styles.css"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useAtom, useSetAtom } from "jotai"
import { AlignJustify, Inbox, Plus } from "lucide-react"
import { trpc } from "../../lib/trpc"
import { useIsMobile } from "../../lib/hooks/use-mobile"
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
  const [query, setQuery] = useState("")
  const [stateFilter, setStateFilter] = useState<StateFilter>("all")

  const automations = trpc.automations.list.useQuery(
    { includeArchived: false, limit: 100 },
    { refetchInterval: 5_000 },
  )
  const inbox = trpc.automations.inbox.useQuery(
    { unreadOnly: true, limit: 1 },
    { refetchInterval: 5_000 },
  )

  const filtered = useMemo(
    () => filterAutomationRecords(automations.data?.items ?? [], { query, state: stateFilter }),
    [automations.data?.items, query, stateFilter],
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
    <main className="h-full overflow-y-auto bg-background" aria-labelledby="automation-page-title">
      <div className="mx-auto max-w-5xl px-4 py-5 md:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {(!sidebarOpen || isMobile) && (
              <button
                type="button"
                onClick={toggleSidebar}
                className="rounded-md p-1.5 hover:bg-muted"
                aria-label={isMobile ? "Back to chats" : "Open sidebar"}
              >
                <AlignJustify className="h-4 w-4" />
              </button>
            )}
            <div>
              <h1 id="automation-page-title" className="text-lg font-semibold">
                {AUTOMATION_A11Y.pageTitle}
              </h1>
              <p className="text-sm text-muted-foreground">
                Runs locally only while the Flapstack desktop app is open. At startup, each schedule
                catches up at most once.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDesktopView("inbox")}
              className="inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted"
              aria-label={`Open automation inbox, ${inbox.data?.unreadCount ?? 0} unread`}
            >
              <Inbox className="h-4 w-4" />
              Inbox
              {(inbox.data?.unreadCount ?? 0) > 0 && (
                <span className="rounded-full bg-blue-600 px-1.5 text-[10px] text-white">
                  {inbox.data!.unreadCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => openDetail("new")}
              className="inline-flex h-8 items-center gap-2 rounded-md bg-foreground px-3 text-sm text-background hover:opacity-90"
            >
              <Plus className="h-4 w-4" /> New
            </button>
          </div>
        </header>

        <section className="mt-5 rounded-lg border bg-card p-3" aria-label="Automation filters">
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, trigger, provider…"
              aria-label={AUTOMATION_A11Y.search}
              className="h-9 min-w-56 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <select
              value={stateFilter}
              onChange={(event) => setStateFilter(event.target.value as StateFilter)}
              aria-label="Filter automations by state"
              className="h-9 rounded-md border bg-background px-3 text-sm"
            >
              <option value="all">All states</option>
              <option value="active">Active</option>
              <option value="draft">Drafts</option>
              <option value="paused">Paused</option>
              <option value="error">Denied or revoked</option>
            </select>
          </div>
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
        ) : automations.error ? (
          <ErrorState
            message={automations.error.message}
            retry={() => void automations.refetch()}
          />
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm font-medium">No matching local automations</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create a disabled draft, inspect its exact authority and budget, then approve it.
            </p>
          </div>
        ) : (
          <ul
            className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3"
            aria-label={AUTOMATION_A11Y.list}
          >
            {filtered.map((record) => (
              <li key={record.id}>
                <AutomationCard automation={record} onClick={() => openDetail(record.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert" className="mt-6 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm">
      <p className="font-medium">Automations could not be loaded.</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
      <button type="button" onClick={retry} className="mt-3 rounded-md border px-3 py-1.5">
        Retry
      </button>
    </div>
  )
}
