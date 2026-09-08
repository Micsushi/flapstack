import { useRef, useState } from "react"
import type {
  WorktreeDeclarationRevision,
  WorktreeDeclarationState,
} from "../../../../shared/worktree-declarations"
import { Button } from "../../../components/ui/button"
import { recordAppAction } from "../../../lib/app-action-history"
import { trpc, trpcClient } from "../../../lib/trpc"
import { useBetaFeatures } from "../../settings/use-beta-features"
import { useDiscussionDraft } from "../../discussions/use-discussions"

type Scope = { projectId: string; taskId: string }
const cursors = new Map<string, { revision: number; stateRevision: number }>()

export function WorktreeDeclarationsPanel(props: Scope & { onNavigate: (chatId: string) => void }) {
  const beta = useBetaFeatures()
  return beta.orchestration && props.projectId && props.taskId ? (
    <DeclarationsContent key={JSON.stringify([props.projectId, props.taskId])} {...props} />
  ) : null
}

function DeclarationsContent({
  projectId,
  taskId,
  onNavigate,
}: Scope & { onNavigate: (chatId: string) => void }) {
  const scope = { projectId, taskId }
  const query = trpc.orchestrationOperations.worktreeDeclarationState.useQuery(scope, {
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  const utils = trpc.useUtils()
  const refresh = () => utils.orchestrationOperations.worktreeDeclarationState.invalidate(scope)
  const [runId, setRunId, storageError] = useDiscussionDraft(
    `flapstack.worktree-selection:${JSON.stringify([projectId, taskId])}`,
    "",
  )
  const data: WorktreeDeclarationState | undefined = query.data
  const ownRows = data?.declarations.filter((row) => row.taskId === taskId) ?? []
  const members = data?.members ?? []
  return (
    <section
      aria-label="Worktree declarations"
      className="min-w-0 space-y-3 rounded-md border p-3 text-sm"
    >
      <h4 className="font-medium">Declared worktree access</h4>
      <p>
        Manual read or write intent for exact runs. These declarations do not change permissions,
        prove writes, or provide an exclusive lock.
      </p>
      <Button variant="outline" onClick={() => void refresh()}>
        Refresh declarations
      </Button>
      {query.isLoading ? (
        <p role="status">Loading declarations...</p>
      ) : query.error ? (
        <p role="alert">{query.error.message}</p>
      ) : !data ? (
        <p>Declarations are unavailable.</p>
      ) : (
        <>
          <label className="grid gap-1">
            Run
            <select
              aria-label="Declaration run"
              className="h-9 w-full min-w-0 rounded-md border bg-background px-2"
              value={runId}
              onChange={(event) => setRunId(event.target.value)}
            >
              <option value="">Choose a run in this task</option>
              {members.map((member) => (
                <option key={member.runId} value={member.runId}>
                  {member.name} - {member.runId} ({member.runStatus})
                </option>
              ))}
              {ownRows
                .filter((row) => !members.some((member) => member.runId === row.runId))
                .map((row) => (
                  <option key={row.runId} value={row.runId}>
                    Historical run - {row.runId}
                  </option>
                ))}
            </select>
          </label>
          {runId && (
            <DeclarationEditor
              key={JSON.stringify([projectId, taskId, runId])}
              scope={scope}
              runId={runId}
              member={members.find((member) => member.runId === runId)}
              saved={ownRows.find((row) => row.runId === runId)}
              refresh={refresh}
              onNavigate={onNavigate}
            />
          )}
          <div aria-label="Project declaration conflicts" className="space-y-2">
            <h5 className="font-medium">Potential conflicts across this project</h5>
            {data.conflicts.length ? (
              data.conflicts.map((conflict) => (
                <div key={conflict.worktreePath} className="space-y-1">
                  <code className="block break-all">{conflict.worktreePath}</code>
                  {conflict.runs.map((run) => (
                    <p key={run.runId} className="break-all">
                      {run.intent === "write" ? "Write" : "Read"} intent - run {run.runId}, task{" "}
                      {run.taskId}
                    </p>
                  ))}
                </div>
              ))
            ) : (
              <p>
                No conflicting active declarations were reported. Undeclared or external access is
                not verified.
              </p>
            )}
          </div>
          <div aria-label="Saved project declarations" className="space-y-3">
            {data.declarations.map((row) => (
              <div key={row.runId} className="break-words">
                <p className="break-all">
                  Run {row.runId}, task {row.taskId}:{" "}
                  {row.declaration
                    ? `${row.declaration.intent === "write" ? "Write" : "Read"} intent`
                    : "Released"}{" "}
                  ({row.activity})
                </p>
                {row.declaration && (
                  <>
                    <code className="block break-all">{row.declaration.worktreePath}</code>
                    <Button
                      variant="link"
                      className="h-auto max-w-full whitespace-normal px-0 text-left"
                      onClick={() => onNavigate(row.declaration!.chatId)}
                      aria-label={`Open declared run ${row.runId}`}
                    >
                      Open declared run
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {storageError && <p role="alert">Selection storage is unavailable.</p>}
    </section>
  )
}

function DeclarationEditor({
  scope,
  runId,
  member,
  saved,
  refresh,
  onNavigate,
}: {
  scope: Scope
  runId: string
  member?: WorktreeDeclarationState["members"][number]
  saved?: WorktreeDeclarationRevision
  refresh: () => Promise<unknown>
  onNavigate: (chatId: string) => void
}) {
  const [intent, setIntent, storageError] = useDiscussionDraft(
    `flapstack.worktree-draft:${JSON.stringify([scope.projectId, scope.taskId, runId])}`,
    saved?.declaration?.intent ?? "read",
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const locked = useRef(false)
  const save = async (release = false) => {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError(null)
    try {
      const beforeRevision = saved?.revision ?? 0
      const next = await trpcClient.orchestrationOperations.setWorktreeDeclaration.mutate({
        ...scope,
        runId,
        expectedRevision: beforeRevision,
        intent: release ? null : intent,
      })
      const key = JSON.stringify([scope.projectId, scope.taskId, runId])
      const previous = cursors.get(key)
      const beforeState =
        previous?.revision === beforeRevision ? previous.stateRevision : beforeRevision
      cursors.set(key, { revision: next.revision, stateRevision: next.revision })
      const restore = async (
        expectedState: number,
        targetState: number,
        targetRevision: number,
      ) => {
        const cursor = cursors.get(key)
        if (!cursor || cursor.stateRevision !== expectedState)
          throw new Error(
            "Declaration history changed outside this action. Refresh before changing access.",
          )
        const result = await trpcClient.orchestrationOperations.restoreWorktreeDeclaration.mutate({
          ...scope,
          runId,
          expectedRevision: cursor.revision,
          targetRevision,
        })
        cursors.set(key, { revision: result.revision, stateRevision: targetState })
        await refresh().catch(() => {})
      }
      recordAppAction({
        label: release ? "Release worktree declaration" : "Save worktree declaration",
        undo: () => restore(next.revision, beforeState, beforeRevision),
        redo: () => restore(beforeState, next.revision, next.revision),
      })
      await refresh().catch(() => {})
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : "Declaration could not be saved."} Your draft is retained.`,
      )
      await refresh().catch(() => {})
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return (
    <div className="space-y-2">
      <p className="break-all">Selected run: {runId}</p>
      <p>
        {saved?.declaration ? `Saved ${saved.declaration.intent} intent` : "No current declaration"}
      </p>
      {member?.worktreePath && <code className="block break-all">{member.worktreePath}</code>}
      {member && (
        <Button variant="outline" onClick={() => onNavigate(member.chatId)}>
          Open selected run
        </Button>
      )}
      {!member?.eligible && (
        <p>{member?.reason ?? "This historical run cannot declare new access."}</p>
      )}
      <label className="grid gap-1">
        Declared intent
        <select
          aria-label="Declared intent"
          className="h-9 w-full min-w-0 rounded-md border bg-background px-2"
          value={intent}
          onChange={(event) => setIntent(event.target.value as "read" | "write")}
        >
          <option value="read">Read</option>
          <option value="write">Write</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !member?.eligible} onClick={() => void save()}>
          Save declaration
        </Button>
        <Button
          variant="outline"
          disabled={busy || !saved?.declaration}
          onClick={() => void save(true)}
        >
          Release declaration
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {storageError && <p role="alert">Draft storage is unavailable.</p>}
    </div>
  )
}
