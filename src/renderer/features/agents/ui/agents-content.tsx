"use client"

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
// import { useSearchParams, useRouter } from "next/navigation" // Desktop doesn't use next/navigation
// Desktop: mock Next.js navigation hooks
const useSearchParams = () => ({ get: (_key: string) => null })
const useRouter = () => ({
  push: (_url: string, _options?: unknown) => {},
  replace: (_url: string, _options?: unknown) => {},
})
// Desktop: mock Clerk hooks
const useUser = () => ({ user: null })
const useClerk = () => ({ signOut: (_options?: unknown) => {} })
import {
  openAgentChatIdsAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  previousAgentChatIdAtom,
  selectedDraftIdAtom,
  newChatFormSessionAtom,
  showNewChatFormAtom,
  agentsMobileViewModeAtom,
  agentsPreviewSidebarOpenAtom,
  agentsSidebarOpenAtom,
  agentsUnseenChangesAtom,
  selectedChatScopeAtom,
  agentsSubChatsSidebarModeAtom,
  agentsSubChatsSidebarWidthAtom,
  desktopViewAtom,
  lastMessagedProjectIdAtom,
  selectedProjectAtom,
  SUBCHATS_SIDEBAR_PANEL_ENABLED,
  pendingUserQuestionsAtom,
} from "../atoms"
import {
  selectedTeamIdAtom,
  billingMethodAtom,
  anthropicOnboardingCompletedAtom,
  apiKeyOnboardingCompletedAtom,
  codexOnboardingCompletedAtom,
  agentsQuickSwitchOpenAtom,
  agentsQuickSwitchSelectedIndexAtom,
  subChatsQuickSwitchOpenAtom,
  subChatsQuickSwitchSelectedIndexAtom,
  type CtrlTabTarget,
  getReleasedCtrlTabTarget,
  groupCloseBehaviorAtom,
  chatSourceModeAtom,
  type GroupCloseBehavior,
} from "../../../lib/atoms"
import { NewChatForm } from "../main/new-chat-form"
import { ChatView } from "../main/active-chat"
import { api } from "../../../lib/mock-api"
import { trpc } from "../../../lib/trpc"
import { useIsMobile } from "../../../lib/hooks/use-mobile"
import { useDocumentVisible } from "../../../hooks/use-document-visible"
import { AgentsSidebar } from "../../sidebar/agents-sidebar"
import { AgentsSubChatsSidebar } from "../../sidebar/agents-subchats-sidebar"
import { terminalSidebarOpenAtomFamily } from "../../terminal/atoms"
import { getTerminalScopeKey } from "../../terminal/utils"
import { useAgentSubChatStore, type SubChatMeta } from "../stores/sub-chat-store"
import { useShallow } from "zustand/react/shallow"
import { motion, AnimatePresence } from "motion/react"
// import { ResizableSidebar } from "@/app/(alpha)/canvas/[id]/{components}/resizable-sidebar"
import { ResizableSidebar } from "../../../components/ui/resizable-sidebar"
// import { useClerk, useUser } from "@clerk/nextjs"
// import { useCombinedAuth } from "@/lib/hooks/use-combined-auth"
const useCombinedAuth = () => ({ userId: null }) // Desktop mock
import { Button } from "../../../components/ui/button"
import { Checkbox } from "../../../components/ui/checkbox"
import { RenameDialog } from "../../../components/rename-dialog"
import { AlignJustify, MessageSquare, PanelsTopLeft, Plus, SquareTerminal, X } from "lucide-react"
import { AgentsQuickSwitchDialog } from "../components/agents-quick-switch-dialog"
import { SubChatsQuickSwitchDialog } from "../components/subchats-quick-switch-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../../components/ui/context-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog"
import { resolveOpenChatTabUnderlineColor, resolveVisibleOpenChatTabs } from "../lib/open-chat-tabs"
import { configureChatDragFeedback, shouldPopOutChatDrag } from "../lib/chat-drag-feedback"
import { markChatSeen } from "../lib/chat-unseen-state"
import {
  resolveTopNavigationDropIntent,
  resolveTopNavigationReorderIntent,
  type TopNavigationDropIntent,
} from "../lib/top-navigation-drag"
import { DictationSessionProvider } from "../voice/dictation-session"
import { reconcileLiveAgentInputs } from "../lib/agent-input-transport"
import { appStore } from "../../../lib/jotai-store"
import { useDesktopNotifications } from "../hooks/use-desktop-notifications"
import { getInitialWindowParams, getWindowId } from "../../../contexts/WindowContext"
import { useAutomationInboxNotifications } from "../../automations/use-automation-inbox-notifications"
import { useBetaFeatures } from "../../settings/use-beta-features"
import {
  formatScopeChatTimestamp,
  getScopeChatContext,
  scopeChatTimestampMs,
} from "../lib/scope-chat-card"
import { ChatWorkbench } from "../workbench/chat-workbench"
import {
  loadChatWorkbenchLayout,
  persistChatWorkbenchLayout,
} from "../workbench/chat-workbench-storage"
import {
  createWorkbenchDraftReference,
  createWorkbenchScrollAnchorReference,
  restoreWorkbenchPresentationReferences,
} from "../workbench/chat-workbench-presentation-state"
import {
  closeNewChatDraft,
  emitDraftsChanged,
  openNewChatDraft,
  useNewChatDrafts,
} from "../lib/drafts"
import {
  closeChatsInWorkbench,
  CHAT_WORKBENCH_DRAG_MIME,
  CHAT_WORKBENCH_DRAG_SESSION_KEY,
  CHAT_WORKBENCH_EXTERNAL_GROUP_ID,
  CHAT_WORKBENCH_SIDEBAR_DRAG_END_EVENT,
  CHAT_WORKBENCH_SIDEBAR_DRAG_START_EVENT,
  collectChatGroups,
  createChatWorkbenchLayout,
  getTerminalPresentationChatId,
  isEmptyChatWorkbenchLayout,
  reduceChatWorkbench,
  type ChatWorkbenchAction,
  type ChatWorkbenchLayout,
} from "../../../../shared/chat-workbench"
import { showChatTransferWindowLimitChoice } from "../../../lib/chat-transfer-window-limit"
import { chatWorkbenchToSavedWorkspace } from "../../../../shared/workbench-saved-workspace-adapter"
import {
  activateChatWorkbenchGroup,
  activateChatSelection,
  activateSingleChat,
  appendChatWorkbenchNavigationItem,
  CHAT_WORKBENCH_GROUP_COLORS,
  CHAT_WORKBENCH_NAVIGATION_CHANGE_EVENT,
  CHAT_WORKBENCH_SELECT_CHAT_EVENT,
  chatWorkbenchNavigationStorageKey,
  createChatWorkbenchGroup,
  detachChatFromWorkbenchGroup,
  findLoneChatGroupTransition,
  getGroupedChatIds,
  moveChatToWorkbenchGroup,
  parseChatWorkbenchNavigation,
  reconcileChatWorkbenchNavigation,
  removeChatWorkbenchGroup,
  renameChatWorkbenchGroup,
  reorderChatWorkbenchNavigationItem,
  resolveChatWorkbenchNavigationItems,
  setChatWorkbenchGroupColor,
  type ChatWorkbenchGroupColor,
  type ChatWorkbenchNavigationItem,
  type ChatWorkbenchNavigation,
} from "../../../../shared/chat-workbench-navigation"
import { recordAppAction } from "../../../lib/app-action-history"
import { SelectRepoPage } from "../../onboarding"
import {
  incrementPerformanceCounter,
  measurePerformanceNextFrame,
} from "../../../lib/performance-counters"

type ChatWorkbenchSnapshot = {
  navigation: ChatWorkbenchNavigation
  layout: ChatWorkbenchLayout
  openChatIds: string[]
}

const SettingsContent = lazy(() =>
  import("../../settings/settings-content").then((module) => ({ default: module.SettingsContent })),
)
const AgentsUsageTab = lazy(() =>
  import("../../../components/dialogs/settings-tabs/agents-usage-tab").then((module) => ({
    default: module.AgentsUsageTab,
  })),
)
const KanbanView = lazy(() =>
  import("../../kanban/kanban-view").then((module) => ({ default: module.KanbanView })),
)
const PlanView = lazy(() =>
  import("../../plan/plan-view").then((module) => ({ default: module.PlanView })),
)
const ProjectVaultView = lazy(() =>
  import("../../project-vault/project-vault-view").then((module) => ({
    default: module.ProjectVaultView,
  })),
)
const SavedWorkspacesView = lazy(() =>
  import("../../saved-workspaces/saved-workspaces-view").then((module) => ({
    default: module.SavedWorkspacesView,
  })),
)
const OrchestrationFleetView = lazy(() =>
  import("../../orchestration-fleet/orchestration-fleet-view").then((module) => ({
    default: module.OrchestrationFleetView,
  })),
)
const AutomationsView = lazy(() =>
  import("../../automations/automations-view").then((module) => ({
    default: module.AutomationsView,
  })),
)
const AutomationsDetailView = lazy(() =>
  import("../../automations/automations-detail-view").then((module) => ({
    default: module.AutomationsDetailView,
  })),
)
const InboxView = lazy(() =>
  import("../../automations/inbox-view").then((module) => ({ default: module.InboxView })),
)
const AgentPreview = lazy(() =>
  import("./agent-preview").then((module) => ({ default: module.AgentPreview })),
)
const AgentDiffView = lazy(() =>
  import("./agent-diff-view").then((module) => ({ default: module.AgentDiffView })),
)
const TerminalSidebar = lazy(() =>
  import("../../terminal/terminal-sidebar").then((module) => ({
    default: module.TerminalSidebar,
  })),
)
const WorkbenchTerminalPane = lazy(() =>
  import("../../terminal/workbench-terminal-pane").then((module) => ({
    default: module.WorkbenchTerminalPane,
  })),
)

// Desktop mock
const useIsAdmin = () => false
const TOP_NAVIGATION_ENTER_DELAY_MS = 180
const GROUP_COLOR_SWATCHES: Record<ChatWorkbenchGroupColor, string> = {
  blue: "#3B82F6",
  cyan: "#06B6D4",
  teal: "#14B8A6",
  green: "#22C55E",
  lime: "#84CC16",
  amber: "#F59E0B",
  orange: "#F97316",
  red: "#EF4444",
  pink: "#EC4899",
  violet: "#8B5CF6",
}

function resolveGroupTabBackground(
  color: ChatWorkbenchGroupColor | undefined,
  isActive: boolean,
): string | undefined {
  if (!color) return undefined
  return `color-mix(in srgb, ${GROUP_COLOR_SWATCHES[color]} ${isActive ? 42 : 26}%, hsl(var(--background)))`
}

function resolveGroupTabBorder(
  color: ChatWorkbenchGroupColor | undefined,
  isActive: boolean,
): string | undefined {
  if (!color) return undefined
  return `color-mix(in srgb, ${GROUP_COLOR_SWATCHES[color]} ${isActive ? 72 : 48}%, hsl(var(--border)))`
}

function parseStoredProjectColors(value: string): Record<string, string> {
  try {
    return JSON.parse(value) as Record<string, string>
  } catch {
    return {}
  }
}

function AgentInputPoller() {
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom)
  const { notifyAgentNeedsInput } = useDesktopNotifications()
  const notifiedBackgroundRequestIdsRef = useRef(new Set<string>())
  // Mounted for the window's lifetime, so suspend the poll while hidden and
  // catch up on the transition back to visible.
  const isVisible = useDocumentVisible()
  const { data: liveAgentInputs = [], refetch: refetchAgentInputs } =
    trpc.agentInput.listWithContext.useQuery(undefined, {
      refetchInterval: isVisible ? 1_000 : false,
    })

  useEffect(() => {
    if (isVisible) void refetchAgentInputs()
  }, [isVisible, refetchAgentInputs])

  useEffect(() => {
    const current = appStore.get(pendingUserQuestionsAtom)
    const reconciled = reconcileLiveAgentInputs(current, liveAgentInputs)

    for (const { request, parentChatId } of liveAgentInputs) {
      if (
        parentChatId &&
        parentChatId !== selectedChatId &&
        !notifiedBackgroundRequestIdsRef.current.has(request.requestId)
      ) {
        notifiedBackgroundRequestIdsRef.current.add(request.requestId)
        notifyAgentNeedsInput("", { chatId: parentChatId, subChatId: request.chatId })
      }
    }

    if (reconciled.changed) appStore.set(pendingUserQuestionsAtom, reconciled.pending)
  }, [liveAgentInputs, notifyAgentNeedsInput, selectedChatId])

  return null
}

// Main Component
function AgentsContentInner() {
  const workspaceWindowParams = useMemo(() => getInitialWindowParams(), [])
  const openChatTabsRef = useRef<HTMLDivElement>(null)
  const topNavigationEnteredTargetRef = useRef<string | null>(null)
  const topNavigationPendingTargetRef = useRef<string | null>(null)
  const topNavigationEnterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sidebarChatDragSessionRef = useRef<{
    source: { chatId: string; groupId: string; sourceWindowId: string; projectId?: string }
    screenX: number
    screenY: number
    cancelled: boolean
  } | null>(null)
  const [topNavigationDropTarget, setTopNavigationDropTarget] = useState<{
    item: ChatWorkbenchNavigationItem
    intent: TopNavigationDropIntent
  } | null>(null)
  const [mainBarDropActive, setMainBarDropActive] = useState(false)
  const [openChatTabsHovered, setOpenChatTabsHovered] = useState(false)
  const [openChatScrollbar, setOpenChatScrollbar] = useState({ left: 0, width: 0 })
  const [openChatContextMenuId, setOpenChatContextMenuId] = useState<string | null>(null)
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const [openChatIds, setOpenChatIds] = useAtom(openAgentChatIdsAtom)
  const [unseenChatIds, setUnseenChatIds] = useAtom(agentsUnseenChangesAtom)
  const stableWindowId = useMemo(() => getWindowId(), [])
  const [chatWorkbenchLayout, setChatWorkbenchLayout] = useState(() =>
    loadChatWorkbenchLayout(localStorage, stableWindowId, openChatIds, selectedChatId),
  )
  const workbenchNavigationStorageKey = chatWorkbenchNavigationStorageKey(stableWindowId)
  const [chatWorkbenchNavigation, setChatWorkbenchNavigation] = useState<ChatWorkbenchNavigation>(
    () => parseChatWorkbenchNavigation(localStorage.getItem(workbenchNavigationStorageKey)),
  )
  const [renamingWorkbenchGroup, setRenamingWorkbenchGroup] = useState<{
    id: string
    name: string
  } | null>(null)
  const [loneChatGroupPrompt, setLoneChatGroupPrompt] = useState<{
    groupId: string
    chatId: string
  } | null>(null)
  const [groupClosePromptId, setGroupClosePromptId] = useState<string | null>(null)
  const [rememberGroupCloseChoice, setRememberGroupCloseChoice] = useState(false)
  const chatWorkbenchNavigationRef = useRef(chatWorkbenchNavigation)
  const chatWorkbenchLayoutRef = useRef(chatWorkbenchLayout)
  const chatWorkbenchRevisionRef = useRef(0)
  const chatWorkbenchCompactRef = useRef(false)
  const [editableWorkbenchChatIds, setEditableWorkbenchChatIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const workbenchChatIds = useMemo(
    () =>
      isEmptyChatWorkbenchLayout(chatWorkbenchLayout)
        ? []
        : [
            ...new Set(
              collectChatGroups(chatWorkbenchLayout.root)
                .flatMap((group) => group.chatIds)
                .map(
                  (presentationId) =>
                    getTerminalPresentationChatId(presentationId) ?? presentationId,
                ),
            ),
          ],
    [chatWorkbenchLayout],
  )
  const readOnlyWorkbenchChatIds = useMemo(
    () => new Set(workbenchChatIds.filter((chatId) => !editableWorkbenchChatIds.has(chatId))),
    [editableWorkbenchChatIds, workbenchChatIds],
  )
  const [desktopView, setDesktopView] = useAtom(desktopViewAtom)
  const betaFeatures = useBetaFeatures()
  const effectiveDesktopView =
    (desktopView === "orchestration-fleet" && !betaFeatures.orchestration) ||
    ((desktopView === "automations" ||
      desktopView === "automations-detail" ||
      desktopView === "inbox") &&
      !betaFeatures.automations) ||
    ((desktopView === "tasks" || desktopView === "plan") && !betaFeatures.planning) ||
    (desktopView === "project-vault" && !betaFeatures.projectMemory) ||
    (desktopView === "saved-workspaces" && !betaFeatures.savedWorkspaces)
      ? null
      : desktopView
  const [selectedChatIsRemote, setSelectedChatIsRemote] = useAtom(selectedChatIsRemoteAtom)
  const [selectedChatScope, setSelectedChatScope] = useAtom(selectedChatScopeAtom)
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const lastMessagedProjectId = useAtomValue(lastMessagedProjectIdAtom)
  const [groupCloseBehavior, setGroupCloseBehavior] = useAtom(groupCloseBehaviorAtom)
  const createSavedWorkspace = trpc.savedWorkspaces.create.useMutation()
  const setChatSourceMode = useSetAtom(chatSourceModeAtom)
  const chatSourceMode = useAtomValue(chatSourceModeAtom)
  const [selectedDraftId, setSelectedDraftId] = useAtom(selectedDraftIdAtom)
  const [showNewChatForm, setShowNewChatForm] = useAtom(showNewChatFormAtom)
  const [newChatFormSession, setNewChatFormSession] = useAtom(newChatFormSessionAtom)
  const drafts = useNewChatDrafts()
  const openNewChatDrafts = useMemo(
    () => drafts.filter((draft) => draft.isOpen !== false),
    [drafts],
  )
  const [activeNewChatDraftId, setActiveNewChatDraftId] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedChatId) return
    incrementPerformanceCounter("chat-switch")
    measurePerformanceNextFrame("chat-switch")
    setSelectedDraftId(null)
    setShowNewChatForm(false)
    setActiveNewChatDraftId(null)
  }, [selectedChatId, setSelectedDraftId, setShowNewChatForm])
  const [selectedTeamId] = useAtom(selectedTeamIdAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const setApiKeyOnboardingCompleted = useSetAtom(apiKeyOnboardingCompletedAtom)
  const setCodexOnboardingCompleted = useSetAtom(codexOnboardingCompletedAtom)
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [previewSidebarOpen, setPreviewSidebarOpen] = useAtom(agentsPreviewSidebarOpenAtom)
  const [mobileViewMode, setMobileViewMode] = useAtom(agentsMobileViewModeAtom)
  const [subChatsSidebarMode, setSubChatsSidebarMode] = useAtom(agentsSubChatsSidebarModeAtom)
  const effectiveSubChatsSidebarMode = SUBCHATS_SIDEBAR_PANEL_ENABLED ? subChatsSidebarMode : "tabs"
  // Chats pane is hidden for now: coerce any persisted "sidebar" preference back
  // to tabs so sub-chat switching keeps working via the top tabs.
  useEffect(() => {
    if (!SUBCHATS_SIDEBAR_PANEL_ENABLED && subChatsSidebarMode === "sidebar") {
      setSubChatsSidebarMode("tabs")
    }
  }, [subChatsSidebarMode, setSubChatsSidebarMode])
  // Per-chat terminal sidebar state
  const terminalSidebarAtom = useMemo(
    () => terminalSidebarOpenAtomFamily(selectedChatId || ""),
    [selectedChatId],
  )
  const setTerminalSidebarOpen = useSetAtom(terminalSidebarAtom)

  const hasOpenedSubChatsSidebar = useRef(false)
  const wasSubChatsSidebarOpen = useRef(false)
  const [shouldAnimateSubChatsSidebar, setShouldAnimateSubChatsSidebar] = useState(
    effectiveSubChatsSidebarMode !== "sidebar",
  )
  const searchParams = useSearchParams()
  const router = useRouter()
  const isInitialized = useRef(false)
  const isFirstRenderRef = useRef(true) // Skip URL sync on first render to avoid race condition
  const isNavigatingRef = useRef(false)
  const newChatFormKeyRef = useRef(0)
  const isMobile = useIsMobile()
  const [isHydrated, setIsHydrated] = useState(false)
  const { userId } = useCombinedAuth()
  const { user } = useUser()
  const { signOut } = useClerk()
  const isAdmin = useIsAdmin()
  useAutomationInboxNotifications(betaFeatures.automations)

  useEffect(() => {
    if (desktopView !== effectiveDesktopView) setDesktopView(effectiveDesktopView)
  }, [desktopView, effectiveDesktopView, setDesktopView])

  // Quick-switch dialog state - Agents (Opt+Ctrl+Tab)
  const [quickSwitchOpen, setQuickSwitchOpen] = useAtom(agentsQuickSwitchOpenAtom)
  const [quickSwitchSelectedIndex, setQuickSwitchSelectedIndex] = useAtom(
    agentsQuickSwitchSelectedIndexAtom,
  )
  const holdTimerRef = useRef<NodeJS.Timeout | null>(null)
  const modifierKeysHeldRef = useRef(false)
  const wasShiftPressedRef = useRef(false)
  const isQuickSwitchingRef = useRef(false)
  const frozenRecentChatsRef = useRef<typeof agentChats>([]) // Frozen snapshot for dialog

  // Keep the retired persisted preference inert until the quick-switch system is rebuilt.
  const ctrlTabTarget = getReleasedCtrlTabTarget()

  // Quick-switch dialog state - Sub-chats (Ctrl+Tab)
  const [subChatQuickSwitchOpen, setSubChatQuickSwitchOpen] = useAtom(subChatsQuickSwitchOpenAtom)
  const [subChatQuickSwitchSelectedIndex, setSubChatQuickSwitchSelectedIndex] = useAtom(
    subChatsQuickSwitchSelectedIndexAtom,
  )
  const subChatHoldTimerRef = useRef<NodeJS.Timeout | null>(null)
  const subChatModifierKeysHeldRef = useRef(false)
  const subChatWasShiftPressedRef = useRef(false)
  const frozenSubChatsRef = useRef<SubChatMeta[]>([])
  // Refs to avoid effect re-running when dialog state changes (prevents keyup event loss)
  const subChatQuickSwitchOpenRef = useRef(subChatQuickSwitchOpen)
  const subChatQuickSwitchSelectedIndexRef = useRef(subChatQuickSwitchSelectedIndex)
  subChatQuickSwitchOpenRef.current = subChatQuickSwitchOpen
  subChatQuickSwitchSelectedIndexRef.current = subChatQuickSwitchSelectedIndex

  // Get sub-chats from store with shallow comparison
  const { allSubChats, openSubChatIds, activeSubChatId, setActiveSubChat } = useAgentSubChatStore(
    useShallow((state) => ({
      allSubChats: state.allSubChats,
      openSubChatIds: state.openSubChatIds,
      activeSubChatId: state.activeSubChatId,
      setActiveSubChat: state.setActiveSubChat,
    })),
  )

  // Update window title when active sub-chat changes
  const activeSubChatName = useMemo(() => {
    if (!activeSubChatId) return null
    const subChat = allSubChats.find((sc) => sc.id === activeSubChatId)
    return subChat?.name ?? null
  }, [activeSubChatId, allSubChats])

  useEffect(() => {
    if (typeof window !== "undefined" && window.desktopApi?.setWindowTitle) {
      window.desktopApi.setWindowTitle(activeSubChatName || "")
    }
  }, [activeSubChatName])

  // Fetch teams for header
  const { data: teams } = api.teams.getUserTeams.useQuery()
  const selectedTeam = teams?.find((t: any) => t.id === selectedTeamId) as any

  // Fetch agent chats for keyboard navigation and mobile view
  const { data: agentChats } = api.agents.getAgentChats.useQuery(
    { teamId: selectedTeamId! },
    { enabled: !!selectedTeamId },
  )
  const { data: archivedChats } = trpc.chats.listArchived.useQuery({})
  const { data: scopeTasks = [] } = trpc.tasks.list.useQuery({ includeArchived: true })
  // Fetch all projects for git info (like sidebar does)
  const { data: projects } = trpc.projects.list.useQuery()

  // Create map for quick project lookup by id
  const projectsMap = useMemo(() => {
    if (!projects) return new Map()
    return new Map(projects.map((p) => [p.id, p]))
  }, [projects])

  const handleOpenNewChatFromMainBar = useCallback(() => {
    const project = lastMessagedProjectId ? (projectsMap.get(lastMessagedProjectId) ?? null) : null
    localStorage.setItem("flapstack:new-chat-scope", project ? "project" : "global")
    localStorage.removeItem("flapstack:new-chat-task-id")
    setSelectedChatScope(
      project
        ? { type: "project", id: project.id, name: project.name }
        : { type: "global", id: "global", name: "Global chats" },
    )
    setSelectedProject(
      project
        ? {
            id: project.id,
            name: project.name,
            path: project.path,
            gitRemoteUrl: project.gitRemoteUrl,
            gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
            gitOwner: project.gitOwner,
            gitRepo: project.gitRepo,
          }
        : null,
    )
    setSelectedChatId(null)
    setSelectedChatIsRemote(false)
    setSelectedDraftId(null)
    setActiveNewChatDraftId(null)
    setNewChatFormSession((session) => session + 1)
    setShowNewChatForm(true)
    setDesktopView(null)
  }, [
    lastMessagedProjectId,
    projectsMap,
    setDesktopView,
    setNewChatFormSession,
    setSelectedChatId,
    setSelectedChatIsRemote,
    setSelectedChatScope,
    setSelectedDraftId,
    setSelectedProject,
    setShowNewChatForm,
  ])

  // Fetch current chat data for preview info
  const { data: chatData } = api.agents.getAgentChat.useQuery(
    { chatId: selectedChatId! },
    { enabled: !!selectedChatId },
  )

  useEffect(() => {
    if (!selectedChatId || selectedChatIsRemote) return
    setOpenChatIds((current) =>
      current.includes(selectedChatId) ? current : [...current, selectedChatId],
    )
  }, [selectedChatId, selectedChatIsRemote, setOpenChatIds])

  const persistWorkbenchPresentation = useCallback(
    (layout: typeof chatWorkbenchLayout) => {
      const chatIds = isEmptyChatWorkbenchLayout(layout)
        ? []
        : [
            ...new Set(
              collectChatGroups(layout.root)
                .flatMap((group) => group.chatIds)
                .map(
                  (presentationId) =>
                    getTerminalPresentationChatId(presentationId) ?? presentationId,
                ),
            ),
          ]
      void window.desktopApi?.updateWorkbenchSessionPresentation?.({
        layout,
        compact: chatWorkbenchCompactRef.current,
        draftRefs: Object.fromEntries(
          chatIds.map((chatId) => [chatId, createWorkbenchDraftReference(chatId)]),
        ),
        scrollAnchorRefs: Object.fromEntries(
          chatIds.map((chatId) => [chatId, createWorkbenchScrollAnchorReference(chatId)]),
        ),
      })
    },
    [stableWindowId],
  )

  const persistWorkbenchNavigation = useCallback(
    (navigation: ChatWorkbenchNavigation) => {
      chatWorkbenchNavigationRef.current = navigation
      setChatWorkbenchNavigation(navigation)
      localStorage.setItem(workbenchNavigationStorageKey, JSON.stringify(navigation))
      window.dispatchEvent(
        new CustomEvent(CHAT_WORKBENCH_NAVIGATION_CHANGE_EVENT, { detail: navigation }),
      )
    },
    [workbenchNavigationStorageKey],
  )

  const currentWorkbenchSnapshot = useCallback(
    (): ChatWorkbenchSnapshot => ({
      navigation: chatWorkbenchNavigationRef.current,
      layout: chatWorkbenchLayoutRef.current,
      openChatIds: appStore.get(openAgentChatIdsAtom),
    }),
    [],
  )

  const restoreWorkbenchSnapshot = useCallback(
    (snapshot: ChatWorkbenchSnapshot) => {
      persistWorkbenchNavigation(snapshot.navigation)
      chatWorkbenchRevisionRef.current += 1
      chatWorkbenchLayoutRef.current = snapshot.layout
      setChatWorkbenchLayout(snapshot.layout)
      persistChatWorkbenchLayout(localStorage, stableWindowId, snapshot.layout)
      persistWorkbenchPresentation(snapshot.layout)
      const layoutChatIds = isEmptyChatWorkbenchLayout(snapshot.layout)
        ? []
        : collectChatGroups(snapshot.layout.root).flatMap((group) => group.chatIds)
      const savedChatIds = snapshot.navigation.groups.flatMap((group) =>
        collectChatGroups(group.layout.root).flatMap((pane) => pane.chatIds),
      )
      setOpenChatIds([
        ...new Set(
          [...snapshot.openChatIds, ...layoutChatIds, ...savedChatIds].map(
            (presentationId) => getTerminalPresentationChatId(presentationId) ?? presentationId,
          ),
        ),
      ])
      const panes = collectChatGroups(snapshot.layout.root)
      const active = panes.find((pane) => pane.id === snapshot.layout.activeGroupId) ?? panes[0]
      setSelectedChatId(
        active ? (getTerminalPresentationChatId(active.activeChatId) ?? active.activeChatId) : null,
      )
      setSelectedChatIsRemote(false)
      setChatSourceMode("local")
    },
    [
      persistWorkbenchNavigation,
      persistWorkbenchPresentation,
      setChatSourceMode,
      setOpenChatIds,
      setSelectedChatId,
      setSelectedChatIsRemote,
      stableWindowId,
    ],
  )

  const recordWorkbenchMutation = useCallback(
    (action?: ChatWorkbenchAction) => {
      if (action?.type === "activate-tab") return
      const before = currentWorkbenchSnapshot()
      const label =
        action?.type === "resize-split"
          ? "Resize Chat panes"
          : action?.type === "close-tab"
            ? "Close Chat tab"
            : action?.type === "move-group" || action?.type === "move-tab"
              ? "Move Chat"
              : "Change Chat group"
      queueMicrotask(() => {
        const after = currentWorkbenchSnapshot()
        recordAppAction({
          label,
          undo: () => restoreWorkbenchSnapshot(before),
          redo: () => restoreWorkbenchSnapshot(after),
        })
      })
    },
    [currentWorkbenchSnapshot, restoreWorkbenchSnapshot],
  )

  const showSelectedChatLayout = useCallback(
    (chatId: string) => {
      const result = activateChatSelection(
        chatWorkbenchNavigationRef.current,
        chatWorkbenchLayoutRef.current,
        chatId,
      )
      persistWorkbenchNavigation(result.navigation)
      chatWorkbenchRevisionRef.current += 1
      chatWorkbenchLayoutRef.current = result.layout
      setChatWorkbenchLayout(result.layout)
      persistChatWorkbenchLayout(localStorage, stableWindowId, result.layout)
      persistWorkbenchPresentation(result.layout)
    },
    [persistWorkbenchNavigation, persistWorkbenchPresentation, stableWindowId],
  )

  useEffect(() => {
    if (
      chatWorkbenchNavigationRef.current.groups.length > 0 ||
      collectChatGroups(chatWorkbenchLayoutRef.current.root).length <= 1
    ) {
      return
    }
    const chatIds = collectChatGroups(chatWorkbenchLayoutRef.current.root).flatMap(
      (group) => group.chatIds,
    )
    const navigation = reconcileChatWorkbenchNavigation(
      chatWorkbenchNavigationRef.current,
      createChatWorkbenchLayout(chatIds, chatIds[0]),
      chatWorkbenchLayoutRef.current,
    )
    persistWorkbenchNavigation(navigation)
  }, [persistWorkbenchNavigation])

  const closeWorkbenchChats = useCallback(
    (chatIds: readonly string[]) => {
      const current = chatWorkbenchLayoutRef.current
      const next = closeChatsInWorkbench(current, chatIds)
      if (next === current) return
      chatWorkbenchRevisionRef.current += 1
      chatWorkbenchLayoutRef.current = next
      setChatWorkbenchLayout(next)
      persistChatWorkbenchLayout(localStorage, stableWindowId, next)
      persistWorkbenchPresentation(next)
    },
    [persistWorkbenchPresentation, stableWindowId],
  )

  useEffect(() => {
    const revision = chatWorkbenchRevisionRef.current
    void window.desktopApi?.getWorkbenchSession?.().then((session) => {
      if (!session || chatWorkbenchRevisionRef.current !== revision) return
      const restoredPresentation = restoreWorkbenchPresentationReferences(localStorage, session)
      if (Object.keys(restoredPresentation.draftsByChat).length > 0) emitDraftsChanged()
      chatWorkbenchCompactRef.current = session.compact
      chatWorkbenchLayoutRef.current = session.layout
      setChatWorkbenchLayout(session.layout)
      persistChatWorkbenchLayout(localStorage, stableWindowId, session.layout)
      const restoredGroups = collectChatGroups(session.layout.root)
      const restoredEmpty = isEmptyChatWorkbenchLayout(session.layout)
      setOpenChatIds(
        restoredEmpty
          ? []
          : restoredGroups
              .flatMap((group) => group.chatIds)
              .map(
                (presentationId) => getTerminalPresentationChatId(presentationId) ?? presentationId,
              ),
      )
      const restoredActive =
        restoredGroups.find((group) => group.id === session.layout.activeGroupId) ??
        restoredGroups[0]
      if (restoredActive && !restoredEmpty) {
        setSelectedChatId(
          getTerminalPresentationChatId(restoredActive.activeChatId) ?? restoredActive.activeChatId,
        )
        setSelectedChatIsRemote(false)
        setChatSourceMode("local")
      } else if (restoredEmpty) {
        setSelectedChatId(null)
        setSelectedChatIsRemote(false)
        setChatSourceMode("local")
      }
    })
  }, [
    setChatSourceMode,
    setOpenChatIds,
    setSelectedChatId,
    setSelectedChatIsRemote,
    stableWindowId,
  ])

  useEffect(() => {
    const desktop = window.desktopApi
    if (!desktop?.claimChat) return
    let cancelled = false
    const liveChatIds = new Set(workbenchChatIds)
    setEditableWorkbenchChatIds((current) => {
      const next = new Set([...current].filter((chatId) => liveChatIds.has(chatId)))
      return next.size === current.size ? current : next
    })
    for (const chatId of workbenchChatIds) {
      if (editableWorkbenchChatIds.has(chatId)) continue
      void desktop.claimChat(chatId).then((result) => {
        if (cancelled || !result.ok) return
        setEditableWorkbenchChatIds((current) => new Set([...current, chatId]))
      })
    }
    return () => {
      cancelled = true
    }
  }, [editableWorkbenchChatIds, workbenchChatIds])

  useEffect(() => {
    const desktop = window.desktopApi
    if (!desktop?.onWorkspaceOwnershipChanged) return
    return desktop.onWorkspaceOwnershipChanged((event) => {
      const visibleIds = new Set(
        collectChatGroups(chatWorkbenchLayoutRef.current.root)
          .flatMap((group) => group.chatIds)
          .map((presentationId) => getTerminalPresentationChatId(presentationId) ?? presentationId),
      )
      const relevantIds = event.chatIds.filter((chatId) => visibleIds.has(chatId))
      if (relevantIds.length === 0) return
      setEditableWorkbenchChatIds((current) => {
        const next = new Set(current)
        for (const chatId of relevantIds) {
          if (event.targetStableId === stableWindowId) next.add(chatId)
          else next.delete(chatId)
        }
        return next
      })
    })
  }, [stableWindowId])

  useEffect(() => {
    if (!selectedChatId || selectedChatIsRemote) return
    const groups = collectChatGroups(chatWorkbenchLayout.root)
    const owner = groups.find((group) =>
      group.chatIds.some(
        (presentationId) =>
          (getTerminalPresentationChatId(presentationId) ?? presentationId) === selectedChatId,
      ),
    )
    const activeOwnerChatId = owner
      ? (getTerminalPresentationChatId(owner.activeChatId) ?? owner.activeChatId)
      : null
    if (owner?.id === chatWorkbenchLayout.activeGroupId && activeOwnerChatId === selectedChatId) {
      return
    }
    showSelectedChatLayout(selectedChatId)
  }, [chatWorkbenchLayout, selectedChatId, selectedChatIsRemote, showSelectedChatLayout])

  const handleChatWorkbenchChange = useCallback(
    (layout: typeof chatWorkbenchLayout, action: ChatWorkbenchAction) => {
      const previousLayout = chatWorkbenchLayoutRef.current
      const previousNavigation = chatWorkbenchNavigationRef.current
      recordWorkbenchMutation(action)
      let navigation = reconcileChatWorkbenchNavigation(previousNavigation, previousLayout, layout)
      if (navigation.activeGroupId) {
        const groupedTerminalIds = new Set(
          collectChatGroups(layout.root)
            .flatMap((group) => group.chatIds)
            .filter((presentationId) => getTerminalPresentationChatId(presentationId)),
        )
        navigation = {
          ...navigation,
          order: navigation.order?.filter(
            (item) => !(item.kind === "chat" && groupedTerminalIds.has(item.id)),
          ),
        }
      }
      const loneChatTransition = findLoneChatGroupTransition(previousNavigation, navigation)
      if (loneChatTransition) setLoneChatGroupPrompt(loneChatTransition)
      persistWorkbenchNavigation(navigation)
      chatWorkbenchRevisionRef.current += 1
      chatWorkbenchLayoutRef.current = layout
      setChatWorkbenchLayout(layout)
      persistChatWorkbenchLayout(localStorage, stableWindowId, layout)
      persistWorkbenchPresentation(layout)
      const groups = collectChatGroups(layout.root)
      const emptyLayout = isEmptyChatWorkbenchLayout(layout)
      const visibleChatIds = emptyLayout
        ? []
        : groups
            .flatMap((group) => group.chatIds)
            .map(
              (presentationId) => getTerminalPresentationChatId(presentationId) ?? presentationId,
            )
      setOpenChatIds((current) => [...new Set([...current, ...visibleChatIds])])
      const activeGroup = groups.find((group) => group.id === layout.activeGroupId) ?? groups[0]
      if (activeGroup && !emptyLayout) {
        setSelectedChatId(
          getTerminalPresentationChatId(activeGroup.activeChatId) ?? activeGroup.activeChatId,
        )
        setSelectedChatIsRemote(false)
        setChatSourceMode("local")
      } else if (emptyLayout) {
        setSelectedChatId(null)
        setSelectedChatIsRemote(false)
        setChatSourceMode("local")
      }
      if (action.type === "close-tab" && !getTerminalPresentationChatId(action.chatId)) {
        window.desktopApi?.releaseChat?.(action.chatId)
      }
    },
    [
      persistWorkbenchPresentation,
      persistWorkbenchNavigation,
      recordWorkbenchMutation,
      setChatSourceMode,
      setOpenChatIds,
      setSelectedChatId,
      setSelectedChatIsRemote,
      stableWindowId,
    ],
  )

  useEffect(() => {
    type GridRequest = {
      complete: (result: { expectedChatIds: string[]; visibleChatIds: string[] }) => void
      fail: (message: string) => void
    }
    const configureGrid = (event: Event) => {
      const request = (event as CustomEvent<GridRequest>).detail
      const chatIds = appStore.get(openAgentChatIdsAtom).slice(-4)
      if (chatIds.length < 4) {
        request.fail("Electron grid setup requires four open product chats.")
        return
      }
      const base = createChatWorkbenchLayout(chatIds, chatIds[3])
      const result = reduceChatWorkbench(base, { type: "apply-preset", preset: "grid-2x2" })
      if (!result.accepted) {
        request.fail("Electron grid setup could not apply the product 2x2 layout.")
        return
      }
      handleChatWorkbenchChange(result.layout, {
        type: "apply-preset",
        preset: "grid-2x2",
      })
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          request.complete({
            expectedChatIds: chatIds,
            visibleChatIds: Array.from(
              document.querySelectorAll<HTMLElement>(
                "[data-chat-workbench] [data-chat-group][data-active-chat-id]",
              ),
            ).map((group) => group.dataset.activeChatId ?? ""),
          })
        }),
      )
    }
    window.addEventListener("stage6-performance:configure-grid", configureGrid)
    return () => window.removeEventListener("stage6-performance:configure-grid", configureGrid)
  }, [handleChatWorkbenchChange])

  useEffect(() => {
    const desktop = window.desktopApi
    if (!desktop?.onChatTransferOffer || !desktop.onChatTransferRemoveSource) return
    const removeOffer = desktop.onChatTransferOffer(async ({ transfer, destination }) => {
      if (destination.windowId !== stableWindowId) return
      const layoutBeforeTransfer = chatWorkbenchLayoutRef.current
      const destinationWasEmpty = isEmptyChatWorkbenchLayout(layoutBeforeTransfer)
      const destinationGroup = collectChatGroups(layoutBeforeTransfer.root).find(
        (group) => group.id === destination.groupId,
      )
      if (!destinationGroup) {
        await desktop.abortChatTransfer(transfer.nonce)
        return
      }
      const ready = await desktop.markChatTransferDestinationReady({
        version: 1,
        nonce: transfer.nonce,
        destinationWindowId: stableWindowId,
      })
      if (ready.status !== "ready") {
        await desktop.abortChatTransfer(transfer.nonce)
        return
      }
      const ownership = await desktop.transferChatOwnership({
        version: 1,
        nonce: transfer.nonce,
        windowId: stableWindowId,
      })
      if (ownership.status !== "ownership-transferred" && ownership.status !== "read-only") {
        await desktop.abortChatTransfer(transfer.nonce)
        return
      }

      let next = reduceChatWorkbench(layoutBeforeTransfer, {
        type: "open-tab",
        groupId: destinationGroup.id,
        chatId: transfer.chatId,
      })
      if (next.accepted && destination.zone !== "tab" && !destinationWasEmpty) {
        next = reduceChatWorkbench(next.layout, {
          type: "split",
          groupId: next.layout.activeGroupId,
          chatId: transfer.chatId,
          zone: destination.zone,
        })
      }
      if (!next.accepted) {
        await desktop.abortChatTransfer(transfer.nonce)
        return
      }
      handleChatWorkbenchChange(next.layout, {
        type: "open-tab",
        groupId: next.layout.activeGroupId,
        chatId: transfer.chatId,
      })
      if (transfer.operation === "read-only-copy") {
        setEditableWorkbenchChatIds((current) => {
          const nextEditable = new Set(current)
          nextEditable.delete(transfer.chatId)
          return nextEditable
        })
      }
      const committed = await desktop.commitChatTransferDestination({
        version: 1,
        nonce: transfer.nonce,
        windowId: stableWindowId,
      })
      if (committed.status !== "destination-committed") {
        await desktop.abortChatTransfer(transfer.nonce)
        const previousActive =
          collectChatGroups(layoutBeforeTransfer.root).find(
            (group) => group.id === layoutBeforeTransfer.activeGroupId,
          ) ?? collectChatGroups(layoutBeforeTransfer.root)[0]
        handleChatWorkbenchChange(layoutBeforeTransfer, {
          type: "activate-tab",
          groupId: previousActive.id,
          chatId: previousActive.activeChatId,
        })
        setEditableWorkbenchChatIds((current) => {
          const nextEditable = new Set(current)
          nextEditable.delete(transfer.chatId)
          return nextEditable
        })
        return
      }
      if (transfer.operation === "move") {
        setEditableWorkbenchChatIds((current) => new Set([...current, transfer.chatId]))
      }
    })
    const removeSource = desktop.onChatTransferRemoveSource(async (input) => {
      if (input.sourceWindowId !== stableWindowId) return
      const layoutBeforeRemoval = chatWorkbenchLayoutRef.current
      const result = reduceChatWorkbench(layoutBeforeRemoval, {
        type: "close-tab",
        groupId: input.sourceGroupId,
        chatId: input.chatId,
      })
      if (!result.accepted) {
        await desktop.abortChatTransfer(input.nonce)
        return
      }
      handleChatWorkbenchChange(result.layout, {
        type: "close-tab",
        groupId: input.sourceGroupId,
        chatId: input.chatId,
      })
      const committed = await desktop.commitChatTransferSource({
        version: 1,
        nonce: input.nonce,
        windowId: stableWindowId,
      })
      if (committed.status !== "completed") {
        const previousActive =
          collectChatGroups(layoutBeforeRemoval.root).find(
            (group) => group.id === layoutBeforeRemoval.activeGroupId,
          ) ?? collectChatGroups(layoutBeforeRemoval.root)[0]
        handleChatWorkbenchChange(layoutBeforeRemoval, {
          type: "activate-tab",
          groupId: previousActive.id,
          chatId: previousActive.activeChatId,
        })
        setEditableWorkbenchChatIds((current) => {
          const nextEditable = new Set(current)
          nextEditable.delete(input.chatId)
          return nextEditable
        })
      }
    })
    return () => {
      removeOffer()
      removeSource()
    }
  }, [handleChatWorkbenchChange, stableWindowId])

  const dropChatIntoCurrentWindow = useCallback(
    async (
      source: { chatId: string; groupId: string; sourceWindowId: string },
      target: {
        groupId: string
        zone: "tab" | "left" | "right" | "top" | "bottom"
      },
    ) => {
      const result = await window.desktopApi.dropChatTransferIntoCurrentWindow({
        version: 1,
        chatId: source.chatId,
        sourceWindowId: source.sourceWindowId,
        sourceGroupId: source.groupId,
        operation: "move",
        destinationWindowId: stableWindowId,
        destinationGroupId: target.groupId,
        zone: target.zone,
      })
      return result.status === "offered"
        ? `Moving Chat into ${target.zone === "tab" ? "the selected tab group" : `the ${target.zone} pane`}`
        : "Cross-window drop was rejected. The source Chat stayed unchanged."
    },
    [stableWindowId],
  )

  const dropChatOutside = useCallback(
    async (
      source: {
        chatId: string
        groupId: string
        sourceWindowId: string
        projectId?: string
      },
      point: { screenX: number; screenY: number },
    ) => {
      const projectId = source.projectId ?? selectedProject?.id
      const result = await window.desktopApi.dropChatTransferOutside({
        version: 1,
        chatId: source.chatId,
        sourceWindowId: source.sourceWindowId,
        sourceGroupId: source.groupId,
        operation: "move",
        destinationGroupId: "chat-group-1",
        zone: "tab",
        screenX: point.screenX,
        screenY: point.screenY,
        ...(projectId ? { projectId } : {}),
      })
      if (result.status === "offered") return "Moving Chat into a new floating window."
      if (result.status === "at-limit") {
        showChatTransferWindowLimitChoice({
          api: window.desktopApi,
          context: {
            chatId: source.chatId,
            sourceWindowId: source.sourceWindowId,
            sourceGroupId: source.groupId,
            operation: "move",
          },
          destinations: result.destinations.filter(
            (destination) => destination.stableId !== source.sourceWindowId,
          ),
        })
        return "Four windows are open. Choose an existing destination or cancel."
      }
      return "Drag-out was cancelled. The source Chat stayed unchanged."
    },
    [selectedProject?.id],
  )

  useEffect(() => {
    const startSidebarChatDrag = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          source?: {
            chatId?: unknown
            groupId?: unknown
            sourceWindowId?: unknown
            projectId?: unknown
          }
          screenX?: unknown
          screenY?: unknown
        }>
      ).detail
      if (
        typeof detail?.source?.chatId !== "string" ||
        detail.source.groupId !== CHAT_WORKBENCH_EXTERNAL_GROUP_ID ||
        typeof detail.source.sourceWindowId !== "string" ||
        typeof detail.screenX !== "number" ||
        typeof detail.screenY !== "number"
      ) {
        return
      }
      sidebarChatDragSessionRef.current = {
        source: {
          chatId: detail.source.chatId,
          groupId: detail.source.groupId,
          sourceWindowId: detail.source.sourceWindowId,
          ...(typeof detail.source.projectId === "string"
            ? { projectId: detail.source.projectId }
            : {}),
        },
        screenX: detail.screenX,
        screenY: detail.screenY,
        cancelled: false,
      }
    }
    const cancelSidebarChatDrag = (event: KeyboardEvent) => {
      if (event.key === "Escape" && sidebarChatDragSessionRef.current) {
        sidebarChatDragSessionRef.current.cancelled = true
      }
    }
    const endSidebarChatDrag = (event: Event) => {
      const session = sidebarChatDragSessionRef.current
      sidebarChatDragSessionRef.current = null
      if (!session) return
      const detail = (
        event as CustomEvent<{
          dropEffect?: DataTransfer["dropEffect"]
          screenX?: unknown
          screenY?: unknown
        }>
      ).detail
      if (
        !detail ||
        typeof detail.screenX !== "number" ||
        typeof detail.screenY !== "number" ||
        !detail.dropEffect ||
        !shouldPopOutChatDrag(session, {
          dropEffect: detail.dropEffect,
          screenX: detail.screenX,
          screenY: detail.screenY,
        })
      ) {
        return
      }
      void dropChatOutside(session.source, {
        screenX: detail.screenX,
        screenY: detail.screenY,
      }).catch((error: unknown) => {
        console.error("Failed to open dragged Chat in a new window", error)
      })
    }

    window.addEventListener(CHAT_WORKBENCH_SIDEBAR_DRAG_START_EVENT, startSidebarChatDrag)
    window.addEventListener(CHAT_WORKBENCH_SIDEBAR_DRAG_END_EVENT, endSidebarChatDrag)
    window.addEventListener("keydown", cancelSidebarChatDrag, true)
    return () => {
      window.removeEventListener(CHAT_WORKBENCH_SIDEBAR_DRAG_START_EVENT, startSidebarChatDrag)
      window.removeEventListener(CHAT_WORKBENCH_SIDEBAR_DRAG_END_EVENT, endSidebarChatDrag)
      window.removeEventListener("keydown", cancelSidebarChatDrag, true)
    }
  }, [dropChatOutside])

  const claimReadOnlyChat = useCallback(async (chatId: string) => {
    const desktop = window.desktopApi
    if (!desktop?.claimChat) return "Chat ownership controls are unavailable in this window."
    const result = await desktop.claimChat(chatId)
    if (result.ok) {
      setEditableWorkbenchChatIds((current) => new Set([...current, chatId]))
      return "Chat ownership moved here. Editing is enabled."
    }
    const moved = await desktop.takeChatOwnership?.(chatId, result.ownerStableId)
    if (moved?.ok) {
      setEditableWorkbenchChatIds((current) => new Set([...current, chatId]))
      return "Chat ownership moved here. The former presentation is now read-only."
    }
    const focused = await desktop.focusChatOwner(chatId)
    const ownerStableId = moved && !moved.ok ? moved.ownerStableId : result.ownerStableId
    return focused
      ? `Chat remains owned by ${ownerStableId ?? "another window"}. Focused the owner window.`
      : `Chat remains owned by ${ownerStableId ?? "another window"}. The owner window could not be focused.`
  }, [])

  const groupedChatIds = useMemo(
    () => getGroupedChatIds(chatWorkbenchNavigation),
    [chatWorkbenchNavigation],
  )
  const workbenchChatCatalog = useMemo(() => {
    return resolveVisibleOpenChatTabs({
      chats: agentChats,
      archivedChats,
      selectedChat: chatData ?? undefined,
      openChatIds,
      selectedChatId,
      selectedChatIsRemote,
    })
  }, [agentChats, archivedChats, chatData, openChatIds, selectedChatId, selectedChatIsRemote])
  const openChatTabs = useMemo(() => {
    return resolveVisibleOpenChatTabs({
      chats: agentChats,
      archivedChats,
      selectedChat: chatData ?? undefined,
      openChatIds,
      selectedChatId,
      selectedChatIsRemote,
      excludedChatIds: groupedChatIds,
    })
  }, [
    agentChats,
    archivedChats,
    chatData,
    groupedChatIds,
    openChatIds,
    selectedChatId,
    selectedChatIsRemote,
  ])
  const topNavigationItems = useMemo(() => {
    const terminalIds = (chatWorkbenchNavigation.order ?? []).flatMap((item) =>
      item.kind === "chat" && getTerminalPresentationChatId(item.id) ? [item.id] : [],
    )
    return resolveChatWorkbenchNavigationItems(chatWorkbenchNavigation, [
      ...openChatTabs.map((chat) => chat.id),
      ...terminalIds,
    ])
  }, [chatWorkbenchNavigation, openChatTabs])
  const standaloneTerminalIds = useMemo(
    () =>
      topNavigationItems.flatMap((item) =>
        item.kind === "chat" && getTerminalPresentationChatId(item.id) ? [item.id] : [],
      ),
    [topNavigationItems],
  )
  const topNavigationOrder = useMemo(
    () =>
      new Map(topNavigationItems.map((item, index) => [`${item.kind}:${item.id}`, index] as const)),
    [topNavigationItems],
  )

  const saveChatWorkbenchAsWorkspace = useCallback(async () => {
    if (!selectedProject?.id) return "Select a project before saving this workspace."
    const groups = collectChatGroups(chatWorkbenchLayoutRef.current.root)
    const active = groups.find((group) => group.id === chatWorkbenchLayoutRef.current.activeGroupId)
    const activeName =
      workbenchChatCatalog
        .find(
          (chat) =>
            chat.id ===
            (active
              ? (getTerminalPresentationChatId(active.activeChatId) ?? active.activeChatId)
              : null),
        )
        ?.name?.trim() || "Chat workbench"
    const requestedName = window.prompt("Workspace name", `${activeName} workspace`)
    if (requestedName === null) return "Save as Workspace cancelled."
    const name = requestedName.trim()
    if (!name) return "Workspace name is required."
    const result = await createSavedWorkspace.mutateAsync({
      name,
      scope: { type: "project", projectId: selectedProject.id },
      layout: chatWorkbenchToSavedWorkspace(chatWorkbenchLayoutRef.current),
    })
    return `Saved as workspace ${result.workspace.name}`
  }, [createSavedWorkspace, selectedProject?.id, workbenchChatCatalog])

  const openChatProjectColorsStorageValue =
    typeof window === "undefined"
      ? "{}"
      : (window.localStorage.getItem("flapstack-sidebar-project-colors") ?? "{}")
  const openChatProjectColors = useMemo(
    () => parseStoredProjectColors(openChatProjectColorsStorageValue),
    [openChatProjectColorsStorageValue],
  )
  const workbenchChats = useMemo(
    () =>
      workbenchChatCatalog.map((chat) => ({
        ...chat,
        accentColor: resolveOpenChatTabUnderlineColor(chat, openChatProjectColors),
        hasUnseenChanges: unseenChatIds.has(chat.id),
      })),
    [openChatProjectColors, unseenChatIds, workbenchChatCatalog],
  )

  const updateOpenChatScrollbar = useCallback(() => {
    const element = openChatTabsRef.current
    if (!element || element.scrollWidth <= element.clientWidth) {
      setOpenChatScrollbar({ left: 0, width: 0 })
      return
    }

    const width = Math.max(24, (element.clientWidth / element.scrollWidth) * element.clientWidth)
    const maxLeft = element.clientWidth - width
    const left = (element.scrollLeft / (element.scrollWidth - element.clientWidth)) * maxLeft
    setOpenChatScrollbar({ left, width })
  }, [])

  useEffect(() => {
    updateOpenChatScrollbar()
    const element = openChatTabsRef.current
    if (!element) return
    const observer = new ResizeObserver(updateOpenChatScrollbar)
    observer.observe(element)
    return () => observer.disconnect()
  }, [openChatTabs, updateOpenChatScrollbar])

  const scopeChats = useMemo(() => {
    if (!agentChats || !selectedChatScope) return []
    const getChatUpdatedAt = (chat: NonNullable<typeof agentChats>[number]) => {
      const value = (chat as typeof chat & { updated_at?: Date | string | number | null })
        .updated_at
      return scopeChatTimestampMs(chat.updatedAt ?? value ?? 0)
    }
    return agentChats
      .filter((chat) => {
        if (selectedChatScope.type === "global") {
          return !chat.projectId && !chat.taskId
        }
        if (selectedChatScope.type === "project") {
          return chat.projectId === selectedChatScope.id
        }
        return chat.taskId === selectedChatScope.id
      })
      .sort((a, b) => {
        return getChatUpdatedAt(b) - getChatUpdatedAt(a)
      })
  }, [agentChats, selectedChatScope])
  const scopeTasksById = useMemo(
    () => new Map(scopeTasks.map((task) => [task.id, task])),
    [scopeTasks],
  )

  useEffect(() => {
    if (!agentChats || !archivedChats || openChatIds.length === 0) return
    const validIds = new Set([...agentChats, ...archivedChats].map((chat) => chat.id))
    const filtered = openChatIds.filter((id) => validIds.has(id))
    if (filtered.length !== openChatIds.length) {
      setOpenChatIds(filtered)
    }
  }, [agentChats, archivedChats, openChatIds, setOpenChatIds])

  const handleSelectOpenChatTab = useCallback(
    async (chatId: string) => {
      if (window.desktopApi?.claimChat) {
        const result = await window.desktopApi.claimChat(chatId)
        if (!result.ok) {
          await window.desktopApi.focusChatOwner(chatId)
          setOpenChatIds((current) => current.filter((id) => id !== chatId))
          return
        }
      }
      setUnseenChatIds((current) => markChatSeen(current, chatId))
      setSelectedDraftId(null)
      setShowNewChatForm(false)
      setSelectedChatId(chatId)
      setSelectedChatIsRemote(false)
      setChatSourceMode("local")
      setDesktopView(null)
    },
    [
      setChatSourceMode,
      setDesktopView,
      setOpenChatIds,
      setSelectedDraftId,
      setSelectedChatId,
      setSelectedChatIsRemote,
      setShowNewChatForm,
      setUnseenChatIds,
    ],
  )

  const handleSelectOpenDraftTab = useCallback(
    (draftId: string) => {
      openNewChatDraft(draftId)
      setActiveNewChatDraftId(draftId)
      setSelectedChatId(null)
      setSelectedDraftId(draftId)
      setShowNewChatForm(false)
      setDesktopView(null)
    },
    [setDesktopView, setSelectedChatId, setSelectedDraftId, setShowNewChatForm],
  )

  const handleChatViewed = useCallback(
    (chatId: string) => setUnseenChatIds((current) => markChatSeen(current, chatId)),
    [setUnseenChatIds],
  )

  const handleToggleSidebar = useCallback(
    () => setSidebarOpen((current) => !current),
    [setSidebarOpen],
  )

  const handleWorkbenchActiveChatChange = useCallback(
    (chatId: string) => {
      if (readOnlyWorkbenchChatIds.has(chatId)) {
        setSelectedChatId(chatId)
        setSelectedChatIsRemote(false)
        setChatSourceMode("local")
        return
      }
      void handleSelectOpenChatTab(chatId)
    },
    [
      handleSelectOpenChatTab,
      readOnlyWorkbenchChatIds,
      setChatSourceMode,
      setSelectedChatId,
      setSelectedChatIsRemote,
    ],
  )

  const renderWorkbenchChat = useCallback(
    (
      presentationId: string,
      active: boolean,
      controls: { openTerminal: (chatId: string) => void },
    ) => {
      const terminalChatId = getTerminalPresentationChatId(presentationId)
      if (terminalChatId) {
        const owner = workbenchChatCatalog.find((chat) => chat.id === terminalChatId)
        return (
          <WorkbenchTerminalPane
            chatId={terminalChatId}
            cwd={(owner?.worktreePath as string | null | undefined) ?? null}
          />
        )
      }
      const chatId = presentationId
      const readOnly = readOnlyWorkbenchChatIds.has(chatId)
      return (
        <div className="relative h-full">
          <div
            className="h-full"
            inert={readOnly ? true : undefined}
            aria-disabled={readOnly || undefined}
          >
            <ChatView
              key={`${chatSourceMode}-${chatId}`}
              chatId={chatId}
              workbenchActive={active}
              isSidebarOpen={sidebarOpen}
              onToggleSidebar={handleToggleSidebar}
              onOpenTerminal={() => controls.openTerminal(chatId)}
              selectedTeamName={selectedTeam?.name}
              selectedTeamImageUrl={selectedTeam?.image_url}
            />
          </div>
          {readOnly && (
            <div
              role="note"
              className="absolute inset-x-3 bottom-3 rounded-md border border-border bg-background/95 px-3 py-2 text-xs shadow"
            >
              Read-only in this window. Move Chat ownership here before sending or changing
              settings.
            </div>
          )}
        </div>
      )
    },
    [
      chatSourceMode,
      handleToggleSidebar,
      readOnlyWorkbenchChatIds,
      selectedTeam?.image_url,
      selectedTeam?.name,
      sidebarOpen,
      workbenchChatCatalog,
    ],
  )

  const showSingleChatLayout = useCallback(
    (chatId: string) => {
      const activated = activateSingleChat(chatWorkbenchNavigationRef.current, chatId)
      persistWorkbenchNavigation(activated.navigation)
      chatWorkbenchRevisionRef.current += 1
      chatWorkbenchLayoutRef.current = activated.layout
      setChatWorkbenchLayout(activated.layout)
      persistChatWorkbenchLayout(localStorage, stableWindowId, activated.layout)
      persistWorkbenchPresentation(activated.layout)
    },
    [persistWorkbenchNavigation, persistWorkbenchPresentation, stableWindowId],
  )

  const handleSelectMainChatTab = useCallback(
    (chatId: string) => {
      showSingleChatLayout(chatId)
      void handleSelectOpenChatTab(chatId)
    },
    [handleSelectOpenChatTab, showSingleChatLayout],
  )

  const handleSelectStandaloneTerminal = useCallback(
    (presentationId: string) => {
      const ownerChatId = getTerminalPresentationChatId(presentationId)
      if (!ownerChatId) return
      showSingleChatLayout(presentationId)
      void handleSelectOpenChatTab(ownerChatId)
    },
    [handleSelectOpenChatTab, showSingleChatLayout],
  )

  const handleCloseStandaloneTerminal = useCallback(
    (presentationId: string) => {
      const ownerChatId = getTerminalPresentationChatId(presentationId)
      if (!ownerChatId) return
      persistWorkbenchNavigation({
        ...chatWorkbenchNavigationRef.current,
        order: chatWorkbenchNavigationRef.current.order?.filter(
          (item) => !(item.kind === "chat" && item.id === presentationId),
        ),
      })
      showSingleChatLayout(ownerChatId)
      void handleSelectOpenChatTab(ownerChatId)
    },
    [handleSelectOpenChatTab, persistWorkbenchNavigation, showSingleChatLayout],
  )

  const handleSelectWorkbenchGroup = useCallback(
    (groupId: string) => {
      const activated = activateChatWorkbenchGroup(chatWorkbenchNavigationRef.current, groupId)
      persistWorkbenchNavigation(activated.navigation)
      chatWorkbenchRevisionRef.current += 1
      chatWorkbenchLayoutRef.current = activated.layout
      setChatWorkbenchLayout(activated.layout)
      persistChatWorkbenchLayout(localStorage, stableWindowId, activated.layout)
      persistWorkbenchPresentation(activated.layout)
      const panes = collectChatGroups(activated.layout.root)
      const active = panes.find((pane) => pane.id === activated.layout.activeGroupId) ?? panes[0]
      if (active) {
        void handleSelectOpenChatTab(
          getTerminalPresentationChatId(active.activeChatId) ?? active.activeChatId,
        )
      }
    },
    [
      handleSelectOpenChatTab,
      persistWorkbenchNavigation,
      persistWorkbenchPresentation,
      stableWindowId,
    ],
  )

  const saveRenamedWorkbenchGroup = useCallback(
    (name: string) => {
      if (renamingWorkbenchGroup) {
        recordWorkbenchMutation()
        persistWorkbenchNavigation(
          renameChatWorkbenchGroup(
            chatWorkbenchNavigationRef.current,
            renamingWorkbenchGroup.id,
            name,
          ),
        )
      }
      return Promise.resolve()
    },
    [persistWorkbenchNavigation, recordWorkbenchMutation, renamingWorkbenchGroup],
  )

  const handleSetWorkbenchGroupColor = useCallback(
    (groupId: string, color: ChatWorkbenchGroupColor) => {
      recordWorkbenchMutation()
      persistWorkbenchNavigation(
        setChatWorkbenchGroupColor(chatWorkbenchNavigationRef.current, groupId, color),
      )
    },
    [persistWorkbenchNavigation, recordWorkbenchMutation],
  )

  const showActiveNavigationGroup = useCallback(
    (navigation: ChatWorkbenchNavigation, chatId: string) => {
      const group = navigation.groups.find((candidate) => candidate.id === navigation.activeGroupId)
      if (!group) return
      persistWorkbenchNavigation(navigation)
      chatWorkbenchRevisionRef.current += 1
      chatWorkbenchLayoutRef.current = group.layout
      setChatWorkbenchLayout(group.layout)
      persistChatWorkbenchLayout(localStorage, stableWindowId, group.layout)
      persistWorkbenchPresentation(group.layout)
      setOpenChatIds((current) => (current.includes(chatId) ? current : [...current, chatId]))
      void handleSelectOpenChatTab(chatId)
    },
    [
      handleSelectOpenChatTab,
      persistWorkbenchNavigation,
      persistWorkbenchPresentation,
      setOpenChatIds,
      stableWindowId,
    ],
  )

  const handleMoveChatToWorkbenchGroup = useCallback(
    (chatId: string, groupId: string) => {
      const previous = chatWorkbenchNavigationRef.current
      const navigation = moveChatToWorkbenchGroup(previous, chatId, groupId)
      if (navigation === previous) return
      recordWorkbenchMutation()
      const transition = findLoneChatGroupTransition(previous, navigation)
      if (transition) setLoneChatGroupPrompt(transition)
      showActiveNavigationGroup(navigation, chatId)
    },
    [recordWorkbenchMutation, showActiveNavigationGroup],
  )

  const handleCreateWorkbenchGroupFromChat = useCallback(
    (chatId: string) => {
      const previous = chatWorkbenchNavigationRef.current
      const navigation = createChatWorkbenchGroup(
        previous,
        openChatTabs.map((chat) => chat.id),
        chatId,
      )
      recordWorkbenchMutation()
      const transition = findLoneChatGroupTransition(previous, navigation)
      if (transition) setLoneChatGroupPrompt(transition)
      showActiveNavigationGroup(navigation, chatId)
    },
    [openChatTabs, recordWorkbenchMutation, showActiveNavigationGroup],
  )

  const handleRemoveLoneChatGroup = useCallback(() => {
    if (!loneChatGroupPrompt) return
    const current = chatWorkbenchNavigationRef.current
    const group = current.groups.find((candidate) => candidate.id === loneChatGroupPrompt.groupId)
    if (!group) {
      setLoneChatGroupPrompt(null)
      return
    }
    recordWorkbenchMutation()
    const navigation = removeChatWorkbenchGroup(
      current,
      group.id,
      openChatTabs.map((chat) => chat.id),
    )
    persistWorkbenchNavigation(navigation)
    if (current.activeGroupId === group.id) showSingleChatLayout(loneChatGroupPrompt.chatId)
    setLoneChatGroupPrompt(null)
  }, [
    loneChatGroupPrompt,
    openChatTabs,
    persistWorkbenchNavigation,
    recordWorkbenchMutation,
    showSingleChatLayout,
  ])

  useEffect(() => {
    const selectChat = (event: Event) => {
      const chatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId
      if (chatId) {
        handleChatViewed(chatId)
        showSelectedChatLayout(chatId)
      }
    }
    window.addEventListener(CHAT_WORKBENCH_SELECT_CHAT_EVENT, selectChat)
    return () => window.removeEventListener(CHAT_WORKBENCH_SELECT_CHAT_EVENT, selectChat)
  }, [handleChatViewed, showSelectedChatLayout])

  const handleCloseOpenChatTab = useCallback(
    (chatId: string) => {
      window.desktopApi?.releaseChat?.(chatId)
      closeWorkbenchChats([chatId])
      const isClosingSelected = selectedChatId === chatId
      const closedIndex = openChatIds.indexOf(chatId)
      const next = openChatIds.filter((id) => id !== chatId)
      setOpenChatIds(next)

      if (!isClosingSelected) return

      const nextSelectedId = next[Math.max(0, closedIndex - 1)] ?? next[0] ?? null
      if (nextSelectedId) {
        // Route through the claim path, not a bare setSelectedChatId.
        void handleSelectOpenChatTab(nextSelectedId)
      } else {
        setSelectedChatId(null)
        setSelectedChatIsRemote(false)
        setChatSourceMode("local")
      }
    },
    [
      openChatIds,
      selectedChatId,
      closeWorkbenchChats,
      handleSelectOpenChatTab,
      setChatSourceMode,
      setOpenChatIds,
      setSelectedChatId,
      setSelectedChatIsRemote,
    ],
  )

  const handleCloseOpenChatTabs = useCallback(
    (chatIds: string[], fallbackChatId?: string) => {
      const closingIds = new Set(chatIds)
      chatIds.forEach((chatId) => window.desktopApi?.releaseChat?.(chatId))
      closeWorkbenchChats(chatIds)
      const next = openChatIds.filter((chatId) => !closingIds.has(chatId))
      setOpenChatIds(next)

      if (!selectedChatId || !closingIds.has(selectedChatId)) return

      const nextSelectedId =
        (fallbackChatId && next.includes(fallbackChatId) ? fallbackChatId : undefined) ??
        next[0] ??
        null
      if (nextSelectedId) {
        void handleSelectOpenChatTab(nextSelectedId)
      } else {
        setSelectedChatId(null)
        setSelectedChatIsRemote(false)
        setChatSourceMode("local")
      }
    },
    [
      handleSelectOpenChatTab,
      closeWorkbenchChats,
      openChatIds,
      selectedChatId,
      setChatSourceMode,
      setOpenChatIds,
      setSelectedChatId,
      setSelectedChatIsRemote,
    ],
  )

  const closeWorkbenchGroup = useCallback(
    (groupId: string, behavior: Exclude<GroupCloseBehavior, "ask">) => {
      const current = chatWorkbenchNavigationRef.current
      const group = current.groups.find((candidate) => candidate.id === groupId)
      if (!group) {
        setGroupClosePromptId(null)
        return
      }

      const chatIds = [
        ...new Set(
          collectChatGroups(group.layout.root)
            .flatMap((pane) => pane.chatIds)
            .map(
              (presentationId) => getTerminalPresentationChatId(presentationId) ?? presentationId,
            ),
        ),
      ]
      const wasActive = current.activeGroupId === groupId
      recordWorkbenchMutation()
      const nextNavigation = removeChatWorkbenchGroup(
        current,
        groupId,
        openChatTabs.map((chat) => chat.id),
        behavior,
      )
      persistWorkbenchNavigation(nextNavigation)

      if (behavior === "keep-chats") {
        if (wasActive && selectedChatId) showSingleChatLayout(selectedChatId)
        setGroupClosePromptId(null)
        setRememberGroupCloseChoice(false)
        return
      }

      const closingIds = new Set(chatIds)
      chatIds.forEach((chatId) => window.desktopApi?.releaseChat?.(chatId))
      closeWorkbenchChats(chatIds)
      const remainingChatIds = openChatIds.filter((chatId) => !closingIds.has(chatId))
      setOpenChatIds(remainingChatIds)

      if (wasActive) {
        const nextItem = resolveChatWorkbenchNavigationItems(nextNavigation, remainingChatIds)[0]
        if (nextItem?.kind === "group") {
          handleSelectWorkbenchGroup(nextItem.id)
        } else if (nextItem?.kind === "chat") {
          showSingleChatLayout(nextItem.id)
          void handleSelectOpenChatTab(nextItem.id)
        } else {
          setSelectedChatId(null)
          setSelectedChatIsRemote(false)
          setChatSourceMode("local")
        }
      }

      setGroupClosePromptId(null)
      setRememberGroupCloseChoice(false)
    },
    [
      closeWorkbenchChats,
      handleSelectOpenChatTab,
      handleSelectWorkbenchGroup,
      openChatIds,
      openChatTabs,
      persistWorkbenchNavigation,
      recordWorkbenchMutation,
      selectedChatId,
      setChatSourceMode,
      setOpenChatIds,
      setSelectedChatId,
      setSelectedChatIsRemote,
      showSingleChatLayout,
    ],
  )

  const handleCloseWorkbenchGroup = useCallback(
    (groupId: string) => {
      if (groupCloseBehavior === "ask") {
        setRememberGroupCloseChoice(false)
        setGroupClosePromptId(groupId)
        return
      }
      closeWorkbenchGroup(groupId, groupCloseBehavior)
    },
    [closeWorkbenchGroup, groupCloseBehavior],
  )

  const handleGroupCloseChoice = useCallback(
    (behavior: Exclude<GroupCloseBehavior, "ask">) => {
      if (!groupClosePromptId) return
      if (rememberGroupCloseChoice) setGroupCloseBehavior(behavior)
      closeWorkbenchGroup(groupClosePromptId, behavior)
    },
    [closeWorkbenchGroup, groupClosePromptId, rememberGroupCloseChoice, setGroupCloseBehavior],
  )

  const reorderOpenChatTab = useCallback(
    (draggedChatId: string, targetChatId: string, position: "before" | "after") => {
      if (!draggedChatId || draggedChatId === targetChatId) return

      setOpenChatIds((current) => {
        const fromIndex = current.indexOf(draggedChatId)
        if (fromIndex < 0 || !current.includes(targetChatId)) return current

        const next = [...current]
        next.splice(fromIndex, 1)
        const targetIndex = next.indexOf(targetChatId)
        next.splice(targetIndex + (position === "after" ? 1 : 0), 0, draggedChatId)
        return next
      })
    },
    [setOpenChatIds],
  )

  const cancelTopNavigationEnter = useCallback(() => {
    if (topNavigationEnterTimerRef.current !== null) {
      clearTimeout(topNavigationEnterTimerRef.current)
      topNavigationEnterTimerRef.current = null
    }
    topNavigationPendingTargetRef.current = null
  }, [])

  const clearTopNavigationDropTarget = useCallback(() => {
    cancelTopNavigationEnter()
    topNavigationEnteredTargetRef.current = null
    setTopNavigationDropTarget(null)
    setMainBarDropActive(false)
  }, [cancelTopNavigationEnter])

  const readTopNavigationDragSource = useCallback((dataTransfer: DataTransfer) => {
    try {
      const serialized =
        dataTransfer.getData(CHAT_WORKBENCH_DRAG_MIME) ||
        localStorage.getItem(CHAT_WORKBENCH_DRAG_SESSION_KEY)
      if (!serialized) return null
      const source = JSON.parse(serialized) as { chatId?: unknown; groupId?: unknown }
      return typeof source.chatId === "string" && typeof source.groupId === "string"
        ? { chatId: source.chatId, groupId: source.groupId }
        : null
    } catch {
      return null
    }
  }, [])

  const activateTopNavigationDropTarget = useCallback(
    (target: ChatWorkbenchNavigationItem) => {
      const key = `${target.kind}:${target.id}`
      if (topNavigationEnteredTargetRef.current === key) return
      topNavigationEnteredTargetRef.current = key
      if (target.kind === "group") handleSelectWorkbenchGroup(target.id)
      else if (getTerminalPresentationChatId(target.id)) {
        handleSelectStandaloneTerminal(target.id)
      } else handleSelectMainChatTab(target.id)
    },
    [handleSelectMainChatTab, handleSelectStandaloneTerminal, handleSelectWorkbenchGroup],
  )

  const handleCloseNewChatTab = useCallback(
    (draftId: string | null) => {
      if (draftId) closeNewChatDraft(draftId)
      const isActive = !selectedChatId && (selectedDraftId === draftId || showNewChatForm)
      if (!isActive) return

      const fallbackDraft = openNewChatDrafts.find((draft) => draft.id !== draftId)
      setActiveNewChatDraftId(null)
      if (fallbackDraft) {
        handleSelectOpenDraftTab(fallbackDraft.id)
        return
      }

      setSelectedDraftId(null)
      const fallback = topNavigationItems[0]
      if (fallback) {
        activateTopNavigationDropTarget(fallback)
        return
      }
      setShowNewChatForm(false)
    },
    [
      activateTopNavigationDropTarget,
      handleSelectOpenDraftTab,
      openNewChatDrafts,
      selectedChatId,
      selectedDraftId,
      setSelectedDraftId,
      setShowNewChatForm,
      showNewChatForm,
      topNavigationItems,
    ],
  )

  const scheduleTopNavigationEnter = useCallback(
    (target: ChatWorkbenchNavigationItem) => {
      const key = `${target.kind}:${target.id}`
      if (
        topNavigationEnteredTargetRef.current === key ||
        topNavigationPendingTargetRef.current === key
      ) {
        return
      }
      cancelTopNavigationEnter()
      topNavigationPendingTargetRef.current = key
      topNavigationEnterTimerRef.current = setTimeout(() => {
        topNavigationPendingTargetRef.current = null
        topNavigationEnterTimerRef.current = null
        activateTopNavigationDropTarget(target)
      }, TOP_NAVIGATION_ENTER_DELAY_MS)
    },
    [activateTopNavigationDropTarget, cancelTopNavigationEnter],
  )

  useEffect(() => cancelTopNavigationEnter, [cancelTopNavigationEnter])

  const moveGroupedChatToMainBar = useCallback(
    (chatId: string, target?: ChatWorkbenchNavigationItem, position?: "before" | "after") => {
      const current = chatWorkbenchNavigationRef.current
      const detached = detachChatFromWorkbenchGroup(current, chatId)
      const terminalOwnerChatId = getTerminalPresentationChatId(chatId)
      const remainingGroupedIds = new Set(
        detached.navigation.groups.flatMap((group) =>
          collectChatGroups(group.layout.root).flatMap((pane) => pane.chatIds),
        ),
      )
      const visibleChatIds = [
        ...new Set([...openChatIds, ...standaloneTerminalIds, chatId]),
      ].filter((id) => !remainingGroupedIds.has(id))
      const navigation =
        target && position
          ? reorderChatWorkbenchNavigationItem(
              detached.navigation,
              visibleChatIds,
              { kind: "chat", id: chatId },
              target,
              position,
            )
          : appendChatWorkbenchNavigationItem(detached.navigation, visibleChatIds, {
              kind: "chat",
              id: chatId,
            })
      recordWorkbenchMutation()
      const transition = findLoneChatGroupTransition(current, navigation)
      if (transition) setLoneChatGroupPrompt(transition)
      persistWorkbenchNavigation(navigation)
      chatWorkbenchRevisionRef.current += 1
      chatWorkbenchLayoutRef.current = detached.layout
      setChatWorkbenchLayout(detached.layout)
      persistChatWorkbenchLayout(localStorage, stableWindowId, detached.layout)
      persistWorkbenchPresentation(detached.layout)
      if (terminalOwnerChatId) {
        setSelectedChatId(terminalOwnerChatId)
      } else {
        setOpenChatIds((currentIds) =>
          currentIds.includes(chatId) ? currentIds : [...currentIds, chatId],
        )
        void handleSelectOpenChatTab(chatId)
      }
    },
    [
      handleSelectOpenChatTab,
      openChatIds,
      persistWorkbenchNavigation,
      persistWorkbenchPresentation,
      recordWorkbenchMutation,
      setOpenChatIds,
      setSelectedChatId,
      standaloneTerminalIds,
      stableWindowId,
    ],
  )

  const openSidebarChatOnMainBar = useCallback(
    (chatId: string, target?: ChatWorkbenchNavigationItem, position?: "before" | "after") => {
      const visibleChatIds = [...new Set([...openChatIds, ...standaloneTerminalIds, chatId])]
      const current = chatWorkbenchNavigationRef.current
      const item = { kind: "chat" as const, id: chatId }
      const navigation =
        target && position
          ? reorderChatWorkbenchNavigationItem(current, visibleChatIds, item, target, position)
          : appendChatWorkbenchNavigationItem(current, visibleChatIds, item)
      recordWorkbenchMutation()
      persistWorkbenchNavigation(navigation)
      setOpenChatIds((currentIds) =>
        currentIds.includes(chatId) ? currentIds : [...currentIds, chatId],
      )
      handleSelectMainChatTab(chatId)
    },
    [
      handleSelectMainChatTab,
      openChatIds,
      persistWorkbenchNavigation,
      recordWorkbenchMutation,
      setOpenChatIds,
      standaloneTerminalIds,
    ],
  )

  const handleTopNavigationDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>, target: ChatWorkbenchNavigationItem) => {
      const source = readTopNavigationDragSource(event.dataTransfer)
      if (!source) return
      event.preventDefault()
      event.stopPropagation()
      const bounds = event.currentTarget.getBoundingClientRect()
      const sourceIsGrouped = groupedChatIds.has(source.chatId)
      const sourceIsSidebar =
        source.groupId === CHAT_WORKBENCH_EXTERNAL_GROUP_ID &&
        workbenchChatCatalog.some((chat) => chat.id === source.chatId)
      const intent =
        (sourceIsGrouped || sourceIsSidebar) && target.kind === "chat"
          ? resolveTopNavigationReorderIntent(event.clientX, bounds.left, bounds.width)
          : resolveTopNavigationDropIntent(event.clientX, bounds.left, bounds.width)
      const sourceIsOrdinary = openChatTabs.some((chat) => chat.id === source.chatId)
      const sourceIsTerminal = standaloneTerminalIds.includes(source.chatId)
      const sourceCanMoveToMainBar =
        sourceIsOrdinary || sourceIsGrouped || sourceIsTerminal || sourceIsSidebar
      const accepted = intent === "inside" || sourceCanMoveToMainBar
      event.dataTransfer.dropEffect = accepted ? "move" : "none"
      setMainBarDropActive(false)
      setTopNavigationDropTarget((current) => {
        if (!accepted) return current === null ? current : null
        return current?.item.kind === target.kind &&
          current.item.id === target.id &&
          current.intent === intent
          ? current
          : { item: target, intent }
      })
      if (intent === "inside" && source.chatId !== target.id) {
        scheduleTopNavigationEnter(target)
      } else {
        cancelTopNavigationEnter()
      }
      if (intent !== "inside") {
        topNavigationEnteredTargetRef.current = null
      }
    },
    [
      cancelTopNavigationEnter,
      groupedChatIds,
      openChatTabs,
      readTopNavigationDragSource,
      scheduleTopNavigationEnter,
      standaloneTerminalIds,
      workbenchChatCatalog,
    ],
  )

  const handleTopNavigationDrop = useCallback(
    (event: React.DragEvent<HTMLElement>, target: ChatWorkbenchNavigationItem) => {
      const source = readTopNavigationDragSource(event.dataTransfer)
      if (!source) return
      event.preventDefault()
      event.stopPropagation()
      const bounds = event.currentTarget.getBoundingClientRect()
      const sourceIsSidebar =
        source.groupId === CHAT_WORKBENCH_EXTERNAL_GROUP_ID &&
        workbenchChatCatalog.some((chat) => chat.id === source.chatId)
      const intent =
        (groupedChatIds.has(source.chatId) || sourceIsSidebar) && target.kind === "chat"
          ? resolveTopNavigationReorderIntent(event.clientX, bounds.left, bounds.width)
          : resolveTopNavigationDropIntent(event.clientX, bounds.left, bounds.width)
      if (intent === "inside") {
        if (source.chatId !== target.id) activateTopNavigationDropTarget(target)
        clearTopNavigationDropTarget()
        return
      }
      if (groupedChatIds.has(source.chatId)) {
        moveGroupedChatToMainBar(source.chatId, target, intent)
        clearTopNavigationDropTarget()
        return
      }
      if (sourceIsSidebar) {
        openSidebarChatOnMainBar(source.chatId, target, intent)
        clearTopNavigationDropTarget()
        return
      }
      const sourceIsTerminal = standaloneTerminalIds.includes(source.chatId)
      if (!openChatTabs.some((chat) => chat.id === source.chatId) && !sourceIsTerminal) {
        clearTopNavigationDropTarget()
        return
      }
      const navigation = reorderChatWorkbenchNavigationItem(
        chatWorkbenchNavigationRef.current,
        [...openChatTabs.map((chat) => chat.id), ...standaloneTerminalIds],
        { kind: "chat", id: source.chatId },
        target,
        intent,
      )
      recordWorkbenchMutation()
      persistWorkbenchNavigation(navigation)
      if (
        target.kind === "chat" &&
        !sourceIsTerminal &&
        !getTerminalPresentationChatId(target.id)
      ) {
        reorderOpenChatTab(source.chatId, target.id, intent)
      }
      clearTopNavigationDropTarget()
    },
    [
      activateTopNavigationDropTarget,
      clearTopNavigationDropTarget,
      groupedChatIds,
      moveGroupedChatToMainBar,
      openChatTabs,
      openSidebarChatOnMainBar,
      persistWorkbenchNavigation,
      readTopNavigationDragSource,
      recordWorkbenchMutation,
      reorderOpenChatTab,
      standaloneTerminalIds,
      workbenchChatCatalog,
    ],
  )

  const handleMainBarDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const source = readTopNavigationDragSource(event.dataTransfer)
      const sourceIsSidebar =
        source?.groupId === CHAT_WORKBENCH_EXTERNAL_GROUP_ID &&
        workbenchChatCatalog.some((chat) => chat.id === source.chatId)
      if (!source || (!groupedChatIds.has(source.chatId) && !sourceIsSidebar)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = "move"
      cancelTopNavigationEnter()
      setTopNavigationDropTarget(null)
      setMainBarDropActive(true)
    },
    [cancelTopNavigationEnter, groupedChatIds, readTopNavigationDragSource, workbenchChatCatalog],
  )

  const handleMainBarDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const source = readTopNavigationDragSource(event.dataTransfer)
      const sourceIsSidebar =
        source?.groupId === CHAT_WORKBENCH_EXTERNAL_GROUP_ID &&
        workbenchChatCatalog.some((chat) => chat.id === source.chatId)
      if (!source || (!groupedChatIds.has(source.chatId) && !sourceIsSidebar)) return
      event.preventDefault()
      if (sourceIsSidebar && !groupedChatIds.has(source.chatId)) {
        openSidebarChatOnMainBar(source.chatId)
      } else {
        moveGroupedChatToMainBar(source.chatId)
      }
      clearTopNavigationDropTarget()
    },
    [
      clearTopNavigationDropTarget,
      groupedChatIds,
      moveGroupedChatToMainBar,
      openSidebarChatOnMainBar,
      readTopNavigationDragSource,
      workbenchChatCatalog,
    ],
  )

  // Track previous chat ID for navigation after archive
  const [previousChatId, setPreviousChatId] = useAtom(previousAgentChatIdAtom)
  const prevSelectedChatIdRef = useRef<string | null>(null)

  // Update previousChatId when selectedChatId changes
  useEffect(() => {
    // Only update if we're switching from one chat to another
    if (prevSelectedChatIdRef.current && prevSelectedChatIdRef.current !== selectedChatId) {
      setPreviousChatId(prevSelectedChatIdRef.current)
    }
    prevSelectedChatIdRef.current = selectedChatId
  }, [selectedChatId, setPreviousChatId])

  // Note: Archive mutations moved to AgentsSidebar to share undo stack with Cmd+Z

  // Track hydration
  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // On mount: read URL → set atom
  useEffect(() => {
    if (isInitialized.current) return
    isInitialized.current = true

    const chatIdFromUrl = searchParams.get("chat")
    if (chatIdFromUrl) {
      setSelectedChatId(chatIdFromUrl)
    }
  }, [searchParams, setSelectedChatId])

  // When atom changes: update URL and increment NewChatForm key when returning to new chat view
  useEffect(() => {
    // Skip the first render - let the URL read effect set the initial value first
    // This prevents a race condition where this effect would clear the chat param
    // before the atom has been updated from the URL
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }

    const currentChatId = searchParams.get("chat")
    if (selectedChatId !== currentChatId) {
      const url = new URL(window.location.href)
      if (selectedChatId) {
        url.searchParams.set("chat", selectedChatId)
      } else {
        url.searchParams.delete("chat")
        // Increment key to force NewChatForm remount and trigger focus
        newChatFormKeyRef.current += 1
      }
      router.replace(url.pathname + url.search, { scroll: false })
    }
  }, [selectedChatId, searchParams, router, quickSwitchOpen])

  // Auto-close sidebars on mobile devices
  useEffect(() => {
    if (isMobile && isHydrated) {
      setSidebarOpen(false)
      setPreviewSidebarOpen(false)
    }
  }, [isMobile, isHydrated, setSidebarOpen, setPreviewSidebarOpen])

  // On mobile: when chat is selected, switch to chat mode
  useEffect(() => {
    if (isMobile && selectedChatId && mobileViewMode === "chats") {
      setMobileViewMode("chat")
    }
  }, [isMobile, selectedChatId, mobileViewMode, setMobileViewMode])

  // On mobile: when in terminal mode, sync with terminal sidebar close
  const terminalSidebarOpen = useAtomValue(terminalSidebarAtom)
  useEffect(() => {
    // If terminal sidebar closed while in terminal mode, go back to chat
    if (isMobile && mobileViewMode === "terminal" && !terminalSidebarOpen) {
      setMobileViewMode("chat")
    }
  }, [isMobile, mobileViewMode, terminalSidebarOpen, setMobileViewMode])

  // On mobile: show/hide native traffic lights based on view mode
  useEffect(() => {
    if (!isMobile) return
    if (typeof window === "undefined" || !window.desktopApi?.setTrafficLightVisibility) return

    window.desktopApi.setTrafficLightVisibility(mobileViewMode === "chats")
  }, [isMobile, mobileViewMode])

  // Get recent chats for quick-switch dialog
  // Order: current chat first (left), then previous chats by last updated
  // IMPORTANT: Only recalculate when dialog is closed to prevent flickering
  const sortedChats = agentChats
    ? [...agentChats].sort(
        (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
      )
    : []

  let recentChats: typeof sortedChats = []
  // Use frozen chats when dialog is open to prevent recalculation
  if (quickSwitchOpen && frozenRecentChatsRef.current && frozenRecentChatsRef.current.length > 0) {
    recentChats = frozenRecentChatsRef.current ?? []
  } else if (selectedChatId) {
    // Put current chat first, then take next 4
    const currentChat = sortedChats.find((c) => c.id === selectedChatId)
    const otherChats = sortedChats.filter((c) => c.id !== selectedChatId).slice(0, 4)
    recentChats = currentChat ? [currentChat, ...otherChats] : otherChats
  } else {
    recentChats = sortedChats.slice(0, 5)
  }

  // Keyboard navigation: Quick switch between workspaces
  // Shortcut depends on ctrlTabTarget preference:
  // - "workspaces" (default): Ctrl+Tab switches workspaces
  // - "agents": Opt+Ctrl+Tab switches workspaces
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Determine shortcut based on preference
      const isCtrlTabOnly = e.ctrlKey && e.key === "Tab" && !e.altKey && !e.metaKey
      const isOptCtrlTab = e.altKey && e.ctrlKey && e.key === "Tab" && !e.metaKey

      // Workspace switch: Ctrl+Tab by default, or Opt+Ctrl+Tab when ctrlTabTarget is "agents"
      const isWorkspaceSwitchShortcut =
        ctrlTabTarget === "workspaces" ? isCtrlTabOnly : isOptCtrlTab

      if (isWorkspaceSwitchShortcut) {
        e.preventDefault()
        wasShiftPressedRef.current = e.shiftKey

        if (recentChats.length === 0) return

        // If dialog is open, navigate through chats
        if (quickSwitchOpen) {
          let nextIndex: number
          if (e.shiftKey) {
            // Shift + Tab = Previous
            nextIndex = quickSwitchSelectedIndex - 1
            if (nextIndex < 0) {
              nextIndex = (frozenRecentChatsRef.current?.length ?? 1) - 1
            }
          } else {
            // Tab = Next
            nextIndex = (quickSwitchSelectedIndex + 1) % (frozenRecentChatsRef.current?.length ?? 1)
          }
          setQuickSwitchSelectedIndex(nextIndex)
          return
        }

        // If dialog is not open yet, start hold timer
        if (!quickSwitchOpen && !holdTimerRef.current) {
          modifierKeysHeldRef.current = true

          // Freeze current recentChats snapshot for this dialog session
          frozenRecentChatsRef.current = [...recentChats]

          // Start timer to show dialog after 30ms (almost instant)
          holdTimerRef.current = setTimeout(() => {
            // Clear timer ref AFTER it fires - this is critical for close detection
            holdTimerRef.current = null
            if (modifierKeysHeldRef.current) {
              // Show dialog
              setQuickSwitchOpen(true)

              // Current chat is always at index 0 (left), select next chat (index 1)
              // For Shift+Tab, select last chat
              if (wasShiftPressedRef.current) {
                // Shift: go to last chat
                setQuickSwitchSelectedIndex((frozenRecentChatsRef.current?.length ?? 1) - 1)
              } else {
                // Tab: go to next chat (index 1), or wrap to 0 if only one chat
                setQuickSwitchSelectedIndex((frozenRecentChatsRef.current?.length ?? 1) > 1 ? 1 : 0)
              }
            }
          }, 30)

          return
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      // ESC to close dialog without navigating
      if (e.key === "Escape" && quickSwitchOpen) {
        e.preventDefault()
        modifierKeysHeldRef.current = false
        isQuickSwitchingRef.current = false // Unblock selectedChatId changes

        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current)
          holdTimerRef.current = null
        }

        setQuickSwitchOpen(false)
        setQuickSwitchSelectedIndex(0)
        return
      }

      // When modifier key is released
      // For workspaces mode (Ctrl+Tab only): react to Control release
      // For agents mode (Opt+Ctrl+Tab): react to Alt or Control release
      const isRelevantKeyRelease =
        ctrlTabTarget === "workspaces"
          ? e.key === "Control"
          : e.key === "Alt" || e.key === "Control"

      if (isRelevantKeyRelease) {
        modifierKeysHeldRef.current = false

        // If timer is still running (quick press - dialog not shown yet)
        if (holdTimerRef.current) {
          clearTimeout(holdTimerRef.current)
          holdTimerRef.current = null
          isQuickSwitchingRef.current = false // Unblock

          // Do quick switch without showing dialog
          if (!isNavigatingRef.current && agentChats && agentChats.length > 0) {
            // Get sorted chat list
            const sortedChats = [...agentChats].sort(
              (a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime(),
            )
            isNavigatingRef.current = true
            setTimeout(() => {
              isNavigatingRef.current = false
            }, 300)

            // If no chat selected, select first one
            if (!selectedChatId) {
              setSelectedChatId(sortedChats[0].id)
              // agentChats are local chats only, so always set isRemote to false
              setSelectedChatIsRemote(false)
              setChatSourceMode("local")
              return
            }

            // Find current index
            const currentIndex = sortedChats.findIndex((chat) => chat.id === selectedChatId)

            if (currentIndex === -1) {
              setSelectedChatId(sortedChats[0].id)
              setSelectedChatIsRemote(false)
              setChatSourceMode("local")
              return
            }

            // Navigate forward or backward
            let nextIndex: number
            if (wasShiftPressedRef.current) {
              nextIndex = currentIndex - 1
              if (nextIndex < 0) {
                nextIndex = sortedChats.length - 1
              }
            } else {
              nextIndex = currentIndex + 1
              if (nextIndex >= sortedChats.length) {
                nextIndex = 0
              }
            }

            setSelectedChatId(sortedChats[nextIndex].id)
            setSelectedChatIsRemote(false)
            setChatSourceMode("local")
          }
          return
        }

        // If dialog is open, navigate to selected chat and close
        if (quickSwitchOpen) {
          const selectedChat = frozenRecentChatsRef.current?.[quickSwitchSelectedIndex]

          if (selectedChat) {
            setSelectedChatId(selectedChat.id)
            // agentChats are local chats only
            setSelectedChatIsRemote(false)
            setChatSourceMode("local")
          }

          setQuickSwitchOpen(false)
          setQuickSwitchSelectedIndex(0)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current)
      }
    }
  }, [
    agentChats,
    selectedChatId,
    setSelectedChatId,
    quickSwitchOpen,
    setQuickSwitchOpen,
    quickSwitchSelectedIndex,
    setQuickSwitchSelectedIndex,
    ctrlTabTarget,
    // Note: recentChats removed - we use frozenRecentChatsRef instead
  ])

  // Get open sub-chats for quick-switch (only tabs that are open in the selector)
  // Sorted by position in openSubChatIds, with active first
  // Limited to 5 items for quick-switch dialog
  const recentSubChats = useMemo(() => {
    if (!openSubChatIds || openSubChatIds.length === 0) return []

    // Get sub-chat metadata for open tabs
    const openSubChats = openSubChatIds
      .map((id) => allSubChats.find((c) => c.id === id))
      .filter((c): c is SubChatMeta => c !== undefined)

    if (openSubChats.length === 0) return []

    // Put active sub-chat first, keep rest in tab order, limit to 5
    if (activeSubChatId) {
      const activeChat = openSubChats.find((c) => c.id === activeSubChatId)
      const otherChats = openSubChats.filter((c) => c.id !== activeSubChatId).slice(0, 4)
      return activeChat ? [activeChat, ...otherChats] : openSubChats.slice(0, 5)
    }
    return openSubChats.slice(0, 5)
  }, [openSubChatIds, allSubChats, activeSubChatId])

  // Keyboard navigation: Quick switch between agents (sub-chats within workspace)
  // Shortcut depends on ctrlTabTarget preference:
  // - "workspaces" (default): Opt+Ctrl+Tab switches agents
  // - "agents": Ctrl+Tab switches agents
  // Uses refs for dialog state to avoid effect re-running and losing keyup events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Determine shortcut based on preference
      const isCtrlTabOnly = e.ctrlKey && e.key === "Tab" && !e.altKey && !e.metaKey
      const isOptCtrlTab = e.altKey && e.ctrlKey && e.key === "Tab" && !e.metaKey

      // Agent switch: Opt+Ctrl+Tab by default, or Ctrl+Tab when ctrlTabTarget is "agents"
      const isAgentSwitchShortcut = ctrlTabTarget === "agents" ? isCtrlTabOnly : isOptCtrlTab

      if (isAgentSwitchShortcut) {
        e.preventDefault()
        subChatWasShiftPressedRef.current = e.shiftKey

        // If dialog is open, navigate through sub-chats
        if (subChatQuickSwitchOpenRef.current) {
          let nextIndex: number
          if (e.shiftKey) {
            nextIndex = subChatQuickSwitchSelectedIndexRef.current - 1
            if (nextIndex < 0) {
              nextIndex = (frozenSubChatsRef.current?.length ?? 1) - 1
            }
          } else {
            nextIndex =
              (subChatQuickSwitchSelectedIndexRef.current + 1) %
              (frozenSubChatsRef.current?.length ?? 1)
          }
          setSubChatQuickSwitchSelectedIndex(nextIndex)
          return
        }

        // If dialog is not open yet, start hold timer
        if (!subChatQuickSwitchOpenRef.current && !subChatHoldTimerRef.current) {
          // Get fresh data from store for snapshot
          const store = useAgentSubChatStore.getState()
          const currentOpenIds = store.openSubChatIds
          const currentAllSubChats = store.allSubChats
          const currentActiveId = store.activeSubChatId

          if (currentOpenIds.length === 0) return

          subChatModifierKeysHeldRef.current = true

          // Build frozen snapshot from current store state
          const openSubChats = currentOpenIds
            .map((id) => currentAllSubChats.find((c) => c.id === id))
            .filter((c): c is SubChatMeta => c !== undefined)

          if (openSubChats.length === 0) return

          // Put active sub-chat first, limit to 5
          if (currentActiveId) {
            const activeChat = openSubChats.find((c) => c.id === currentActiveId)
            const otherChats = openSubChats.filter((c) => c.id !== currentActiveId).slice(0, 4)
            frozenSubChatsRef.current = activeChat
              ? [activeChat, ...otherChats]
              : openSubChats.slice(0, 5)
          } else {
            frozenSubChatsRef.current = openSubChats.slice(0, 5)
          }

          subChatHoldTimerRef.current = setTimeout(() => {
            // Clear timer ref AFTER it fires - this is critical for close detection
            subChatHoldTimerRef.current = null
            if (subChatModifierKeysHeldRef.current) {
              // Update ref immediately so keyUp can detect dialog is open
              // (before React re-renders and updates the ref from state)
              subChatQuickSwitchOpenRef.current = true
              setSubChatQuickSwitchOpen(true)
              if (subChatWasShiftPressedRef.current) {
                setSubChatQuickSwitchSelectedIndex((frozenSubChatsRef.current?.length ?? 1) - 1)
              } else {
                setSubChatQuickSwitchSelectedIndex(
                  (frozenSubChatsRef.current?.length ?? 1) > 1 ? 1 : 0,
                )
              }
            }
          }, 30)

          return
        }
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      // ESC to close dialog without navigating
      if (e.key === "Escape" && subChatQuickSwitchOpenRef.current) {
        e.preventDefault()
        subChatModifierKeysHeldRef.current = false

        if (subChatHoldTimerRef.current) {
          clearTimeout(subChatHoldTimerRef.current)
          subChatHoldTimerRef.current = null
        }

        setSubChatQuickSwitchOpen(false)
        setSubChatQuickSwitchSelectedIndex(0)
        return
      }

      // When modifier key is released
      // For agents mode (Ctrl+Tab): react to Control release
      // For workspaces mode (Opt+Ctrl+Tab): react to Alt or Control release
      const isRelevantKeyRelease =
        ctrlTabTarget === "agents" ? e.key === "Control" : e.key === "Alt" || e.key === "Control"

      if (isRelevantKeyRelease) {
        subChatModifierKeysHeldRef.current = false

        // If timer is still running (quick press - dialog not shown yet)
        if (subChatHoldTimerRef.current) {
          clearTimeout(subChatHoldTimerRef.current)
          subChatHoldTimerRef.current = null

          // Do quick switch without showing dialog (only between open tabs)
          const store = useAgentSubChatStore.getState()
          const currentOpenIds = store.openSubChatIds
          const currentActiveId = store.activeSubChatId

          if (currentOpenIds && currentOpenIds.length > 1) {
            if (!currentActiveId) {
              store.setActiveSubChat(currentOpenIds[0])
              return
            }

            const currentIndex = currentOpenIds.indexOf(currentActiveId)
            if (currentIndex === -1) {
              store.setActiveSubChat(currentOpenIds[0])
              return
            }

            let nextIndex: number
            if (subChatWasShiftPressedRef.current) {
              nextIndex = currentIndex - 1
              if (nextIndex < 0) nextIndex = currentOpenIds.length - 1
            } else {
              nextIndex = currentIndex + 1
              if (nextIndex >= currentOpenIds.length) nextIndex = 0
            }

            store.setActiveSubChat(currentOpenIds[nextIndex])
          }
          return
        }

        // If dialog is open, navigate to selected sub-chat and close
        if (subChatQuickSwitchOpenRef.current) {
          const selectedSubChat =
            frozenSubChatsRef.current?.[subChatQuickSwitchSelectedIndexRef.current]

          if (selectedSubChat) {
            useAgentSubChatStore.getState().setActiveSubChat(selectedSubChat.id)
          }

          setSubChatQuickSwitchOpen(false)
          setSubChatQuickSwitchSelectedIndex(0)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      if (subChatHoldTimerRef.current) {
        clearTimeout(subChatHoldTimerRef.current)
      }
    }
  }, [setSubChatQuickSwitchOpen, setSubChatQuickSwitchSelectedIndex, ctrlTabTarget])

  // Note: Cmd+E archive hotkey is handled in AgentsSidebar to share undo stack

  const handleSignOut = async () => {
    setBillingMethod(null)
    setAnthropicOnboardingCompleted(false)
    setApiKeyOnboardingCompleted(false)
    setCodexOnboardingCompleted(false)

    // Check if running in Electron desktop app
    if (typeof window !== "undefined" && window.desktopApi) {
      // Use desktop logout which clears the token and shows login page
      await window.desktopApi.logout()
    } else {
      // Web: use Clerk sign out
      await signOut({ redirectUrl: window.location.pathname })
    }
  }

  // Check if sub-chats data is loaded (use separate selectors to avoid object creation)
  const subChatsStoreChatId = useAgentSubChatStore((state) => state.chatId)
  const subChatsCount = useAgentSubChatStore((state) => state.allSubChats.length)

  // Check if sub-chats are still loading (store not yet initialized for this chat)
  const isLoadingSubChats =
    selectedChatId !== null && (subChatsStoreChatId !== selectedChatId || subChatsCount === 0)

  // Track sub-chats sidebar open state for animation control
  // Now renders even while loading to show spinner (mobile always uses tabs)
  const isSubChatsSidebarOpen =
    selectedChatId &&
    effectiveSubChatsSidebarMode === "sidebar" &&
    !isMobile &&
    !effectiveDesktopView

  useEffect(() => {
    // When sidebar closes, reset for animation on next open
    if (!isSubChatsSidebarOpen && wasSubChatsSidebarOpen.current) {
      hasOpenedSubChatsSidebar.current = false
      setShouldAnimateSubChatsSidebar(true)
    }
    wasSubChatsSidebarOpen.current = !!isSubChatsSidebarOpen

    // Mark as opened after animation completes
    if (isSubChatsSidebarOpen && !hasOpenedSubChatsSidebar.current) {
      const timer = setTimeout(() => {
        hasOpenedSubChatsSidebar.current = true
        setShouldAnimateSubChatsSidebar(false)
      }, 150 + 50) // 150ms duration + 50ms buffer
      return () => clearTimeout(timer)
    } else if (isSubChatsSidebarOpen && hasOpenedSubChatsSidebar.current) {
      setShouldAnimateSubChatsSidebar(false)
    }
  }, [isSubChatsSidebarOpen])

  // Check if chat has sandbox with port for preview
  const chatMeta = chatData?.meta as
    | {
        sandboxConfig?: { port?: number }
        isQuickSetup?: boolean
        repository?: string
      }
    | undefined
  const isQuickSetup = chatMeta?.isQuickSetup === true
  const canShowPreview = !!(chatData?.sandbox_id && !isQuickSetup && chatMeta?.sandboxConfig?.port)
  // Check if diff can be shown (sandbox exists)
  const canShowDiff = !!chatData?.sandbox_id

  // Check if terminal can be shown (worktree exists - desktop only)
  const worktreePath = (chatData as any)?.worktreePath as string | undefined
  const canShowTerminal = !!worktreePath

  // Terminal scope key for shared terminals
  const terminalScopeKey = useMemo(() => {
    if (!selectedChatId || !worktreePath) return `ws:${selectedChatId || "none"}`
    return getTerminalScopeKey({
      branch: (chatData as any)?.branch ?? null,
      worktreePath: worktreePath,
      id: selectedChatId,
    })
  }, [(chatData as any)?.branch, worktreePath, selectedChatId])

  // Mobile layout - completely different structure
  if (isMobile) {
    return (
      <div className="flex h-full bg-background" data-agents-page data-mobile-view>
        {/* Mobile: Settings fullscreen view */}
        {effectiveDesktopView === "orchestration-fleet" ? (
          <OrchestrationFleetView />
        ) : effectiveDesktopView === "automations" ? (
          <AutomationsView />
        ) : effectiveDesktopView === "automations-detail" ? (
          <AutomationsDetailView />
        ) : effectiveDesktopView === "inbox" ? (
          <InboxView />
        ) : effectiveDesktopView === "settings" ? (
          <SettingsContent />
        ) : effectiveDesktopView === "usage" ? (
          <div className="h-full overflow-y-auto select-text">
            <AgentsUsageTab />
          </div>
        ) : effectiveDesktopView === "tasks" ? (
          <KanbanView />
        ) : effectiveDesktopView === "plan" ? (
          <PlanView />
        ) : effectiveDesktopView === "project-vault" ? (
          <ProjectVaultView key={selectedProject?.id} />
        ) : effectiveDesktopView === "saved-workspaces" ? (
          <SavedWorkspacesView
            projectId={selectedProject?.id ?? null}
            initialProjectId={workspaceWindowParams.projectId}
            initialChatId={selectedChatId}
            initialWorkspaceId={workspaceWindowParams.workspaceId}
            popoutPaneId={workspaceWindowParams.paneId}
            initialSkipPaneId={workspaceWindowParams.skipPaneId}
          />
        ) : mobileViewMode === "chats" ? (
          // Chats List Mode (default) - uses AgentsSidebar in fullscreen
          <AgentsSidebar
            userId={userId}
            clerkUser={user}
            onSignOut={handleSignOut}
            onToggleSidebar={() => {}}
            isMobileFullscreen={true}
            onChatSelect={() => setMobileViewMode("chat")}
          />
        ) : mobileViewMode === "preview" && selectedChatId && canShowPreview ? (
          // Preview Mode
          <AgentPreview
            chatId={selectedChatId}
            sandboxId={chatData!.sandbox_id!}
            port={chatMeta?.sandboxConfig?.port!}
            isMobile={true}
            onClose={() => setMobileViewMode("chat")}
          />
        ) : mobileViewMode === "diff" && selectedChatId && canShowDiff ? (
          // Diff Mode - fullscreen diff view
          <AgentDiffView
            chatId={selectedChatId}
            sandboxId={chatData!.sandbox_id!}
            worktreePath={worktreePath}
            repository={chatMeta?.repository}
            showFooter={true}
            isMobile={true}
            onClose={() => setMobileViewMode("chat")}
          />
        ) : mobileViewMode === "terminal" && selectedChatId && canShowTerminal ? (
          // Terminal Mode - fullscreen terminal
          <TerminalSidebar
            chatId={selectedChatId}
            scopeKey={terminalScopeKey}
            cwd={worktreePath!}
            workspaceId={selectedChatId}
            isMobileFullscreen={true}
            onClose={() => setMobileViewMode("chat")}
          />
        ) : (
          // Chat Mode - shows either ChatView or NewChatForm
          <div
            className="h-full w-full flex flex-col overflow-hidden select-text"
            data-mobile-chat-mode
          >
            {selectedChatId ? (
              <ChatView
                key={`${chatSourceMode}-${selectedChatId}`}
                chatId={selectedChatId}
                isSidebarOpen={false}
                onToggleSidebar={() => {}}
                selectedTeamName={selectedTeam?.name}
                selectedTeamImageUrl={selectedTeam?.image_url}
                isMobileFullscreen={true}
                onBackToChats={() => {
                  setMobileViewMode("chats")
                  setSelectedChatId(null)
                }}
                onOpenPreview={canShowPreview ? () => setMobileViewMode("preview") : undefined}
                onOpenDiff={canShowDiff ? () => setMobileViewMode("diff") : undefined}
                onOpenTerminal={
                  canShowTerminal
                    ? () => {
                        setTerminalSidebarOpen(true)
                        setMobileViewMode("terminal")
                      }
                    : undefined
                }
              />
            ) : (
              // NewChatForm for creating new agent
              <div className="h-full flex flex-col relative overflow-hidden">
                <NewChatForm
                  isMobileFullscreen={true}
                  onBackToChats={() => setMobileViewMode("chats")}
                />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // Desktop layout
  return (
    <>
      <div className="flex h-full">
        {/* Sub-chats sidebar - only show in sidebar mode when viewing a chat */}
        {SUBCHATS_SIDEBAR_PANEL_ENABLED && (
          <ResizableSidebar
            isOpen={!!isSubChatsSidebarOpen}
            onClose={() => {
              setShouldAnimateSubChatsSidebar(true)
              setSubChatsSidebarMode("tabs")
            }}
            widthAtom={agentsSubChatsSidebarWidthAtom}
            minWidth={160}
            maxWidth={300}
            side="left"
            animationDuration={0}
            initialWidth={0}
            exitWidth={0}
            disableClickToClose={true}
          >
            <AgentsSubChatsSidebar
              onClose={() => {
                setShouldAnimateSubChatsSidebar(true)
                setSubChatsSidebarMode("tabs")
              }}
              isMobile={isMobile}
              isSidebarOpen={sidebarOpen}
              onBackToChats={() => setSidebarOpen((prev) => !prev)}
              isLoading={isLoadingSubChats}
              agentName={chatData?.name ?? undefined}
            />
          </ResizableSidebar>
        )}

        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-hidden" style={{ minWidth: "350px" }}>
          {effectiveDesktopView === "orchestration-fleet" ? (
            <OrchestrationFleetView />
          ) : effectiveDesktopView === "automations" ? (
            <AutomationsView />
          ) : effectiveDesktopView === "automations-detail" ? (
            <AutomationsDetailView />
          ) : effectiveDesktopView === "inbox" ? (
            <InboxView />
          ) : effectiveDesktopView === "settings" ? (
            <SettingsContent />
          ) : effectiveDesktopView === "usage" ? (
            <div className="h-full overflow-y-auto select-text">
              <AgentsUsageTab />
            </div>
          ) : effectiveDesktopView === "tasks" ? (
            <KanbanView />
          ) : effectiveDesktopView === "plan" ? (
            <PlanView />
          ) : effectiveDesktopView === "project-vault" ? (
            <ProjectVaultView key={selectedProject?.id} />
          ) : effectiveDesktopView === "saved-workspaces" ? (
            <SavedWorkspacesView
              projectId={selectedProject?.id ?? null}
              initialProjectId={workspaceWindowParams.projectId}
              initialChatId={selectedChatId}
              initialWorkspaceId={workspaceWindowParams.workspaceId}
              popoutPaneId={workspaceWindowParams.paneId}
              initialSkipPaneId={workspaceWindowParams.skipPaneId}
            />
          ) : selectedChatId || selectedDraftId || showNewChatForm ? (
            <div className="h-full flex flex-col relative overflow-hidden">
              {(openChatTabs.length > 0 ||
                openNewChatDrafts.length > 0 ||
                selectedDraftId ||
                showNewChatForm ||
                chatWorkbenchNavigation.groups.length > 0 ||
                standaloneTerminalIds.length > 0) && (
                <div
                  className="relative h-[43px] shrink-0 border-b-2 border-border bg-muted/30"
                  style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
                  onMouseEnter={() => {
                    setOpenChatTabsHovered(true)
                    updateOpenChatScrollbar()
                  }}
                  onMouseLeave={() => setOpenChatTabsHovered(false)}
                >
                  <div
                    ref={openChatTabsRef}
                    data-chat-main-bar-drop-target
                    data-chat-main-bar-drop-active={mainBarDropActive || undefined}
                    className={[
                      "scrollbar-hide relative flex h-full items-start overflow-x-auto px-px pr-10 pt-1 transition-[background-color,box-shadow]",
                      mainBarDropActive ? "bg-primary/10 ring-1 ring-inset ring-primary/70" : "",
                    ].join(" ")}
                    onScroll={updateOpenChatScrollbar}
                    onDragOver={handleMainBarDragOver}
                    onDrop={handleMainBarDrop}
                    onDragLeave={(event) => {
                      const next = event.relatedTarget
                      if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
                        clearTopNavigationDropTarget()
                      }
                    }}
                  >
                    {!selectedChatIsRemote &&
                      chatWorkbenchNavigation.groups.map((group) => {
                        const isActive = chatWorkbenchNavigation.activeGroupId === group.id
                        const hasUnseenChanges = collectChatGroups(group.layout.root).some((pane) =>
                          pane.chatIds.some((chatId) => unseenChatIds.has(chatId)),
                        )
                        return (
                          <ContextMenu key={group.id}>
                            <ContextMenuTrigger asChild>
                              <div
                                data-workbench-navigation-group={group.id}
                                data-top-navigation-item-kind="group"
                                data-top-navigation-item-id={group.id}
                                data-top-navigation-drop-intent={
                                  topNavigationDropTarget?.item.kind === "group" &&
                                  topNavigationDropTarget.item.id === group.id
                                    ? topNavigationDropTarget.intent
                                    : undefined
                                }
                                onDragOver={(event) =>
                                  handleTopNavigationDragOver(event, {
                                    kind: "group",
                                    id: group.id,
                                  })
                                }
                                onDrop={(event) =>
                                  handleTopNavigationDrop(event, { kind: "group", id: group.id })
                                }
                                onDragLeave={(event) => {
                                  if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                                    clearTopNavigationDropTarget()
                                  }
                                }}
                                className={[
                                  "group relative flex h-9 min-w-28 max-w-56 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 pl-2 pr-1 text-left text-xs transition-[background-color,border-color,color,box-shadow]",
                                  isActive
                                    ? "border-foreground/50 bg-muted font-semibold text-foreground shadow-sm ring-1 ring-inset ring-foreground/20"
                                    : "border-border/40 bg-muted/25 text-foreground/90 hover:border-border/70 hover:bg-muted/70 hover:text-foreground",
                                  topNavigationDropTarget?.item.kind === "group" &&
                                  topNavigationDropTarget.item.id === group.id &&
                                  topNavigationDropTarget.intent === "inside"
                                    ? "ring-1 ring-inset ring-primary/80"
                                    : "",
                                ].join(" ")}
                                style={
                                  {
                                    WebkitAppRegion: "no-drag",
                                    order: topNavigationOrder.get(`group:${group.id}`),
                                    backgroundColor: resolveGroupTabBackground(
                                      group.color,
                                      isActive,
                                    ),
                                    borderColor: resolveGroupTabBorder(group.color, isActive),
                                  } as React.CSSProperties
                                }
                              >
                                {topNavigationDropTarget?.item.kind === "group" &&
                                  topNavigationDropTarget.item.id === group.id &&
                                  topNavigationDropTarget.intent !== "inside" && (
                                    <span
                                      aria-hidden
                                      data-top-navigation-insertion={topNavigationDropTarget.intent}
                                      className={[
                                        "pointer-events-none absolute bottom-0 top-1 z-20 w-0.5 rounded-full bg-blue-500",
                                        topNavigationDropTarget.intent === "before"
                                          ? "-left-px"
                                          : "-right-px",
                                      ].join(" ")}
                                    />
                                  )}
                                {isActive && (
                                  <span
                                    aria-hidden
                                    data-active-group-indicator
                                    className="pointer-events-none absolute inset-x-1 bottom-0 h-1 rounded-t-full bg-primary"
                                    style={{
                                      backgroundColor: group.color
                                        ? GROUP_COLOR_SWATCHES[group.color]
                                        : undefined,
                                    }}
                                  />
                                )}
                                <PanelsTopLeft className="h-3.5 w-3.5 shrink-0 text-foreground/80" />
                                <button
                                  type="button"
                                  aria-current={isActive ? "page" : undefined}
                                  className="min-w-0 flex-1 truncate text-left font-medium text-foreground"
                                  onClick={() => handleSelectWorkbenchGroup(group.id)}
                                >
                                  {group.name}
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Close ${group.name}`}
                                  className={[
                                    "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground/70 hover:bg-foreground/20 hover:text-foreground group-hover:opacity-100",
                                    hasUnseenChanges ? "opacity-100" : "opacity-60",
                                  ].join(" ")}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleCloseWorkbenchGroup(group.id)
                                  }}
                                >
                                  {hasUnseenChanges && (
                                    <span
                                      aria-hidden
                                      data-group-unseen-indicator={group.id}
                                      className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
                                    >
                                      <span className="h-2 w-2 rounded-full bg-[#307BD0]" />
                                    </span>
                                  )}
                                  <X
                                    className={[
                                      "h-3.5 w-3.5",
                                      hasUnseenChanges
                                        ? "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                                        : "",
                                    ].join(" ")}
                                  />
                                </button>
                              </div>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-48">
                              <ContextMenuItem
                                onSelect={() =>
                                  setRenamingWorkbenchGroup({ id: group.id, name: group.name })
                                }
                              >
                                Rename group…
                              </ContextMenuItem>
                              <ContextMenuSub>
                                <ContextMenuSubTrigger>Group color</ContextMenuSubTrigger>
                                <ContextMenuSubContent className="w-44">
                                  {CHAT_WORKBENCH_GROUP_COLORS.map((color) => (
                                    <ContextMenuItem
                                      key={color}
                                      onSelect={() => handleSetWorkbenchGroupColor(group.id, color)}
                                    >
                                      <span
                                        aria-hidden
                                        className="h-3 w-3 rounded-full ring-1 ring-white/20"
                                        style={{ backgroundColor: GROUP_COLOR_SWATCHES[color] }}
                                      />
                                      <span className="capitalize">{color}</span>
                                      {group.color === color && <span className="ml-auto">✓</span>}
                                    </ContextMenuItem>
                                  ))}
                                </ContextMenuSubContent>
                              </ContextMenuSub>
                              <ContextMenuSeparator />
                              <ContextMenuItem onSelect={() => handleCloseWorkbenchGroup(group.id)}>
                                Close group
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        )
                      })}
                    {standaloneTerminalIds.map((presentationId) => {
                      const ownerChatId = getTerminalPresentationChatId(presentationId)!
                      const owner = workbenchChatCatalog.find((chat) => chat.id === ownerChatId)
                      const isActive =
                        chatWorkbenchNavigation.activeGroupId === null &&
                        collectChatGroups(chatWorkbenchLayout.root).some((pane) =>
                          pane.chatIds.includes(presentationId),
                        )
                      return (
                        <ContextMenu key={presentationId}>
                          <ContextMenuTrigger asChild>
                            <div
                              data-top-navigation-item-kind="chat"
                              data-top-navigation-item-id={presentationId}
                              draggable
                              onDragStart={(event) => {
                                const source = {
                                  chatId: presentationId,
                                  groupId: CHAT_WORKBENCH_EXTERNAL_GROUP_ID,
                                  sourceWindowId: stableWindowId,
                                }
                                const serialized = JSON.stringify(source)
                                event.dataTransfer.setData(CHAT_WORKBENCH_DRAG_MIME, serialized)
                                localStorage.setItem(CHAT_WORKBENCH_DRAG_SESSION_KEY, serialized)
                              }}
                              onDragEnd={() => {
                                localStorage.removeItem(CHAT_WORKBENCH_DRAG_SESSION_KEY)
                                clearTopNavigationDropTarget()
                              }}
                              onDragOver={(event) =>
                                handleTopNavigationDragOver(event, {
                                  kind: "chat",
                                  id: presentationId,
                                })
                              }
                              onDrop={(event) =>
                                handleTopNavigationDrop(event, {
                                  kind: "chat",
                                  id: presentationId,
                                })
                              }
                              className={[
                                "group relative flex h-9 min-w-28 max-w-56 items-center gap-1.5 rounded-t-md border border-b-0 pl-3 pr-1 text-left text-xs",
                                isActive
                                  ? "border-foreground/20 bg-muted font-medium text-foreground shadow-sm"
                                  : "border-border/40 bg-muted/25 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                              ].join(" ")}
                              style={
                                {
                                  WebkitAppRegion: "no-drag",
                                  order: topNavigationOrder.get(`chat:${presentationId}`),
                                } as React.CSSProperties
                              }
                            >
                              <SquareTerminal className="h-3.5 w-3.5 shrink-0" />
                              <button
                                type="button"
                                className="min-w-0 flex-1 truncate text-left"
                                onClick={() => handleSelectStandaloneTerminal(presentationId)}
                              >
                                Terminal{owner?.name ? ` â€” ${owner.name}` : ""}
                              </button>
                              <button
                                type="button"
                                aria-label="Close Terminal"
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 hover:bg-foreground/20 hover:text-foreground group-hover:opacity-100"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleCloseStandaloneTerminal(presentationId)
                                }}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem
                              onSelect={() => handleCloseStandaloneTerminal(presentationId)}
                            >
                              Close Terminal
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      )
                    })}
                    {openChatTabs.map((chat) => {
                      const isActive =
                        chatWorkbenchNavigation.activeGroupId === null && chat.id === selectedChatId
                      const hasUnseenChanges = unseenChatIds.has(chat.id)
                      const underlineColor = resolveOpenChatTabUnderlineColor(
                        chat,
                        openChatProjectColors,
                      )
                      const menuIndex =
                        openChatContextMenuId === chat.id
                          ? openChatTabs.findIndex(({ id }) => id === chat.id)
                          : -1
                      const tabsToRight =
                        menuIndex >= 0 ? openChatTabs.slice(menuIndex + 1).map(({ id }) => id) : []
                      const otherTabs =
                        menuIndex >= 0
                          ? openChatTabs.filter(({ id }) => id !== chat.id).map(({ id }) => id)
                          : []
                      return (
                        <ContextMenu
                          key={chat.id}
                          onOpenChange={(open) => setOpenChatContextMenuId(open ? chat.id : null)}
                        >
                          <ContextMenuTrigger asChild>
                            <div
                              data-open-chat-tab-id={chat.id}
                              data-top-navigation-item-kind="chat"
                              data-top-navigation-item-id={chat.id}
                              data-top-navigation-drop-intent={
                                topNavigationDropTarget?.item.kind === "chat" &&
                                topNavigationDropTarget.item.id === chat.id
                                  ? topNavigationDropTarget.intent
                                  : undefined
                              }
                              draggable={!selectedChatIsRemote}
                              onDragStart={(event) => {
                                if (selectedChatIsRemote) {
                                  event.preventDefault()
                                  return
                                }
                                configureChatDragFeedback(
                                  event.dataTransfer,
                                  chat.name || "New Chat",
                                )
                                const source = {
                                  chatId: chat.id,
                                  groupId: CHAT_WORKBENCH_EXTERNAL_GROUP_ID,
                                  sourceWindowId: stableWindowId,
                                }
                                const serialized = JSON.stringify(source)
                                event.dataTransfer.setData(CHAT_WORKBENCH_DRAG_MIME, serialized)
                                localStorage.setItem(CHAT_WORKBENCH_DRAG_SESSION_KEY, serialized)
                              }}
                              onDragEnd={() => {
                                localStorage.removeItem(CHAT_WORKBENCH_DRAG_SESSION_KEY)
                                clearTopNavigationDropTarget()
                              }}
                              onDragOver={(event) =>
                                handleTopNavigationDragOver(event, { kind: "chat", id: chat.id })
                              }
                              onDrop={(event) =>
                                handleTopNavigationDrop(event, { kind: "chat", id: chat.id })
                              }
                              onDragLeave={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                                  clearTopNavigationDropTarget()
                                }
                              }}
                              className={[
                                "group relative flex h-9 max-w-56 min-w-28 items-center gap-1.5 rounded-t-md border border-b-0 pl-3 pr-1 text-left text-xs transition-[background-color,border-color,color,box-shadow]",
                                isActive
                                  ? "border-foreground/20 bg-muted font-medium text-foreground shadow-sm"
                                  : "border-border/40 bg-muted/25 text-muted-foreground hover:border-border/70 hover:bg-muted/70 hover:text-foreground",
                                topNavigationDropTarget?.item.kind === "chat" &&
                                topNavigationDropTarget.item.id === chat.id &&
                                topNavigationDropTarget.intent === "inside"
                                  ? "ring-1 ring-inset ring-primary/80"
                                  : "",
                              ].join(" ")}
                              style={
                                {
                                  WebkitAppRegion: "no-drag",
                                  order: topNavigationOrder.get(`chat:${chat.id}`),
                                } as React.CSSProperties
                              }
                            >
                              <button
                                type="button"
                                className="min-w-0 flex-1 truncate text-left"
                                onClick={() => handleSelectMainChatTab(chat.id)}
                              >
                                {chat.name || "New Chat"}
                                {hasUnseenChanges && (
                                  <span className="sr-only">, new response</span>
                                )}
                              </button>
                              <button
                                type="button"
                                data-open-chat-tab-action
                                aria-label={`Close ${chat.name || "chat"}`}
                                className={[
                                  "relative flex h-8 w-8 translate-y-0.5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,box-shadow,color,opacity] hover:bg-foreground/20 hover:text-foreground hover:ring-1 hover:ring-inset hover:ring-foreground/35 group-hover:opacity-100",
                                  hasUnseenChanges
                                    ? "opacity-100"
                                    : isActive
                                      ? "opacity-60"
                                      : "opacity-0",
                                ].join(" ")}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleCloseOpenChatTab(chat.id)
                                }}
                              >
                                {hasUnseenChanges && (
                                  <span
                                    aria-hidden
                                    data-open-chat-unseen-indicator={chat.id}
                                    className="absolute inset-0 flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
                                  >
                                    <span className="h-2 w-2 rounded-full bg-[#307BD0]" />
                                  </span>
                                )}
                                <X
                                  className={[
                                    "h-4 w-4",
                                    hasUnseenChanges
                                      ? "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                                      : "",
                                  ].join(" ")}
                                />
                              </button>
                              <span
                                aria-hidden
                                className="pointer-events-none absolute inset-x-0 top-0 h-0.5 opacity-[0.55]"
                                style={{ backgroundColor: underlineColor }}
                              />
                              {topNavigationDropTarget?.item.kind === "chat" &&
                                topNavigationDropTarget.item.id === chat.id &&
                                topNavigationDropTarget.intent !== "inside" && (
                                  <span
                                    aria-hidden
                                    data-top-navigation-insertion={topNavigationDropTarget.intent}
                                    className={[
                                      "pointer-events-none absolute bottom-0 top-1 z-20 w-0.5 rounded-full bg-blue-500 shadow-[0_0_0_1px_rgba(59,130,246,0.2)]",
                                      topNavigationDropTarget.intent === "before"
                                        ? "-left-px"
                                        : "-right-px",
                                    ].join(" ")}
                                  />
                                )}
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-48">
                            <ContextMenuSub>
                              <ContextMenuSubTrigger
                                disabled={chatWorkbenchNavigation.groups.length === 0}
                              >
                                Move
                              </ContextMenuSubTrigger>
                              <ContextMenuSubContent className="w-52">
                                {chatWorkbenchNavigation.groups.map((group) => (
                                  <ContextMenuItem
                                    key={group.id}
                                    onSelect={() =>
                                      handleMoveChatToWorkbenchGroup(chat.id, group.id)
                                    }
                                  >
                                    {group.name}
                                  </ContextMenuItem>
                                ))}
                              </ContextMenuSubContent>
                            </ContextMenuSub>
                            <ContextMenuItem
                              onSelect={() => handleCreateWorkbenchGroupFromChat(chat.id)}
                            >
                              Add to new group
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onSelect={() => handleCloseOpenChatTab(chat.id)}>
                              Close
                            </ContextMenuItem>
                            <ContextMenuItem
                              disabled={otherTabs.length === 0}
                              onSelect={() => handleCloseOpenChatTabs(otherTabs, chat.id)}
                            >
                              Close Other Tabs
                            </ContextMenuItem>
                            <ContextMenuItem
                              disabled={tabsToRight.length === 0}
                              onSelect={() => handleCloseOpenChatTabs(tabsToRight, chat.id)}
                            >
                              Close Tabs to the Right
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onSelect={() => handleCloseOpenChatTabs(openChatIds)}>
                              Close All Tabs
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      )
                    })}
                    {openNewChatDrafts.map((draft) => {
                      const isActive =
                        !selectedChatId &&
                        (selectedDraftId === draft.id || activeNewChatDraftId === draft.id)
                      return (
                        <div
                          key={draft.id}
                          data-open-draft-tab-id={draft.id}
                          className={[
                            "group relative flex h-9 min-w-28 max-w-56 items-center gap-1.5 rounded-t-md border border-b-0 pl-3 pr-1 text-left text-xs",
                            isActive
                              ? "border-foreground/20 bg-muted font-medium text-foreground shadow-sm"
                              : "border-border/40 bg-muted/25 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                          ].join(" ")}
                          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                        >
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left"
                            onClick={() => handleSelectOpenDraftTab(draft.id)}
                          >
                            New Chat
                          </button>
                          <button
                            type="button"
                            aria-label="Close New Chat"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 hover:bg-foreground/20 hover:text-foreground group-hover:opacity-100"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleCloseNewChatTab(draft.id)
                            }}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })}
                    {!selectedChatId &&
                      (showNewChatForm || selectedDraftId) &&
                      !openNewChatDrafts.some(
                        (draft) => draft.id === (selectedDraftId ?? activeNewChatDraftId),
                      ) && (
                        <div
                          data-new-chat-tab="true"
                          className="group relative flex h-9 min-w-28 max-w-56 items-center gap-1.5 rounded-t-md border border-b-0 border-foreground/20 bg-muted pl-3 pr-1 text-left text-xs font-medium text-foreground shadow-sm"
                          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
                        >
                          <span className="min-w-0 flex-1 truncate text-left">New Chat</span>
                          <button
                            type="button"
                            aria-label="Close New Chat"
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-60 hover:bg-foreground/20 hover:text-foreground group-hover:opacity-100"
                            onClick={() => handleCloseNewChatTab(activeNewChatDraftId)}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    <button
                      type="button"
                      data-main-taskbar-new-chat
                      aria-label="Open a new Chat"
                      title={
                        lastMessagedProjectId && projectsMap.has(lastMessagedProjectId)
                          ? `New Chat in ${projectsMap.get(lastMessagedProjectId)?.name}`
                          : "New Global Chat"
                      }
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/70"
                      style={
                        { WebkitAppRegion: "no-drag", order: 2_147_483_647 } as React.CSSProperties
                      }
                      onClick={handleOpenNewChatFromMainBar}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </button>
                    {mainBarDropActive && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute right-2 top-1/2 z-30 -translate-y-1/2 rounded bg-background/90 px-2 py-1 text-xs font-medium text-foreground shadow-sm"
                      >
                        Move to main bar
                      </span>
                    )}
                  </div>
                  {openChatScrollbar.width > 0 && (
                    <span
                      aria-hidden
                      className={[
                        "pointer-events-none absolute bottom-0 h-0.5 bg-muted-foreground/45 transition-opacity duration-100",
                        openChatTabsHovered ? "opacity-100" : "opacity-0",
                      ].join(" ")}
                      style={{ left: openChatScrollbar.left, width: openChatScrollbar.width }}
                    />
                  )}
                </div>
              )}
              {!selectedChatId && (selectedDraftId || showNewChatForm) ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <NewChatForm
                    key={`new-chat-${newChatFormSession}-${newChatFormKeyRef.current}`}
                    onDraftIdChange={setActiveNewChatDraftId}
                  />
                </div>
              ) : selectedChatIsRemote ? (
                <ChatView
                  key={`${chatSourceMode}-${selectedChatId}`}
                  chatId={selectedChatId!}
                  isSidebarOpen={sidebarOpen}
                  onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
                  selectedTeamName={selectedTeam?.name}
                  selectedTeamImageUrl={selectedTeam?.image_url}
                />
              ) : (
                <ChatWorkbench
                  chats={workbenchChats}
                  layout={chatWorkbenchLayout}
                  onLayoutChange={handleChatWorkbenchChange}
                  onActiveChatChange={handleWorkbenchActiveChatChange}
                  onChatViewed={handleChatViewed}
                  readOnlyChatIds={readOnlyWorkbenchChatIds}
                  windowId={stableWindowId}
                  onCrossWindowDrop={dropChatIntoCurrentWindow}
                  onDragOutside={dropChatOutside}
                  onClaimOwnership={claimReadOnlyChat}
                  onSaveAsWorkspace={saveChatWorkbenchAsWorkspace}
                  showPaneHeaders={Boolean(chatWorkbenchNavigation.activeGroupId)}
                  savedGroups={chatWorkbenchNavigation.groups.map(({ id, name }) => ({ id, name }))}
                  activeSavedGroupId={chatWorkbenchNavigation.activeGroupId}
                  onMoveChatToMainBar={moveGroupedChatToMainBar}
                  onMoveChatToGroup={handleMoveChatToWorkbenchGroup}
                  onCreateGroupFromChat={handleCreateWorkbenchGroupFromChat}
                  renderChat={renderWorkbenchChat}
                />
              )}
            </div>
          ) : selectedChatScope ? (
            <div className="h-full flex flex-col overflow-hidden bg-background">
              <div className="shrink-0 border-b border-border/70 px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {selectedChatScope.type === "global"
                        ? "Global"
                        : selectedChatScope.type === "project"
                          ? "Project"
                          : "Task"}
                    </div>
                    <h2 className="truncate text-lg font-semibold text-foreground">
                      {selectedChatScope.name}
                    </h2>
                  </div>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setSelectedDraftId(null)
                      setNewChatFormSession((session) => session + 1)
                      setShowNewChatForm(true)
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    New Chat
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-auto px-6 py-4">
                {scopeChats.length > 0 ? (
                  <div className="grid gap-2">
                    {scopeChats.map((chat) => {
                      const task = chat.taskId ? scopeTasksById.get(chat.taskId) : null
                      const context = getScopeChatContext(chat, task)
                      const updatedAt =
                        chat.updatedAt ??
                        (
                          chat as typeof chat & {
                            updated_at?: Date | string | number | null
                          }
                        ).updated_at
                      return (
                        <button
                          key={chat.id}
                          type="button"
                          className="flex items-center gap-3 rounded-md border border-border/70 bg-card px-3 py-2 text-left transition-colors hover:bg-muted/60"
                          onClick={() => {
                            setSelectedChatId(chat.id)
                            setSelectedChatIsRemote(false)
                            setChatSourceMode("local")
                          }}
                        >
                          <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">
                              {chat.name || "New Chat"}
                            </div>
                            {(context.taskName || context.testFixture) && (
                              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                {context.taskName && (
                                  <span className="max-w-full truncate">
                                    Task: {context.taskName}
                                  </span>
                                )}
                                {context.taskArchived && (
                                  <span className="rounded bg-muted px-1.5 py-0.5">
                                    Archived task
                                  </span>
                                )}
                                {context.testFixture && (
                                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-500">
                                    Test fixture
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {formatScopeChatTimestamp(updatedAt)}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="flex h-full min-h-64 items-center justify-center text-sm text-muted-foreground">
                    No chats in this {selectedChatScope.type} yet.
                  </div>
                )}
              </div>
            </div>
          ) : !selectedProject ? (
            <SelectRepoPage embedded />
          ) : (
            <div className="flex h-full items-center justify-center bg-background px-6 text-sm text-muted-foreground">
              Select a chat, project, or task.
            </div>
          )}
        </div>
      </div>

      <RenameDialog
        isOpen={renamingWorkbenchGroup !== null}
        onClose={() => setRenamingWorkbenchGroup(null)}
        onSave={saveRenamedWorkbenchGroup}
        currentName={renamingWorkbenchGroup?.name ?? ""}
        title="Rename group"
        placeholder="Group name"
      />

      <AlertDialog
        open={groupClosePromptId !== null}
        onOpenChange={(open) => {
          if (open) return
          setGroupClosePromptId(null)
          setRememberGroupCloseChoice(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this group?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody className="space-y-4">
            <AlertDialogDescription>
              Choose whether to close every Chat in the group or keep the Chats open as separate
              tabs on the main bar.
            </AlertDialogDescription>
            <label
              htmlFor="remember-group-close-choice"
              className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
            >
              <Checkbox
                id="remember-group-close-choice"
                checked={rememberGroupCloseChoice}
                onCheckedChange={(checked) => setRememberGroupCloseChoice(checked === true)}
              />
              <span>Always use this choice</span>
            </label>
          </AlertDialogBody>
          <AlertDialogFooter className="flex-wrap">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleGroupCloseChoice("keep-chats")}>
              Keep Chats on main bar
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground shadow-sm shadow-black/5 hover:bg-destructive/90"
              onClick={() => handleGroupCloseChoice("close-chats")}
            >
              Close all Chats
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={loneChatGroupPrompt !== null}
        onOpenChange={(open) => {
          if (!open) setLoneChatGroupPrompt(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keep this one-Chat group?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogBody>
            <AlertDialogDescription>
              This move leaves one Chat in the group. Keep the group, or remove it and place the
              remaining Chat on the main bar?
            </AlertDialogDescription>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLoneChatGroupPrompt(null)}>
              Keep group
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveLoneChatGroup}>Remove group</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Quick-switch dialog - Agents (Opt+Ctrl+Tab) */}
      <AgentsQuickSwitchDialog
        isOpen={quickSwitchOpen}
        chats={(quickSwitchOpen ? (frozenRecentChatsRef.current ?? []) : recentChats).map(
          (chat) => ({
            ...chat,
            name: chat.name ?? "Untitled chat",
            meta: null,
            sandbox_id: null,
            updated_at: chat.updatedAt ?? new Date(),
            projectId: chat.projectId ?? "",
          }),
        )}
        selectedIndex={quickSwitchSelectedIndex}
        projectsMap={projectsMap}
        onHover={setQuickSwitchSelectedIndex}
      />

      {/* Quick-switch dialog - Sub-chats (Ctrl+Tab) */}
      <SubChatsQuickSwitchDialog
        isOpen={subChatQuickSwitchOpen}
        subChats={subChatQuickSwitchOpen ? (frozenSubChatsRef.current ?? []) : recentSubChats}
        selectedIndex={subChatQuickSwitchSelectedIndex}
        onHover={setSubChatQuickSwitchSelectedIndex}
      />

      {/* Dev mode / Admin sandbox debugger */}
      {(process.env.NODE_ENV === "development" || isAdmin) && chatData?.sandbox_id && (
        <a
          href={`https://codesandbox.io/p/devbox/${chatData.sandbox_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-4 right-4 z-50 bg-zinc-900 text-zinc-300 px-3 py-1.5 rounded-md text-xs font-mono opacity-70 hover:opacity-100 hover:bg-zinc-800 transition-all cursor-pointer"
        >
          sandbox: {chatData.sandbox_id}
        </a>
      )}
    </>
  )
}

export function AgentsContent() {
  return (
    <DictationSessionProvider>
      <AgentInputPoller />
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            LoadingÃ¢â‚¬Â¦
          </div>
        }
      >
        <AgentsContentInner />
      </Suspense>
    </DictationSessionProvider>
  )
}
