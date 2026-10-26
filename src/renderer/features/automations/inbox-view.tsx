"use client"

import { WorkspaceRow } from "../../components/ui/workspace"

import {
  WorkspacePage,
  WorkspaceHeader,
  WorkspaceTitle,
  WorkspaceContent,
} from "../../components/ui/workspace"
import { Button } from "../../components/ui/button"
import "./inbox-styles.css"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSetAtom } from "jotai"
import { ArrowLeft, CheckCheck, ExternalLink, Inbox, Mail, MailOpen } from "lucide-react"
import { trpc } from "../../lib/trpc"
import { desktopViewAtom } from "../agents/atoms"
import { AUTOMATION_A11Y, formatAutomationError } from "./automation-ui-model"
import { moveAutomationInboxFocus } from "./inbox-state"
import { useAutomationEvidenceNavigation } from "./use-automation-evidence-navigation"

export function InboxView() {
  const setView = useSetAtom(desktopViewAtom)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const utils = trpc.useUtils()
  const inbox = trpc.automations.inbox.useInfiniteQuery(
    { unreadOnly, limit: 200 },
    { refetchInterval: 5_000, getNextPageParam: (page) => page.nextCursor ?? undefined },
  )
  const markRead = trpc.automations.markInboxRead.useMutation()
  const markAll = trpc.automations.markAllInboxRead.useMutation()
  const items = useMemo(
    () => [
      ...new Map(
        inbox.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item]) ?? [],
      ).values(),
    ],
    [inbox.data],
  )
  const unreadCount = inbox.data?.pages[0]?.unreadCount
  const [failedRead, setFailedRead] = useState<(typeof items)[number] | null>(null)
  const clearFailedRead = useCallback(() => setFailedRead(null), [])
  const { beginNavigation, cancelNavigation, navigate } =
    useAutomationEvidenceNavigation(clearFailedRead)
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId),
  )

  useEffect(() => {
    if (!items.some((item) => item.id === selectedId)) setSelectedId(items[0]?.id ?? null)
  }, [items, selectedId])

  const readCacheSnapshot = () =>
    new Map(
      [false, true].map(
        (unreadOnly) =>
          [
            unreadOnly,
            utils.automations.inbox.getInfiniteData({ unreadOnly, limit: 200 }),
          ] as const,
      ),
    )

  const applyRead = (
    ids: Set<string> | null,
    changed: number,
    before: ReturnType<typeof readCacheSnapshot>,
  ) => {
    for (const unreadOnly of [false, true]) {
      utils.automations.inbox.setInfiniteData({ unreadOnly, limit: 200 }, (data) =>
        data && data === before.get(unreadOnly)
          ? {
              ...data,
              pages: data.pages.map((page) => ({
                ...page,
                unreadCount: ids ? Math.max(0, page.unreadCount - changed) : 0,
                nextCursor: !ids && unreadOnly ? null : page.nextCursor,
                items: page.items.flatMap((item) =>
                  !ids || ids.has(item.id)
                    ? unreadOnly
                      ? []
                      : [{ ...item, unread: false }]
                    : [item],
                ),
              })),
            }
          : data,
      )
    }
  }

  const selected = items[selectedIndex] ?? null
  const openItem = async (item: (typeof items)[number], withoutMarkingRead = false) => {
    const isCurrent = beginNavigation()
    setFailedRead(null)
    setMessage(null)
    if (item.unread && !withoutMarkingRead) {
      const before = readCacheSnapshot()
      let result: { changed: number }
      try {
        result = await markRead.mutateAsync({ ids: [item.id], unread: false })
      } catch (error) {
        if (isCurrent()) {
          setMessage(
            `Could not save read status for “${item.title}”: ${formatAutomationError(error)}`,
          )
          setFailedRead(item)
        }
        return
      }
      applyRead(new Set([item.id]), result.changed, before)
      // A refresh failure must not turn a successful read write into a failed write.
      void utils.automations.inbox.invalidate().catch(() => {
        // The inbox query retains its refresh error and Retry action.
      })
    }
    try {
      if (isCurrent()) await navigate(item, isCurrent)
    } catch (error) {
      if (isCurrent()) setMessage(formatAutomationError(error))
    }
  }

  const onListKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      const index = moveAutomationInboxFocus({
        direction: "next",
        currentIndex: selectedIndex,
        itemIds: items.map((item) => item.id),
        elements: itemRefs.current,
      })
      setSelectedId(items[index]?.id ?? null)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      const index = moveAutomationInboxFocus({
        direction: "previous",
        currentIndex: selectedIndex,
        itemIds: items.map((item) => item.id),
        elements: itemRefs.current,
      })
      setSelectedId(items[index]?.id ?? null)
    } else if (event.key === "Enter" && selected) {
      event.preventDefault()
      void openItem(selected)
    } else if (event.key === "Escape") setView("automations")
  }

  const markEverythingRead = async () => {
    const isCurrent = beginNavigation()
    setFailedRead(null)
    const before = readCacheSnapshot()
    try {
      const result = await markAll.mutateAsync()
      applyRead(null, result.changed, before)
      if (isCurrent()) {
        setMessage(`${result.changed} inbox items marked read.`)
      }
      void utils.automations.inbox.invalidate().catch(() => {
        // The query exposes refresh failure without replacing a confirmed write.
      })
    } catch (error) {
      if (isCurrent()) setMessage(formatAutomationError(error))
    }
  }

  return (
    <WorkspacePage className="overflow-y-auto" aria-labelledby="automation-inbox-title">
      <WorkspaceContent>
        <WorkspaceHeader className="border-b pb-4">
          <div className="flex items-start gap-2">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={() => setView("automations")}

              aria-label="Back to local automations"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <WorkspaceTitle id="automation-inbox-title" className="flex items-center gap-2">
                <Inbox className="h-5 w-5" />
                Automation inbox
              </WorkspaceTitle>
            </div>
          </div>
          <Button
            variant="outline"
            size="workspace"
            type="button"
            onClick={() => void markEverythingRead()}
            disabled={unreadCount === undefined || unreadCount === 0 || markAll.isPending}
            className="gap-2"
          >
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </Button>
        </WorkspaceHeader>

        <div className="flex items-center justify-between gap-3 py-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => {
                cancelNavigation()
                setFailedRead(null)
                setMessage(null)
                setUnreadOnly(event.target.checked)
              }}
              aria-label={AUTOMATION_A11Y.unreadFilter}
            />
            Unread only
          </label>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {unreadCount !== undefined ? `${unreadCount} unread` : "Unread count unavailable"}
          </span>
        </div>
        {message && (
          <p role="status" className="mb-3 text-sm text-muted-foreground">
            {message}
          </p>
        )}
        {failedRead && (
          <div className="mb-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="workspace"
              onClick={() => void openItem(failedRead)}
            >
              Retry marking read
            </Button>
            <Button
              type="button"
              variant="outline"
              size="workspace"
              className="h-auto whitespace-normal text-left"
              onClick={() => void openItem(failedRead, true)}
            >
              Open evidence without marking read
            </Button>
          </div>
        )}

        {inbox.isLoading && !inbox.data ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading local inbox…</p>
        ) : inbox.error && !inbox.data ? null : !inbox.data ? null : items.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <MailOpen className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No automation inbox items</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Completed, failed, denied, budget-exhausted, and cancelled executions appear here.
            </p>
          </div>
        ) : (
          <ul
            aria-label={AUTOMATION_A11Y.inbox}
            tabIndex={0}
            onKeyDown={onListKeyDown}
            className="space-y-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {items.map((item, index) => (
              <li key={item.id}>
                <WorkspaceRow
                  ref={(element) => {
                    if (element) itemRefs.current.set(item.id, element)
                    else itemRefs.current.delete(item.id)
                  }}
                  type="button"
                  aria-current={index === selectedIndex ? "true" : undefined}
                  onFocus={() => setSelectedId(item.id)}
                  onClick={() => void openItem(item)}
                  className={`border p-3 ${index === selectedIndex ? "border-ring/50 bg-muted/30" : "bg-card"}`}
                >
                  <div className="flex items-start gap-3">
                    {item.unread ? (
                      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" aria-label="Unread" />
                    ) : (
                      <MailOpen
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-label="Read"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{item.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {item.automationName} · <span className="capitalize">{item.kind}</span>
                      </p>
                      {item.body && <p className="mt-2 text-sm">{item.body}</p>}
                      <span className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600">
                        <ExternalLink className="h-3 w-3" />
                        Open real evidence
                      </span>
                    </div>
                  </div>
                </WorkspaceRow>
              </li>
            ))}
          </ul>
        )}

        {(inbox.data || inbox.error) && (
          <Button
            variant="outline"
            size="workspace"
            type="button"
            className="mt-3"
            disabled={inbox.isFetching}
            onClick={() =>
              void (inbox.isFetchNextPageError || (!inbox.error && inbox.hasNextPage)
                ? inbox.fetchNextPage()
                : inbox.refetch())
            }
          >
            {inbox.isFetchingNextPage
              ? "Loading more…"
              : inbox.error
                ? "Retry"
                : inbox.hasNextPage
                  ? "Load more inbox items"
                  : "Refresh inbox"}
          </Button>
        )}
        {inbox.error && (
          <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
            {inbox.isFetchNextPageError
              ? "More inbox items could not be loaded; showing the last available items."
              : inbox.data
                ? "Inbox refresh failed; showing the last available items."
                : inbox.error.message}
          </p>
        )}
      </WorkspaceContent>
    </WorkspacePage>
  )
}
