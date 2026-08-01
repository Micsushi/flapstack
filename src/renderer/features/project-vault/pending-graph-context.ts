export type PendingProjectVaultGraphSelection = {
  nodeIds: string[]
  expectedGenerationId: string
  expansion?: {
    depth: number
    direction: "outgoing" | "incoming" | "both"
    maxNodes: number
  }
}

const pendingByProject = new Map<string, PendingProjectVaultGraphSelection>()

export function stageProjectVaultGraphSelection(
  projectId: string,
  selection: PendingProjectVaultGraphSelection,
): void {
  pendingByProject.set(projectId, structuredClone(selection))
}

export function readProjectVaultGraphSelection(
  projectId: string | undefined,
): PendingProjectVaultGraphSelection | undefined {
  if (!projectId) return undefined
  const selection = pendingByProject.get(projectId)
  return selection ? structuredClone(selection) : undefined
}

export function clearProjectVaultGraphSelection(projectId: string | undefined): void {
  if (projectId) pendingByProject.delete(projectId)
}
