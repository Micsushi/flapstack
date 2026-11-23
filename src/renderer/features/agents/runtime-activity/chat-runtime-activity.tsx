import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "../../../components/ui/dialog"
import { Button } from "../../../components/ui/button"
import { useMemo } from "react"
import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { getQueryKey } from "@trpc/react-query"
import { trpc, trpcClient } from "../../../lib/trpc"
import { RuntimeActivityTimeline } from "./runtime-activity-timeline"

export function ChatRuntimeActivity({
  chatId,
  live,
  open,
  onOpenChange,
  returnFocus,
}: {
  chatId: string
  live: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  returnFocus?: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open === undefined && (
        <DialogTrigger asChild>
          <Button size="sm" variant="ghost">
            Activity transcript
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        onCloseAutoFocus={
          returnFocus
            ? (event) => {
                event.preventDefault()
                returnFocus()
              }
            : undefined
        }
        className="w-[min(52rem,95vw)] max-w-none max-h-[85vh] overflow-y-auto"
      >
        <DialogTitle>Activity transcript</DialogTitle>
        <PersistedRuntimeActivity chatId={chatId} live={live} />
      </DialogContent>
    </Dialog>
  )
}

function PersistedRuntimeActivity({ chatId, live }: { chatId: string; live: boolean }) {
  const localRuns = useQuery({
    queryKey: getQueryKey(trpc.agentActivity.localRunStatuses, { chatId }, "query"),
    queryFn: () => trpcClient.agentActivity.localRunStatuses.query({ chatId }),
    refetchInterval: 5_000,
  })
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
  const error = query.error ?? localRuns.error
  return (
    <>
      {(query.hasNextPage || localRuns.data?.hasMore) && (
        <p className="mb-2 text-xs text-muted-foreground">
          Search and export include loaded activity and up to 500 recent local runs.
        </p>
      )}
      <RuntimeActivityTimeline
        events={events}
        localRunStatuses={localRuns.data?.runs}
        status={
          error
            ? "error"
            : query.isFetching || localRuns.isLoading
              ? "loading"
              : live
                ? "live"
                : "ready"
        }
        error={error?.message}
        hasMore={query.hasNextPage}
        onLoadMore={() => {
          void query.fetchNextPage()
        }}
        onRetry={() => {
          void query.refetch()
          void localRuns.refetch()
        }}
        viewportHeight={400}
      />
    </>
  )
}
