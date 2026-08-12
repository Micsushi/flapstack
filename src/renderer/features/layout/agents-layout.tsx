import { useCallback, useEffect, useState, useMemo, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { toast } from "sonner"
import { isDesktopApp } from "../../lib/utils/platform"
import { useIsMobile } from "../../lib/hooks/use-mobile"

import {
  agentsSidebarOpenAtom,
  agentsSidebarWidthAtom,
  agentsSettingsDialogActiveTabAtom,
  agentsSettingsDialogOpenAtom,
  apiKeyOnboardingCompletedAtom,
  billingMethodAtom,
  claudeLoginModalConfigAtom,
  codexOnboardingCompletedAtom,
  isDesktopAtom,
  isFullscreenAtom,
  anthropicOnboardingCompletedAtom,
  customHotkeysAtom,
  recordingHotkeyForActionAtom,
} from "../../lib/atoms"
import {
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedProjectAtom,
  selectedDraftIdAtom,
  showNewChatFormAtom,
  desktopViewAtom,
  fileSearchDialogOpenAtom,
} from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { useAgentsHotkeys } from "../agents/lib/agents-hotkeys-manager"
import { toggleSearchAtom } from "../agents/search"
import { ClaudeLoginModal } from "../../components/dialogs/claude-login-modal"
import { CodexLoginModal } from "../../components/dialogs/codex-login-modal"
import { TooltipProvider } from "../../components/ui/tooltip"
import { ResizableSidebar } from "../../components/ui/resizable-sidebar"
import { AgentsSidebar } from "../sidebar/agents-sidebar"
import { AgentsContent } from "../agents/ui/agents-content"
import { WindowsTitleBar } from "../../components/windows-title-bar"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import {
  AGENTS_SIDEBAR_WIDTH_MIGRATION_KEY,
  MAX_AGENTS_SIDEBAR_WIDTH,
  migrateAgentsSidebarWidth,
} from "../agents/lib/sidebar-width"
import { QueueProcessor } from "../agents/components/queue-processor"
import { SettingsSidebar } from "../settings/settings-sidebar"
import { ProductTour } from "../onboarding/product-tour"

// ============================================================================
// Constants
// ============================================================================

const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = MAX_AGENTS_SIDEBAR_WIDTH
const SIDEBAR_ANIMATION_DURATION = 0
const NAVIGATION_HISTORY_LIMIT = 100
const SIDEBAR_CLOSE_HOTKEY = "⌘\\"

// ============================================================================
// Component
// ============================================================================

export function AgentsLayout() {
  // No useHydrateAtoms - desktop doesn't need SSR, atomWithStorage handles persistence
  const isMobile = useIsMobile()

  // Global desktop/fullscreen state - initialized here at root level
  const [isDesktop, setIsDesktop] = useAtom(isDesktopAtom)
  const [isFullscreen, setIsFullscreen] = useAtom(isFullscreenAtom)

  // Initialize isDesktop on mount
  useEffect(() => {
    setIsDesktop(isDesktopApp())
  }, [setIsDesktop])

  // Subscribe to fullscreen changes from Electron
  useEffect(() => {
    if (!isDesktop || typeof window === "undefined" || !window.desktopApi?.windowIsFullscreen)
      return

    // Get initial fullscreen state
    window.desktopApi.windowIsFullscreen().then(setIsFullscreen)

    // In dev mode, HMR breaks IPC event subscriptions, so we poll instead
    const isDev = import.meta.env.DEV
    if (isDev) {
      const interval = setInterval(() => {
        window.desktopApi?.windowIsFullscreen?.().then(setIsFullscreen)
      }, 300)
      return () => clearInterval(interval)
    }

    // In production, use events (more efficient)
    const unsubscribe = window.desktopApi.onFullscreenChange?.(setIsFullscreen)
    return unsubscribe
  }, [isDesktop, setIsFullscreen])

  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [sidebarWidth, setSidebarWidth] = useAtom(agentsSidebarWidthAtom)
  const [settingsActiveTab, setSettingsActiveTab] = useAtom(agentsSettingsDialogActiveTabAtom)
  const setSettingsDialogOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setFileSearchDialogOpen = useSetAtom(fileSearchDialogOpenAtom)
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const [selectedChatIsRemote, setSelectedChatIsRemote] = useAtom(selectedChatIsRemoteAtom)
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const [selectedDraftId, setSelectedDraftId] = useAtom(selectedDraftIdAtom)
  const [showNewChatForm, setShowNewChatForm] = useAtom(showNewChatFormAtom)
  const [desktopView, setDesktopView] = useAtom(desktopViewAtom)
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const setApiKeyOnboardingCompleted = useSetAtom(apiKeyOnboardingCompletedAtom)
  const setCodexOnboardingCompleted = useSetAtom(codexOnboardingCompletedAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const claudeLoginModalConfig = useAtomValue(claudeLoginModalConfigAtom)
  useEffect(() => {
    if (typeof window === "undefined") return
    const migrationApplied =
      window.localStorage.getItem(AGENTS_SIDEBAR_WIDTH_MIGRATION_KEY) === "complete"
    const migratedWidth = migrateAgentsSidebarWidth(sidebarWidth, migrationApplied)
    if (migratedWidth !== sidebarWidth) setSidebarWidth(migratedWidth)
    if (!migrationApplied) {
      window.localStorage.setItem(AGENTS_SIDEBAR_WIDTH_MIGRATION_KEY, "complete")
    }
  }, [setSidebarWidth, sidebarWidth])

  // Fetch projects to validate selectedProject exists
  const { data: projects, isLoading: isLoadingProjects } = trpc.projects.list.useQuery()

  // Validated project - only valid if exists in DB
  // While loading, trust localStorage value to prevent clearing on app restart
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    // While loading, trust localStorage value to prevent flicker and clearing
    if (isLoadingProjects) return selectedProject
    // After loading, validate against DB
    if (!projects) return null
    const exists = projects.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projects, isLoadingProjects])

  // Clear invalid project from storage (only after loading completes)
  useEffect(() => {
    if (selectedProject && projects && !isLoadingProjects && !validatedProject) {
      setSelectedProject(null)
    }
  }, [selectedProject, projects, isLoadingProjects, validatedProject, setSelectedProject])

  // Show/hide native traffic lights based on sidebar and fullscreen state
  // This also re-syncs visibility when leaving fullscreen.
  // When settings view is active, don't control traffic lights here -
  // SettingsSidebar manages its own visibility (always hidden).
  const isSettingsView = desktopView === "settings"
  useEffect(() => {
    if (!isDesktop) return
    if (isSettingsView) return // SettingsSidebar handles its own traffic light state
    if (typeof window === "undefined" || !window.desktopApi?.setTrafficLightVisibility) return

    window.desktopApi.setTrafficLightVisibility(sidebarOpen)
  }, [sidebarOpen, isDesktop, isFullscreen, isSettingsView])

  const setChatId = useAgentSubChatStore((state) => state.setChatId)

  type NavigationSnapshot = {
    selectedChatId: string | null
    selectedChatIsRemote: boolean
    selectedProject: typeof selectedProject
    selectedDraftId: string | null
    showNewChatForm: boolean
    desktopView: typeof desktopView
  }
  const currentNavigationSnapshot = useMemo<NavigationSnapshot>(
    () => ({
      selectedChatId,
      selectedChatIsRemote,
      selectedProject,
      selectedDraftId,
      showNewChatForm,
      desktopView,
    }),
    [
      desktopView,
      selectedChatId,
      selectedChatIsRemote,
      selectedDraftId,
      selectedProject,
      showNewChatForm,
    ],
  )
  const navigationKey = JSON.stringify({
    chatId: selectedChatId,
    remote: selectedChatIsRemote,
    projectId: selectedProject?.id ?? null,
    draftId: selectedDraftId,
    newChat: showNewChatForm,
    view: desktopView,
  })
  const navigationHistoryRef = useRef({
    entries: [currentNavigationSnapshot],
    index: 0,
    applyingKey: null as string | null,
  })
  const [navigationIndex, setNavigationIndex] = useState(0)
  const [navigationLength, setNavigationLength] = useState(1)

  useEffect(() => {
    const history = navigationHistoryRef.current
    if (history.applyingKey === navigationKey) {
      history.applyingKey = null
      return
    }
    const current = history.entries[history.index]
    const currentKey = JSON.stringify({
      chatId: current.selectedChatId,
      remote: current.selectedChatIsRemote,
      projectId: current.selectedProject?.id ?? null,
      draftId: current.selectedDraftId,
      newChat: current.showNewChatForm,
      view: current.desktopView,
    })
    if (currentKey === navigationKey) {
      history.entries[history.index] = currentNavigationSnapshot
      return
    }
    history.entries = [
      ...history.entries.slice(0, history.index + 1),
      currentNavigationSnapshot,
    ].slice(-NAVIGATION_HISTORY_LIMIT)
    history.index = history.entries.length - 1
    setNavigationIndex(history.index)
    setNavigationLength(history.entries.length)
  }, [currentNavigationSnapshot, navigationKey])

  const moveInNavigationHistory = useCallback(
    (direction: -1 | 1) => {
      const history = navigationHistoryRef.current
      const nextIndex = history.index + direction
      const snapshot = history.entries[nextIndex]
      if (!snapshot) return
      history.index = nextIndex
      history.applyingKey = JSON.stringify({
        chatId: snapshot.selectedChatId,
        remote: snapshot.selectedChatIsRemote,
        projectId: snapshot.selectedProject?.id ?? null,
        draftId: snapshot.selectedDraftId,
        newChat: snapshot.showNewChatForm,
        view: snapshot.desktopView,
      })
      setNavigationIndex(nextIndex)
      setSelectedChatId(snapshot.selectedChatId)
      setSelectedChatIsRemote(snapshot.selectedChatIsRemote)
      setSelectedProject(snapshot.selectedProject)
      setSelectedDraftId(snapshot.selectedDraftId)
      setShowNewChatForm(snapshot.showNewChatForm)
      setDesktopView(snapshot.desktopView)
      setChatId(snapshot.selectedChatId)
    },
    [
      setChatId,
      setDesktopView,
      setSelectedChatId,
      setSelectedChatIsRemote,
      setSelectedDraftId,
      setSelectedProject,
      setShowNewChatForm,
    ],
  )

  useEffect(() => {
    const handleMouseHistory = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      moveInNavigationHistory(event.button === 3 ? -1 : 1)
    }
    window.addEventListener("mouseup", handleMouseHistory)
    return () => window.removeEventListener("mouseup", handleMouseHistory)
  }, [moveInNavigationHistory])

  // Desktop user state
  const [desktopUser, setDesktopUser] = useState<{
    id: string
    email: string
    name: string | null
    imageUrl: string | null
    username: string | null
  } | null>(null)

  // Fetch desktop user on mount
  useEffect(() => {
    async function fetchUser() {
      if (window.desktopApi?.getUser) {
        const user = await window.desktopApi.getUser()
        setDesktopUser(user)
      }
    }
    fetchUser()
  }, [])

  // Track if this is the initial load - skip auto-open on first load to respect saved state
  const isInitialLoadRef = useRef(true)

  // Auto-open sidebar when project is selected, close when no project
  // Skip on initial load to preserve user's saved sidebar preference
  useEffect(() => {
    if (!projects) return // Don't change sidebar state while loading

    // On initial load, just mark as loaded and don't change sidebar state
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false
      return
    }

    // After initial load, react to project changes
    if (validatedProject) setSidebarOpen(true)
  }, [validatedProject, projects, setSidebarOpen])

  // Worktree setup failures from main process
  useEffect(() => {
    if (typeof window === "undefined") return
    const desktopApi = window.desktopApi as any
    if (!desktopApi?.onWorktreeSetupFailed) return

    const unsubscribe = desktopApi.onWorktreeSetupFailed(
      (payload: { kind: "create-failed" | "setup-failed"; message: string; projectId: string }) => {
        const errorMessage = payload.message.replace(/\s+/g, " ").trim()
        const title =
          payload.kind === "create-failed" ? "Worktree creation failed" : "Worktree setup failed"

        toast.error(title, {
          description: errorMessage || undefined,
          duration: 10000,
          action: {
            label: "Open settings",
            onClick: () => {
              const projectMatch = projects?.find((project) => project.id === payload.projectId)
              if (projectMatch) {
                setSelectedProject(projectMatch as any)
              }
              setSettingsActiveTab("projects")
              setSettingsDialogOpen(true)
            },
          },
        })
      },
    )

    return unsubscribe
  }, [projects, setSelectedProject, setSettingsActiveTab, setSettingsDialogOpen])

  // Handle sign out
  const handleSignOut = useCallback(async () => {
    // Reset onboarding/provider selection state on logout.
    setSelectedProject(null)
    setSelectedChatId(null)
    setBillingMethod(null)
    setAnthropicOnboardingCompleted(false)
    setApiKeyOnboardingCompleted(false)
    setCodexOnboardingCompleted(false)
    if (window.desktopApi?.logout) {
      await window.desktopApi.logout()
    }
  }, [
    setSelectedProject,
    setSelectedChatId,
    setBillingMethod,
    setAnthropicOnboardingCompleted,
    setApiKeyOnboardingCompleted,
    setCodexOnboardingCompleted,
  ])

  // Clear sub-chat store when no chat is selected
  useEffect(() => {
    if (!selectedChatId) {
      setChatId(null)
    }
  }, [selectedChatId, setChatId])

  // Chat search toggle
  const toggleChatSearch = useSetAtom(toggleSearchAtom)

  const customHotkeysConfig = useAtomValue(customHotkeysAtom)
  const recordingHotkeyForAction = useAtomValue(recordingHotkeyForActionAtom)

  // Initialize hotkeys manager
  useAgentsHotkeys(
    {
      setSelectedChatId,
      setSelectedDraftId,
      setShowNewChatForm,
      setDesktopView,
      setSidebarOpen,
      setSettingsActiveTab,
      setFileSearchDialogOpen,
      toggleChatSearch,
      selectedChatId,
      desktopView,
      hasSelectedProject: Boolean(selectedProject),
      customHotkeysConfig,
    },
    { enabled: recordingHotkeyForAction === null },
  )

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false)
  }, [setSidebarOpen])

  return (
    <TooltipProvider delayDuration={300}>
      {/* Global queue processor - handles message queues for all sub-chats */}
      <QueueProcessor />
      <ClaudeLoginModal
        hideCustomModelSettingsLink={claudeLoginModalConfig.hideCustomModelSettingsLink}
        autoStartAuth={claudeLoginModalConfig.autoStartAuth}
      />
      <CodexLoginModal />
      <ProductTour />
      <div className="flex flex-col w-full h-full relative overflow-hidden bg-background select-none">
        {/* Windows Title Bar (only shown on Windows with frameless window) */}
        <WindowsTitleBar
          canGoBack={navigationIndex > 0}
          canGoForward={navigationIndex < navigationLength - 1}
          onBack={() => moveInNavigationHistory(-1)}
          onForward={() => moveInNavigationHistory(1)}
        />
        {isSettingsView && isDesktop && (
          <div
            className="h-8 flex-shrink-0 border-b border-border/50 bg-background"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            aria-hidden="true"
            data-settings-title-bar
          />
        )}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar - switches between chat list and settings nav */}
          <ResizableSidebar
            isOpen={!isMobile && (isSettingsView || sidebarOpen)}
            onClose={handleCloseSidebar}
            widthAtom={agentsSidebarWidthAtom}
            minWidth={SIDEBAR_MIN_WIDTH}
            maxWidth={SIDEBAR_MAX_WIDTH}
            side="left"
            closeHotkey={SIDEBAR_CLOSE_HOTKEY}
            animationDuration={SIDEBAR_ANIMATION_DURATION}
            initialWidth={0}
            exitWidth={0}
            showResizeTooltip={!isSettingsView}
            disableClickToClose={true}
            className="overflow-hidden bg-background border-r"
            style={{ borderRightWidth: "0.5px" }}
          >
            {isSettingsView ? (
              <SettingsSidebar />
            ) : (
              <AgentsSidebar
                desktopUser={
                  desktopUser ? { ...desktopUser, name: desktopUser.name ?? undefined } : null
                }
                onSignOut={handleSignOut}
                onToggleSidebar={handleCloseSidebar}
              />
            )}
          </ResizableSidebar>

          {/* Main Content */}
          <div className="flex-1 overflow-hidden flex flex-col min-w-0">
            <AgentsContent />
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
