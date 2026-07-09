"use client"

import { useEffect, useMemo, useState } from "react"
import {
  CheckCircle2,
  CircleDashed,
  FileClock,
  GitCommit,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react"
import { trpc } from "@/lib/trpc"
import { cn } from "@/lib/utils"
import { getHarnessChipMeta } from "@/features/agents/constants"
import { formatModelDisplayName } from "../../../../shared/model-catalog"

type RunStatus = "running" | "success" | "failure" | "cancelled" | string

function formatTime(value: Date | string | number | null | undefined): string {
  if (!value) return ""
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function statusIcon(status: RunStatus) {
  if (status === "success") return CheckCircle2
  if (status === "failure" || status === "cancelled") return XCircle
  return CircleDashed
}

function statusClass(status: RunStatus): string {
  if (status === "success") return "text-emerald-600 dark:text-emerald-400"
  if (status === "failure" || status === "cancelled") return "text-red-600 dark:text-red-400"
  return "text-muted-foreground"
}

function shortCommit(value: string | null | undefined): string {
  if (!value) return "no git commit"
  return value.slice(0, 8)
}

function formatChangeType(value: string): string {
  if (value === "none") return "No changes"
  return value.replace(/-/g, " ")
}

export function RunHistoryWidget({ chatId }: { chatId: string }) {
  const { data: runs = [], isLoading } = trpc.runs.listByChat.useQuery(
    { chatId },
    {
      enabled: !!chatId,
      refetchInterval: (query) => {
        const data = query.state.data as Array<{ status?: string }> | undefined
        return data?.some((run) => run.status === "running") ? 5000 : false
      },
    },
  )
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [showRestorePreview, setShowRestorePreview] = useState(false)
  const [showAllRuns, setShowAllRuns] = useState(false)

  const RUN_PREVIEW_COUNT = 5
  const visibleRuns = showAllRuns ? runs : runs.slice(0, RUN_PREVIEW_COUNT)

  useEffect(() => {
    if (!runs.length) {
      setSelectedRunId(null)
      return
    }

    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id ?? null)
    }
  }, [runs, selectedRunId])

  useEffect(() => {
    setShowRestorePreview(false)
  }, [selectedRunId])

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  )

  const { data: manifestData } = trpc.runs.getManifest.useQuery(
    { runId: selectedRun?.id ?? "" },
    { enabled: !!selectedRun?.id },
  )

  if (isLoading) {
    return <div className="px-2 py-2 text-xs text-muted-foreground">Loading runs...</div>
  }

  if (!runs.length) {
    return <div className="px-2 py-2 text-xs text-muted-foreground">No agent runs yet</div>
  }

  const manifest = manifestData?.manifest ?? []
  const changedFiles = manifest.filter((entry) => entry.changeType !== "none")
  const checkpoints = manifestData?.checkpoints ?? []

  return (
    <div className="px-2 py-2 space-y-2">
      <div className="space-y-1">
        {visibleRuns.map((run) => {
          const Icon = statusIcon(run.status)
          const harnessMeta = getHarnessChipMeta(run.harness)
          const isSelected = run.id === selectedRun?.id

          return (
            <button
              key={run.id}
              type="button"
              onClick={() => setSelectedRunId(run.id)}
              className={cn(
                "w-full min-w-0 rounded-md border px-2 py-1.5 text-left transition-colors",
                isSelected
                  ? "border-border bg-muted/60"
                  : "border-transparent hover:border-border/60 hover:bg-muted/40",
              )}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", statusClass(run.status))} />
                <span
                  className={cn(
                    "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium",
                    harnessMeta.className,
                  )}
                >
                  {harnessMeta.name}
                </span>
                <span
                  title={run.model ?? undefined}
                  className="min-w-0 flex-1 truncate text-xs text-foreground"
                >
                  {formatModelDisplayName(run.model) || "unknown model"}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="capitalize">{run.status}</span>
                <span>{formatTime(run.startedAt)}</span>
              </div>
            </button>
          )
        })}
        {runs.length > RUN_PREVIEW_COUNT && (
          <button
            type="button"
            onClick={() => setShowAllRuns((prev) => !prev)}
            className="w-full rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            {showAllRuns ? "Show fewer runs" : `Show all ${runs.length} runs`}
          </button>
        )}
      </div>

      {selectedRun && (
        <div className="space-y-2">
          <div className="rounded-md bg-muted/30 px-2 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Run details</span>
            </div>
            <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
              <span className="text-muted-foreground">Permission</span>
              <span className="truncate">{selectedRun.permissionMode}</span>
              <span className="text-muted-foreground">Worktree</span>
              <span className="truncate" title={selectedRun.worktreePath ?? undefined}>
                {selectedRun.worktreePath || "none"}
              </span>
              <span className="text-muted-foreground">Started</span>
              <span>{formatTime(selectedRun.startedAt) || "unknown"}</span>
              <span className="text-muted-foreground">Completed</span>
              <span>{formatTime(selectedRun.completedAt) || "pending"}</span>
            </div>
          </div>

          <div className="rounded-md bg-muted/30 px-2 py-2 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <FileClock className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Checkpoints</span>
            </div>
            {checkpoints.length > 0 ? (
              <div className="space-y-1">
                {checkpoints.map((checkpoint) => (
                  <div
                    key={checkpoint.id}
                    className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2 text-[11px]"
                  >
                    <span className="capitalize text-muted-foreground">{checkpoint.kind}</span>
                    <span className="min-w-0 truncate" title={checkpoint.gitCommit ?? undefined}>
                      {shortCommit(checkpoint.gitCommit)}
                    </span>
                    <span />
                    <span className="text-muted-foreground">
                      {formatTime(checkpoint.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">Checkpoint capture pending</div>
            )}
          </div>

          <div className="rounded-md bg-muted/30 px-2 py-2 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Run manifest</span>
            </div>
            {manifest.length > 0 ? (
              <div className="space-y-1">
                {manifest.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded border border-border/50 bg-background/40 p-1.5"
                  >
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="capitalize text-muted-foreground">
                        {formatChangeType(entry.changeType)}
                      </span>
                      {entry.filePath ? (
                        <span className="min-w-0 flex-1 truncate" title={entry.filePath}>
                          {entry.filePath}
                        </span>
                      ) : (
                        <span className="min-w-0 flex-1 text-muted-foreground">
                          No files changed
                        </span>
                      )}
                    </div>
                    {entry.changeType !== "none" && (
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="text-emerald-600 dark:text-emerald-400">
                          +{entry.additions}
                        </span>
                        <span className="text-red-600 dark:text-red-400">-{entry.deletions}</span>
                        {entry.beforeHash !== entry.afterHash && (
                          <span className="truncate">
                            {entry.beforeHash?.slice(0, 8) || "none"} {"->"}{" "}
                            {entry.afterHash?.slice(0, 8) || "none"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground">Manifest capture pending</div>
            )}
          </div>

          <div className="rounded-md border border-dashed border-border/70 px-2 py-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Restore preview</span>
              </div>
              <button
                type="button"
                onClick={() => setShowRestorePreview((value) => !value)}
                className="inline-flex h-6 items-center gap-1 rounded border border-border px-1.5 text-[11px] text-muted-foreground hover:bg-muted"
              >
                <RotateCcw className="h-3 w-3" />
                Preview
              </button>
            </div>
            {showRestorePreview && (
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <div>
                  Revert is not executed here. A later confirmation flow should show the exact patch
                  and require explicit approval before changing files.
                </div>
                {changedFiles.length > 0 ? (
                  <div className="space-y-0.5">
                    {changedFiles.map((entry) => (
                      <div key={`preview-${entry.id}`} className="truncate" title={entry.filePath}>
                        {entry.filePath}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div>No file changes to restore for this run.</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
