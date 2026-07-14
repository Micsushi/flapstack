"use client"

import { useCallback, useEffect, useMemo, useReducer, useState } from "react"
import { useAtomValue } from "jotai"
import {
  AlertTriangle,
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ExternalLink,
  FileWarning,
  RefreshCw,
  Search,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { cn } from "../../lib/utils"
import { trpc } from "../../lib/trpc"
import type { ProjectPlanSnapshot } from "../../../shared/plan-sources"
import {
  buildPlanOpenTarget,
  buildPlanViewModel,
  describePlanSourceStatus,
  planViewReducer,
  type PlanStatusFilter,
  type PlanViewNode,
  type PlanViewState,
  type PlanWorkStatus,
} from "../../../shared/plan-view"
import { selectedProjectAtom } from "../agents/atoms"

const INITIAL_STATE: PlanViewState = { selectedSourceId: null, query: "", status: "all" }
const STATUS_FILTERS: Array<{ value: PlanStatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "proposed", label: "Proposed" },
  { value: "active", label: "Active" },
  { value: "built", label: "Built" },
]

export function PlanView() {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const projectId = selectedProject?.id ?? ""
  const [state, dispatch] = useReducer(planViewReducer, INITIAL_STATE)
  const [liveSnapshot, setLiveSnapshot] = useState<ProjectPlanSnapshot | null>(null)
  const [watchError, setWatchError] = useState<string | null>(null)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const refreshQuery = trpc.planSources.refresh.useQuery(
    { projectId },
    { enabled: Boolean(projectId), refetchOnWindowFocus: false },
  )
  const openInEditor = trpc.external.openFileInEditor.useMutation({
    onError: (error) => toast.error(error.message || "Could not open plan source"),
  })

  useEffect(() => {
    dispatch({ type: "reset-project" })
    setLiveSnapshot(null)
    setWatchError(null)
    setCollapsedIds(new Set())
  }, [projectId])

  useEffect(() => {
    if (refreshQuery.data && liveSnapshot === null) setLiveSnapshot(refreshQuery.data)
  }, [liveSnapshot, refreshQuery.data])

  trpc.planSources.watch.useSubscription(
    { projectId },
    {
      enabled: Boolean(projectId),
      onData: (event) => {
        setLiveSnapshot(event.snapshot)
        setWatchError(null)
      },
      onError: (error) => setWatchError(error.message || "Plan source watcher stopped"),
    },
  )

  const snapshot = liveSnapshot ?? refreshQuery.data ?? null
  const model = useMemo(() => buildPlanViewModel(snapshot, state), [snapshot, state])
  const source = model.source

  const refresh = useCallback(async () => {
    setWatchError(null)
    const result = await refreshQuery.refetch()
    if (result.data) setLiveSnapshot(result.data)
  }, [refreshQuery])

  const openSource = useCallback(
    (relativePath: string, line?: number) => {
      if (!snapshot) return
      const target = buildPlanOpenTarget(snapshot.rootPath, relativePath, line)
      if (!target) {
        toast.error("Plan source path is outside the registered project")
        return
      }
      openInEditor.mutate(target)
    },
    [openInEditor, snapshot],
  )

  const toggleCollapsed = useCallback((candidateId: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(candidateId)) next.delete(candidateId)
      else next.add(candidateId)
      return next
    })
  }, [])

  if (!selectedProject) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <BookOpenText className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h1 className="text-base font-semibold">Select a project to view its plans</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan sources are read from registered project roots only.
          </p>
        </div>
      </div>
    )
  }

  return (
    <main className="flex h-full min-w-0 flex-col bg-background" aria-labelledby="plan-view-title">
      <header className="shrink-0 border-b border-border/70 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {selectedProject.name}
            </div>
            <h1
              id="plan-view-title"
              className="mt-0.5 flex items-center gap-2 text-lg font-semibold"
            >
              <BookOpenText className="h-5 w-5" aria-hidden="true" />
              Plan
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Read-only OpenSpec and selected Markdown sources. No task is created from this view.
            </p>
          </div>
          <div
            className="flex min-h-9 items-center gap-2 rounded-full border border-border bg-muted/35 px-3 text-sm"
            aria-label={
              model.progress.total > 0
                ? `${model.progress.completed} of ${model.progress.total} plan items built`
                : "No checklist progress available"
            }
          >
            <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            {model.progress.total > 0 ? (
              <>
                <span className="font-medium">
                  {model.progress.completed} / {model.progress.total} built
                </span>
                <span className="text-muted-foreground">{model.progress.percent}%</span>
              </>
            ) : (
              <span className="text-muted-foreground">No checklist progress</span>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(240px,1fr)_minmax(220px,1fr)_auto]">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Source
            <select
              className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={source?.id ?? ""}
              onChange={(event) =>
                dispatch({ type: "select-source", sourceId: event.currentTarget.value })
              }
              disabled={!snapshot?.sources.length}
              aria-label="Plan source"
            >
              {!snapshot?.sources.length && <option value="">No plan sources</option>}
              {snapshot?.sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.type === "openspec" ? "OpenSpec" : "Markdown"} · {item.path} · {item.status}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            Search plan
            <span className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                className="h-9 pl-9"
                value={state.query}
                onChange={(event) =>
                  dispatch({ type: "set-query", query: event.currentTarget.value })
                }
                placeholder="Requirements, tasks, paths..."
                type="search"
              />
            </span>
          </label>

          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              className="h-9 gap-2"
              onClick={() => void refresh()}
              disabled={refreshQuery.isFetching}
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshQuery.isFetching && "animate-spin")}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Filter plan status">
          {STATUS_FILTERS.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              size="sm"
              variant={state.status === filter.value ? "secondary" : "ghost"}
              className="h-7 rounded-full px-3"
              aria-pressed={state.status === filter.value}
              onClick={() => dispatch({ type: "set-status", status: filter.value })}
            >
              {filter.label}
            </Button>
          ))}
          {source && (
            <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
              {model.resultCount} matching {model.resultCount === 1 ? "item" : "items"}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4 allow-text-selection">
        {refreshQuery.isLoading ? (
          <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading plan sources…
          </div>
        ) : refreshQuery.error ? (
          <StateNotice
            kind="error"
            title="Plan sources could not be read"
            detail={refreshQuery.error.message}
          />
        ) : !snapshot?.sources.length ? (
          <StateNotice
            kind="empty"
            title="No plan sources found"
            detail="Add an OpenSpec change or register a Markdown plan for this project."
          />
        ) : !source ? (
          <StateNotice
            kind="empty"
            title="No source selected"
            detail="Choose a plan source to continue."
          />
        ) : (
          <div className="mx-auto max-w-5xl space-y-4">
            {watchError && (
              <StateNotice kind="warning" title="Automatic refresh paused" detail={watchError} />
            )}

            <section
              className="rounded-lg border border-border bg-card"
              aria-labelledby="source-title"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 id="source-title" className="truncate text-sm font-semibold">
                      {source.path}
                    </h2>
                    <SourceStatusBadge status={source.status} />
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      {source.type}
                    </Badge>
                  </div>
                  <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                    {source.fingerprint}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => openSource(source.path)}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  Open source
                </Button>
              </div>

              {(source.status !== "current" || source.errors.length > 0) && (
                <div className="border-b border-border/70 px-4 py-3" aria-live="assertive">
                  <StateNotice
                    kind={source.status === "stale" ? "warning" : "error"}
                    title={describePlanSourceStatus(source.status)}
                    detail={
                      source.status === "stale"
                        ? "The source changed after it was displayed. Refresh before relying on its candidates."
                        : "Readable content remains visible, but parse errors are not treated as current plan truth."
                    }
                    compact
                  />
                </div>
              )}

              {source.limitations.length > 0 && (
                <div className="border-b border-border/70 bg-amber-500/5 px-4 py-3">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    Parse limitations
                  </h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    {source.limitations.map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                </div>
              )}

              {source.errors.length > 0 && (
                <div className="border-b border-border/70 bg-destructive/5 px-4 py-3">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-destructive">
                    <FileWarning className="h-4 w-4" aria-hidden="true" />
                    Parse errors
                  </h3>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {source.errors.map((error, index) => (
                      <li key={`${error.path}:${error.line ?? 0}:${error.code}:${index}`}>
                        <span className="font-medium text-foreground">{error.path}</span>
                        {error.line ? `:${error.line}` : ""} — {error.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="p-2">
                {model.nodes.length > 0 ? (
                  <ul
                    role="tree"
                    aria-label={`${source.path} plan hierarchy`}
                    className="space-y-1"
                  >
                    {model.nodes.map((node) => (
                      <PlanTreeNode
                        key={node.candidate.id}
                        node={node}
                        level={1}
                        collapsedIds={collapsedIds}
                        onToggleCollapsed={toggleCollapsed}
                        onOpenSource={openSource}
                      />
                    ))}
                  </ul>
                ) : (
                  <div className="px-3 py-10 text-center text-sm text-muted-foreground">
                    No plan items match the current search and status filter.
                  </div>
                )}
              </div>
            </section>

            {snapshot.limitations.length > 0 && (
              <section className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                <h2 className="text-xs font-semibold">Project discovery limits</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {snapshot.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function PlanTreeNode({
  node,
  level,
  collapsedIds,
  onToggleCollapsed,
  onOpenSource,
}: {
  node: PlanViewNode
  level: number
  collapsedIds: ReadonlySet<string>
  onToggleCollapsed: (candidateId: string) => void
  onOpenSource: (relativePath: string, line?: number) => void
}) {
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsedIds.has(node.candidate.id)
  const isPromotableCandidate =
    (node.candidate.kind === "task" || node.candidate.kind === "checklist") &&
    node.candidate.completed !== true
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const treeItems = event.currentTarget
      .closest('[role="tree"]')
      ?.querySelectorAll<HTMLElement>('[role="treeitem"]')
    const currentIndex = treeItems ? Array.from(treeItems).indexOf(event.currentTarget) : -1
    if (event.key === "ArrowDown" && treeItems && currentIndex < treeItems.length - 1) {
      event.preventDefault()
      treeItems[currentIndex + 1]?.focus()
    } else if (event.key === "ArrowUp" && treeItems && currentIndex > 0) {
      event.preventDefault()
      treeItems[currentIndex - 1]?.focus()
    } else if (event.key === "Home" && treeItems?.length) {
      event.preventDefault()
      treeItems[0]?.focus()
    } else if (event.key === "End" && treeItems?.length) {
      event.preventDefault()
      treeItems[treeItems.length - 1]?.focus()
    } else if (event.key === "ArrowRight" && hasChildren && isCollapsed) {
      event.preventDefault()
      onToggleCollapsed(node.candidate.id)
    } else if (event.key === "ArrowLeft" && hasChildren && !isCollapsed) {
      event.preventDefault()
      onToggleCollapsed(node.candidate.id)
    } else if (hasChildren && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault()
      onToggleCollapsed(node.candidate.id)
    }
  }

  return (
    <li role="none">
      <div
        role="treeitem"
        aria-level={level}
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        aria-label={`${node.candidate.title}, ${statusLabel(node.status)}, ${node.candidate.kind}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="group rounded-md border border-transparent px-2 py-2 outline-none hover:border-border hover:bg-muted/35 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <div className="flex min-w-0 items-start gap-2">
          {hasChildren ? (
            <button
              type="button"
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onToggleCollapsed(node.candidate.id)}
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${node.candidate.title}`}
              tabIndex={-1}
            >
              <ChevronRight
                className={cn("h-4 w-4 transition-transform", !isCollapsed && "rotate-90")}
                aria-hidden="true"
              />
            </button>
          ) : node.candidate.completed === true ? (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-emerald-500">
              <Check className="h-4 w-4" aria-hidden="true" />
            </span>
          ) : (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
              <Circle className="h-3 w-3" aria-hidden="true" />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "text-sm font-medium",
                  node.candidate.completed && "text-muted-foreground line-through",
                )}
              >
                {node.candidate.title}
              </span>
              <WorkStatusBadge status={node.status} />
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                {node.candidate.kind}
              </Badge>
            </div>
            {node.candidate.body && (
              <p className="mt-1 max-w-3xl whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                {node.candidate.body}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span className="break-all font-mono">
                {node.candidate.path}:{node.candidate.line}
              </span>
              <button
                type="button"
                className="rounded px-1 py-0.5 font-medium text-foreground/70 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onOpenSource(node.candidate.path, node.candidate.line)}
              >
                Open
              </button>
              {isPromotableCandidate && (
                <button
                  type="button"
                  disabled
                  className="cursor-not-allowed rounded border border-border px-1.5 py-0.5 opacity-55"
                  aria-label={`Promote ${node.candidate.title} to task. Unavailable until task promotion is implemented.`}
                  title="Task promotion is not part of this read-only view"
                >
                  Promote to task
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {hasChildren && !isCollapsed && (
        <ul role="group" className="ml-4 border-l border-border/70 pl-2">
          {node.children.map((child) => (
            <PlanTreeNode
              key={child.candidate.id}
              node={child}
              level={level + 1}
              collapsedIds={collapsedIds}
              onToggleCollapsed={onToggleCollapsed}
              onOpenSource={onOpenSource}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function SourceStatusBadge({ status }: { status: "current" | "stale" | "malformed" }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px]",
        status === "current" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
        status === "stale" && "border-amber-500/40 text-amber-700 dark:text-amber-300",
        status === "malformed" && "border-destructive/40 text-destructive",
      )}
    >
      {describePlanSourceStatus(status)}
    </Badge>
  )
}

function WorkStatusBadge({ status }: { status: PlanWorkStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] capitalize",
        status === "proposed" && "border-violet-500/40 text-violet-700 dark:text-violet-300",
        status === "active" && "border-blue-500/40 text-blue-700 dark:text-blue-300",
        status === "built" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
      )}
    >
      {statusLabel(status)}
    </Badge>
  )
}

function statusLabel(status: PlanWorkStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function StateNotice({
  kind,
  title,
  detail,
  compact = false,
}: {
  kind: "empty" | "warning" | "error"
  title: string
  detail: string
  compact?: boolean
}) {
  const Icon = kind === "empty" ? BookOpenText : kind === "warning" ? AlertTriangle : FileWarning
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-4 py-3",
        compact || "mx-auto max-w-3xl",
        kind === "empty" && "border-border bg-muted/20",
        kind === "warning" && "border-amber-500/30 bg-amber-500/5",
        kind === "error" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex items-start gap-3">
        <Icon
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0",
            kind === "empty" && "text-muted-foreground",
            kind === "warning" && "text-amber-600",
            kind === "error" && "text-destructive",
          )}
          aria-hidden="true"
        />
        <div>
          <div className="text-sm font-semibold">{title}</div>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  )
}
