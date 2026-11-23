import { workspaceEditMaxBytes, type WorkspaceEditScope } from "../../../shared/workspace-edits"
import type { trpcClient } from "../../lib/trpc"

type Api = typeof trpcClient.workspaceEditing
type Opened = Awaited<ReturnType<Api["openDraft"]["mutate"]>>
type Saved = Awaited<ReturnType<Api["saveDraft"]["mutate"]>>
type Update = Parameters<Api["updateDraft"]["mutate"]>[0]
type Save = Parameters<Api["saveDraft"]["mutate"]>[0]
type Disk = Awaited<ReturnType<Api["read"]["query"]>>
type Replacement = Parameters<Api["replaceDraft"]["mutate"]>[0]
type Client = {
  open: Api["openDraft"]["mutate"]
  update: Api["updateDraft"]["mutate"]
  save: Api["saveDraft"]["mutate"]
  release: Api["releaseDraft"]["mutate"]
  read: Api["read"]["query"]
  replace: Api["replaceDraft"]["mutate"]
}

export type WorkspaceDraftSessionState = {
  phase: "opening" | "ready" | "closed" | "error"
  content: string
  draft: Opened["draft"] | null
  disk: Disk | null
  conflict: boolean
  busy: boolean
  error: string | null
  interruptedSave: boolean
  autosave: boolean
  autosaveAllowed: boolean
}

/** Serialize IPC writes; acknowledgements update server state, never newer typing. */
export function createWorkspaceDraftSession(
  target: WorkspaceEditScope & { relativePath: string },
  client: Client,
  onSaved: (operation: Extract<Saved, { ok: true }>["operation"]) => void = () => undefined,
  onDiscarded: (before: Opened["draft"], after: Opened["draft"]) => void = () => undefined,
) {
  let state: WorkspaceDraftSessionState = {
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
  let leaseToken = ""
  let blocked = false
  let queue = Promise.resolve()
  let pendingUpdate: Update | null = null
  let pendingSave: Save | null = null
  let pendingDiscard: {
    request: Replacement
    before: Opened["draft"]
    content: string
    discardedContent: string
  } | null = null
  let pendingRestore: {
    request: Replacement
    expected: Opened["draft"]
    restore: Opened["draft"]
  } | null = null
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined
  let editGeneration = 0
  const cancelAutosave = () => {
    editGeneration++
    clearTimeout(autosaveTimer)
    autosaveTimer = undefined
  }
  const listeners = new Set<() => void>()
  const publish = (change: Partial<WorkspaceDraftSessionState>) => {
    state = { ...state, ...change }
    listeners.forEach((listener) => listener())
  }
  const enqueue = (action: () => Promise<boolean>) => {
    const result = queue.then(async () => {
      publish({ busy: true })
      try {
        return await action()
      } catch (error) {
        blocked = true
        publish({
          phase: state.draft ? state.phase : "error",
          error:
            error instanceof Error ? error.message : "Draft operation failed. Retry to recover.",
        })
        return false
      } finally {
        publish({ busy: false })
      }
    })
    queue = result.then(() => undefined)
    return result
  }
  const draftTarget = () => {
    if (!state.draft || state.phase !== "ready") throw new Error("Open the draft before editing.")
    return { ...target, draftId: state.draft.id, leaseToken }
  }
  const applySave = (result: Saved) => {
    pendingSave = null
    if (
      !result.ok &&
      result.reason === "rejected" &&
      result.draft.content !== state.draft?.content
    ) {
      blocked = true
      publish({
        interruptedSave: false,
        autosave: false,
        error:
          "The stored draft changed. Your local text is preserved; save a separate copy before continuing.",
      })
      return false
    }
    const conflict =
      !result.ok &&
      (result.reason === "conflict" ||
        result.reason === "expired" ||
        (result.reason === "rejected" && state.conflict))
    publish({
      ...("draft" in result ? { draft: result.draft } : {}),
      ...(result.ok
        ? {
            disk: {
              content: result.draft.content,
              sha256: result.operation.afterSha256,
              byteLength: new TextEncoder().encode(result.draft.content).length,
            },
          }
        : {}),
      interruptedSave: false,
      ...(!result.ok && result.reason === "rejected" ? { autosave: false } : {}),
      conflict,
      error: result.ok
        ? null
        : conflict
          ? "File changed or save history expired. Your draft is preserved; review before saving."
          : "message" in result
            ? result.message
            : `Save did not complete (${result.reason}). Your draft is preserved.`,
    })
    if (result.ok) {
      try {
        onSaved(result.operation)
      } catch {
        publish({ error: "File saved, but undo history could not be recorded." })
      }
    }
    return result.ok
  }
  const syncBuffer = async () => {
    if (blocked) return false
    draftTarget()
    while (pendingUpdate || state.content !== state.draft!.content) {
      pendingUpdate ??= {
        ...draftTarget(),
        expectedRevision: state.draft!.revision,
        content: state.content,
      }
      const draft = await client.update(pendingUpdate)
      pendingUpdate = null
      publish({ draft })
    }
    return true
  }
  const flush = () => enqueue(syncBuffer)
  const applyReplacement = async (request: Replacement, contentBefore: string) => {
    const result = await client.replace({ ...request, leaseToken })
    if (!result.ok) {
      pendingDiscard = null
      throw new Error("The saved file changed. Review it again before discarding your draft.")
    }
    blocked = false
    publish({
      draft: result.draft,
      disk: result.disk,
      content: state.content === contentBefore ? result.draft.content : state.content,
      conflict: result.disk.sha256 !== result.draft.baseSha256,
      error: null,
      autosave: false,
    })
    return result.draft
  }
  const finishDiscard = async () => {
    if (!pendingDiscard) return true
    const pending = pendingDiscard
    const after = await applyReplacement(pending.request, pending.content)
    onDiscarded(pending.before, after)
    pendingDiscard = null
    return true
  }
  const open = () =>
    enqueue(async () => {
      if (state.phase === "ready") return !blocked
      const opened = await client.open(target)
      leaseToken = opened.leaseToken
      blocked = false
      publish({
        phase: "ready",
        content: opened.draft.content,
        draft: opened.draft,
        conflict: opened.conflict,
        disk: null,
        error: null,
        autosaveAllowed: opened.autosaveAllowed === true,
        autosave: false,
      })
      return true
    })
  const save = (
    intent: "save" | "autosave" = "save",
    reviewedDiskSha256?: string,
    generation = editGeneration,
  ) => {
    if (intent === "save") cancelAutosave()
    const eligible = () =>
      intent === "save" ||
      (state.autosave &&
        state.autosaveAllowed &&
        state.phase === "ready" &&
        generation === editGeneration)
    return enqueue(async () => {
      if (!eligible() || blocked || !(await syncBuffer()) || !eligible()) return false
      if (
        reviewedDiskSha256 &&
        (intent !== "save" || state.draft?.pendingSave || state.disk?.sha256 !== reviewedDiskSha256)
      )
        return false
      if (state.conflict && !reviewedDiskSha256) return false
      if (!reviewedDiskSha256 && state.disk?.content === state.content) return true
      pendingSave = {
        ...draftTarget(),
        id: crypto.randomUUID(),
        expectedRevision: state.draft!.revision,
        intent,
        ...(reviewedDiskSha256 ? { reviewedDiskSha256 } : {}),
      }
      publish({ interruptedSave: true })
      return applySave(await client.save(pendingSave))
    })
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    open,
    setContent: (content: string) => {
      if (state.phase !== "ready") return false
      if (content === state.content) return true
      if (
        content.includes("\0") ||
        /[\uD800-\uDFFF]/u.test(content) ||
        content.length > workspaceEditMaxBytes ||
        new TextEncoder().encode(content).length > workspaceEditMaxBytes
      ) {
        publish({
          error:
            "Text must be UTF-8 without NUL bytes and no larger than 2 MiB. The previous draft is preserved.",
        })
        return false
      }
      publish({ content, ...(!blocked && !state.conflict ? { error: null } : {}) })
      cancelAutosave()
      if (!blocked) void flush()
      if (state.autosave && state.autosaveAllowed && !blocked && !state.conflict) {
        const generation = editGeneration
        autosaveTimer = setTimeout(() => {
          autosaveTimer = undefined
          void save("autosave", undefined, generation)
        }, 750)
      }
      return true
    },
    flush,
    save,
    restoreDiscard: async (restore: Opened["draft"], expected: Opened["draft"]) => {
      let restored: Opened["draft"] | null = null
      const success = await enqueue(async () => {
        const refuse = (error: string) => {
          publish({ error })
          return false
        }
        if (
          pendingRestore &&
          (pendingRestore.expected !== expected || pendingRestore.restore !== restore)
        )
          return refuse("Retry the pending Undo or Redo before reversing another draft action.")
        const revision = pendingRestore?.request.expectedRevision ?? state.draft?.revision
        const alreadyApplied =
          pendingRestore &&
          state.draft?.revision === pendingRestore.request.expectedRevision + 1 &&
          state.content === restore.content &&
          state.draft.content === restore.content &&
          state.draft.baseSha256 === restore.baseSha256
        if (
          pendingSave ||
          pendingDiscard ||
          pendingUpdate ||
          state.phase !== "ready" ||
          state.draft?.id !== expected.id ||
          (!alreadyApplied &&
            (state.content !== expected.content ||
              state.draft.content !== expected.content ||
              state.draft.baseSha256 !== expected.baseSha256 ||
              state.draft.revision !== revision))
        )
          return refuse(
            "Later draft edits are preserved. Restore the prior text before reversing the discard; changed saved-file bases require a new recovery action.",
          )
        if (blocked && !pendingRestore)
          return refuse("Retry the pending draft operation before reversing the discard.")
        cancelAutosave()
        pendingRestore ??= {
          expected,
          restore,
          request: {
            ...draftTarget(),
            expectedRevision: state.draft.revision,
            replacement: {
              kind: "restore",
              content: restore.content,
              baseSha256: restore.baseSha256,
            },
          },
        }
        restored = await applyReplacement(pendingRestore.request, state.content)
        pendingRestore = null
        return true
      })
      if (!success || !restored)
        throw new Error(state.error ?? "Draft reversal failed. Retry Undo or Redo.")
      return restored
    },
    discard: (reviewedDiskSha256: string) => {
      cancelAutosave()
      return enqueue(async () => {
        if (blocked || pendingSave || pendingDiscard || !(await syncBuffer())) return false
        if (!state.disk || state.disk.sha256 !== reviewedDiskSha256) return false
        pendingDiscard = {
          request: {
            ...draftTarget(),
            expectedRevision: state.draft!.revision,
            replacement: { kind: "discard", reviewedDiskSha256 },
          },
          before: state.draft!,
          content: state.content,
          discardedContent: state.disk.content,
        }
        return finishDiscard()
      })
    },
    setAutosave: (enabled: boolean) => {
      if (state.phase !== "ready" || (enabled && !state.autosaveAllowed)) return false
      cancelAutosave()
      publish({ autosave: enabled })
      // Opting in never writes a recovered/existing buffer; only later typing arms it.
      return true
    },
    retry: () =>
      enqueue(async () => {
        if (state.phase !== "ready") return false
        if (pendingRestore) {
          publish({ error: "Retry Undo or Redo to finish the pending draft reversal." })
          return false
        }
        blocked = false
        publish({ error: null })
        if (pendingDiscard) await finishDiscard()
        const saved = pendingSave ? applySave(await client.save(pendingSave)) : true
        const synced = await syncBuffer()
        return saved && synced
      }),
    reopen: () => {
      cancelAutosave()
      return enqueue(async () => {
        const previous = state.draft
        const opened = await client.open({
          ...target,
          ...(previous
            ? {
                recovery: {
                  draftId: previous.id,
                  leaseToken,
                  content: previous.content,
                  ...(pendingUpdate ? { pendingUpdateContent: pendingUpdate.content } : {}),
                  ...(pendingDiscard
                    ? { pendingUpdateContent: pendingDiscard.discardedContent }
                    : {}),
                  ...(pendingRestore
                    ? { pendingUpdateContent: pendingRestore.restore.content }
                    : {}),
                },
              }
            : {}),
        })
        const localChanged = !!pendingUpdate || (!!previous && state.content !== previous.content)
        leaseToken = opened.leaseToken
        // Retrying ownership changes only the token, never an uncertain save's identity/revision.
        if (pendingUpdate) pendingUpdate = { ...pendingUpdate, leaseToken }
        if (pendingSave) pendingSave = { ...pendingSave, leaseToken }
        blocked = false
        publish({
          phase: "ready",
          content: localChanged ? state.content : opened.draft.content,
          draft: opened.draft,
          disk: null,
          conflict: opened.conflict,
          error: null,
          autosave: false,
          autosaveAllowed: opened.autosaveAllowed === true,
        })
        if (pendingRestore) {
          blocked = true
          publish({ error: "Retry Undo or Redo to finish the pending draft reversal." })
          return false
        }
        const saved = pendingSave ? applySave(await client.save(pendingSave)) : true
        if (pendingDiscard) await finishDiscard()
        return (await syncBuffer()) && saved
      })
    },
    refreshDisk: () =>
      enqueue(async () => {
        if (!state.draft) return false
        try {
          const disk = await client.read(target)
          publish({
            disk,
            conflict:
              state.conflict || !!state.draft.pendingSave || disk.sha256 !== state.draft.baseSha256,
          })
          return true
        } catch (error) {
          publish({
            conflict: true,
            disk: null,
            error:
              error instanceof Error ? error.message : "File unavailable. Your draft is preserved.",
          })
          return false
        }
      }),
    releaseLeasePreservingText: () => {
      cancelAutosave()
      return enqueue(async () => {
        await client.release(draftTarget())
        blocked = true
        publish({
          autosave: false,
          error:
            "The editor lease was released. Local text is retained; reacquire the editor to continue.",
        })
        return true
      })
    },
    release: (isIdle: () => boolean = () => true) => {
      if (isIdle()) cancelAutosave()
      return enqueue(async () => {
        if (state.phase !== "ready") return false
        if (!(await syncBuffer()) || !isIdle()) return false
        const input = draftTarget()
        publish({ phase: "closed" })
        await client.release(input)
        return true
      })
    },
    hasUnpersistedText: () =>
      !!pendingRestore ||
      !!pendingDiscard ||
      !!pendingUpdate ||
      (!!state.draft && state.content !== state.draft.content),
    needsRetry: () => blocked,
  }
}
