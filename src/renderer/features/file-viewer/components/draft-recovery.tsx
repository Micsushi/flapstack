import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { trpc, trpcClient } from "@/lib/trpc"
import { recordAppAction } from "@/lib/app-action-history"
import {
  saveAsWorkspaceEditSchema,
  type WorkspaceEditScope,
} from "../../../../shared/workspace-edits"

type SaveAsRequest = Parameters<typeof trpcClient.workspaceEditing.saveAs.mutate>[0]
type Draft = Awaited<ReturnType<typeof trpcClient.workspaceEditing.readDraft.query>>

function pendingSaveAs(key: string, scope: WorkspaceEditScope) {
  const requests: SaveAsRequest[] = []
  let error = ""
  try {
    for (const storedKey of Object.keys(localStorage).filter((candidate) =>
      candidate.startsWith(`${key}:`),
    )) {
      try {
        const stored = localStorage.getItem(storedKey)
        if (stored === null) continue
        const request = saveAsWorkspaceEditSchema.parse(JSON.parse(stored))
        if (
          storedKey !== `${key}:${request.id}` ||
          request.projectId !== scope.projectId ||
          request.chatId !== scope.chatId
        )
          throw new Error("Recovery scope changed")
        requests.push(request)
      } catch {
        error =
          "Some retry details cannot be read. They are kept intact. You can still copy your text or save a separate file."
      }
    }
  } catch {
    error = "Retry storage is unavailable. Copy your text or retry loading recovery details."
  }
  return { requests, error }
}

const recordedSaveAs = new Set<string>()

export function DraftRecovery({
  scope,
  relativePath,
}: {
  scope: WorkspaceEditScope
  relativePath: string
}) {
  const drafts = trpc.workspaceEditing.listDrafts.useQuery(scope, { retry: false })
  const matches = drafts.data?.filter(
    (draft) => draft.relativePath.replaceAll("\\", "/") === relativePath.replaceAll("\\", "/"),
  )
  return (
    <section
      className="min-h-0 overflow-auto border-t p-3 space-y-3"
      aria-label="Recover saved drafts"
    >
      <h3 className="text-sm font-medium">Saved draft recovery</h3>
      {drafts.isLoading && <p role="status">Checking for saved drafts…</p>}
      {drafts.error && (
        <p role="alert" className="text-sm text-destructive">
          {drafts.error.message}
        </p>
      )}
      {drafts.error && (
        <Button size="sm" variant="outline" onClick={() => void drafts.refetch()}>
          Retry draft recovery
        </Button>
      )}
      {matches?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No saved draft was found for this file in this workspace.
        </p>
      )}
      {matches?.map((draft) => (
        <RecoveredDraft key={draft.id} scope={scope} draftId={draft.id} />
      ))}
    </section>
  )
}

function RecoveredDraft({ scope, draftId }: { scope: WorkspaceEditScope; draftId: string }) {
  const draft = trpc.workspaceEditing.readDraft.useQuery({ ...scope, draftId }, { retry: false })
  const [copyState, setCopyState] = useState("")
  const copy = async () => {
    if (!draft.data) return
    try {
      await navigator.clipboard.writeText(draft.data.content)
      setCopyState("Draft copied. Paste it into a new file to keep a separate copy.")
    } catch {
      setCopyState("Copy failed. Select the draft text below and copy it manually.")
    }
  }
  return (
    <div className="space-y-2">
      {draft.isLoading && <p role="status">Loading saved text…</p>}
      {draft.error && (
        <>
          <p role="alert" className="text-sm text-destructive">
            {draft.error.message}
          </p>
          <Button size="sm" variant="outline" onClick={() => void draft.refetch()}>
            Retry loading draft
          </Button>
        </>
      )}
      {draft.data && (
        <>
          <p className="text-sm text-muted-foreground">
            Your draft is saved locally. Save a separate file or copy the text; the draft stays
            here.
          </p>
          <textarea
            aria-label="Recovered draft text"
            readOnly
            value={draft.data.content}
            className="w-full min-h-48 rounded-md border bg-background p-2 font-mono text-xs"
          />
          <Button size="sm" variant="outline" onClick={() => void copy()}>
            Copy saved draft
          </Button>
          <p role="status" className="text-sm">
            {copyState}
          </p>
          <RecoverySaveAs
            key={`${draft.data.id}:${draft.data.rootIdentity}`}
            scope={scope}
            draft={draft.data}
          />
        </>
      )}
    </div>
  )
}

export function RecoverySaveAs({
  scope,
  draft,
  onSavedCopy,
}: {
  scope: WorkspaceEditScope
  draft: Pick<Draft, "id" | "rootIdentity" | "relativePath" | "content">
  onSavedCopy?: (content: string | null, relativePath: string) => void
}) {
  const pathId = useId(),
    hintId = useId()
  const storageKey = `workspace-draft-save-as:${JSON.stringify([scope.projectId, scope.chatId, draft.rootIdentity, draft.id])}`
  const [pending, setPending] = useState(() => pendingSaveAs(storageKey, scope))
  const [request, setRequest] = useState<SaveAsRequest | null>(null)
  const [path, setPath] = useState("")
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const refresh = useCallback(
    () => setPending(pendingSaveAs(storageKey, scope)),
    [storageKey, scope.projectId, scope.chatId],
  )
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith(`${storageKey}:`)) refresh()
    }
    window.addEventListener("storage", changed)
    return () => window.removeEventListener("storage", changed)
  }, [storageKey, refresh])
  const saveAs = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setMessage("")
    try {
      // Only the displayed request can be retried; another window never supplies a new submission.
      let submitted = request
      if (!submitted) {
        const destination = path.trim().replaceAll("\\", "/")
        if (
          !destination ||
          destination.startsWith("/") ||
          /^[a-z]:/i.test(destination) ||
          destination.split("/").some((part) => !part || part === "." || part === "..") ||
          destination === draft.relativePath.replaceAll("\\", "/")
        ) {
          setMessage("Enter a different relative file path in an existing worktree folder.")
          return
        }
        submitted = saveAsWorkspaceEditSchema.parse({
          ...scope,
          id: crypto.randomUUID(),
          relativePath: destination,
          content: draft.content,
        })
      }
      localStorage.setItem(`${storageKey}:${submitted.id}`, JSON.stringify(submitted))
      setRequest(submitted)
      setPath(submitted.relativePath)
      refresh()
      const result = await trpcClient.workspaceEditing.saveAs.mutate(submitted)
      if (result.ok) {
        localStorage.removeItem(`${storageKey}:${submitted.id}`)
        let operationId = result.operation.id,
          retryId: string | null = null,
          exists = true
        const savedContent = submitted.content
        const savedPath = submitted.relativePath
        const reverse = async () => {
          retryId ??= crypto.randomUUID()
          const reversed = await trpcClient.workspaceEditing.revert.mutate({
            ...scope,
            id: retryId,
            operationId,
          })
          if (!reversed.ok) {
            if (reversed.reason === "failed") retryId = null
            throw new Error(
              `File reversal did not complete (${reversed.reason}). Your draft is preserved.`,
            )
          }
          operationId = reversed.operation.id
          retryId = null
          exists = !exists
          onSavedCopy?.(exists ? savedContent : null, savedPath)
        }
        if (!recordedSaveAs.has(result.operation.id)) {
          recordAppAction({
            label: `Save As ${submitted.relativePath}`,
            undo: reverse,
            redo: reverse,
          })
          recordedSaveAs.add(result.operation.id)
          if (recordedSaveAs.size > 100)
            recordedSaveAs.delete(recordedSaveAs.values().next().value!)
        }
        onSavedCopy?.(savedContent, savedPath)
        setRequest(null)
        setPath("")
        refresh()
        setMessage(
          `Saved ${submitted.relativePath}. Your original draft is still available. Undo is available in action history.`,
        )
      } else if (
        result.reason === "failed" ||
        (result.reason === "conflict" && "notApplied" in result && result.notApplied)
      ) {
        localStorage.removeItem(`${storageKey}:${submitted.id}`)
        setRequest(null)
        refresh()
        setMessage(
          "This attempt did not write the file. Choose another path or retry. Your draft is preserved.",
        )
      } else {
        setMessage(
          `Save As is unresolved (${result.reason}). Retry keeps the same path and text. You can also save a separate copy without removing this request.`,
        )
      }
    } catch (error) {
      setMessage(
        `${error instanceof Error ? error.message : "Save As failed."} Your text and any pending request are preserved.`,
      )
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-2"
      aria-label="Save recovered draft as"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault()
        void saveAs()
      }}
    >
      {pending.requests.length > 0 && (
        <div className="space-y-2" aria-label="Pending Save As requests">
          <p className="text-sm">
            Unconfirmed copies. Select a request to review its text and retry.
          </p>
          {pending.requests.map((saved) => (
            <Button
              key={saved.id}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto max-w-full whitespace-normal break-all text-left"
              disabled={busy}
              onClick={() => {
                setRequest(saved)
                setPath(saved.relativePath)
                setMessage("")
              }}
            >
              Review retry: {saved.relativePath}
            </Button>
          ))}
        </div>
      )}
      {pending.error && (
        <p role="alert" className="text-sm break-words text-destructive">
          {pending.error}
        </p>
      )}
      {pending.error && (
        <Button type="button" size="sm" variant="outline" onClick={refresh}>
          Retry recovery
        </Button>
      )}
      <label htmlFor={pathId} className="block text-sm font-medium">
        New file path
      </label>
      <Input
        id={pathId}
        value={path}
        onChange={(event) => {
          setPath(event.target.value)
          setMessage("")
        }}
        readOnly={busy || !!request}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hintId}
      />
      <p id={hintId} className="text-sm text-muted-foreground">
        Relative to this chat’s worktree. The folder must exist. Existing files are never
        overwritten.
      </p>
      {request && (
        <>
          <p className="text-sm">
            Retry sends this saved text to the displayed path with its original request ID.
          </p>
          <textarea
            aria-label="Text awaiting Save As confirmation"
            readOnly
            value={request.content}
            className="w-full min-h-32 rounded-md border bg-background p-2 font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setRequest(null)
              setPath("")
              setMessage(
                "The previous request is retained above and may already have created a file. A separate copy uses your current draft text.",
              )
            }}
          >
            Save a separate copy
          </Button>
        </>
      )}
      <Button type="submit" size="sm" disabled={busy || (!request && !path.trim())}>
        {busy ? "Saving…" : request ? "Retry Save As" : "Save As new file"}
      </Button>
      {message && (
        <p role="status" className="text-sm break-words">
          {message}
        </p>
      )}
    </form>
  )
}
