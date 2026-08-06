import { useMemo, useState, type ReactNode } from "react"
import { GitBranch, GitCommitHorizontal, RefreshCw, Search, Trees } from "lucide-react"
import { Button } from "../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog"
import { Input } from "../../components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs"
import { cn } from "../../lib/utils"
import { trpc } from "../../lib/trpc"

export function RepositoryOverviewDialog({
  open,
  onOpenChange,
  projectName,
  projectPath,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectName: string
  projectPath: string | null
}) {
  const [query, setQuery] = useState("")
  const overview = trpc.changes.getRepositoryOverview.useQuery(
    { projectPath: projectPath ?? "" },
    { enabled: open && Boolean(projectPath), staleTime: 10_000 },
  )
  const needle = query.trim().toLocaleLowerCase()
  const worktrees = useMemo(
    () =>
      (overview.data?.worktrees ?? []).filter((item) =>
        `${item.path} ${item.branch ?? "detached"}`.toLocaleLowerCase().includes(needle),
      ),
    [needle, overview.data?.worktrees],
  )
  const branches = useMemo(
    () =>
      (overview.data?.branches ?? []).filter((item) =>
        `${item.name} ${item.upstream ?? ""}`.toLocaleLowerCase().includes(needle),
      ),
    [needle, overview.data?.branches],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(760px,calc(100vh-3rem))] w-[min(920px,calc(100vw-3rem))] max-w-none grid-rows-[auto_auto_1fr] overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 pb-4 pt-6 pr-14">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Trees className="h-4 w-4 text-teal-400" />
            Repository overview
          </DialogTitle>
          <DialogDescription className="truncate">
            {projectName} · read-only branch and worktree health
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 px-6 pt-4">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter paths, branches, or upstreams"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => overview.refetch()}
            disabled={overview.isFetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", overview.isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>
        {!projectPath ? (
          <div className="p-6 text-sm text-muted-foreground">This project has no local path.</div>
        ) : overview.isError ? (
          <div className="m-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {overview.error.message}
          </div>
        ) : (
          <Tabs defaultValue="worktrees" className="flex min-h-0 flex-col px-6 pb-6 pt-4">
            <TabsList className="h-9 w-fit p-0.5">
              <TabsTrigger value="worktrees" className="h-8 gap-1.5 px-3 text-xs">
                <Trees className="h-3.5 w-3.5" /> Worktrees {overview.data?.worktrees.length ?? 0}
              </TabsTrigger>
              <TabsTrigger value="branches" className="h-8 gap-1.5 px-3 text-xs">
                <GitBranch className="h-3.5 w-3.5" /> Branches {overview.data?.branches.length ?? 0}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="worktrees" className="min-h-0 flex-1 overflow-y-auto pt-2">
              <div className="divide-y divide-border/60 rounded-lg border border-border/70">
                {worktrees.map((item) => (
                  <div
                    key={item.path}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                        {item.branch ?? "Detached HEAD"}
                        {item.isMain && <StatusPill tone="teal">Main worktree</StatusPill>}
                        {item.isCurrent && <StatusPill tone="blue">Current</StatusPill>}
                        {item.isLocked && <StatusPill tone="amber">Locked</StatusPill>}
                      </div>
                      <div
                        className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
                        title={item.path}
                      >
                        {item.path}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={cn(
                          "text-xs font-medium",
                          item.dirtyCount ? "text-amber-300" : "text-emerald-300",
                        )}
                      >
                        {item.dirtyCount ? `${item.dirtyCount} changed` : "Clean"}
                      </div>
                      {item.dirtyCount > 0 && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {item.stagedCount} staged · {item.modifiedCount} modified ·{" "}
                          {item.untrackedCount} new
                          {item.conflictedCount > 0 ? ` · ${item.conflictedCount} conflicted` : ""}
                        </div>
                      )}
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                        {item.head.slice(0, 8)}
                      </div>
                    </div>
                    {item.prunableReason && (
                      <div className="col-span-2 text-xs text-rose-300">
                        Prunable: {item.prunableReason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </TabsContent>
            <TabsContent value="branches" className="min-h-0 flex-1 overflow-y-auto pt-2">
              <div className="divide-y divide-border/60 rounded-lg border border-border/70">
                {branches.map((item) => (
                  <div
                    key={item.name}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                        {item.name}
                        {(item.name === overview.data?.defaultBranch ||
                          item.name === `origin/${overview.data?.defaultBranch}`) && (
                          <StatusPill tone="teal">Default</StatusPill>
                        )}
                        {item.kind === "remote" && <StatusPill tone="slate">Remote</StatusPill>}
                        {item.checkedOutPath && <StatusPill tone="blue">Checked out</StatusPill>}
                        {item.mergedIntoDefault && item.name !== overview.data?.defaultBranch && (
                          <StatusPill tone="slate">Merged</StatusPill>
                        )}
                      </div>
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">
                        {item.checkedOutPath ?? item.upstream ?? "No upstream"}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span
                        title="Commits only on this branch"
                        className={item.uniqueCommits ? "text-amber-300" : undefined}
                      >
                        <GitCommitHorizontal className="mr-1 inline h-3.5 w-3.5" />
                        {item.uniqueCommits} unique
                      </span>
                      <span>
                        ↑{item.ahead} ↓{item.behind}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StatusPill({
  children,
  tone,
}: {
  children: ReactNode
  tone: "teal" | "blue" | "amber" | "slate"
}) {
  const tones = {
    teal: "border-teal-500/25 bg-teal-500/10 text-teal-300",
    blue: "border-blue-500/25 bg-blue-500/10 text-blue-300",
    amber: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    slate: "border-slate-500/25 bg-slate-500/10 text-slate-300",
  }
  return (
    <span className={cn("rounded border px-1.5 py-0.5 text-[9px] font-medium", tones[tone])}>
      {children}
    </span>
  )
}
