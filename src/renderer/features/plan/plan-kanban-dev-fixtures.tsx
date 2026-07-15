import { Beaker, FastForward, Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "../../components/ui/button"
import { trpc } from "../../lib/trpc"

export function PlanKanbanDevFixtures({
  projectId,
  onDatasetChanged,
}: {
  projectId: string
  onDatasetChanged: () => Promise<void>
}) {
  const utils = trpc.useUtils()
  const status = trpc.planSources.devFixtureStatus.useQuery({ projectId }, { retry: false })
  const refreshProductQueries = async () => {
    await Promise.all([
      utils.planSources.invalidate(),
      utils.taskProposals.invalidate(),
      utils.tasks.board.invalidate(),
      utils.tasks.list.invalidate(),
      utils.chats.list.invalidate(),
    ])
  }
  const create = trpc.planSources.devFixtureCreate.useMutation({
    onSuccess: async () => {
      await refreshProductQueries()
      await onDatasetChanged()
      await status.refetch()
      toast.success("Dev Plan dataset created. Sources and inert proposals are ready.")
    },
    onError: (error) => toast.error(error.message || "Dev Plan dataset creation failed."),
  })
  const advance = trpc.planSources.devFixtureAdvance.useMutation({
    onSuccess: async () => {
      await status.refetch()
      toast.success("Source revision changed. Wait for stale status, then refresh the Plan view.")
    },
    onError: (error) => toast.error(error.message || "Dev Plan source update failed."),
  })
  const reset = trpc.planSources.devFixtureReset.useMutation({
    onSuccess: async () => {
      await refreshProductQueries()
      await onDatasetChanged()
      await status.refetch()
      toast.success("Dev Plan dataset reset without touching unrelated project state.")
    },
    onError: (error) => toast.error(error.message || "Dev Plan dataset reset failed."),
  })
  const busy = create.isPending || advance.isPending || reset.isPending
  const fixture = status.data

  return (
    <section
      className="mt-3 rounded-md border border-dashed border-violet-500/40 bg-violet-500/5 px-3 py-2"
      aria-label="Development Plan and Kanban dataset"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
          <Beaker className="h-3.5 w-3.5" aria-hidden="true" />
          Dev dataset
        </span>
        <span className="min-w-48 flex-1 text-[11px] text-muted-foreground" aria-live="polite">
          {status.isLoading
            ? "Checking this project…"
            : status.error
              ? status.error.message
              : fixture?.message}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={busy || !fixture || fixture.state !== "absent"}
          onClick={() => create.mutate({ projectId })}
        >
          {create.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Create sources and proposals
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={busy || fixture?.state !== "ready"}
          onClick={() => advance.mutate({ projectId })}
        >
          {advance.isPending ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <FastForward className="mr-1 h-3 w-3" aria-hidden="true" />
          )}
          Change source revision
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          disabled={busy || !fixture || fixture.state === "absent"}
          onClick={() => reset.mutate({ projectId })}
        >
          {reset.isPending ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" />
          )}
          Reset dataset
        </Button>
      </div>
      {fixture && fixture.state !== "absent" && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Project-scoped: {fixture.proposalCount} proposals · {fixture.taskCount} linked tasks ·
          Markdown {fixture.markdownRegistered ? "registered" : "not registered"}
        </p>
      )}
    </section>
  )
}
