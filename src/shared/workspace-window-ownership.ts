export type WorkspacePaneWindowTarget = {
  workspaceId: string
  paneId: string
  projectId?: string
  chatIds: string[]
}

export type WorkspaceWindowOpenTarget = {
  workspaceId: string
  projectId?: string
  panes: Array<{ paneId: string; chatIds: string[] }>
}

export type WorkspaceOwnershipConflict = {
  kind: "workspace-pane" | "chat"
  chatId?: string
  ownerStableId: string
}

export type WorkspacePaneClaimResult =
  | {
      ok: true
      state: "claimed" | "moved"
      ownerStableId: string
    }
  | {
      ok: false
      ownerStableId: string
      conflicts: WorkspaceOwnershipConflict[]
    }

export type WorkspacePaneOpenResult =
  | {
      ok: true
      state: "opened" | "focused"
      ownerStableId: string
    }
  | {
      ok: false
      ownerStableId: string
      conflicts: WorkspaceOwnershipConflict[]
      reason?: "recovering"
    }

export type WorkspaceOwnershipInvalidation = {
  revision: number
  reason: "claim" | "move" | "release" | "close" | "pull-back"
  workspaceId?: string
  paneId?: string
  chatIds: string[]
  sourceStableId?: string
  targetStableId?: string
}

export type WorkspaceWindowInitialParams = {
  projectId?: string
  workspaceId?: string
  paneId?: string
  skipPaneId?: string
}
