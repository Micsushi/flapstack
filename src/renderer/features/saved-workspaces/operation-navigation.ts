import { writeSavedWorkspaceSelection } from "./selection-storage"

export async function openOperationWorkspace(input: {
  projectId: string
  taskId: string
  fetchWorkspace: (input: { taskId: string }) => Promise<{ workspaceId: string } | null>
  showSavedWorkspaces: () => void
}): Promise<boolean> {
  const workspace = await input.fetchWorkspace({ taskId: input.taskId })
  if (!workspace) return false
  writeSavedWorkspaceSelection(input.projectId, workspace.workspaceId)
  input.showSavedWorkspaces()
  return true
}
