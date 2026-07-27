import { Provider as JotaiProvider, useAtomValue, useSetAtom } from "jotai"
import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, useMemo } from "react"
import { Toaster } from "sonner"
import { McpApprovalBridge } from "./features/mcp-safety/approval-bridge"
import { McpExternalMutationRefreshBridge } from "./features/mcp-safety/external-mutation-refresh"
import { TooltipProvider } from "./components/ui/tooltip"
import { TRPCProvider } from "./contexts/TRPCProvider"
import {
  WindowProvider,
  claimInitialWindowParamsApplication,
  getInitialWindowParams,
} from "./contexts/WindowContext"
import {
  selectedProjectAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedDraftIdAtom,
  showNewChatFormAtom,
  desktopViewAtom,
} from "./features/agents/atoms"
import { useAgentSubChatStore } from "./features/agents/stores/sub-chat-store"
import { AgentsLayout } from "./features/layout/agents-layout"
import { DevTestControlBridge } from "./features/settings/dev-test-control-bridge"
import {
  AnthropicOnboardingPage,
  ApiKeyOnboardingPage,
  BillingMethodPage,
  CodexOnboardingPage,
  SelectRepoPage,
} from "./features/onboarding"
import { identify, initAnalytics, shutdown } from "./lib/analytics"
import {
  anthropicOnboardingCompletedAtom,
  apiKeyOnboardingCompletedAtom,
  billingMethodAtom,
  codexOnboardingCompletedAtom,
} from "./lib/atoms"
import { appStore } from "./lib/jotai-store"
import { subscribeCliLaunchDirectories } from "./lib/cli-launch-directory"
import { VSCodeThemeProvider } from "./lib/themes/theme-provider"
import { trpc } from "./lib/trpc"
import { trpcClient } from "./lib/trpc"
import {
  CREDENTIAL_MIGRATION_STATUS_EVENT,
  migrateLegacyCredentials,
  recordCredentialMigrationStatus,
} from "./lib/credential-migration"

/**
 * Custom Toaster that adapts to theme
 */
function ThemedToaster() {
  const { resolvedTheme } = useTheme()

  return (
    <Toaster
      position="bottom-right"
      theme={resolvedTheme as "light" | "dark" | "system"}
      closeButton
    />
  )
}

/**
 * Main content router - decides which page to show based on onboarding state
 */
function AppContent() {
  const initialWindowParams = useMemo(() => getInitialWindowParams(), [])
  const billingMethod = useAtomValue(billingMethodAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const anthropicOnboardingCompleted = useAtomValue(anthropicOnboardingCompletedAtom)
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const apiKeyOnboardingCompleted = useAtomValue(apiKeyOnboardingCompletedAtom)
  const setApiKeyOnboardingCompleted = useSetAtom(apiKeyOnboardingCompletedAtom)
  const codexOnboardingCompleted = useAtomValue(codexOnboardingCompletedAtom)
  const setCodexOnboardingCompleted = useSetAtom(codexOnboardingCompletedAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const setSelectedProject = useSetAtom(selectedProjectAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setSelectedChatIsRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const { setActiveSubChat, addToOpenSubChats, setChatId } = useAgentSubChatStore()
  const trpcUtils = trpc.useUtils()
  const { mutateAsync: openLaunchDirectory } = trpc.projects.openLaunchDirectory.useMutation()

  useEffect(
    () =>
      subscribeCliLaunchDirectories({
        subscribe: (callback) => window.desktopApi.onCliOpenDirectory(callback),
        openNext: openLaunchDirectory,
        onOpened: async (project) => {
          await trpcUtils.projects.list.invalidate()
          setSelectedProject({
            id: project.id,
            name: project.name,
            path: project.path,
            gitRemoteUrl: project.gitRemoteUrl,
            gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
            gitOwner: project.gitOwner,
            gitRepo: project.gitRepo,
          })
          setSelectedChatIsRemote(false)
          setSelectedDraftId(null)
          setSelectedChatId(null)
          setChatId(null)
          setShowNewChatForm(true)
          setDesktopView(null)
        },
        onError: (error) => console.warn("[CLI] Failed to open launch directory:", error),
      }),
    [
      openLaunchDirectory,
      setChatId,
      setDesktopView,
      setSelectedChatId,
      setSelectedChatIsRemote,
      setSelectedDraftId,
      setSelectedProject,
      setShowNewChatForm,
      trpcUtils.projects.list,
    ],
  )

  useEffect(
    () =>
      window.desktopApi.onDevMcpViewChanged(async (payload) => {
        if (payload.action === "project-created") {
          await trpcUtils.projects.list.invalidate()
          const refreshedProjects = await trpcUtils.projects.list.fetch()
          const project = refreshedProjects.find((item) => item.id === payload.projectId)
          if (project) {
            setSelectedProject({
              id: project.id,
              name: project.name,
              path: project.path,
              gitRemoteUrl: project.gitRemoteUrl,
              gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
              gitOwner: project.gitOwner,
              gitRepo: project.gitRepo,
            })
          }
          return
        }
        if (payload.action === "project-archived") {
          await Promise.all([
            trpcUtils.projects.list.invalidate(),
            trpcUtils.projects.listArchived.invalidate(),
          ])
          if (selectedProject?.id === payload.projectId) setSelectedProject(null)
          return
        }
        if (payload.action === "chat-opened") {
          await Promise.all([
            trpcUtils.chats.list.invalidate(),
            trpcUtils.chats.get.invalidate({ id: payload.chatId }),
          ])
          setSelectedChatIsRemote(false)
          setSelectedDraftId(null)
          setShowNewChatForm(false)
          setSelectedChatId(payload.chatId)
          setChatId(payload.chatId)
          if (payload.subChatId) {
            addToOpenSubChats(payload.subChatId)
            setActiveSubChat(payload.subChatId)
          }
          return
        }
        if (payload.action === "orchestration-changed") {
          await Promise.all([
            trpcUtils.tasks.list.invalidate(),
            trpcUtils.chats.list.invalidate(),
            ...payload.chatIds.map((chatId) => trpcUtils.chats.get.invalidate({ id: chatId })),
            trpcUtils.spawnedAgents.getTaskOverview.invalidate({ taskId: payload.taskId }),
            trpcUtils.spawnedAgents.getLineage.invalidate({ taskId: payload.taskId }),
            trpcUtils.savedWorkspaces.getOperation.invalidate(),
            ...payload.chatIds.map((chatId) =>
              trpcUtils.spawnedAgents.previewLineage.invalidate({ chatId }),
            ),
          ])
          return
        }
        await Promise.all([
          trpcUtils.chats.list.invalidate(),
          trpcUtils.chats.listArchived.invalidate(),
        ])
      }),
    [
      addToOpenSubChats,
      selectedProject?.id,
      setActiveSubChat,
      setChatId,
      setSelectedChatId,
      setSelectedChatIsRemote,
      setSelectedDraftId,
      setSelectedProject,
      setShowNewChatForm,
      trpcUtils.chats.list,
      trpcUtils.chats.listArchived,
      trpcUtils.projects.list,
      trpcUtils.projects.listArchived,
      trpcUtils.savedWorkspaces.getOperation,
      trpcUtils.spawnedAgents.getLineage,
      trpcUtils.spawnedAgents.getTaskOverview,
      trpcUtils.spawnedAgents.previewLineage,
      trpcUtils.tasks.list,
    ],
  )

  useEffect(() => {
    if (!window.desktopApi?.onDevMcpSettingsChanged) return
    return window.desktopApi.onDevMcpSettingsChanged(({ domains }) => {
      if (domains.includes("credentials")) {
        void Promise.all([
          trpcUtils.credentials.listStatuses.invalidate(),
          trpcUtils.codex.getIntegration.invalidate(),
          trpcUtils.voice.hasOpenAIKey.invalidate(),
        ])
      }
      if (domains.includes("provider-extensions")) {
        void trpcUtils.providerExtensions.list.invalidate()
      }
      if (domains.includes("permissions")) {
        void Promise.all([
          trpcUtils.permissions.getPreferences.invalidate(),
          trpcUtils.permissions.getGlobalDefault.invalidate(),
          trpcUtils.permissions.listChatModes.invalidate(),
          trpcUtils.permissions.resolveForChat.invalidate(),
        ])
      }
    })
  }, [trpcUtils])

  useEffect(() => {
    void migrateLegacyCredentials(localStorage, trpcClient).then(async (report) => {
      recordCredentialMigrationStatus(sessionStorage, report)
      window.dispatchEvent(new Event(CREDENTIAL_MIGRATION_STATUS_EVENT))
      if (report.migrated.length > 0) {
        await Promise.all([
          trpcUtils.credentials.listStatuses.invalidate(),
          trpcUtils.codex.getIntegration.invalidate(),
          trpcUtils.voice.hasOpenAIKey.invalidate(),
        ])
      }
      for (const retained of report.retained) {
        console.warn(`[Credentials] Legacy migration retained ${retained.key}: ${retained.reason}`)
      }
    })
  }, [trpcUtils])

  // Apply initial window params (chatId/subChatId) when opening via "Open in new window"
  useEffect(() => {
    const params = initialWindowParams
    if (!claimInitialWindowParamsApplication(params)) return
    if (params.workspaceId) {
      setShowNewChatForm(false)
      setDesktopView("saved-workspaces")
      setSelectedProject(null)
      if (params.projectId) {
        void trpcUtils.projects.list.fetch().then((projects) => {
          const project = projects.find((item) => item.id === params.projectId)
          if (!project) return
          setSelectedProject({
            id: project.id,
            name: project.name,
            path: project.path,
            gitRemoteUrl: project.gitRemoteUrl,
            gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
            gitOwner: project.gitOwner,
            gitRepo: project.gitRepo,
          })
        })
      }
    }
    if (params.chatId) {
      console.log("[App] Opening chat from window params:", params.chatId, params.subChatId)
      setSelectedChatId(params.chatId)
      setChatId(params.chatId)
      if (params.subChatId) {
        addToOpenSubChats(params.subChatId)
        setActiveSubChat(params.subChatId)
      }
    }
  }, [
    addToOpenSubChats,
    initialWindowParams,
    setActiveSubChat,
    setChatId,
    setDesktopView,
    setSelectedChatId,
    setSelectedProject,
    setShowNewChatForm,
    trpcUtils.projects.list,
  ])

  // Claim the initially selected chat to prevent duplicate windows.
  // For new windows opened via "Open in new window", the chat is pre-claimed by main process.
  // For restored windows (persisted localStorage), we need to claim here.
  // Read atom directly from store to avoid stale closure with empty deps.
  useEffect(() => {
    if (!window.desktopApi?.claimChat) return
    const currentChatId = appStore.get(selectedAgentChatIdAtom)
    if (!currentChatId) return
    window.desktopApi.claimChat(currentChatId).then((result) => {
      if (!result.ok) {
        // Another window already has this chat - clear our selection
        setSelectedChatId(null)
      }
    })
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Check if user has existing CLI config (API key or proxy)
  // Based on PR #29 by @sa4hnd
  const { data: cliConfig, isLoading: isLoadingCliConfig } =
    trpc.claudeCode.hasExistingCliConfig.useQuery()
  const claudeIntegration = trpc.claudeCode.getIntegration.useQuery(undefined, { retry: 1 })
  const customClaudeCredential = trpc.credentials.status.useQuery(
    { id: "claude.custom-api-token" },
    { retry: 1 },
  )
  const codexIntegration = trpc.codex.getIntegration.useQuery(undefined, { retry: 1 })

  // Migration: If user already completed Anthropic onboarding but has no billing method set,
  // automatically set it to "claude-subscription" (legacy users before billing method was added)
  useEffect(() => {
    if (!billingMethod && anthropicOnboardingCompleted) {
      setBillingMethod("claude-subscription")
    }
  }, [billingMethod, anthropicOnboardingCompleted, setBillingMethod])

  // Auto-skip onboarding if user has existing CLI config (API key or proxy)
  // This allows users with ANTHROPIC_API_KEY to use the app without OAuth
  useEffect(() => {
    if (cliConfig?.hasConfig && !billingMethod) {
      console.log("[App] Detected existing CLI config, auto-completing onboarding")
      if (cliConfig.hasSystemToken) {
        setBillingMethod("claude-subscription")
        setAnthropicOnboardingCompleted(true)
      } else {
        setBillingMethod("api-key")
        setApiKeyOnboardingCompleted(true)
      }
    }
  }, [
    cliConfig?.hasConfig,
    cliConfig?.hasSystemToken,
    billingMethod,
    setAnthropicOnboardingCompleted,
    setApiKeyOnboardingCompleted,
    setBillingMethod,
  ])

  // Completion flags are navigation hints only. Keep them aligned with actual
  // local credentials so a removed or unreadable credential cannot masquerade
  // as a live provider connection.
  useEffect(() => {
    if (!claudeIntegration.data) return
    setAnthropicOnboardingCompleted(claudeIntegration.data.isConnected)
  }, [claudeIntegration.data, setAnthropicOnboardingCompleted])

  useEffect(() => {
    if (!customClaudeCredential.data) return
    setApiKeyOnboardingCompleted(customClaudeCredential.data.configured)
  }, [customClaudeCredential.data, setApiKeyOnboardingCompleted])

  useEffect(() => {
    const state = codexIntegration.data?.state
    if (state === "connected_chatgpt" || state === "connected_api_key") {
      setCodexOnboardingCompleted(true)
    } else if (state === "not_logged_in") {
      setCodexOnboardingCompleted(false)
    }
  }, [codexIntegration.data?.state, setCodexOnboardingCompleted])

  // Fetch projects to validate selectedProject exists
  const { data: projects, isLoading: isLoadingProjects } = trpc.projects.list.useQuery()

  // Validated project - only valid if exists in DB
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    // While loading, trust localStorage value to prevent flicker
    if (isLoadingProjects) return selectedProject
    // After loading, validate against DB
    if (!projects) return null
    const exists = projects.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projects, isLoadingProjects])

  if (!billingMethod) {
    if (isLoadingCliConfig) return <ProviderCheckPage />
    return <BillingMethodPage />
  }

  const claudeSubscriptionConnected = claudeIntegration.data?.isConnected === true
  const customClaudeConnected = customClaudeCredential.data?.configured === true
  const codexState = codexIntegration.data?.state
  const codexMethodConnected =
    billingMethod === "codex-subscription"
      ? codexState === "connected_chatgpt"
      : billingMethod === "codex-api-key"
        ? codexState === "connected_api_key"
        : false

  const selectedProviderCheckPending =
    (billingMethod === "claude-subscription" && claudeIntegration.isLoading) ||
    ((billingMethod === "api-key" || billingMethod === "custom-model") &&
      customClaudeCredential.isLoading) ||
    ((billingMethod === "codex-subscription" || billingMethod === "codex-api-key") &&
      codexIntegration.isLoading)

  if (selectedProviderCheckPending) return <ProviderCheckPage />

  const claudeStatusFallback = claudeIntegration.isError && anthropicOnboardingCompleted
  if (
    billingMethod === "claude-subscription" &&
    !claudeSubscriptionConnected &&
    !claudeStatusFallback
  ) {
    return <AnthropicOnboardingPage />
  }

  if (
    (billingMethod === "codex-subscription" || billingMethod === "codex-api-key") &&
    !codexMethodConnected &&
    !(codexIntegration.isError && codexOnboardingCompleted)
  ) {
    return <CodexOnboardingPage />
  }

  if (
    (billingMethod === "api-key" || billingMethod === "custom-model") &&
    !customClaudeConnected &&
    !(customClaudeCredential.isError && apiKeyOnboardingCompleted)
  ) {
    return <ApiKeyOnboardingPage />
  }

  if (!validatedProject && !isLoadingProjects) {
    return <SelectRepoPage />
  }

  return <AgentsLayout />
}

function ProviderCheckPage() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">
      Checking local provider connections…
    </div>
  )
}

export function App() {
  // Initialize analytics on mount
  useEffect(() => {
    initAnalytics()

    // Sync analytics opt-out status to main process
    const syncOptOutStatus = async () => {
      try {
        const optOut = localStorage.getItem("preferences:analytics-opt-out") === "true"
        await window.desktopApi?.setAnalyticsOptOut(optOut)
      } catch (error) {
        console.warn("[Analytics] Failed to sync opt-out status:", error)
      }
    }
    syncOptOutStatus()

    // Identify user if already authenticated
    const identifyUser = async () => {
      try {
        const user = await window.desktopApi?.getUser()
        if (user?.id) {
          identify(user.id, { email: user.email, name: user.name })
        }
      } catch (error) {
        console.warn("[Analytics] Failed to identify user:", error)
      }
    }
    identifyUser()

    // Cleanup on unmount
    return () => {
      shutdown()
    }
  }, [])

  return (
    <WindowProvider>
      <JotaiProvider store={appStore}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <VSCodeThemeProvider>
            <TooltipProvider delayDuration={100}>
              <TRPCProvider>
                <div
                  data-agents-page
                  className="h-screen w-screen bg-background text-foreground overflow-hidden"
                >
                  <AppContent />
                </div>
                <ThemedToaster />
                <McpApprovalBridge />
                <McpExternalMutationRefreshBridge />
                <DevTestControlBridge />
              </TRPCProvider>
            </TooltipProvider>
          </VSCodeThemeProvider>
        </ThemeProvider>
      </JotaiProvider>
    </WindowProvider>
  )
}
