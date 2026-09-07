import { useRef, useState } from "react"
import { trpc, trpcClient } from "../../../lib/trpc"
import { recordAppAction } from "../../../lib/app-action-history"
import { Button } from "../../../components/ui/button"
import type { DiffAnnotationAnchor, DiffAnnotationDto } from "../../../../shared/diff-annotations"
import { diffAnnotationBodySchema } from "../../../../shared/diff-annotations"

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
}: {
  chatId: string
  draft: DiffCommentDraft | null
  setDraft: (draft: DiffCommentDraft | null) => void
  onBusyChange: (busy: boolean) => void
  displayedDiffHash: string | null
}) {
  const metadata = trpc.chats.getMetadata.useQuery({ id: chatId })
  const projectId = metadata.data?.projectId ?? ""
  const scope = { chatId, projectId }
  const query = trpc.diffAnnotations.list.useQuery(scope, { enabled: !!projectId })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
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

  async function refresh() {
    if (busy) return
    setBusy(true)
    onBusyChange(true)
    setError(null)
    try {
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
          Select lines in a diff, then use its comment control. Comments stay local; sending to an
          agent is not available yet.
        </p>
      )}
      <ul className="divide-y divide-border">
        {rows
          .filter((row) => showDeleted || row.deletedAt === null)
          .map((row) => (
            <li key={row.id} className="py-2">
              <p className="break-all text-xs text-muted-foreground">
                {row.filePath} · {row.side === "left" ? "Old" : "New"} {row.startLine}–{row.endLine}
                {freshness(row) !== "current" ? ` · ${freshness(row)}` : ""}
                {row.deletedAt !== null ? " · deleted" : ""}
              </p>
              <p className="my-1 whitespace-pre-wrap break-words">{row.body}</p>
              <div className="flex gap-2">
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
