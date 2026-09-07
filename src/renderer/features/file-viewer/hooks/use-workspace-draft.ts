import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import type { WorkspaceEditScope } from "../../../../shared/workspace-edits"
import { trpcClient } from "../../../lib/trpc"
import { recordAppAction } from "../../../lib/app-action-history"
import {
  createWorkspaceDraftSession,
  type WorkspaceDraftSessionState,
} from "../workspace-draft-session"

type Target = WorkspaceEditScope & { rootPath: string; relativePath: string }
type Session = ReturnType<typeof createWorkspaceDraftSession>
const sessions = new Map<string, { session: Session; users: number }>()
const keyFor = (target: Target) =>
  JSON.stringify([target.projectId, target.chatId, target.rootPath, target.relativePath])
const idleState: WorkspaceDraftSessionState = {
  phase: "opening",
  content: "",
  draft: null,
  disk: null,
  conflict: false,
  busy: false,
  error: null,
  interruptedSave: false,
  autosave: false,
  autosaveAllowed: false,
}
const idleSnapshot = () => idleState
const idleSubscribe = () => () => undefined

function protectUnpersistedText(event: BeforeUnloadEvent) {
  if (![...sessions.values()].some(({ session }) => session.hasUnpersistedText())) return
  event.preventDefault()
  event.returnValue = ""
}

/** Pane moves share a session; failed persistence retains its buffer for recovery. */
export function acquireWorkspaceDraft(target: Target) {
  const key = keyFor(target)
  let entry = sessions.get(key)
  if (!entry) {
    if (sessions.size >= 64)
      throw new Error(
        "Too many retained editors. Save or recover an open draft before opening another.",
      )
    const session = createWorkspaceDraftSession(
      { projectId: target.projectId, chatId: target.chatId, relativePath: target.relativePath },
      {
        open: trpcClient.workspaceEditing.openDraft.mutate,
        update: trpcClient.workspaceEditing.updateDraft.mutate,
        save: trpcClient.workspaceEditing.saveDraft.mutate,
        release: trpcClient.workspaceEditing.releaseDraft.mutate,
        read: trpcClient.workspaceEditing.read.query,
      },
      (operation) => {
        let operationId = operation.id,
          pendingId: string | null = null
        const reverse = async () => {
          pendingId ??= crypto.randomUUID()
          const result = await trpcClient.workspaceEditing.revert.mutate({
            projectId: target.projectId,
            chatId: target.chatId,
            id: pendingId,
            operationId,
          })
          if (!result.ok)
            throw new Error(
              `File reversal did not complete (${result.reason}). The draft is preserved.`,
            )
          operationId = result.operation.id
          pendingId = null
          await sessions.get(key)?.session.refreshDisk()
        }
        recordAppAction({ label: `Save ${target.relativePath}`, undo: reverse, redo: reverse })
      },
    )
    entry = { users: 0, session }
    sessions.set(key, entry)
    if (sessions.size === 1) window.addEventListener("beforeunload", protectUnpersistedText)
  }
  const current = entry
  current.users++
  void current.session.open()
  void current.session.refreshDisk()
  let released = false
  return {
    session: current.session,
    release: () => {
      if (released) return
      released = true
      if (--current.users > 0) return
      void current.session
        .release(() => current.users === 0)
        .then((success) => {
          const snapshot = current.session.getSnapshot()
          const disposable =
            success ||
            !snapshot.draft ||
            (snapshot.phase === "closed" && !current.session.hasUnpersistedText())
          if (disposable && current.users === 0 && sessions.get(key) === current) {
            sessions.delete(key)
            if (sessions.size === 0)
              window.removeEventListener("beforeunload", protectUnpersistedText)
          }
        })
    },
  }
}

function changeAutosave(key: string | null, enabled: boolean) {
  if (!key) return false
  const previous = sessions.get(key)?.session.getSnapshot().autosave
  if (previous === undefined || !sessions.get(key)?.session.setAutosave(enabled)) return false
  const apply = (value: boolean) => {
    if (!sessions.get(key)?.session.setAutosave(value))
      throw new Error("Reopen this editor with automatic edit permission to change autosave.")
  }
  recordAppAction({
    label: `${enabled ? "Enable" : "Disable"} editor autosave`,
    undo: () => apply(previous),
    redo: () => apply(enabled),
  })
  return true
}

export function useWorkspaceDraft(input: Target | null) {
  const projectId = input?.projectId,
    chatId = input?.chatId
  const rootPath = input?.rootPath,
    relativePath = input?.relativePath
  const target = useMemo(
    () =>
      projectId && chatId && rootPath && relativePath
        ? { projectId, chatId, rootPath, relativePath }
        : null,
    [projectId, chatId, rootPath, relativePath],
  )
  const key = target ? keyFor(target) : null
  const [binding, setBinding] = useState<{
    key: string
    session: Session | null
    error: string | null
  } | null>(null)
  useEffect(() => {
    if (!target) return
    try {
      const acquired = acquireWorkspaceDraft(target)
      setBinding({ key: keyFor(target), session: acquired.session, error: null })
      return acquired.release
    } catch (error) {
      setBinding({
        key: keyFor(target),
        session: null,
        error: error instanceof Error ? error.message : "Editor unavailable.",
      })
    }
  }, [target])
  const active = binding?.key === key ? binding : null
  const session = active?.session ?? null
  const state = useSyncExternalStore(
    session?.subscribe ?? idleSubscribe,
    session?.getSnapshot ?? idleSnapshot,
    idleSnapshot,
  )
  return {
    session,
    setAutosave: (enabled: boolean) => changeAutosave(key, enabled),
    state: active?.error ? { ...state, phase: "error" as const, error: active.error } : state,
  }
}
