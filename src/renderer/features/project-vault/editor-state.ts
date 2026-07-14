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
}

export function createVaultEditorState(snapshot: VaultDocumentSnapshot): VaultEditorState {
  return { base: snapshot, draft: snapshot.content, conflict: null }
}

export function updateVaultEditorDraft(state: VaultEditorState, draft: string): VaultEditorState {
  return { ...state, draft }
}

export function markVaultEditorConflict(
  state: VaultEditorState,
  current: VaultDocumentSnapshot,
): VaultEditorState {
  return { ...state, conflict: current }
}

export function hasVaultEditorChanges(state: VaultEditorState): boolean {
  return state.draft !== state.base.content
}
