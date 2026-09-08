import type { OrchestrationSharedWorktrees } from "../../../../shared/agent-orchestration"
import { Button } from "../../../components/ui/button"

export function OrchestrationSharedWorktreeAdvisory({
  value,
  onNavigate,
}: {
  value?: OrchestrationSharedWorktrees
  onNavigate: (chatId: string) => void
}) {
  if (!value || (!value.groups.length && !value.unknown.length)) return null
  return (
    <aside
      aria-label="Shared worktree advisory"
      className="space-y-2 rounded-md border border-amber-500/40 p-3 text-xs"
    >
      <p className="font-medium">Check shared worktree access</p>
      <p>
        Active runs may share files. This indicates potential overlap, not confirmed writes or an
        exclusive lock.
      </p>
      {value.groups.map((group) => (
        <div key={group.path} className="space-y-1">
          <code className="block break-all">{group.path}</code>
          <ul className="space-y-1">
            {group.runs.map((run) => (
              <li key={run.runId}>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto max-w-full whitespace-normal px-0 text-left text-xs"
                  onClick={() => onNavigate(run.chatId)}
                  aria-label={`Open ${run.name}, run ${run.runId}`}
                >
                  <span className="break-all">
                    {run.name} · {run.runId}
                  </span>
                </Button>
                <span>
                  {" "}
                  ·{" "}
                  {run.access === "may-edit"
                    ? "May edit"
                    : run.access === "read-only"
                      ? "Read-only"
                      : "Permissions unknown"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {value.unknown.length > 0 && (
        <div>
          <p>
            Worktree identity is unavailable for these active runs; overlap could not be checked.
          </p>
          {value.unknown.map((run) => (
            <Button
              key={run.runId}
              variant="link"
              size="sm"
              className="h-auto max-w-full whitespace-normal px-0 text-left text-xs"
              onClick={() => onNavigate(run.chatId)}
              aria-label={`Open ${run.name}, run ${run.runId}`}
            >
              <span className="break-all">
                {run.name} · {run.runId}
              </span>
            </Button>
          ))}
        </div>
      )}
    </aside>
  )
}
