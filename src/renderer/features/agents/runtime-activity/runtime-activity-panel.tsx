import { useCallback, useEffect, useMemo, useState } from "react"
import type { AgentActivityEvent } from "../../../../shared/agent-activity"
import { trpc, trpcClient } from "../../../lib/trpc"
import { mergeRuntimeActivityPages } from "./runtime-activity-model"
import {
  projectDevRuntimeActivityView,
  type DevRuntimeActivityViewMode,
} from "./runtime-activity-dev-fixture"
import { RuntimeActivityFixtureControls } from "./runtime-activity-fixture-controls"
import { RuntimeActivityTimeline } from "./runtime-activity-timeline"

export function RuntimeActivityPanel({
  chatId,
  projectId,
  subChatId,
  legacyMessages,
  isStreaming,
}: {
  chatId: string
  projectId: string | null
  subChatId: string
  legacyMessages: unknown
  isStreaming: boolean
}) {
  const [events, setEvents] = useState<AgentActivityEvent[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [devViewMode, setDevViewMode] = useState<DevRuntimeActivityViewMode>("activity")
  const page = trpc.agentActivity.list.useQuery(
    {
      chatId,
      limit: 500,
      direction: "backward",
      corruptionMode: "redacted-placeholder",
    },
    { refetchInterval: isStreaming ? 750 : false },
  )
  const diagnostics = trpc.agentRuntimeDefaults.diagnostics.useQuery({ chatId })
  const actualStatus = page.isError
    ? "error"
    : page.isLoading && events.length === 0
      ? "loading"
      : isStreaming
        ? "live"
        : page.isFetching
          ? "stale"
          : "ready"
  const view = useMemo(
    () =>
      projectDevRuntimeActivityView(
        events,
        import.meta.env.DEV ? devViewMode : "activity",
        actualStatus,
        page.error?.message ?? null,
      ),
    [actualStatus, devViewMode, events, page.error?.message],
  )

  useEffect(() => {
    if (!page.data) return
    setEvents(
      (current) => mergeRuntimeActivityPages(current, page.data!.events) as AgentActivityEvent[],
    )
    setHasMore(page.data.hasMore)
  }, [page.data])

  useEffect(() => {
    setEvents([])
    setHasMore(false)
    setDevViewMode("activity")
  }, [chatId])

  const oldestStorageId = useMemo(
    () => events.reduce((minimum, event) => Math.min(minimum, event.storageId), Infinity),
    [events],
  )
  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !Number.isFinite(oldestStorageId)) return
    setLoadingMore(true)
    try {
      const older = await trpcClient.agentActivity.list.query({
        chatId,
        beforeStorageId: oldestStorageId,
        limit: 500,
        direction: "backward",
        corruptionMode: "redacted-placeholder",
      })
      setEvents(
        (current) => mergeRuntimeActivityPages(older.events, current) as AgentActivityEvent[],
      )
      setHasMore(older.hasMore)
    } finally {
      setLoadingMore(false)
    }
  }, [chatId, hasMore, loadingMore, oldestStorageId])

  return (
    <div className="space-y-3">
      {import.meta.env.DEV ? (
        <RuntimeActivityFixtureControls
          projectId={projectId}
          chatId={chatId}
          subChatId={subChatId}
          viewMode={devViewMode}
          onViewModeChange={setDevViewMode}
        />
      ) : null}
      {diagnostics.data ? (
        <details id="runtime-diagnostics" className="rounded-md border border-border/60 px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Runtime diagnostics</summary>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <dt>Preference</dt>
            <dd>{diagnostics.data.preference}</dd>
            <dt>Source</dt>
            <dd>{diagnostics.data.preferenceSource}</dd>
            <dt>Resolved</dt>
            <dd>{diagnostics.data.resolvedRuntime ?? "Not launched"}</dd>
            <dt>Adapter</dt>
            <dd>{diagnostics.data.versions?.adapterVersion ?? "Unavailable"}</dd>
            <dt>Protocol</dt>
            <dd>{diagnostics.data.versions?.protocolVersion ?? "Unavailable"}</dd>
            <dt>Session</dt>
            <dd>{diagnostics.data.sessionIdentityClass}</dd>
            <dt>Activity</dt>
            <dd>{diagnostics.data.activity.count} durable events</dd>
          </dl>
          {diagnostics.data.diagnosticError ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {diagnostics.data.diagnosticError}
            </p>
          ) : null}
        </details>
      ) : null}
      <RuntimeActivityTimeline
        events={view.events}
        legacyMessages={view.suppressLegacy ? [] : legacyMessages}
        status={view.status}
        error={view.error}
        hasMore={view.events.length > 0 && hasMore}
        onLoadMore={loadingMore ? undefined : loadMore}
        onRetry={() => {
          if (import.meta.env.DEV && devViewMode === "error") setDevViewMode("activity")
          void page.refetch()
        }}
        diagnosticsHref="#runtime-diagnostics"
      />
    </div>
  )
}
