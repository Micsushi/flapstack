import { useEffect, useRef } from "react"

export function useProjectSelectionGuard(
  projectId: string | null,
  selectedChatId: string | null,
  selectedChatIsRemote: boolean,
  localChats: readonly { id: string; projectId: string | null }[] | undefined,
  clearSelection: () => void,
) {
  const previousProjectId = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const previous = previousProjectId.current
    previousProjectId.current = projectId
    if (previous == null || previous === projectId || !selectedChatId) return
    // An explicit cross-project chat selection already belongs to the new project.
    if (
      !selectedChatIsRemote &&
      projectId &&
      localChats?.some((chat) => chat.id === selectedChatId && chat.projectId === projectId)
    )
      return
    clearSelection()
  }, [projectId, selectedChatId, selectedChatIsRemote, localChats, clearSelection])
}
