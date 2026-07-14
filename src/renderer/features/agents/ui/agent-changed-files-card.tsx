"use client"

import { ChevronRight, FileDiff, RotateCcw } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "../../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog"
import { cn } from "../../../lib/utils"
import { trpc } from "../../../lib/trpc"

interface AgentChangedFilesCardProps {
  runId?: string
}

const INITIAL_VISIBLE_FILES = 3

export function AgentChangedFilesCard({ runId }: AgentChangedFilesCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [isUndone, setIsUndone] = useState(false)
  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [reviewFilePath, setReviewFilePath] = useState<string | undefined>()
  const [conflicts, setConflicts] = useState<Array<{ filePath: string; reason: string }>>([])
  const utils = trpc.useUtils()
  const { data } = trpc.runs.getChangeSet.useQuery(
    { runId: runId ?? "" },
    { enabled: Boolean(runId), staleTime: 5_000 },
  )
  const { data: reviewData, isLoading: isReviewLoading } = trpc.runs.getChangeReview.useQuery(
    { runId: runId ?? "", filePath: reviewFilePath },
    { enabled: Boolean(runId && isReviewOpen) },
  )
  const undoMutation = trpc.runs.undoChangeSet.useMutation({
    onSuccess: async (result) => {
      if (result.success) {
        setIsUndone(true)
        toast.success(
          result.alreadyUndone
            ? "These changes were already undone"
            : `Undid changes to ${result.files.length} file${result.files.length === 1 ? "" : "s"}`,
        )
        await utils.runs.getChangeSet.invalidate({ runId: runId ?? "" })
        return
      }
      toast.error("Undo needs review", {
        description: "Later changes overlap this response. No files were changed.",
      })
      setConflicts(result.conflicts)
      openReview(result.conflicts[0]?.filePath)
    },
    onError: (error) => toast.error("Could not undo changes", { description: error.message }),
  })

  if (!runId || !data || data.fileCount === 0) return null

  const changeSetRunId = runId
  const isRecoverable = data.recoverable
  const hiddenCount = Math.max(0, data.files.length - INITIAL_VISIBLE_FILES)
  const visibleFiles = showAll ? data.files : data.files.slice(0, INITIAL_VISIBLE_FILES)

  function openReview(filePath?: string) {
    setReviewFilePath(filePath)
    setIsReviewOpen(true)
  }

  function undo(event: React.MouseEvent) {
    event.stopPropagation()
    if (!isRecoverable) return
    undoMutation.mutate({ runId: changeSetRunId })
  }

  return (
    <>
      <div
        className="mx-2 overflow-hidden rounded-lg border border-border bg-muted/45"
        data-dev-carryover-surface="run-change"
        data-run-id={runId}
        data-expanded={isExpanded ? "true" : "false"}
        data-review-open={isReviewOpen ? "true" : "false"}
        data-undone={isUndone ? "true" : "false"}
        data-file-count={data.fileCount}
      >
        <div
          role="button"
          data-dev-carryover-action="toggle"
          tabIndex={0}
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((expanded) => !expanded)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              setIsExpanded((expanded) => !expanded)
            }
          }}
          className="flex min-h-10 cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/60"
        >
          <FileDiff className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">
            {data.fileCount} file{data.fileCount === 1 ? "" : "s"} changed
          </span>
          <span className="text-sm text-emerald-500">+{data.additions}</span>
          <span className="text-sm text-red-500">-{data.deletions}</span>
          <div className="flex-1" />
          {isRecoverable && !isUndone && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={undo}
              disabled={undoMutation.isPending}
              className="h-7 gap-1.5 px-2 text-xs"
              title="Undo this response's file changes"
              data-dev-carryover-action="undo"
            >
              {undoMutation.isPending ? "Undoing..." : "Undo"}
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              openReview()
            }}
            className="h-7 px-2.5 text-xs"
            data-dev-carryover-action="open-review"
          >
            Review
          </Button>
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
              isExpanded && "rotate-90",
            )}
          />
        </div>

        {isExpanded && (
          <div className="border-t border-border/70">
            {visibleFiles.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => openReview(file.filePath)}
                className="flex w-full items-center gap-3 border-b border-border/50 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/55"
              >
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {file.filePath}
                </span>
                <span className="text-emerald-500">+{file.additions}</span>
                <span className="text-red-500">-{file.deletions}</span>
              </button>
            ))}
            {!showAll && hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="flex w-full items-center justify-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:bg-muted/55 hover:text-foreground"
                data-dev-carryover-action="show-all"
              >
                Show {hiddenCount} more file{hiddenCount === 1 ? "" : "s"}
                <ChevronRight className="h-3.5 w-3.5 rotate-90" />
              </button>
            )}
          </div>
        )}
      </div>

      <Dialog
        open={isReviewOpen}
        onOpenChange={(open) => {
          setIsReviewOpen(open)
          if (!open) {
            setReviewFilePath(undefined)
            setConflicts([])
          }
        }}
      >
        <DialogContent className="flex h-[80vh] w-[min(1000px,calc(100%-2rem))] max-w-none flex-col gap-3 overflow-hidden p-4">
          <DialogHeader>
            <DialogTitle>
              Review {data.fileCount} changed file{data.fileCount === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              <span className="text-emerald-500">+{data.additions}</span>{" "}
              <span className="text-red-500">-{data.deletions}</span>
              {reviewFilePath ? ` · ${reviewFilePath}` : ""}
            </DialogDescription>
          </DialogHeader>
          {conflicts.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              Undo changed nothing because later edits overlap:{" "}
              {conflicts.map((item) => item.filePath).join(", ")}.
            </div>
          )}
          <pre className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/35 p-3 text-xs leading-5">
            {isReviewLoading
              ? "Loading stored diff..."
              : reviewData?.diff || "Stored historical diff is unavailable for this older run."}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  )
}
