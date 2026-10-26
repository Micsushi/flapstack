import { useCallback, useEffect, useRef } from "react"
import { useStore } from "jotai"
import { trpc } from "../../lib/trpc"
import { chatSourceModeAtom } from "../../lib/atoms"
import {
  desktopViewAtom,
  automationDetailIdAtom,
  agentsMobileViewModeAtom,
  openAgentChatIdsAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedChatScopeAtom,
  selectedProjectAtom,
  selectedDraftIdAtom,
  showNewChatFormAtom,
} from "../agents/atoms"
import { detailsSidebarOpenAtom, detailsSidebarTabAtom } from "../details-sidebar/atoms"
import { automationEvidenceRunIdAtom } from "./state"

export function useAutomationEvidenceNavigation(onCancel: () => void) {
  const store = useStore()
  const utils = trpc.useUtils()
  const generation = useRef(0)
  const cancelNavigation = useCallback(() => {
    generation.current++
    onCancel()
  }, [onCancel])
  useEffect(() => {
    const unsubscribe = [
      desktopViewAtom,
      automationDetailIdAtom,
      selectedProjectAtom,
      selectedAgentChatIdAtom,
      selectedChatScopeAtom,
      chatSourceModeAtom,
      selectedChatIsRemoteAtom,
      showNewChatFormAtom,
      selectedDraftIdAtom,
      agentsMobileViewModeAtom,
    ].map((atom) => store.sub(atom, cancelNavigation))
    return () => {
      generation.current++
      unsubscribe.forEach((stop) => stop())
    }
  }, [store, cancelNavigation])

  // Begin before the inbox's read write so its completion cannot reopen a departed view.
  const beginNavigation = () => {
    const request = ++generation.current
    return () => request === generation.current
  }

  const navigate = async (
    item: { chatId: string | null; runId: string | null },
    isCurrent: () => boolean,
  ) => {
    if (!item.chatId) throw new Error("This execution has no chat evidence to open.")
    const [chat, runs] = await Promise.all([
      utils.chats.get.fetch({ id: item.chatId }, { staleTime: 0 }),
      item.runId
        ? utils.runs.listByChat.fetch({ chatId: item.chatId }, { staleTime: 0 })
        : Promise.resolve([]),
    ])
    if (!isCurrent()) return
    if (!chat || chat.id !== item.chatId) throw new Error("The evidence chat no longer exists.")
    if (item.runId && !runs.some((run) => run.id === item.runId && run.chatId === chat.id)) {
      throw new Error("The requested run no longer exists in this chat.")
    }
    const project = chat.project
    const task = chat.taskId
      ? await utils.tasks.get.fetch({ id: chat.taskId }, { staleTime: 0 })
      : null
    if (!isCurrent()) return
    if (
      !["global", "project", "task"].includes(chat.scope) ||
      (chat.scope === "global" && (chat.projectId || chat.taskId)) ||
      (chat.scope !== "global" && (!project || project.id !== chat.projectId)) ||
      (chat.taskId && (!task || task.id !== chat.taskId || task.projectId !== chat.projectId)) ||
      (chat.scope === "task" && !task)
    ) {
      throw new Error(
        "The evidence chat's project or task is no longer available. Refresh and retry.",
      )
    }
    // Execution records can retain older scope metadata after a chat moves.
    store.set(
      selectedProjectAtom,
      project
        ? {
            ...project,
            gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
          }
        : null,
    )
    if (task) {
      store.set(selectedChatScopeAtom, {
        type: "task",
        id: task.id,
        name: task.name,
        projectId: task.projectId,
        projectName: project!.name,
      })
    } else if (project) {
      store.set(selectedChatScopeAtom, { type: "project", id: project.id, name: project.name })
    } else {
      store.set(selectedChatScopeAtom, { type: "global", id: "global", name: "Global chats" })
    }
    store.set(selectedAgentChatIdAtom, chat.id)
    store.set(openAgentChatIdsAtom, (current) =>
      current.includes(chat.id) ? current : [...current, chat.id],
    )
    store.set(selectedChatIsRemoteAtom, false)
    store.set(chatSourceModeAtom, "local")
    store.set(showNewChatFormAtom, false)
    store.set(selectedDraftIdAtom, null)
    store.set(agentsMobileViewModeAtom, "chat")
    store.set(detailsSidebarOpenAtom, true)
    store.set(detailsSidebarTabAtom, "details")
    store.set(automationEvidenceRunIdAtom, item.runId)
    store.set(desktopViewAtom, null)
  }
  return { beginNavigation, cancelNavigation, navigate }
}
