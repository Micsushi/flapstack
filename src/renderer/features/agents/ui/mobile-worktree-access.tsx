import { WorktreeDeclarationsPanel } from "./worktree-declarations-panel"
import { Button } from "../../../components/ui/button"
import { trpc } from "../../../lib/trpc"
import { OrchestrationSharedWorktreeAdvisory } from "./orchestration-shared-worktree-advisory"

/** Mounted only inside the deliberately opened mobile worktree disclosure. */
export function MobileWorktreeAccess({
  projectId,
  taskId,
  onNavigate,
}: {
  projectId: string
  taskId: string
  onNavigate: (chatId: string) => void
}) {
  const query = trpc.spawnedAgents.getTaskOverview.useQuery(
    { taskId },
    {
      refetchInterval: 5000,
      refetchIntervalInBackground: false,
    },
  )
  const overview = query.data
  const value =
    overview?.orchestration.taskId === taskId && overview.orchestration.projectId === projectId
      ? overview.sharedWorktrees
      : undefined
  return (
    <section aria-label="Worktree access" className="min-w-0 space-y-3 text-sm">
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
        Refresh worktree access
      </Button>
      {query.isLoading ? (
        <p role="status">Loading worktree access...</p>
      ) : query.error ? (
        <p role="alert">
          Worktree access could not be loaded. {query.error.message} Refresh to try again.
        </p>
      ) : !value ? (
        <p>Worktree access is unavailable for this task.</p>
      ) : value.groups.length || value.unknown.length ? (
        <OrchestrationSharedWorktreeAdvisory value={value} onNavigate={onNavigate} />
      ) : (
        <p>
          No potential overlap was reported among this task's recorded active local runs. External
          writes and exclusive access are not verified.
        </p>
      )}
      <WorktreeDeclarationsPanel
        key={JSON.stringify([projectId, taskId])}
        projectId={projectId}
        taskId={taskId}
        onNavigate={onNavigate}
      />
    </section>
  )
}
