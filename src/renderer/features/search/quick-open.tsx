import { useCallback, useMemo, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai"
import { toast } from "sonner"
import { CHAT_WORKBENCH_SELECT_CHAT_EVENT } from "../../../shared/chat-workbench-navigation"
import { trpc } from "../../lib/trpc"
import {
  agentsSettingsDialogActiveTabAtom,
  devToolsUnlockedAtom,
  chatSourceModeAtom,
  settingsSearchTargetAtom,
} from "../../lib/atoms"
import {
  desktopViewAtom,
  fileSearchDialogOpenAtom,
  fileViewerOpenAtomFamily,
  selectedAgentChatIdAtom,
  openAgentChatIdsAtom,
  selectedChatIsRemoteAtom,
  selectedProjectAtom,
  selectedDraftIdAtom,
  selectedChatScopeAtom,
  showNewChatFormAtom,
} from "../agents/atoms"
import {
  executeAgentAction,
  getAvailableAgentActions,
  type AgentActionContext,
} from "../agents/lib/agents-actions"
import { FileSearchDialog, type QuickOpenItem } from "../file-viewer/components/file-search-dialog"
import { searchSettings } from "../settings/settings-search"
import { getVisibleSettingsTabs } from "../settings/settings-visibility"
import { useBetaFeatures } from "../settings/use-beta-features"

export function QuickOpen({ actions }: { actions: AgentActionContext }) {
  const [open, setOpen] = useAtom(fileSearchDialogOpenAtom)
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom)
  const remote = useAtomValue(selectedChatIsRemoteAtom)
  const developer = useAtomValue(devToolsUnlockedAtom)
  const store = useStore()
  const utils = trpc.useUtils()
  const navigationRequest = useRef(0)
  const pendingChatId = useRef<string | null>(null)
  const changeOpen = useCallback(
    (value: boolean) => {
      if (!value) {
        navigationRequest.current++
        pendingChatId.current = null
      }
      setOpen(value)
    },
    [setOpen],
  )
  const setView = useSetAtom(desktopViewAtom)
  const beta = useBetaFeatures()
  const projects = trpc.projects.list.useQuery(undefined, { enabled: open })
  const chats = trpc.chats.list.useQuery({}, { enabled: open })
  const current = trpc.chats.get.useQuery(
    { id: selectedChatId ?? "" },
    { enabled: open && Boolean(selectedChatId) && !remote },
  )
  const projectPath =
    !remote && current.data?.id === selectedChatId ? (current.data.worktreePath ?? "") : ""
  const projectNames = useMemo(
    () => new Map(projects.data?.map((project) => [project.id, project.name])),
    [projects.data],
  )
  const navigateChat = useCallback(
    async (chat: NonNullable<typeof chats.data>[number]) => {
      const request = ++navigationRequest.current
      pendingChatId.current = chat.id
      const destination = await utils.chats.get.fetch({ id: chat.id }).catch(() => null)
      if (request !== navigationRequest.current) return false
      if (!destination || destination.archivedAt) {
        toast.error("This chat is no longer available. Refresh the results and try again.")
        void chats.refetch()
        return false
      }
      // Use the same ownership handshake as the sidebar before changing selection.
      if (window.desktopApi?.claimChat) {
        const result = await window.desktopApi.claimChat(chat.id).catch(() => null)
        if (request !== navigationRequest.current) {
          if (
            result?.ok &&
            pendingChatId.current !== chat.id &&
            store.get(selectedAgentChatIdAtom) !== chat.id &&
            !store.get(openAgentChatIdsAtom).includes(chat.id)
          ) {
            await window.desktopApi.releaseChat(chat.id).catch(() => {})
          }
          return false
        }
        if (!result) {
          toast.error("This chat could not be opened. Try again.")
          return false
        }
        if (!result.ok) {
          toast.info("This chat is already open in another window")
          await window.desktopApi.focusChatOwner(chat.id).catch(() => {})
          return false
        }
      }
      const project = destination.project
      store.set(
        selectedProjectAtom,
        project
          ? {
              ...project,
              gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
            }
          : null,
      )
      store.set(
        selectedChatScopeAtom,
        destination.taskId && destination.projectId
          ? {
              type: "task",
              id: destination.taskId,
              name: "Task",
              projectId: destination.projectId,
              projectName: project?.name ?? null,
            }
          : destination.projectId
            ? {
                type: "project",
                id: destination.projectId,
                name: project?.name ?? "Project",
              }
            : { type: "global", id: "global", name: "Global chats" },
      )
      window.dispatchEvent(
        new CustomEvent(CHAT_WORKBENCH_SELECT_CHAT_EVENT, { detail: { chatId: chat.id } }),
      )
      store.set(selectedChatIsRemoteAtom, false)
      store.set(chatSourceModeAtom, "local")
      store.set(selectedDraftIdAtom, null)
      store.set(showNewChatFormAtom, false)
      store.set(selectedAgentChatIdAtom, chat.id)
      setView(null)
      pendingChatId.current = null
      return true
    },
    [utils, chats.refetch, store, setView],
  )
  const getNavigationItems = useCallback(
    (query: string): QuickOpenItem[] => {
      const term = query.trim().toLowerCase()
      const matches = (...values: Array<string | null | undefined>) =>
        !term || values.some((value) => value?.toLowerCase().includes(term))
      const items: QuickOpenItem[] = []
      for (const chat of chats.data ?? []) {
        const project =
          projectNames.get(chat.projectId ?? "") ??
          (chat.projectId ? "Project chat" : "Global chat")
        if (matches(chat.name, project))
          items.push({
            id: `chat:${chat.id}`,
            label: chat.name || "Untitled chat",
            context: project,
            kind: "Chat",
            onSelect: () => navigateChat(chat),
          })
        if (chat.worktreePath && matches(chat.worktreePath, chat.name))
          items.push({
            id: `worktree:${chat.id}`,
            label: chat.name || "Untitled chat",
            context: `Open chat · ${chat.worktreePath}`,
            kind: "Worktree",
            onSelect: () => navigateChat(chat),
          })
      }
      for (const project of projects.data ?? [])
        if (matches(project.name, project.path))
          items.push({
            id: `project:${project.id}`,
            label: project.name,
            context: project.path,
            kind: "Project",
            onSelect: () => {
              store.set(selectedProjectAtom, {
                ...project,
                gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
              })
              store.set(selectedChatScopeAtom, {
                type: "project",
                id: project.id,
                name: project.name,
              })
              store.set(selectedChatIsRemoteAtom, false)
              store.set(chatSourceModeAtom, "local")
              store.set(selectedAgentChatIdAtom, null)
              store.set(selectedDraftIdAtom, null)
              store.set(showNewChatFormAtom, true)
              setView(null)
            },
          })
      const options = { showDevelopment: import.meta.env.DEV || developer, betaFeatures: beta }
      const settings = term
        ? searchSettings(query, options)
        : [
            ...getVisibleSettingsTabs("main", options),
            ...getVisibleSettingsTabs("advanced", options),
          ].map((tab) => ({
            id: `settings-page-${tab.id}`,
            label: tab.label,
            tab: tab.id,
            targetId: `settings-tab-${tab.id}`,
          }))
      for (const entry of settings)
        items.push({
          id: `settings:${entry.id}`,
          label: entry.label,
          context: "Settings",
          kind: "Settings",
          onSelect: () => {
            store.set(agentsSettingsDialogActiveTabAtom, entry.tab)
            store.set(settingsSearchTargetAtom, entry.targetId)
            setView("settings")
          },
        })
      for (const action of getAvailableAgentActions(actions)) {
        if (
          action.id === "file-search" ||
          ((action.id === "open-automations" || action.id === "open-inbox") && !beta.automations)
        )
          continue
        if (matches(action.label, action.description))
          items.push({
            id: `command:${action.id}`,
            label: action.label,
            context: "Command",
            kind: "Command",
            onSelect: () => {
              void executeAgentAction(action.id, actions, "ui_button").then((result) => {
                if (!result.success) toast.error(result.error || "Command could not run")
              })
            },
          })
      }
      return items.map((item) => ({
        ...item,
        onSelect: () => {
          navigationRequest.current++
          pendingChatId.current = null
          return item.onSelect()
        },
      }))
    },
    [
      chats.data,
      projects.data,
      projectNames,
      navigateChat,
      store,
      setView,
      developer,
      beta,
      actions,
    ],
  )
  const failures = [
    { label: "Chats", query: chats },
    { label: "Projects", query: projects },
    ...(selectedChatId && !remote ? [{ label: "Current workspace", query: current }] : []),
  ].flatMap(({ label, query }) =>
    query.error
      ? [
          {
            label,
            message: query.error.message,
            retry: () => {
              void query.refetch()
            },
          },
        ]
      : [],
  )
  return (
    <FileSearchDialog
      open={open}
      onOpenChange={changeOpen}
      projectPath={projectPath}
      onSelectFile={(path) => {
        navigationRequest.current++
        pendingChatId.current = null
        if (!selectedChatId || remote || !projectPath) return
        store.set(fileViewerOpenAtomFamily(selectedChatId), path)
        setView(null)
      }}
      getNavigationItems={getNavigationItems}
      navigationBusy={open && (chats.isLoading || projects.isLoading)}
      providerErrors={failures}
    />
  )
}
