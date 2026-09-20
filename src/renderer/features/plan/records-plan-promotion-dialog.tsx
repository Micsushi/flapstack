import { useState } from "react"
import { trpc } from "../../lib/trpc"
import { Button } from "../../components/ui/button"
import { Label } from "../../components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog"
import type { PlanCandidate, PlanSourceSnapshot } from "../../../shared/plan-sources"
import { YAP_REVIEW_REQUEST_EVENT } from "../../../shared/task-proposals"

export function RecordsPlanPromotionDialog({
  sourceProjectId,
  source,
  candidate,
  onClose,
}: {
  sourceProjectId: string
  source: PlanSourceSnapshot
  candidate: PlanCandidate
  onClose: () => void
}) {
  const destinations = trpc.planSources.recordsDestinations.useQuery()
  const [selection, setSelection] = useState("")
  const utils = trpc.useUtils()
  const proposal = trpc.planSources.proposeCandidate.useMutation({
    onSuccess: (result) => {
      void utils.planSources.sourceLinks.invalidate({ projectId: sourceProjectId })
      window.dispatchEvent(
        new CustomEvent(YAP_REVIEW_REQUEST_EVENT, {
          detail: { proposalId: result.proposalId, source: "plan" },
        }),
      )
      onClose()
    },
  })
  const selected = destinations.data?.find((item) => `${item.path}:${item.projectId}` === selection)
  return (
    <Dialog open onOpenChange={(open) => !open && !proposal.isPending && onClose()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        aria-describedby={undefined}
        showCloseButton={!proposal.isPending}
      >
        <DialogHeader>
          <DialogTitle>Propose task in Yap</DialogTitle>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          <div>
            <p className="break-words font-medium">{candidate.title}</p>
            <p className="mt-2 break-words whitespace-pre-wrap text-sm">{candidate.body}</p>
          </div>
          <p className="break-all text-sm text-muted-foreground">
            {candidate.path}:{candidate.line}
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="records-plan-destination">Records project</Label>
            <select
              id="records-plan-destination"
              className="h-9 min-w-0 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selection}
              disabled={proposal.isPending}
              onChange={(event) => setSelection(event.target.value)}
            >
              <option value="">Choose a project</option>
              {destinations.data?.map((item) => (
                <option
                  key={`${item.path}:${item.projectId}`}
                  value={`${item.path}:${item.projectId}`}
                >
                  {item.projectName} · {item.path}
                </option>
              ))}
            </select>
          </div>
          {destinations.isLoading && <p role="status">Loading Records projects…</p>}
          {destinations.isSuccess && destinations.data.length === 0 && (
            <p role="status">
              Add a project feature or task in Board before linking plan candidates.
            </p>
          )}
          {(destinations.isError || proposal.isError) && (
            <p role="alert" className="break-words text-sm text-destructive">
              {destinations.error?.message ?? proposal.error?.message}
            </p>
          )}
          {destinations.isError && (
            <Button variant="outline" onClick={() => void destinations.refetch()}>
              Retry connection
            </Button>
          )}
          <p className="text-sm text-muted-foreground">
            Review and approve this captured plan in Yap before a task is created. Later source
            edits appear in Plan comparisons; they do not update the proposal. No conversation,
            worktree, or run starts here.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={proposal.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!selected || proposal.isPending}
            onClick={() => {
              if (selected)
                proposal.mutate({
                  reference: {
                    sourceProjectId,
                    sourceId: source.id,
                    sourcePath: source.path,
                    sourceFingerprint: source.fingerprint,
                    candidateId: candidate.id,
                    candidateFingerprint: candidate.fingerprint,
                  },
                  destinationPath: selected.path,
                  projectId: selected.projectId,
                })
            }}
          >
            {proposal.isPending ? "Saving proposal…" : "Review in Yap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
