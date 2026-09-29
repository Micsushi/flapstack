import { useMemo, useState } from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { getQueryKey } from "@trpc/react-query"
import { trpc, trpcClient } from "../../../lib/trpc"
import { RuntimeActivityTimeline } from "./runtime-activity-timeline"

export function ChatRuntimeActivity({ chatId, live }: { chatId: string; live: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer py-2 text-sm font-medium">Runtime activity</summary>
      {open && <PersistedRuntimeActivity chatId={chatId} live={live} />}
    </details>
  )
}

function PersistedRuntimeActivity({ chatId, live }: { chatId: string; live: boolean }) {
  const input = {
    chatId,
    limit: 500,
    direction: "backward" as const,
    corruptionMode: "redacted-placeholder" as const,
  }
  const query = useInfiniteQuery({
    // Share the existing activity invalidation prefix without sharing the 100-row count query.
    queryKey: getQueryKey(trpc.agentActivity.list, input, "query"),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) =>
      trpcClient.agentActivity.list.query({ ...input, beforeStorageId: pageParam }),
    getNextPageParam: (page) => (page.hasMore ? (page.nextCursor ?? undefined) : undefined),
  })
  const events = useMemo(
    () => [...(query.data?.pages ?? [])].reverse().flatMap((page) => page.events),
    [query.data],
  )
  return (
    <>
      {query.hasNextPage && (
        <p className="mb-2 text-xs text-muted-foreground">
          Search and export include loaded activity. Load earlier activity to include more history.
        </p>
      )}
      <RuntimeActivityTimeline
        events={events}
        status={query.isError ? "error" : query.isFetching ? "loading" : live ? "live" : "ready"}
        error={query.error?.message}
        hasMore={query.hasNextPage}
        onLoadMore={() => {
          void query.fetchNextPage()
        }}
        onRetry={() => {
          void query.refetch()
        }}
        viewportHeight={400}
      />
    </>
  )
}
