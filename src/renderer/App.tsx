import { Provider as JotaiProvider, useAtomValue, useSetAtom } from "jotai"
import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, useMemo } from "react"
import { Toaster } from "sonner"
import { McpApprovalBridge } from "./features/mcp-safety/approval-bridge"
import { McpExternalMutationRefreshBridge } from "./features/mcp-safety/external-mutation-refresh"
import { TooltipProvider } from "./components/ui/tooltip"
import { TRPCProvider } from "./contexts/TRPCProvider"
import { WindowProvider, getInitialWindowParams } from "./contexts/WindowContext"
import {
  selectedProjectAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedDraftIdAtom,
  showNewChatFormAtom,
} from "./features/agents/atoms"
import { useAgentSubChatStore } from "./features/agents/stores/sub-chat-store"
import { AgentsLayout } from "./features/layout/agents-layout"
import { DevTestControlBridge } from "./features/settings/dev-test-control-bridge"
import {
  AnthropicOnboardingPage,
  ApiKeyOnboardingPage,
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
  const billingMethod = useAtomValue(billingMethodAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const anthropicOnboardingCompleted = useAtomValue(anthropicOnboardingCompletedAtom)
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const apiKeyOnboardingCompleted = useAtomValue(apiKeyOnboardingCompletedAtom)
  const setApiKeyOnboardingCompleted = useSetAtom(apiKeyOnboardingCompletedAtom)
  const codexOnboardingCompleted = useAtomValue(codexOnboardingCompletedAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const setSelectedProject = useSetAtom(selectedProjectAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setSelectedChatIsRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const { setActiveSubChat, addToOpenSubChats, setChatId } = useAgentSubChatStore()
  const trpcUtils = trpc.useUtils()

  useEffect(
    () =>
      window.desktopApi.onDevMcpViewChanged(async (payload) => {
        if (payload.action === "project-created") {
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
    const params = getInitialWindowParams()
    if (params.chatId) {
      console.log("[App] Opening chat from window params:", params.chatId, params.subChatId)
      setSelectedChatId(params.chatId)
      setChatId(params.chatId)
      if (params.subChatId) {
        addToOpenSubChats(params.subChatId)
        setActiveSubChat(params.subChatId)
      }
    }
  }, [setSelectedChatId, setChatId, addToOpenSubChats, setActiveSubChat])

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
      setBillingMethod("api-key")
      setApiKeyOnboardingCompleted(true)
    }
  }, [cliConfig?.hasConfig, billingMethod, setBillingMethod, setApiKeyOnboardingCompleted])

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

  // Local-first startup enters the workspace/project picker without requiring
  // hosted account, sign-in, or billing selection. Provider-specific
  // onboarding still runs when a local billing/auth mode has already been
  // selected and needs credentials.
  if (billingMethod === "claude-subscription" && !anthropicOnboardingCompleted) {
    return <AnthropicOnboardingPage />
  }

  if (
    (billingMethod === "codex-subscription" || billingMethod === "codex-api-key") &&
    !codexOnboardingCompleted
  ) {
    return <CodexOnboardingPage />
  }

  if (
    (billingMethod === "api-key" || billingMethod === "custom-model") &&
    !apiKeyOnboardingCompleted
  ) {
    return <ApiKeyOnboardingPage />
  }

  if (!validatedProject && !isLoadingProjects) {
    return <SelectRepoPage />
  }

  return <AgentsLayout />
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
