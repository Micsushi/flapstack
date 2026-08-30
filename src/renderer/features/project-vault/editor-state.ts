import { atom } from "jotai"

export type VaultDocumentSnapshot = {
  version: number
  content: string
  contentHash: string
  currentContentHash: string
  externallyModified: boolean
}

export type VaultEditorState = {
  base: VaultDocumentSnapshot
  draft: string
  conflict: VaultDocumentSnapshot | null
  revision: number
}

export function createVaultEditorState(snapshot: VaultDocumentSnapshot): VaultEditorState {
  return { base: snapshot, draft: snapshot.content, conflict: null, revision: 0 }
}

export function createVaultConflictCopyPath(relativePath: string): string {
  return relativePath.toLocaleLowerCase("en-US").endsWith(".md")
    ? `${relativePath.slice(0, -3)} (local copy).md`
    : `${relativePath} (local copy).md`
}

export function updateVaultEditorDraft(state: VaultEditorState, draft: string): VaultEditorState {
  return { ...state, draft, revision: state.revision + 1 }
}

export function markVaultEditorConflict(
  state: VaultEditorState,
  current: VaultDocumentSnapshot,
): VaultEditorState {
  return { ...state, conflict: current }
}

export function applyVaultEditorExternalSnapshot(
  state: VaultEditorState | undefined,
  current: VaultDocumentSnapshot,
): VaultEditorState {
  if (!state) return createVaultEditorState(current)
  const changed =
    current.version !== state.base.version ||
    current.contentHash !== state.base.contentHash ||
    current.currentContentHash !== state.base.currentContentHash ||
    current.externallyModified !== state.base.externallyModified
  if (!changed) return state
  if (hasVaultEditorChanges(state) || state.conflict) {
    if (
      state.conflict?.version === current.version &&
      state.conflict.currentContentHash === current.currentContentHash
    ) {
      return state
    }
    return markVaultEditorConflict(state, current)
  }
  return createVaultEditorState(current)
}

export function hasVaultEditorChanges(state: VaultEditorState): boolean {
  return state.draft !== state.base.content
}

export type VaultEditorCache = Record<
  string,
  Record<string, VaultEditorState | undefined> | undefined
>

export const projectVaultCustomNoteEditorCacheAtom = atom<VaultEditorCache>({})

export function hasUnsavedVaultDrafts(cache: VaultEditorCache): boolean {
  return Object.values(cache).some((projectEditors) =>
    Object.values(projectEditors ?? {}).some((state) => !!state && hasVaultEditorChanges(state)),
  )
}

export function protectUnsavedVaultDraftsBeforeUnload(
  event: Pick<BeforeUnloadEvent, "preventDefault" | "returnValue">,
  cache: VaultEditorCache,
): boolean {
  if (!hasUnsavedVaultDrafts(cache)) return false
  event.preventDefault()
  event.returnValue = ""
  return true
}

export function rebaseVaultEditorAfterSave(
  state: VaultEditorState,
  saved: VaultDocumentSnapshot,
  submittedRevision: number,
): VaultEditorState {
  if (state.revision === submittedRevision) return createVaultEditorState(saved)
  return {
    base: saved,
    draft: state.draft,
    conflict: null,
    revision: state.revision,
  }
}
