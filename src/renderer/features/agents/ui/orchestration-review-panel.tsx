import { useRef, useState } from "react"
import type {
  OrchestrationReviewMember,
  OrchestrationRunReview,
} from "../../../../shared/agent-orchestration"
import { Button } from "../../../components/ui/button"
import { Textarea } from "../../../components/ui/textarea"
import { recordAppAction } from "../../../lib/app-action-history"
import { trpc, trpcClient } from "../../../lib/trpc"
import { useDiscussionDraft } from "../../discussions/use-discussions"

type Scope = { projectId: string; taskId: string }
const verdicts = { pass: "Pass", "needs-work": "Needs work", inconclusive: "Inconclusive" } as const
const reviewCursors = new Map<string, { revision: number; stateRevision: number }>()
const terminal = new Set(["success", "failure", "cancelled"])
const fieldClass = "h-8 w-full min-w-0 rounded-md border bg-background px-2 text-xs"
const runLabel = (run: OrchestrationReviewMember) =>
  `${run.name || run.role} - ${run.runId} (${run.runStatus})`

export function OrchestrationReviewPanel({
  projectId,
  taskId,
  onNavigate,
}: Scope & { onNavigate: (chatId: string) => void }) {
  const scope = { projectId, taskId }
  const query = trpc.orchestrationOperations.reviewState.useQuery(scope, {
    refetchOnWindowFocus: true,
    refetchInterval: 5000,
  })
  const [sourceRunId, selectSource, storageError] = useDiscussionDraft(
    `flapstack.review-selection:${JSON.stringify([projectId, taskId])}`,
    "",
  )
  const utils = trpc.useUtils()
  const refresh = () => utils.orchestrationOperations.reviewState.invalidate(scope)
  const members = query.data?.members ?? []
  const historical = (query.data?.reviews ?? []).filter(
    (row) => !members.some((member) => member.runId === row.sourceRunId),
  )
  return (
    <section
      aria-label="Run reviews"
      className="rounded-md border border-border/60 p-3 text-xs space-y-3"
    >
      <h4 className="font-medium">Run reviews</h4>
      <p className="text-muted-foreground">
        Record an explicit review of one run by another. Run completion, assigned role, and owner
        acceptance remain separate.
      </p>
      {query.error && (
        <p role="alert">
          {query.error.message}{" "}
          <button className="underline" onClick={() => void refresh()}>
            Refresh reviews
          </button>
        </p>
      )}
      {storageError && (
        <p role="alert">Selection storage unavailable. Your saved reviews remain on this device.</p>
      )}
      <label className="grid gap-1">
        Source run
        <select
          aria-label="Review source run"
          className={fieldClass}
          value={sourceRunId}
          onChange={(event) => selectSource(event.target.value)}
        >
          <option value="">
            {query.isLoading ? "Loading task runs..." : "Choose a source run"}
          </option>
          {members.map((run) => (
            <option key={run.runId} value={run.runId}>
              {runLabel(run)}
            </option>
          ))}
          {historical.map((row) => (
            <option key={row.sourceRunId} value={row.sourceRunId}>
              Historical run - {row.sourceRunId}
            </option>
          ))}
        </select>
      </label>
      {!query.isLoading && !members.length && !historical.length && (
        <p>No task runs are available for review.</p>
      )}
      {sourceRunId && query.data && (
        <ReviewEditor
          key={sourceRunId}
          scope={scope}
          sourceRunId={sourceRunId}
          members={members}
          saved={query.data.reviews.find((row) => row.sourceRunId === sourceRunId)}
          refresh={refresh}
          onNavigate={onNavigate}
        />
      )}
    </section>
  )
}

function ReviewEditor({
  scope,
  sourceRunId,
  members,
  saved,
  refresh,
  onNavigate,
}: {
  scope: Scope
  sourceRunId: string
  members: OrchestrationReviewMember[]
  saved?: OrchestrationRunReview
  refresh: () => Promise<unknown>
  onNavigate: (chatId: string) => void
}) {
  const [draft, setDraft, storageError] = useDiscussionDraft<{
    reviewerRunId: string
    verdict: string
    evidence: string
  }>(`flapstack.review-draft:${JSON.stringify([scope.projectId, scope.taskId, sourceRunId])}`, {
    reviewerRunId: saved?.review?.reviewerRunId ?? "",
    verdict: saved?.review?.verdict ?? "",
    evidence: saved?.review?.evidence ?? "",
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const source = members.find((run) => run.runId === sourceRunId)
  const reviewer = members.find((run) => run.runId === draft.reviewerRunId)
  const canPass =
    !!source && !!reviewer && terminal.has(source.runStatus) && terminal.has(reviewer.runStatus)
  const save = async (remove = false) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const beforeRevision = saved?.revision ?? 0
      const next = await trpcClient.orchestrationOperations.setReview.mutate({
        ...scope,
        sourceRunId,
        expectedRevision: beforeRevision,
        review: remove
          ? null
          : {
              reviewerRunId: draft.reviewerRunId,
              verdict: draft.verdict as keyof typeof verdicts,
              evidence: draft.evidence,
            },
      })
      const key = JSON.stringify([scope.projectId, scope.taskId, sourceRunId])
      const previousCursor = reviewCursors.get(key)
      const beforeState =
        previousCursor?.revision === beforeRevision ? previousCursor.stateRevision : beforeRevision
      reviewCursors.set(key, { revision: next.revision, stateRevision: next.revision })
      const restore = async (
        expectedState: number,
        targetState: number,
        targetRevision: number,
      ) => {
        const cursor = reviewCursors.get(key)
        if (!cursor || cursor.stateRevision !== expectedState) {
          throw new Error(
            "Review history changed outside this action. Refresh before changing the verdict.",
          )
        }
        const result = await trpcClient.orchestrationOperations.restoreReview.mutate({
          ...scope,
          sourceRunId,
          expectedRevision: cursor.revision,
          targetRevision,
        })
        reviewCursors.set(key, { revision: result.revision, stateRevision: targetState })
        await refresh().catch(() => {})
      }
      recordAppAction({
        label: `${remove ? "Remove" : "Save"} run review`,
        undo: () => restore(next.revision, beforeState, beforeRevision),
        redo: () => restore(beforeState, next.revision, next.revision),
      })
      await refresh().catch(() => {})
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Review could not be saved. Your draft is retained.",
      )
      await refresh().catch(() => {})
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3">
      <div className="space-y-1 break-words">
        <p>Source: {source ? runLabel(source) : sourceRunId}</p>
        {source && (
          <p className="text-muted-foreground">
            Agent role: {source.role}. Agent status: {source.status}. Run status: {source.runStatus}
            .
          </p>
        )}
        {source?.chatId && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onNavigate(source.chatId)}
          >
            Open source chat
          </Button>
        )}
      </div>
      <div aria-label="Saved run review" className="space-y-1">
        <p className="font-medium">
          {saved?.review ? verdicts[saved.review.verdict] : "Unreviewed"}
        </p>
        {saved?.review && (
          <>
            <p className="break-all">Reviewer run: {saved.review.reviewerRunId}</p>
            <p className="text-muted-foreground">
              Manually recorded verdict. No execution status or owner acceptance changed.
            </p>
            <p className="whitespace-pre-wrap break-words">{saved.review.evidence}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Remove saved verdict
            </Button>
          </>
        )}
      </div>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <label className="grid gap-1">
          Reviewer run
          <select
            aria-label="Reviewer run"
            className={fieldClass}
            value={draft.reviewerRunId}
            onChange={(event) => setDraft({ ...draft, reviewerRunId: event.target.value })}
            required
          >
            <option value="">Choose another task run</option>
            {members
              .filter((run) => run.runId !== sourceRunId)
              .map((run) => (
                <option key={run.runId} value={run.runId}>
                  {runLabel(run)}
                </option>
              ))}
          </select>
        </label>
        {reviewer?.chatId && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onNavigate(reviewer.chatId)}
          >
            Open reviewer chat
          </Button>
        )}
        <label className="grid gap-1">
          Verdict
          <select
            aria-label="Review verdict"
            className={fieldClass}
            value={draft.verdict}
            onChange={(event) => setDraft({ ...draft, verdict: event.target.value })}
            required
          >
            <option value="">Choose an explicit verdict</option>
            {Object.entries(verdicts).map(([value, label]) => (
              <option key={value} value={value} disabled={value === "pass" && !canPass}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!canPass && (
          <p className="text-muted-foreground">
            Pass requires both selected runs to have ended. Other verdicts can describe work still
            in progress.
          </p>
        )}
        <label className="grid gap-1">
          Evidence
          <Textarea
            aria-label="Review evidence"
            rows={4}
            maxLength={8000}
            value={draft.evidence}
            onChange={(event) => setDraft({ ...draft, evidence: event.target.value })}
            required
          />
        </label>
        <Button
          size="sm"
          disabled={
            busy ||
            !source ||
            !reviewer ||
            reviewer.runId === sourceRunId ||
            !(draft.verdict in verdicts) ||
            !draft.evidence.trim() ||
            (draft.verdict === "pass" && !canPass)
          }
        >
          {busy ? "Saving review..." : saved?.review ? "Revise verdict" : "Save verdict"}
        </Button>
        {error && (
          <p role="alert">
            {error} Your draft is retained. Refresh and review the saved verdict before retrying.
          </p>
        )}
        {storageError && (
          <p role="alert">
            Draft storage unavailable. Keep this task open until you save the review.
          </p>
        )}
      </form>
    </div>
  )
}
