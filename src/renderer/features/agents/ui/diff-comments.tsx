import { useEffect, useRef, useState } from "react"
import { trpc, trpcClient } from "../../../lib/trpc"
import { recordAppAction } from "../../../lib/app-action-history"
import { Button } from "../../../components/ui/button"
import type { DiffAnnotationAnchor, DiffAnnotationDto } from "../../../../shared/diff-annotations"
import { diffAnnotationBodySchema } from "../../../../shared/diff-annotations"
import {
  readPendingFeedback,
  storePendingFeedback,
  clearPendingFeedback,
  type PendingDiffFeedback,
} from "../../../lib/diff-feedback-request"

export type DiffCommentDraft = {
  id: string
  anchor: DiffAnnotationAnchor
  body: string
  expectedVersion?: number
}

export function DiffComments({
  chatId,
  draft,
  setDraft,
  onBusyChange,
  displayedDiffHash,
  feedbackTarget,
}: {
  chatId: string
  draft: DiffCommentDraft | null
  setDraft: (draft: DiffCommentDraft | null) => void
  onBusyChange: (busy: boolean) => void
  displayedDiffHash: string | null
  feedbackTarget?: { id: string; name: string } | null
}) {
  const metadata = trpc.chats.getMetadata.useQuery({ id: chatId })
  const projectId = metadata.data?.projectId ?? ""
  const scope = { chatId, projectId }
  const query = trpc.diffAnnotations.list.useQuery(scope, { enabled: !!projectId })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const [selection, setSelection] = useState<Record<string, number>>({})
  const [pending, setPending] = useState<PendingDiffFeedback | null>(null)
  useEffect(() => {
    if (!projectId) return
    try {
      setPending(readPendingFeedback(window.localStorage, { chatId, projectId }))
    } catch {
      setError(
        "Feedback retry storage is unavailable. Restore local storage and refresh before sending.",
      )
    }
  }, [chatId, projectId])
  const lineages = useRef(new Map<string, { version: number }>())
  function acceptLocalChange(row: DiffAnnotationDto, previousVersion?: number) {
    const existing = lineages.current.get(row.id)
    // Only local successors share authority. Observed external edits start a new
    // lineage, leaving old undo entries stale rather than silently rebasing them.
    const lineage =
      existing && existing.version === previousVersion ? existing : { version: row.version }
    lineage.version = row.version
    lineages.current.set(row.id, lineage)
    return lineage
  }
  const rows = query.data?.annotations ?? []
  const freshness = (row: DiffAnnotationDto) =>
    !displayedDiffHash ? "unverified" : row.diffHash !== displayedDiffHash ? "stale" : row.freshness
  const stale =
    !!draft &&
    (displayedDiffHash !== draft.anchor.diffHash || query.data?.diffHash !== draft.anchor.diffHash)
  const eligible = (row: DiffAnnotationDto) =>
    row.deletedAt === null &&
    freshness(row) === "current" &&
    row.lastFeedbackVersion !== row.version
  const selected = Object.entries(selection).map(([id, version]) => ({ id, version }))
  const canSend =
    !!pending ||
    (!!feedbackTarget &&
      selected.length > 0 &&
      selected.every((item) => {
        const row = rows.find((row) => row.id === item.id)
        return row && row.version === item.version && eligible(row)
      }))
  const targetName =
    pending && pending.subChatId !== feedbackTarget?.id ? pending.subChatId : feedbackTarget?.name

  async function sendFeedback() {
    if (busy || !projectId || !canSend || draft) return
    setBusy(true)
    onBusyChange(true)
    setError(null)
    let committed = false
    try {
      const request = pending ?? {
        ...scope,
        id: crypto.randomUUID(),
        subChatId: feedbackTarget!.id,
        comments: selected,
      }
      storePendingFeedback(window.localStorage, request)
      setPending(request)
      await trpcClient.diffAnnotations.send.mutate(request)
      committed = true
      clearPendingFeedback(window.localStorage, request)
      setPending(readPendingFeedback(window.localStorage, scope))
      setSelection({})
      await query.refetch()
    } catch (failure) {
      setError(
        committed
          ? "Feedback was queued. Refresh to recover its status; retry will not duplicate it."
          : failure instanceof Error
            ? failure.message
            : "Feedback could not be queued. Retry keeps the same request.",
      )
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }

  async function cancelFeedback(row: DiffAnnotationDto) {
    if (busy || !row.lastFeedbackBatchId) return
    setBusy(true)
    onBusyChange(true)
    setError(null)
    try {
      await trpcClient.diffAnnotations.cancelFeedback.mutate({
        ...scope,
        id: row.lastFeedbackBatchId,
      })
      await query.refetch()
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Cancellation failed. Refresh and try again.",
      )
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }

  async function refresh() {
    if (busy) return
    setBusy(true)
    onBusyChange(true)
    setError(null)
    try {
      if (projectId) setPending(readPendingFeedback(window.localStorage, scope))
      if (!projectId || metadata.error) await metadata.refetch()
      else await query.refetch()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Refresh failed. Try again.")
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }

  async function save() {
    if (!draft || busy || !projectId) return
    const body = diffAnnotationBodySchema.safeParse(draft.body)
    if (!body.success) {
      setError("Enter a comment up to 16 KiB.")
      return
    }
    setBusy(true)
    onBusyChange(true)
    setError(null)
    try {
      const request = { ...scope, ...draft, body: body.data }
      const before = rows.find((row) => row.id === draft.id)
      let current =
        draft.expectedVersion === undefined
          ? await trpcClient.diffAnnotations.create.mutate(request)
          : await trpcClient.diffAnnotations.revise.mutate({
              ...request,
              expectedVersion: draft.expectedVersion,
            })
      const lineage = acceptLocalChange(current, draft.expectedVersion)
      if (draft.expectedVersion === undefined && current.version === 1) {
        const apply = async (deleted: boolean) => {
          current = await trpcClient.diffAnnotations.setDeleted.mutate({
            ...scope,
            id: current.id,
            expectedVersion: lineage.version,
            deleted,
          })
          lineage.version = current.version
          await query.refetch()
        }
        recordAppAction({
          label: "Create diff comment",
          undo: () => apply(true),
          redo: () => apply(false),
        })
      } else if (draft.expectedVersion !== undefined && before) {
        const previousAnchor = {
          diffHash: before.diffHash,
          filePath: before.filePath,
          side: before.side,
          startLine: before.startLine,
          endLine: before.endLine,
        }
        const apply = async (anchor: DiffAnnotationAnchor, nextBody: string) => {
          current = await trpcClient.diffAnnotations.revise.mutate({
            ...scope,
            id: current.id,
            expectedVersion: lineage.version,
            anchor,
            body: nextBody,
          })
          lineage.version = current.version
          await query.refetch()
        }
        recordAppAction({
          label: "Edit diff comment",
          undo: () => apply(previousAnchor, before.body),
          redo: () => apply(draft.anchor, body.data),
        })
      }
      setDraft(null)
      await query.refetch()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Comment was not saved. Retry keeps this draft.",
      )
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }

  async function changeDeleted(row: DiffAnnotationDto, deleted: boolean) {
    if (busy) return
    setBusy(true)
    onBusyChange(true)
    setError(null)
    try {
      let current = await trpcClient.diffAnnotations.setDeleted.mutate({
        ...scope,
        id: row.id,
        expectedVersion: row.version,
        deleted,
      })
      const lineage = acceptLocalChange(current, row.version)
      const apply = async (next: boolean) => {
        current = await trpcClient.diffAnnotations.setDeleted.mutate({
          ...scope,
          id: row.id,
          expectedVersion: lineage.version,
          deleted: next,
        })
        lineage.version = current.version
        await query.refetch()
      }
      recordAppAction({
        label: deleted ? "Delete diff comment" : "Restore diff comment",
        undo: () => apply(!deleted),
        redo: () => apply(deleted),
      })
      await query.refetch()
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Comment changed. Refresh and try again.",
      )
    } finally {
      setBusy(false)
      onBusyChange(false)
    }
  }

  return (
    <section
      aria-label="Diff comments"
      aria-busy={busy}
      className="max-h-[45%] shrink-0 overflow-auto border-t border-border px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Comments</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={showDeleted}
              onChange={(event) => setShowDeleted(event.target.checked)}
            />
            Deleted
          </label>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh()}>
            Refresh
          </Button>
        </div>
      </div>
      {(rows.length > 0 || pending) && (
        <div className="my-2 space-y-1">
          <p className="break-words text-xs text-muted-foreground">
            {targetName ? `Send to ${targetName}` : "Select a conversation to send feedback."}
            {" · "}
            {pending?.comments.length ?? selected.length} selected (25 maximum)
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !!draft || !projectId || !canSend}
              onClick={() => void sendFeedback()}
            >
              {busy ? "Working…" : pending ? "Retry feedback" : "Send feedback"}
            </Button>
            {pending && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  try {
                    clearPendingFeedback(window.localStorage, pending)
                    setPending(readPendingFeedback(window.localStorage, scope))
                  } catch {
                    setError("Retry state could not be cleared. Restore local storage and refresh.")
                  }
                }}
              >
                Clear retry
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Uses the target conversation’s permissions and may edit files. Cancellation does not
            undo changes.
            {pending ? " Clearing retry does not cancel queued work." : ""}
          </p>
          {!pending && selected.length > 0 && !!feedbackTarget && !canSend && (
            <p className="text-xs text-muted-foreground">
              Selection changed or is no longer sendable. Clear and reselect current comments.
            </p>
          )}
        </div>
      )}
      {(error || query.error || metadata.error || query.data?.error) && (
        <p role="alert" className="my-2 break-words text-red-600 dark:text-red-400">
          {error || query.error?.message || metadata.error?.message || query.data?.error}
        </p>
      )}
      {draft && (
        <form
          className="my-2 space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <p className="break-all text-xs text-muted-foreground">
            {draft.anchor.filePath} · {draft.anchor.side === "left" ? "Old" : "New"} lines{" "}
            {draft.anchor.startLine}–{draft.anchor.endLine}
          </p>
          <label className="block">
            Comment
            <textarea
              aria-label="Comment"
              className="mt-1 block min-h-20 w-full resize-y rounded-md border border-input bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={draft.body}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {(["startLine", "endLine"] as const).map((field) => (
              <label key={field} className="text-xs">
                {field === "startLine" ? "Start line" : "End line"}
                <input
                  type="number"
                  min={1}
                  max={10000000}
                  value={draft.anchor[field]}
                  disabled={busy}
                  className="ml-2 w-20 rounded border border-input bg-background p-1"
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      anchor: { ...draft.anchor, [field]: Number(event.target.value) },
                    })
                  }
                />
              </label>
            ))}
          </div>
          {stale && (
            <p className="text-xs text-muted-foreground">
              This diff changed or cannot be verified. Saving will verify its anchor; your draft
              stays here if it fails. Use the diff comment control to explicitly replace this anchor
              while keeping your text.
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy || !projectId}>
              {busy ? "Saving…" : "Save comment"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft(null)
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {query.isLoading && projectId ? (
        <p role="status" className="py-2 text-muted-foreground">
          Loading comments…
        </p>
      ) : null}
      {!draft && rows.length === 0 && !query.isLoading && (
        <p className="py-2 text-xs text-muted-foreground">
          Select lines in a diff, then use its comment control. Save comments before selecting
          feedback to send.
        </p>
      )}
      <ul className="divide-y divide-border">
        {rows
          .filter((row) => showDeleted || row.deletedAt === null)
          .map((row) => (
            <li key={row.id} className="py-2">
              <label className="mb-1 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  aria-label={`Select feedback ${row.filePath} lines ${row.startLine}–${row.endLine}`}
                  checked={
                    pending
                      ? pending.comments.some((item) => item.id === row.id)
                      : selection[row.id] !== undefined
                  }
                  disabled={
                    busy ||
                    !!pending ||
                    (!selection[row.id] && (!eligible(row) || selected.length >= 25))
                  }
                  onChange={(event) =>
                    setSelection((current) => {
                      const next = { ...current }
                      if (event.target.checked) next[row.id] = row.version
                      else delete next[row.id]
                      return next
                    })
                  }
                />
                Select feedback
              </label>
              <p className="break-all text-xs text-muted-foreground">
                {row.filePath} · {row.side === "left" ? "Old" : "New"} {row.startLine}–{row.endLine}
                {freshness(row) !== "current" ? ` · ${freshness(row)}` : ""}
                {row.deletedAt !== null ? " · deleted" : ""}
              </p>
              <p className="my-1 whitespace-pre-wrap break-words">{row.body}</p>
              {row.lastFeedbackVersion != null && (
                <p className="text-xs text-muted-foreground">
                  Feedback v{row.lastFeedbackVersion} ·{" "}
                  {row.feedback?.status ?? "run history unavailable"}
                  {row.lastFeedbackVersion !== row.version ? " · edited since queueing" : ""}
                </p>
              )}
              <div className="flex gap-2">
                {row.feedback && ["pending", "running"].includes(row.feedback.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void cancelFeedback(row)}
                  >
                    Cancel feedback run
                  </Button>
                )}
                {row.deletedAt === null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || !!draft}
                    onClick={() =>
                      setDraft({
                        id: row.id,
                        body: row.body,
                        expectedVersion: row.version,
                        anchor: {
                          diffHash: row.diffHash,
                          filePath: row.filePath,
                          side: row.side,
                          startLine: row.startLine,
                          endLine: row.endLine,
                        },
                      })
                    }
                  >
                    Edit
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void changeDeleted(row, row.deletedAt === null)}
                >
                  {row.deletedAt === null ? "Delete" : "Restore"}
                </Button>
              </div>
            </li>
          ))}
      </ul>
    </section>
  )
}
