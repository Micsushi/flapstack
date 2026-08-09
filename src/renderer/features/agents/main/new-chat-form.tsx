"use client"

import { useVirtualizer } from "@tanstack/react-virtual"
import type { AgentRuntimePreference } from "../../../../shared/agent-runtime"
import type { RunPermissionMode } from "../../../../shared/harness-types"
import { isReadOnlyChatMode, resolveChatModePermission } from "../../../../shared/chat-mode"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { AlignJustify, Plus } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "../../../components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import {
  AttachIcon,
  BranchIcon,
  CheckIcon,
  IconChevronDown,
  SearchIcon,
} from "../../../components/ui/icons"
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover"
import { cn } from "../../../lib/utils"
import {
  agentsDebugModeAtom,
  enabledOpencodeModelsAtom,
  enabledCursorModelsAtom,
  justCreatedIdsAtom,
  lastMessagedProjectIdAtom,
  lastSelectedAgentIdAtom,
  lastSelectedClaudeEffortAtom,
  lastSelectedCodexFastModeAtom,
  lastSelectedCodexModelIdAtom,
  lastSelectedCodexReasoningAtom,
  lastSelectedCursorModelIdAtom,
  lastSelectedOpencodeModelsAtom,
  lastSelectedBranchesAtom,
  lastSelectedModelIdAtom,
  lastSelectedReasoningEnabledAtom,
  lastSelectedRepoAtom,
  lastSelectedWorkModeAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedDraftIdAtom,
  selectedProjectAtom,
  subChatReasoningEnabledAtomFamily,
  getNextMode,
  type AgentMode,
  type SelectedProject,
} from "../atoms"
import { defaultAgentModeAtom } from "../../../lib/atoms"
import { ProjectSelector } from "../components/project-selector"
import { WorkModeSelector } from "../components/work-mode-selector"
// import { selectedTeamIdAtom } from "@/lib/atoms/team"
import { atom } from "jotai"
const selectedTeamIdAtom = atom<string | null>(null)
import {
  agentsSettingsDialogOpenAtom,
  agentsSettingsDialogActiveTabAtom,
  hiddenModelsAtom,
  selectedOllamaModelAtom,
  chatSourceModeAtom,
} from "../../../lib/atoms"
// Desktop uses real tRPC
import { toast } from "sonner"
import { appStore } from "../../../lib/jotai-store"
import { trpc } from "../../../lib/trpc"
import {
  AgentsSlashCommand,
  COMMAND_PROMPTS,
  BUILTIN_SLASH_COMMANDS,
  type SlashCommandOption,
} from "../commands"
import { useAgentsFileUpload } from "../hooks/use-agents-file-upload"
import { useAvailableModels } from "../hooks/use-available-models"
import { usePastedTextFiles } from "../hooks/use-pasted-text-files"
import { useFocusInputOnEnter } from "../hooks/use-focus-input-on-enter"
import { useToggleFocusOnCmdEsc } from "../hooks/use-toggle-focus-on-cmd-esc"
import { useLocalDictationSetup } from "../hooks/use-local-dictation-setup"
import { useVoiceInputHotkey } from "../hooks/use-voice-input-hotkey"
import { useLocalModelPickerSurface } from "../../local-models/use-local-model-picker-surface"
import { useBetaFeatures } from "../../settings/use-beta-features"
import {
  RuntimeSelector,
  allowedRuntimePreferences,
  resolveConfiguredRuntimePreference,
  resolvedRuntimeAdapter,
} from "../runtime-settings"
import {
  AgentsFileMention,
  AgentsMentionsEditor,
  MENTION_PREFIXES,
  type AgentsMentionsEditorHandle,
  type FileMentionOption,
} from "../mentions"
import { AgentFileItem } from "../ui/agent-file-item"
import { AgentImageItem } from "../ui/agent-image-item"
import { AgentPastedTextItem } from "../ui/agent-pasted-text-item"
import { AgentsHeaderControls } from "../ui/agents-header-controls"
import { VoiceWaveIndicator } from "../ui/voice-wave-indicator"
// import { CreateBranchDialog } from "@/app/(alpha)/agents/{components}/create-branch-dialog"
import {
  PromptInput,
  PromptInputActions,
  PromptInputContextItems,
} from "../../../components/ui/prompt-input"
import { agentsSidebarOpenAtom, agentsUnseenChangesAtom } from "../atoms"
import { AgentSendButton, AgentVoiceButton } from "../components/agent-send-button"
import { AgentModeSelector } from "../components/agent-mode-selector"
import { PermissionSelector } from "../components/permission-selector"
import {
  AgentModelSelector,
  AgentModelTuningSelector,
  type AgentProviderId,
} from "../components/agent-model-selector"
import { CreateBranchDialog } from "../components/create-branch-dialog"
import { formatTimeAgo } from "../utils/format-time-ago"
import { handlePasteEvent } from "../utils/paste-text"
import {
  loadGlobalDrafts,
  generateDraftId,
  deleteNewChatDraft,
  DRAFTS_CHANGE_EVENT,
  markDraftVisible,
  getNewChatDraftRestoreAction,
  resolveNewChatDraftDestination,
  updateNewChatDraftDestination,
  updateNewChatDraftText,
  type DraftProject,
  type NewChatDraft,
} from "../lib/drafts"
import { useDictationSession } from "../voice/dictation-session"
import { registerVoiceHistoryInsertTarget } from "../../../lib/voice-history-insert"
import {
  CODEX_MODELS,
  CURSOR_MODELS,
  DEFAULT_OPENCODE_MODELS,
  DEFAULT_CLAUDE_MODEL_ID,
  type ClaudeEffortLevel,
  type CodexReasoningLevel,
} from "../lib/models"
import { getSelectableRunPermissionModes, RUN_PERMISSION_MODE_LABELS } from "../constants"
import {
  NewChatAgentProfileSelector,
  type NewChatAgentProfileSelectionState,
} from "../../agent-profiles/new-chat-agent-profile-selector"
import { useFeatureVisibility } from "../../settings/use-feature-visibility"
// import type { PlanType } from "@/lib/config/subscription-plans"
type PlanType = string
type ChatScope = "global" | "project" | "task"
type NewChatPermissionMode = Exclude<RunPermissionMode, "custom">
const DEFAULT_PROJECT_COLOR = "#38bdf8"

function parseRunPermissionMode(value: unknown): RunPermissionMode {
  return typeof value === "string" && value in RUN_PERMISSION_MODE_LABELS
    ? (value as RunPermissionMode)
    : "ask-before-edits"
}

// Agent providers
const agents: Array<{
  id: AgentProviderId
  name: string
  hasModels?: boolean
  disabled?: boolean
}> = [
  { id: "claude-code", name: "Claude Code", hasModels: true },
  { id: "cursor-agent", name: "Cursor", hasModels: true },
  { id: "codex", name: "OpenAI Codex" },
  { id: "openrouter", name: "OpenRouter", hasModels: true },
  { id: "nanogpt", name: "NanoGPT", hasModels: true },
  { id: "local", name: "Local · Ollama", hasModels: true },
]

interface NewChatFormProps {
  isMobileFullscreen?: boolean
  onBackToChats?: () => void
  onDraftIdChange?: (draftId: string | null) => void
}

export function NewChatForm({
  isMobileFullscreen = false,
  onBackToChats,
  onDraftIdChange,
}: NewChatFormProps = {}) {
  const betaFeatures = useBetaFeatures()
  // UNCONTROLLED: just track if editor has content for send button
  const [hasContent, setHasContent] = useState(false)
  const [selectedTeamId] = useAtom(selectedTeamIdAtom)
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const setSelectedChatIsRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setChatSourceMode = useSetAtom(chatSourceModeAtom)
  const [selectedDraftId, setSelectedDraftId] = useAtom(selectedDraftIdAtom)
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)

  // Current draft ID being edited (generated when user starts typing in empty form)
  const currentDraftIdRef = useRef<string | null>(null)
  const ensureCurrentDraftId = useCallback(() => {
    const draftId = currentDraftIdRef.current ?? generateDraftId()
    currentDraftIdRef.current = draftId
    onDraftIdChange?.(draftId)
    return draftId
  }, [onDraftIdChange])
  const unseenChanges = useAtomValue(agentsUnseenChangesAtom)

  // Check if any chat has unseen changes
  const hasAnyUnseenChanges = unseenChanges.size > 0
  const [lastSelectedRepo, setLastSelectedRepo] = useAtom(lastSelectedRepoAtom)
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)

  // Fetch projects to validate selectedProject exists
  const { data: projectsList, isLoading: isLoadingProjects } = trpc.projects.list.useQuery()
  const [chatScope, setChatScope] = useState<ChatScope>(() => {
    const requestedScope = localStorage.getItem("flapstack:new-chat-scope")
    if (requestedScope === "task" || requestedScope === "project" || requestedScope === "global") {
      return requestedScope
    }
    return selectedProject ? "project" : "global"
  })
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() =>
    localStorage.getItem("flapstack:new-chat-task-id"),
  )

  // Validate selected project exists in DB
  // While loading, trust the stored value to prevent flicker
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    // While loading, trust localStorage value to prevent flicker
    if (isLoadingProjects) return selectedProject
    // After loading, validate against DB
    if (!projectsList) return null
    const exists = projectsList.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projectsList, isLoadingProjects])

  const selectedProjectColor = useMemo(() => {
    if (!validatedProject?.id) return DEFAULT_PROJECT_COLOR
    try {
      const colors = JSON.parse(
        localStorage.getItem("flapstack-sidebar-project-colors") ?? "{}",
      ) as Record<string, string>
      return colors[validatedProject.id] ?? DEFAULT_PROJECT_COLOR
    } catch {
      return DEFAULT_PROJECT_COLOR
    }
  }, [validatedProject?.id])

  // Clear invalid project from storage
  useEffect(() => {
    if (selectedProject && projectsList && !validatedProject) {
      setSelectedProject(null)
    }
  }, [selectedProject, projectsList, validatedProject, setSelectedProject])
  const { data: projectTasks } = trpc.tasks.list.useQuery(
    { projectId: validatedProject?.id, includeArchived: false },
    { enabled: !!validatedProject?.id },
  )
  const selectedTask = useMemo(
    () => projectTasks?.find((task) => task.id === selectedTaskId) ?? null,
    [projectTasks, selectedTaskId],
  )
  const selectedProjectRecord = useMemo(
    () => projectsList?.find((project) => project.id === validatedProject?.id) ?? null,
    [projectsList, validatedProject?.id],
  )

  useEffect(() => {
    if (!validatedProject && chatScope !== "global") {
      setChatScope("global")
      setSelectedTaskId(null)
      return
    }
  }, [validatedProject, chatScope])

  useEffect(() => {
    if (chatScope !== "task") return
    if (!projectTasks?.length) {
      setSelectedTaskId(null)
      return
    }
    const requestedTaskId = localStorage.getItem("flapstack:new-chat-task-id")
    if (requestedTaskId && projectTasks.some((task) => task.id === requestedTaskId)) {
      setSelectedTaskId(requestedTaskId)
      localStorage.removeItem("flapstack:new-chat-task-id")
      localStorage.removeItem("flapstack:new-chat-scope")
      return
    }
    if (!selectedTaskId || !projectTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(projectTasks[0]?.id ?? null)
    }
  }, [chatScope, projectTasks, selectedTaskId])
  const [lastSelectedAgentId, setLastSelectedAgentId] = useAtom(lastSelectedAgentIdAtom)
  const [lastSelectedModelId, setLastSelectedModelId] = useAtom(lastSelectedModelIdAtom)
  // Mode for new chat - uses user's default preference directly
  // Note: defaultAgentMode is initialized synchronously via atomWithStorage with getOnInit: true
  const defaultAgentMode = useAtomValue(defaultAgentModeAtom)
  const [agentMode, setAgentMode] = useState<AgentMode>(() => defaultAgentMode)
  const featureVisibility = useFeatureVisibility()
  const [runtimePreference, setRuntimePreference] = useState<AgentRuntimePreference>("auto")
  const [permissionModeOverride, setPermissionModeOverride] =
    useState<NewChatPermissionMode | null>(null)
  const { data: runtimeReleases = [] } = trpc.agentRuntimeDefaults.capabilities.useQuery()
  const { data: runtimeDefaults = [] } = trpc.agentRuntimeDefaults.list.useQuery()
  const { data: permissionPreferences } = trpc.permissions.getPreferences.useQuery()
  const inheritedPermissionMode = parseRunPermissionMode(
    chatScope === "task"
      ? selectedTask?.defaultPermissionMode
      : chatScope === "project"
        ? selectedProjectRecord?.defaultPermissionMode
        : permissionPreferences?.globalDefault,
  )
  const selectedPermissionMode = permissionModeOverride ?? inheritedPermissionMode
  const effectivePermissionMode = resolveChatModePermission(agentMode, selectedPermissionMode)
  const [agentProfileSelection, setAgentProfileSelection] =
    useState<NewChatAgentProfileSelectionState>(null)
  // Toggle mode helper
  const toggleMode = useCallback(() => {
    setAgentMode(getNextMode)
  }, [])
  const [workMode, setWorkMode] = useAtom(lastSelectedWorkModeAtom)
  const debugMode = useAtomValue(agentsDebugModeAtom)
  const { data: customClaudeCredentialStatus } = trpc.credentials.status.useQuery({
    id: "claude.custom-api-token",
  })
  const hasCustomClaudeConfig = customClaudeCredentialStatus?.configured === true
  // Connection status for providers
  const { data: claudeCodeIntegration } = trpc.claudeCode.getIntegration.useQuery()
  const { data: cursorIntegration } = trpc.cursor.getIntegration.useQuery(undefined, {
    refetchInterval: (query) => (query.state.data?.isConnected ? false : 2_000),
  })
  const { data: codexIntegration } = trpc.codex.getIntegration.useQuery()
  const { data: cursorModelData } = trpc.cursor.listModels.useQuery()
  const { data: openrouterCatalog } = trpc.opencode.listModels.useQuery({ provider: "openrouter" })
  const { data: nanogptCatalog } = trpc.opencode.listModels.useQuery({ provider: "nanogpt" })
  const cursorLoginMutation = trpc.cursor.startLogin.useMutation({
    onSuccess: () => toast.info("Complete Cursor login in the browser, then retry."),
    onError: (error) => toast.error(`Could not start Cursor login: ${error.message}`),
  })
  const isClaudeConnected = Boolean(claudeCodeIntegration?.isConnected) || hasCustomClaudeConfig
  const setSettingsDialogOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const localModelPicker = useLocalModelPickerSurface()
  const handleOpenVoiceSettings = useCallback(() => {
    setSettingsActiveTab("voice")
    setSettingsDialogOpen(true)
  }, [setSettingsActiveTab, setSettingsDialogOpen])
  const setJustCreatedIds = useSetAtom(justCreatedIdsAtom)
  const [repoSearchQuery, setRepoSearchQuery] = useState("")
  const [createBranchDialogOpen, setCreateBranchDialogOpen] = useState(false)

  // Worktree config banner state
  const [worktreeBannerDismissed, setWorktreeBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem("worktree-banner-dismissed") === "true"
    } catch {
      return false
    }
  })

  // Check if project has worktree config
  const { data: worktreeConfigData } = trpc.worktreeConfig.get.useQuery(
    { projectId: validatedProject?.id ?? "" },
    { enabled: !!validatedProject?.id && workMode === "worktree" && !worktreeBannerDismissed },
  )

  const showWorktreeBanner =
    workMode === "worktree" &&
    validatedProject &&
    !worktreeBannerDismissed &&
    worktreeConfigData &&
    !worktreeConfigData.config

  const handleDismissWorktreeBanner = () => {
    setWorktreeBannerDismissed(true)
    try {
      localStorage.setItem("worktree-banner-dismissed", "true")
    } catch {}
  }

  const handleConfigureWorktree = () => {
    // Open the projects settings tab
    setSettingsActiveTab("projects")
    setSettingsDialogOpen(true)
  }
  // Parse owner/repo from GitHub URL
  const parseGitHubUrl = (url: string) => {
    const match = url.match(/(?:github\.com\/)?([^\/]+)\/([^\/\s#?]+)/)
    if (!match) return null
    return `${match[1]}/${match[2].replace(/\.git$/, "")}`
  }
  const enabledAgents = useMemo(() => agents.filter((agent) => !agent.disabled), [])
  const fallbackAgent = enabledAgents[0] ?? agents[0]!
  const preferredAgentId =
    lastSelectedAgentId === "claude-code" && !isClaudeConnected ? "codex" : lastSelectedAgentId
  const [selectedAgent, setSelectedAgent] = useState(
    () => enabledAgents.find((agent) => agent.id === preferredAgentId) || fallbackAgent,
  )

  useEffect(() => {
    const nextAgent = enabledAgents.find((agent) => agent.id === preferredAgentId) || fallbackAgent

    if (nextAgent && nextAgent.id !== selectedAgent.id) {
      setSelectedAgent(nextAgent)
    }
  }, [enabledAgents, fallbackAgent, preferredAgentId, selectedAgent.id])

  useEffect(() => {
    if (!allowedRuntimePreferences(selectedAgent.id).includes(runtimePreference)) {
      setRuntimePreference("auto")
    }
  }, [runtimePreference, selectedAgent.id])
  const selectableNewChatPermissionModes = useMemo(
    () => getSelectableRunPermissionModes(selectedAgent.id).filter((mode) => mode !== "custom"),
    [selectedAgent.id],
  )
  const resolvedRuntimePreference = resolveConfiguredRuntimePreference({
    harness: selectedAgent.id,
    chatPreference: runtimePreference,
    projectId: validatedProject?.id,
    defaults: runtimeDefaults,
  })
  const resolvedRuntime = resolvedRuntimeAdapter(resolvedRuntimePreference, selectedAgent.id)
  const runtimeBlockedReason = runtimeReleases.find(
    (release) => release.runtime === resolvedRuntime && !release.enabledForNewLaunches,
  )?.reason

  // Get available models (with offline support)
  const availableModels = useAvailableModels()
  const [selectedOllamaModel, setSelectedOllamaModel] = useAtom(selectedOllamaModelAtom)
  const [lastSelectedCodexModelId, setLastSelectedCodexModelId] = useAtom(
    lastSelectedCodexModelIdAtom,
  )
  const [lastSelectedCodexReasoning, setLastSelectedCodexReasoning] = useAtom(
    lastSelectedCodexReasoningAtom,
  )
  const [lastSelectedClaudeEffort, setLastSelectedClaudeEffort] = useAtom(
    lastSelectedClaudeEffortAtom,
  )
  const [lastSelectedCodexFastMode, setLastSelectedCodexFastMode] = useAtom(
    lastSelectedCodexFastModeAtom,
  )
  const [lastSelectedCursorModelId, setLastSelectedCursorModelId] = useAtom(
    lastSelectedCursorModelIdAtom,
  )
  const [lastSelectedOpencodeModels, setLastSelectedOpencodeModels] = useAtom(
    lastSelectedOpencodeModelsAtom,
  )
  const enabledOpencodeModels = useAtomValue(enabledOpencodeModelsAtom)
  const enabledCursorModels = useAtomValue(enabledCursorModelsAtom)
  useEffect(() => {
    for (const providerId of ["openrouter", "nanogpt"] as const) {
      if (enabledOpencodeModels[providerId].includes(lastSelectedOpencodeModels[providerId]))
        continue
      setLastSelectedOpencodeModels((current) => ({
        ...current,
        [providerId]:
          enabledOpencodeModels[providerId][0] ?? DEFAULT_OPENCODE_MODELS[providerId][0].id,
      }))
    }
  }, [enabledOpencodeModels, lastSelectedOpencodeModels, setLastSelectedOpencodeModels])
  const [reasoningOutputEnabled, setReasoningOutputEnabled] = useAtom(
    lastSelectedReasoningEnabledAtom,
  )
  const pendingReasoningEnabledRef = useRef(reasoningOutputEnabled)

  const [selectedModel, setSelectedModel] = useState(
    () =>
      availableModels.models.find((m) => m.id === lastSelectedModelId) || availableModels.models[0],
  )

  // Sync selectedModel when atom value changes (e.g., after localStorage hydration)
  useEffect(() => {
    const model = availableModels.models.find((m) => m.id === lastSelectedModelId)
    if (model && model.id !== selectedModel.id) {
      setSelectedModel(model)
    }
  }, [lastSelectedModelId])

  const selectedModelEfforts =
    selectedModel && "efforts" in selectedModel ? selectedModel.efforts : undefined
  const selectedClaudeEffort = useMemo<ClaudeEffortLevel>(() => {
    const efforts = selectedModelEfforts
    if (!efforts || efforts.length === 0) return "high"
    if (efforts.includes(lastSelectedClaudeEffort as ClaudeEffortLevel)) {
      return lastSelectedClaudeEffort as ClaudeEffortLevel
    }
    if (efforts.includes("high")) return "high"
    return efforts[0]!
  }, [lastSelectedClaudeEffort, selectedModelEfforts])

  useEffect(() => {
    if (lastSelectedClaudeEffort === selectedClaudeEffort) return
    setLastSelectedClaudeEffort(selectedClaudeEffort)
  }, [lastSelectedClaudeEffort, selectedClaudeEffort, setLastSelectedClaudeEffort])

  const { data: codexCredentialStatus } = trpc.credentials.status.useQuery({
    id: "codex.api-key",
  })
  const hasAppCodexApiKey = codexCredentialStatus?.configured === true
  const hiddenModels = useAtomValue(hiddenModelsAtom)
  const codexUiModels = useMemo(() => {
    const authSurface = hasAppCodexApiKey ? "api-key" : "chatgpt"
    const models = CODEX_MODELS.filter((model) => model.authSurfaces.includes(authSurface))
    return models.filter((model) => !hiddenModels.includes(model.id))
  }, [hasAppCodexApiKey, hiddenModels])
  const selectedCodexModel = useMemo(
    () =>
      codexUiModels.find((model) => model.id === lastSelectedCodexModelId) ||
      codexUiModels[0] ||
      CODEX_MODELS[0]!,
    [codexUiModels, lastSelectedCodexModelId],
  )
  const cursorUiModels = useMemo(() => {
    const liveIds = cursorModelData?.models?.length
      ? cursorModelData.models
      : CURSOR_MODELS.map((model) => model.id)
    const ids = enabledCursorModels.filter((id) => liveIds.includes(id))
    return ids.map((id) => ({
      id,
      name: CURSOR_MODELS.find((model) => model.id === id)?.name ?? id,
    }))
  }, [cursorModelData?.models, enabledCursorModels])
  const selectedCursorModel = useMemo(
    () =>
      cursorUiModels.find((model) => model.id === lastSelectedCursorModelId) ||
      cursorUiModels[0] || { id: "auto", name: "Auto" },
    [cursorUiModels, lastSelectedCursorModelId],
  )

  const codexFastModeEnabled =
    selectedCodexModel.supportsFastMode === true && lastSelectedCodexFastMode

  const selectedCodexReasoning = useMemo<CodexReasoningLevel>(() => {
    if (
      selectedCodexModel.reasoningLevels.includes(lastSelectedCodexReasoning as CodexReasoningLevel)
    ) {
      return lastSelectedCodexReasoning as CodexReasoningLevel
    }

    if (selectedCodexModel.reasoningLevels.includes("high")) {
      return "high"
    }

    return selectedCodexModel.reasoningLevels[0]!
  }, [selectedCodexModel, lastSelectedCodexReasoning])

  useEffect(() => {
    if (
      selectedCodexModel.reasoningLevels.includes(lastSelectedCodexReasoning as CodexReasoningLevel)
    ) {
      return
    }

    setLastSelectedCodexReasoning(selectedCodexReasoning)
  }, [
    selectedCodexModel,
    lastSelectedCodexReasoning,
    selectedCodexReasoning,
    setLastSelectedCodexReasoning,
  ])

  useEffect(() => {
    if (selectedCodexModel.supportsFastMode || !lastSelectedCodexFastMode) return
    setLastSelectedCodexFastMode(false)
  }, [lastSelectedCodexFastMode, selectedCodexModel.supportsFastMode, setLastSelectedCodexFastMode])

  const selectedChatModel = useMemo(() => {
    if (selectedAgent.id === "local") {
      return localModelPicker.selectedModelId ?? ""
    }
    if (selectedAgent.id === "codex") {
      return `${selectedCodexModel.id}/${selectedCodexReasoning}`
    }
    if (selectedAgent.id === "cursor-agent") {
      return selectedCursorModel.id
    }
    if (selectedAgent.id === "openrouter" || selectedAgent.id === "nanogpt") {
      return lastSelectedOpencodeModels[selectedAgent.id]
    }
    return selectedModel?.id ?? DEFAULT_CLAUDE_MODEL_ID
  }, [
    selectedAgent.id,
    localModelPicker.selectedModelId,
    selectedCodexModel.id,
    selectedCodexReasoning,
    selectedCursorModel.id,
    lastSelectedOpencodeModels,
    selectedModel?.id,
  ])

  // Determine current Ollama model (selected or recommended)
  const currentOllamaModel =
    selectedOllamaModel || availableModels.recommendedModel || availableModels.ollamaModels[0]
  const claudeAgent = enabledAgents.find((agent) => agent.id === "claude-code") || fallbackAgent
  const selectedModelLabel = useMemo(() => {
    if (selectedAgent.id === "local") {
      return localModelPicker.selectedModelId ?? "Choose local model"
    }
    if (selectedAgent.id === "codex") {
      return selectedCodexModel.name
    }
    if (selectedAgent.id === "cursor-agent") {
      return selectedCursorModel.name
    }

    if (selectedAgent.id === "openrouter" || selectedAgent.id === "nanogpt") {
      const modelId = lastSelectedOpencodeModels[selectedAgent.id]
      const catalog = selectedAgent.id === "openrouter" ? openrouterCatalog : nanogptCatalog
      return (
        catalog?.models.find((model) => `${selectedAgent.id}/${model.id}` === modelId)?.label ||
        modelId
      )
    }

    if (availableModels.isOffline && availableModels.hasOllama) {
      return currentOllamaModel || "Ollama"
    }

    if (hasCustomClaudeConfig) {
      return "Custom Model"
    }

    if (!selectedModel) {
      return "Select model"
    }

    return `${selectedModel.name} ${selectedModel.version}`
  }, [
    selectedAgent.id,
    localModelPicker.selectedModelId,
    selectedCodexModel.name,
    selectedCursorModel.name,
    lastSelectedOpencodeModels,
    openrouterCatalog,
    nanogptCatalog,
    availableModels.isOffline,
    availableModels.hasOllama,
    currentOllamaModel,
    hasCustomClaudeConfig,
    selectedModel,
  ])
  const [repoPopoverOpen, setRepoPopoverOpen] = useState(false)
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false)
  const [lastSelectedBranches, setLastSelectedBranches] = useAtom(lastSelectedBranchesAtom)
  const [branchSearch, setBranchSearch] = useState("")
  const [selectedBranchType, setSelectedBranchType] = useState<"local" | "remote" | undefined>(
    undefined,
  )

  // Get/set selected branch for current project (persisted per project)
  const selectedBranch = validatedProject?.id
    ? lastSelectedBranches[validatedProject.id]?.name || ""
    : ""
  const setSelectedBranch = useCallback(
    (branch: string, type?: "local" | "remote") => {
      if (validatedProject?.id && type) {
        setLastSelectedBranches((prev) => ({
          ...prev,
          [validatedProject.id]: { name: branch, type },
        }))
        setSelectedBranchType(type)
      }
    },
    [validatedProject?.id, setLastSelectedBranches],
  )
  const branchListRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<AgentsMentionsEditorHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Restore selectedBranchType from persisted storage when project changes
  useEffect(() => {
    if (validatedProject?.id) {
      const stored = lastSelectedBranches[validatedProject.id]
      if (stored?.type) {
        setSelectedBranchType(stored.type)
      } else {
        setSelectedBranchType(undefined)
      }
    } else {
      setSelectedBranchType(undefined)
    }
  }, [validatedProject?.id, lastSelectedBranches])

  // File upload hook
  const {
    images,
    files,
    handleAddAttachments,
    removeImage,
    removeFile,
    clearImages,
    clearFiles,
    isUploading,
  } = useAgentsFileUpload()

  // Pasted text files - use a stable temp ID for new chat
  const tempPastedIdRef = useRef(`new-chat-${Date.now()}`)
  const { pastedTexts, addPastedText, removePastedText, clearPastedTexts } = usePastedTextFiles(
    tempPastedIdRef.current,
  )

  // File contents cache - stores content for file mentions (keyed by mentionId)
  // This content gets added to the prompt when sending, without showing a separate card
  const fileContentsRef = useRef<Map<string, string>>(new Map())

  // Mention dropdown state
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionSearchText, setMentionSearchText] = useState("")
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 })

  // Mention subpage navigation state
  const [showingFilesList, setShowingFilesList] = useState(false)
  const [showingSkillsList, setShowingSkillsList] = useState(false)
  const [showingAgentsList, setShowingAgentsList] = useState(false)
  const [showingToolsList, setShowingToolsList] = useState(false)

  // Slash command dropdown state
  const [showSlashDropdown, setShowSlashDropdown] = useState(false)
  const [slashSearchText, setSlashSearchText] = useState("")
  const [slashPosition, setSlashPosition] = useState({ top: 0, left: 0 })

  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)

  // Voice input state
  const dictation = useDictationSession()
  const currentDictationKey = currentDraftIdRef.current
    ? `new-chat:${currentDraftIdRef.current}`
    : null
  const ownsDictation =
    currentDictationKey !== null && dictation.activeTargetKey === currentDictationKey
  const isVoiceRecording = ownsDictation && dictation.isRecording
  const isVoiceStarting = ownsDictation && dictation.isStarting
  const isTranscribing = ownsDictation && dictation.isTranscribing
  const voiceAudioLevel = ownsDictation ? dictation.audioLevel : 0
  const {
    isReady: isVoiceReady,
    statusLabel: voiceStatusLabel,
    showSetup: showVoiceSetup,
  } = useLocalDictationSetup(handleOpenVoiceSettings)

  useEffect(() => {
    if (!ownsDictation || !currentDraftIdRef.current) return
    const draftId = currentDraftIdRef.current
    const syncOriginDraft = () => {
      const text = loadGlobalDrafts()[draftId]?.text ?? ""
      editorRef.current?.setValue(text)
      setHasContent(Boolean(text))
    }
    window.addEventListener(DRAFTS_CHANGE_EVENT, syncOriginDraft)
    return () => window.removeEventListener(DRAFTS_CHANGE_EVENT, syncOriginDraft)
  }, [ownsDictation])

  useEffect(() => {
    return registerVoiceHistoryInsertTarget("new-chat:composer", (value) => {
      const text = value.trim()
      if (!text) return
      const draftId = ensureCurrentDraftId()
      setSelectedDraftId(draftId)
      const current = editorRef.current?.getValue() || ""
      const next = `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`
      const project =
        chatScope !== "global" && validatedProject
          ? {
              id: validatedProject.id,
              name: validatedProject.name,
              path: validatedProject.path,
              gitOwner: validatedProject.gitOwner,
              gitRepo: validatedProject.gitRepo,
              gitProvider: validatedProject.gitProvider,
            }
          : undefined
      updateNewChatDraftText(draftId, next, project)
      editorRef.current?.setValue(next)
      setHasContent(true)
      editorRef.current?.focus()
    })
  }, [chatScope, ensureCurrentDraftId, setSelectedDraftId, validatedProject])

  // Voice input handlers
  const handleVoiceMouseDown = useCallback(async () => {
    if (isUploading || isTranscribing || isVoiceStarting || isVoiceRecording) return
    if (!isVoiceReady) {
      showVoiceSetup()
      return
    }
    const draftId = ensureCurrentDraftId()
    setSelectedDraftId(draftId)
    const project =
      chatScope !== "global" && validatedProject
        ? {
            id: validatedProject.id,
            name: validatedProject.name,
            path: validatedProject.path,
            gitOwner: validatedProject.gitOwner,
            gitRepo: validatedProject.gitRepo,
            gitProvider: validatedProject.gitProvider,
          }
        : undefined
    await dictation.start({
      key: `new-chat:${draftId}`,
      draftId,
      projectLabel: validatedProject?.name || "Global",
      chatLabel: "New chat draft",
      getText: () => editorRef.current?.getValue() || "",
      commitText: (text) => updateNewChatDraftText(draftId, text, project),
      showText: (text) => {
        editorRef.current?.setValue(text)
        setHasContent(Boolean(text))
      },
    })
  }, [
    dictation,
    isUploading,
    isTranscribing,
    isVoiceStarting,
    isVoiceRecording,
    isVoiceReady,
    showVoiceSetup,
    ensureCurrentDraftId,
    setSelectedDraftId,
    chatScope,
    validatedProject,
  ])

  const handleVoiceMouseUp = useCallback(() => dictation.stop(), [dictation])

  const finishVoiceBeforeSend = useCallback(async () => {
    if (ownsDictation) await dictation.stop()
  }, [dictation, ownsDictation])

  useVoiceInputHotkey({
    isRecording: isVoiceRecording,
    isStarting: isVoiceStarting,
    isTranscribing,
    ownsDictation,
    onStart: handleVoiceMouseDown,
    onStop: handleVoiceMouseUp,
  })

  // Shift+Tab handler for mode switching (now handled inside input component via onShiftTab prop)

  // Keyboard shortcut: Enter to focus input when not already focused
  useFocusInputOnEnter(editorRef)

  // Keyboard shortcut: Cmd+Esc to toggle focus/blur
  useToggleFocusOnCmdEsc(editorRef)

  // Fetch repos from team
  // Desktop: no remote repos, we use local projects
  const reposData: {
    repositories: Array<{
      id: string
      name: string
      full_name: string
      sandbox_status: "not_setup" | "in_progress" | "ready" | "error"
      pushed_at?: string | null
    }>
  } = { repositories: [] }
  const isLoadingRepos = false

  // Memoize repos arrays to prevent useEffect from running on every keystroke
  // Apply debug mode simulations
  const repos = useMemo(() => {
    if (debugMode.enabled && debugMode.simulateNoRepos) {
      return []
    }
    return reposData?.repositories || []
  }, [reposData?.repositories, debugMode.enabled, debugMode.simulateNoRepos])

  const readyRepos = useMemo(() => {
    if (debugMode.enabled && debugMode.simulateNoReadyRepos) {
      return []
    }
    return repos.filter((r) => r.sandbox_status === "ready")
  }, [repos, debugMode.enabled, debugMode.simulateNoReadyRepos])

  const notReadyRepos = useMemo(() => repos.filter((r) => r.sandbox_status !== "ready"), [repos])

  // Use state to avoid hydration mismatch
  const [resolvedRepo, setResolvedRepo] = useState<(typeof repos)[0] | null>(null)

  // Derive selected repo from saved or first available (client-side only)
  // Now includes all repos, not just ready ones
  useEffect(() => {
    if (lastSelectedRepo) {
      // For public imports, use lastSelectedRepo directly (it won't be in repos list)
      if (lastSelectedRepo.isPublicImport) {
        setResolvedRepo({
          id: lastSelectedRepo.id,
          name: lastSelectedRepo.name,
          full_name: lastSelectedRepo.full_name,
          sandbox_status: lastSelectedRepo.sandbox_status || "not_setup",
        } as (typeof repos)[0])
        return
      }

      // Look in all repos by id or full_name
      // Only compare IDs when lastSelectedRepo.id is non-empty (old localStorage data might have empty id)
      const stillExists = repos.find(
        (r) =>
          (lastSelectedRepo.id && r.id === lastSelectedRepo.id) ||
          r.full_name === lastSelectedRepo.full_name,
      )
      if (stillExists) {
        setResolvedRepo(stillExists)
        return
      }
    }

    if (repos.length === 0) {
      setResolvedRepo(null)
      return
    }

    // Auto-save first repo if none saved (prefer ready repos, then any)
    if (!lastSelectedRepo && repos.length > 0) {
      const firstRepo = readyRepos[0] || repos[0]
      setLastSelectedRepo({
        id: firstRepo.id,
        name: firstRepo.name,
        full_name: firstRepo.full_name,
        sandbox_status: firstRepo.sandbox_status,
      })
    }

    setResolvedRepo(readyRepos[0] || repos[0] || null)
  }, [lastSelectedRepo, repos, readyRepos, setLastSelectedRepo])

  // Desktop: fetch branches from local git repository
  const branchesQuery = trpc.changes.getBranches.useQuery(
    { worktreePath: validatedProject?.path || "" },
    {
      enabled: !!validatedProject?.path,
      staleTime: 30_000, // Cache for 30 seconds
    },
  )

  const fetchRemoteMutation = trpc.changes.fetchRemote.useMutation()

  // Manual refresh branches
  const handleRefreshBranches = useCallback(() => {
    if (validatedProject?.path) {
      fetchRemoteMutation.mutate(
        { worktreePath: validatedProject.path },
        {
          onSuccess: () => {
            branchesQuery.refetch()
          },
          onError: (error) => {
            console.error("Failed to fetch remote branches:", error)
          },
        },
      )
    }
  }, [validatedProject?.path, fetchRemoteMutation, branchesQuery])

  // Stable ref for handleRefreshBranches to avoid re-running effects on every render
  const handleRefreshBranchesRef = useRef(handleRefreshBranches)
  handleRefreshBranchesRef.current = handleRefreshBranches

  // Transform branch data to match web app format
  const branches = useMemo(() => {
    if (!branchesQuery.data) return []

    const { local, remote, defaultBranch } = branchesQuery.data
    const result: Array<{
      name: string
      type: "local" | "remote"
      protected: boolean
      isDefault: boolean
      committedAt: string | null
      authorName: null
    }> = []

    // Add local branches
    for (const { branch, lastCommitDate } of local) {
      result.push({
        name: branch,
        type: "local",
        protected: false,
        isDefault: branch === defaultBranch,
        committedAt: lastCommitDate ? new Date(lastCommitDate).toISOString() : null,
        authorName: null,
      })
    }

    // Add remote branches
    for (const name of remote) {
      result.push({
        name: name,
        type: "remote",
        protected: false,
        isDefault: name === defaultBranch,
        committedAt: null,
        authorName: null,
      })
    }

    // Sort: default first, then local, then remote, alphabetically
    return result.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1
      if (!a.isDefault && b.isDefault) return 1
      if (a.type !== b.type) return a.type === "local" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [branchesQuery.data])

  // Filter branches based on search
  const filteredBranches = useMemo(() => {
    if (!branchSearch.trim()) return branches
    const search = branchSearch.toLowerCase()
    return branches.filter((b) => b.name.toLowerCase().includes(search))
  }, [branches, branchSearch])

  // Virtualizer for branch list - only active when popover is open
  const branchVirtualizer = useVirtualizer({
    count: filteredBranches.length,
    getScrollElement: () => branchListRef.current,
    estimateSize: () => 28, // Each item is h-7 (28px)
    overscan: 5,
    enabled: branchPopoverOpen, // Only virtualize when popover is open
  })

  // Force virtualizer to re-measure when popover opens
  useEffect(() => {
    if (branchPopoverOpen) {
      // Small delay to ensure ref is attached
      const timer = setTimeout(() => {
        branchVirtualizer.measure()
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [branchPopoverOpen])

  // Format relative time for branches (reuse shared utility)
  const formatRelativeTime = (dateString: string | null): string => {
    if (!dateString) return ""
    return formatTimeAgo(dateString)
  }

  // Set default branch when project/branches change (only if no saved branch for this project)
  useEffect(() => {
    if (branchesQuery.data?.defaultBranch && validatedProject?.id && !selectedBranch) {
      // Find the default branch in the branches list to get its type
      // Prefer local over remote if both exist
      const defaultBranchObj =
        branches.find(
          (b) => b.name === branchesQuery.data.defaultBranch && b.isDefault && b.type === "local",
        ) ||
        branches.find(
          (b) => b.name === branchesQuery.data.defaultBranch && b.isDefault && b.type === "remote",
        )
      // Fallback to "local" if branch not found in list (shouldn't happen but prevents empty selector)
      const branchType = defaultBranchObj?.type || "local"
      setSelectedBranch(branchesQuery.data.defaultBranch, branchType)
    }
  }, [
    branchesQuery.data?.defaultBranch,
    validatedProject?.id,
    selectedBranch,
    setSelectedBranch,
    branches,
  ])

  // Auto-focus input when NewChatForm is shown (when clicking "New Chat")
  // Skip on mobile to prevent keyboard from opening automatically
  useEffect(() => {
    if (isMobileFullscreen) return // Don't autofocus on mobile

    // Small delay to ensure DOM is ready and animations complete
    const timeoutId = setTimeout(() => {
      editorRef.current?.focus()
    }, 150)

    return () => clearTimeout(timeoutId)
  }, [isMobileFullscreen]) // Run on mount and when mobile state changes

  // Track last saved text to avoid unnecessary updates
  const lastSavedTextRef = useRef<string>("")

  // Track previous draft ID to detect when switching away from a draft
  const prevSelectedDraftIdRef = useRef<string | null>(null)

  // Restore draft when a specific draft is selected from sidebar
  // Or clear editor when "New Workspace" is clicked (selectedDraftId becomes null)
  useEffect(() => {
    const restoreAction = getNewChatDraftRestoreAction(
      prevSelectedDraftIdRef.current,
      selectedDraftId,
    )
    if (restoreAction === "none") return

    prevSelectedDraftIdRef.current = selectedDraftId

    if (!selectedDraftId) {
      // No draft selected - only clear if we had a draft before (user clicked "New Workspace")
      // Don't clear if user is currently typing (currentDraftIdRef has a value)
      if (restoreAction === "clear") {
        currentDraftIdRef.current = null
        onDraftIdChange?.(null)
        lastSavedTextRef.current = ""
        if (editorRef.current) {
          editorRef.current.clear()
          setHasContent(false)
        }

        // Fetch remote branches in background when starting new workspace
        if (validatedProject?.path) {
          handleRefreshBranchesRef.current()
        }
      }
      return
    }

    const globalDrafts = loadGlobalDrafts()
    const draft = globalDrafts[selectedDraftId] as NewChatDraft | undefined
    if (draft?.text) {
      const destination = resolveNewChatDraftDestination(draft)
      setChatScope(destination.scope)
      setSelectedTaskId(null)

      if (destination.project) {
        const liveProject = projectsList?.find((project) => project.id === destination.project?.id)
        const project = liveProject ?? destination.project
        const gitProvider =
          project.gitProvider === "github" ||
          project.gitProvider === "gitlab" ||
          project.gitProvider === "bitbucket"
            ? project.gitProvider
            : null

        setSelectedProject({
          id: project.id,
          name: project.name,
          path: project.path,
          gitRemoteUrl: liveProject?.gitRemoteUrl,
          gitProvider,
          gitOwner: project.gitOwner,
          gitRepo: project.gitRepo,
        })
      }

      currentDraftIdRef.current = selectedDraftId
      onDraftIdChange?.(selectedDraftId)
      lastSavedTextRef.current = draft.text // Initialize to prevent immediate re-save

      // Try to set value immediately if editor is ready
      if (editorRef.current) {
        editorRef.current.setValue(draft.text)
        setHasContent(true)
      } else {
        // Fallback: wait for editor to initialize (rare case)
        const timeoutId = setTimeout(() => {
          editorRef.current?.setValue(draft.text)
          setHasContent(true)
        }, 50)
        return () => clearTimeout(timeoutId)
      }
    }
  }, [onDraftIdChange, projectsList, selectedDraftId, setSelectedProject, validatedProject?.path])

  useEffect(() => {
    onDraftIdChange?.(selectedDraftId)
  }, [onDraftIdChange, selectedDraftId])

  const persistDraftDestination = useCallback((scope: ChatScope, project: SelectedProject) => {
    if (!currentDraftIdRef.current) return
    updateNewChatDraftDestination(
      currentDraftIdRef.current,
      scope !== "global" && project
        ? {
            id: project.id,
            name: project.name,
            path: project.path,
            gitOwner: project.gitOwner,
            gitRepo: project.gitRepo,
            gitProvider: project.gitProvider,
          }
        : undefined,
    )
  }, [])

  // Mark draft as visible when component unmounts (user navigates away)
  // This ensures the draft only appears in the sidebar after leaving the form
  useEffect(() => {
    return () => {
      // On unmount, mark current draft as visible so it appears in sidebar
      if (currentDraftIdRef.current) {
        markDraftVisible(currentDraftIdRef.current)
      }
    }
  }, [])

  // Filter all repos by search (combined list) and sort by preview status
  const filteredRepos = repos
    .filter(
      (repo) =>
        repo.name.toLowerCase().includes(repoSearchQuery.toLowerCase()) ||
        repo.full_name.toLowerCase().includes(repoSearchQuery.toLowerCase()),
    )
    .sort((a, b) => {
      // 1. Repos with preview (sandbox_status === "ready") come first
      const aHasPreview = a.sandbox_status === "ready"
      const bHasPreview = b.sandbox_status === "ready"
      if (aHasPreview && !bHasPreview) return -1
      if (!aHasPreview && bHasPreview) return 1

      // 2. Sort by last commit date (pushed_at) - most recent first
      const aDate = a.pushed_at ? new Date(a.pushed_at).getTime() : 0
      const bDate = b.pushed_at ? new Date(b.pushed_at).getTime() : 0
      return bDate - aDate
    })

  // Create chat mutation (real tRPC)
  const utils = trpc.useUtils()
  const createChatMutation = trpc.chats.create.useMutation({
    onSuccess: (data) => {
      appStore.set(
        lastMessagedProjectIdAtom,
        chatScope === "global" ? null : (validatedProject?.id ?? null),
      )
      // Clear editor, images, files, pasted texts, and file contents cache only on success
      editorRef.current?.clear()
      clearImages()
      clearFiles()
      clearPastedTexts()
      fileContentsRef.current.clear()
      clearCurrentDraft()
      utils.chats.list.invalidate()
      setSelectedChatId(data.id)
      // New chats are always local
      setSelectedChatIsRemote(false)
      setChatSourceMode("local")
      // Track this chat and its first subchat as just created for typewriter effect
      const ids = [data.id]
      if (data.subChats?.[0]?.id) {
        const firstSubChatId = data.subChats[0].id
        ids.push(firstSubChatId)
        appStore.set(
          subChatReasoningEnabledAtomFamily(firstSubChatId),
          pendingReasoningEnabledRef.current,
        )
      }
      setJustCreatedIds((prev) => new Set([...prev, ...ids]))
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Open folder mutation for selecting a project
  const openFolder = trpc.projects.openFolder.useMutation({
    onSuccess: (project) => {
      if (project) {
        // Optimistically update the projects list cache to prevent "Select repo" flash
        // This ensures validatedProject can find the new project immediately
        utils.projects.list.setData(undefined, (oldData) => {
          if (!oldData) return [project]
          // Check if project already exists (reopened existing project)
          const exists = oldData.some((p) => p.id === project.id)
          if (exists) {
            // Update existing project's timestamp
            return oldData.map((p) =>
              p.id === project.id ? { ...p, updatedAt: project.updatedAt } : p,
            )
          }
          // Add new project at the beginning
          return [project, ...oldData]
        })

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
    },
  })

  const handleOpenFolder = async () => {
    await openFolder.mutateAsync()
  }

  const trpcUtils = trpc.useUtils()

  const handleSend = useCallback(async () => {
    await finishVoiceBeforeSend()

    if (agentProfileSelection && "invalid" in agentProfileSelection) {
      toast.error("Resolve the selected Agent Profile error before starting this Chat.")
      return
    }
    if (!agentProfileSelection && selectedAgent.id === "local" && !localModelPicker.canLaunch) {
      toast.error("Choose a refreshed, chat-capable local model before launch.")
      setSettingsActiveTab("local-models")
      setSettingsDialogOpen(true)
      return
    }
    // Get value from uncontrolled editor
    let message = editorRef.current?.getValue() || ""

    // Allow send if there's text, images, files, or pasted text files
    const hasText = message.trim().length > 0
    const hasImages = images.filter((img) => !img.isLoading && img.url).length > 0
    const hasFiles = files.filter((f) => !f.isLoading).length > 0
    const hasPastedTexts = pastedTexts.length > 0

    const requiresProject = chatScope === "project" || chatScope === "task"
    const requiresTask = chatScope === "task"

    if (
      (!hasText && !hasImages && !hasFiles && !hasPastedTexts) ||
      (requiresProject && !validatedProject) ||
      (requiresTask && !selectedTask)
    ) {
      return
    }

    // Check if message is a slash command with arguments (e.g. "/hello world")
    // Note: 's' flag makes '.' match newlines, so multi-line arguments are captured
    const slashMatch = message.match(/^\/(\S+)\s*(.*)$/s)
    if (slashMatch) {
      const [, commandName, args] = slashMatch

      // Check if it's a builtin command - if so, don't process as custom command
      const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((cmd) => cmd.name))
      if (!builtinNames.has(commandName)) {
        // This is a custom command - load content and replace $ARGUMENTS
        try {
          const commands = await trpcUtils.commands.list.fetch({
            projectPath: validatedProject?.path,
          })
          const cmd = commands.find((c) => c.name.toLowerCase() === commandName.toLowerCase())

          if (cmd) {
            const { content } = await trpcUtils.commands.getContent.fetch({
              path: cmd.path,
            })
            // Replace $ARGUMENTS with the provided args
            message = content.replace(/\$ARGUMENTS/g, args.trim())
          }
        } catch (error) {
          console.error("Failed to process custom command:", error)
          // Fall through with original message
        }
      }
    }

    // Build message parts array (images first, then text, then hidden file contents)
    type MessagePart =
      | { type: "text"; text: string }
      | {
          type: "data-image"
          data: {
            url: string
            mediaType?: string
            filename?: string
            base64Data?: string
          }
        }
      | {
          type: "file-content"
          filePath: string
          content: string
        }

    const parts: MessagePart[] = images
      .filter((img) => !img.isLoading && img.url)
      .map((img) => ({
        type: "data-image" as const,
        data: {
          url: img.url!,
          mediaType: img.mediaType,
          filename: img.filename,
          base64Data: img.base64Data,
        },
      }))

    // Add pasted text as pasted mentions (format: pasted:size:preview|filepath)
    // Using | as separator since filepath can contain colons
    let finalMessage = message.trim()
    if (pastedTexts.length > 0) {
      const pastedMentions = pastedTexts
        .map((pt) => {
          // Sanitize preview to remove special characters that break mention parsing
          const sanitizedPreview = pt.preview.replace(/[:\[\]|]/g, "")
          const prefix =
            pt.kind === "chatHistory" ? MENTION_PREFIXES.CHAT_HISTORY : MENTION_PREFIXES.PASTED
          return `@[${prefix}${pt.size}:${sanitizedPreview}|${pt.filePath}]`
        })
        .join(" ")
      finalMessage = pastedMentions + (finalMessage ? " " + finalMessage : "")
    }

    if (finalMessage) {
      parts.push({ type: "text" as const, text: finalMessage })
    }

    // Add cached file contents as hidden parts (sent to agent but not displayed in UI)
    // These are from dropped text files - content is embedded so agent sees it immediately
    if (fileContentsRef.current.size > 0) {
      for (const [mentionId, content] of fileContentsRef.current.entries()) {
        // Extract file path from mentionId (file:local:path or file:external:path)
        const filePath = mentionId.replace(/^file:(local|external):/, "")
        parts.push({
          type: "file-content" as const,
          filePath,
          content,
        })
      }
    }

    // Create chat with selected scope, branch, and initial message
    pendingReasoningEnabledRef.current = reasoningOutputEnabled
    createChatMutation.mutate({
      projectId: chatScope === "global" ? undefined : validatedProject?.id,
      taskId: chatScope === "task" ? selectedTask?.id : undefined,
      scope: chatScope,
      name: message.trim().slice(0, 50), // Use first 50 chars as chat name
      harness: agentProfileSelection?.harness ?? selectedAgent.id,
      model: agentProfileSelection?.model ?? selectedChatModel,
      runtimePreference: agentProfileSelection?.runtimePreference ?? runtimePreference,
      permissionMode:
        (agentProfileSelection?.permissionMode as NewChatPermissionMode | undefined) ??
        permissionModeOverride ??
        undefined,
      agentProfile: agentProfileSelection?.profile,
      confirmedAgentProfileDigest: agentProfileSelection?.digest,
      initialMessageParts: parts.length > 0 ? parts : undefined,
      baseBranch:
        chatScope === "project" && workMode === "worktree"
          ? selectedBranch || undefined
          : undefined,
      branchType:
        chatScope === "project" && workMode === "worktree" ? selectedBranchType : undefined,
      useWorktree: chatScope === "task" || (chatScope === "project" && workMode === "worktree"),
      mode: agentMode,
    })
    // Editor, images, files, and pasted texts are cleared in onSuccess callback
  }, [
    chatScope,
    validatedProject?.id,
    validatedProject?.path,
    selectedTask,
    createChatMutation,
    hasContent,
    selectedBranch,
    selectedBranchType,
    workMode,
    images,
    files,
    pastedTexts,
    selectedChatModel,
    selectedAgent.id,
    runtimePreference,
    permissionModeOverride,
    agentMode,
    reasoningOutputEnabled,
    trpcUtils,
    finishVoiceBeforeSend,
    localModelPicker.canLaunch,
    agentProfileSelection,
    setSettingsActiveTab,
    setSettingsDialogOpen,
  ])

  const handleMentionSelect = useCallback((mention: FileMentionOption) => {
    // Category navigation - enter subpage instead of inserting mention
    if (mention.type === "category") {
      if (mention.id === "files") {
        setShowingFilesList(true)
        return
      }
      if (mention.id === "skills") {
        setShowingSkillsList(true)
        return
      }
      if (mention.id === "agents") {
        setShowingAgentsList(true)
        return
      }
      if (mention.id === "tools") {
        setShowingToolsList(true)
        return
      }
    }

    // Otherwise: insert mention as normal
    editorRef.current?.insertMention(mention)
    setShowMentionDropdown(false)
    // Reset subpage state
    setShowingFilesList(false)
    setShowingSkillsList(false)
    setShowingAgentsList(false)
    setShowingToolsList(false)
  }, [])

  // Save draft to localStorage when content changes
  const handleContentChange = useCallback(
    (hasContent: boolean) => {
      setHasContent(hasContent)
      const text = editorRef.current?.getValue() || ""

      // Skip if text hasn't changed
      if (text === lastSavedTextRef.current) {
        return
      }
      lastSavedTextRef.current = text

      if (text.trim()) {
        // If no current draft ID, create a new one
        const draftId = ensureCurrentDraftId()

        updateNewChatDraftText(
          draftId,
          text,
          chatScope !== "global" && validatedProject
            ? {
                id: validatedProject.id,
                name: validatedProject.name,
                path: validatedProject.path,
                gitOwner: validatedProject.gitOwner,
                gitRepo: validatedProject.gitRepo,
                gitProvider: validatedProject.gitProvider,
              }
            : undefined,
        )
      } else if (currentDraftIdRef.current) {
        // Text is empty - delete the current draft
        deleteNewChatDraft(currentDraftIdRef.current)
        currentDraftIdRef.current = null
        onDraftIdChange?.(null)
      }
    },
    [chatScope, ensureCurrentDraftId, onDraftIdChange, validatedProject],
  )

  // Clear current draft when chat is created
  const clearCurrentDraft = useCallback(() => {
    if (!currentDraftIdRef.current) return

    deleteNewChatDraft(currentDraftIdRef.current)
    currentDraftIdRef.current = null
    onDraftIdChange?.(null)
    setSelectedDraftId(null)
  }, [onDraftIdChange, setSelectedDraftId])

  // Memoized callbacks to prevent re-renders
  const handleMentionTrigger = useCallback(
    ({ searchText, rect }: { searchText: string; rect: DOMRect }) => {
      if (validatedProject) {
        setMentionSearchText(searchText)
        setMentionPosition({ top: rect.top, left: rect.left })
        // Reset subpage state when opening dropdown
        setShowingFilesList(false)
        setShowingSkillsList(false)
        setShowingAgentsList(false)
        setShowingToolsList(false)
        setShowMentionDropdown(true)
      }
    },
    [validatedProject],
  )

  const handleCloseTrigger = useCallback(() => {
    setShowMentionDropdown(false)
    // Reset subpage state when closing
    setShowingFilesList(false)
    setShowingSkillsList(false)
    setShowingAgentsList(false)
    setShowingToolsList(false)
  }, [])

  // Slash command handlers
  const handleSlashTrigger = useCallback(
    ({ searchText, rect }: { searchText: string; rect: DOMRect }) => {
      setSlashSearchText(searchText)
      setSlashPosition({ top: rect.top, left: rect.left })
      setShowSlashDropdown(true)
    },
    [],
  )

  const handleCloseSlashTrigger = useCallback(() => {
    setShowSlashDropdown(false)
  }, [])

  const handleSlashSelect = useCallback(
    (command: SlashCommandOption) => {
      // Clear the slash command text from editor
      editorRef.current?.clearSlashCommand()
      setShowSlashDropdown(false)

      // Handle builtin commands that change app state (no text input needed)
      if (command.category === "builtin") {
        switch (command.name) {
          case "clear":
            editorRef.current?.clear()
            return
          case "plan":
            if (agentMode !== "plan") {
              setAgentMode("plan")
            }
            return
          case "write":
            setAgentMode("write")
            return
          case "review":
            setAgentMode("review")
            return
        }
      }

      // For all other commands (builtin prompts and custom):
      // insert the command and let user add arguments or press Enter to send
      editorRef.current?.setValue(`/${command.name} `)
    },
    [agentMode],
  )

  // Paste handler for images, plain text, and large text (saved as files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => handlePasteEvent(e, handleAddAttachments, addPastedText),
    [handleAddAttachments, addPastedText],
  )

  // Drag and drop handlers
  const [isDragOver, setIsDragOver] = useState(false)

  // Focus state for ring
  const [isFocused, setIsFocused] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  // Text file extensions that should have content read and attached
  const TEXT_FILE_EXTENSIONS = new Set([
    // Code
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".py",
    ".rb",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".swift",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".cs",
    ".php",
    ".lua",
    ".r",
    ".m",
    ".mm",
    ".scala",
    ".clj",
    ".ex",
    ".exs",
    ".hs",
    ".elm",
    ".erl",
    ".fs",
    ".fsx",
    ".ml",
    ".v",
    ".vhdl",
    ".zig",
    // Config/Data
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".ini",
    ".env",
    ".conf",
    ".cfg",
    ".properties",
    ".plist",
    // Web
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".vue",
    ".svelte",
    ".astro",
    // Documentation
    ".md",
    ".mdx",
    ".rst",
    ".txt",
    ".text",
    // Graphics (text-based)
    ".svg",
    // Shell/Scripts
    ".sh",
    ".bash",
    ".zsh",
    ".fish",
    ".ps1",
    ".bat",
    ".cmd",
    // Other
    ".sql",
    ".graphql",
    ".gql",
    ".prisma",
    ".dockerfile",
    ".makefile",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".eslintrc",
    ".prettierrc",
  ])

  const MAX_FILE_SIZE_FOR_CONTENT = 100 * 1024 // 100KB - files larger than this only get path mention

  // Image extensions that should be handled as attachments (base64)
  const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const droppedFiles = Array.from(e.dataTransfer.files)

      // Separate images from other files
      const imageFiles: File[] = []
      const otherFiles: File[] = []

      for (const file of droppedFiles) {
        const ext = file.name.includes(".") ? "." + file.name.split(".").pop()?.toLowerCase() : ""
        if (IMAGE_EXTENSIONS.has(ext)) {
          imageFiles.push(file)
        } else {
          otherFiles.push(file)
        }
      }

      // Handle images via existing attachment system (base64)
      if (imageFiles.length > 0) {
        handleAddAttachments(imageFiles)
      }

      // Process other files - for text files, read content and add as file mention
      for (const file of otherFiles) {
        // Get file path using Electron's webUtils API (more reliable than file.path)
        const filePath: string | undefined =
          window.webUtils?.getPathForFile?.(file) || (file as File & { path?: string }).path

        let mentionId: string
        let mentionPath: string

        // Check if file is inside the project
        if (validatedProject?.path && filePath && filePath.startsWith(validatedProject.path)) {
          // Project file: use relative path with file:local: prefix
          const relativePath = filePath.slice(validatedProject.path.length).replace(/^\//, "")
          mentionId = `file:local:${relativePath}`
          mentionPath = relativePath
        } else if (filePath) {
          // External file: use absolute path with file:external: prefix
          mentionId = `file:external:${filePath}`
          mentionPath = filePath
        } else {
          // Fallback: use filename only
          mentionId = `file:external:${file.name}`
          mentionPath = file.name
        }

        const fileName = file.name
        const ext = fileName.includes(".") ? "." + fileName.split(".").pop()?.toLowerCase() : ""
        // Files without extension are likely directories or special files - skip content reading
        const hasExtension = ext !== ""
        const isTextFile = hasExtension && TEXT_FILE_EXTENSIONS.has(ext)
        const isSmallEnough = file.size <= MAX_FILE_SIZE_FOR_CONTENT

        // For text files that are small enough, read content and store it
        // Show file chip, content will be added to prompt on send
        if (isTextFile && isSmallEnough && filePath) {
          // Add file chip for visual representation
          editorRef.current?.insertMention({
            id: mentionId,
            label: fileName,
            path: mentionPath,
            repository: "local",
            type: "file",
          })

          // Read and cache content (will be added to prompt on send)
          try {
            const content = await file.text()
            fileContentsRef.current.set(mentionId, content)
          } catch (err) {
            // If reading fails, chip is still there - agent can try to read via path
            console.error(`[handleDrop] Failed to read file content ${filePath}:`, err)
          }
        } else {
          // For binary files, large files - add as mention only
          // mentionPath contains full absolute path for external files
          editorRef.current?.insertMention({
            id: mentionId,
            label: fileName,
            path: mentionPath,
            repository: "local",
            type: "file",
          })
        }
      }

      // Focus after state update - use double rAF to wait for React render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          editorRef.current?.focus()
        })
      })
    },
    [validatedProject?.path, handleAddAttachments, trpcUtils],
  )

  // Context items for images, files, and pasted text files
  const contextItems =
    images.length > 0 || files.length > 0 || pastedTexts.length > 0 ? (
      <div className="flex flex-wrap items-center gap-[6px]">
        {(() => {
          // Build allImages array for gallery navigation
          const allImages = images
            .filter((img) => img.url && !img.isLoading)
            .map((img) => ({
              id: img.id,
              filename: img.filename,
              url: img.url,
            }))

          return images.map((img, idx) => (
            <AgentImageItem
              key={img.id}
              id={img.id}
              filename={img.filename}
              url={img.url}
              isLoading={img.isLoading}
              onRemove={() => removeImage(img.id)}
              allImages={allImages}
              imageIndex={idx}
            />
          ))
        })()}
        {files.map((f) => (
          <AgentFileItem
            key={f.id}
            id={f.id}
            filename={f.filename}
            url={f.url || ""}
            size={f.size}
            isLoading={f.isLoading}
            onRemove={() => removeFile(f.id)}
          />
        ))}
        {pastedTexts.map((pt) => (
          <AgentPastedTextItem
            key={pt.id}
            filePath={pt.filePath}
            filename={pt.filename}
            size={pt.size}
            preview={pt.preview}
            onRemove={() => removePastedText(pt.id)}
          />
        ))}
      </div>
    ) : null

  // Handle container click to focus editor
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (
      e.target === e.currentTarget ||
      !(e.target as HTMLElement).closest("button, [contenteditable]")
    ) {
      editorRef.current?.focus()
    }
  }, [])

  return (
    <div className="flex h-full flex-col relative">
      {/* Header - Simple burger on mobile, AgentsHeaderControls on desktop */}
      <div className="flex-shrink-0 flex items-center justify-between bg-background p-1.5">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {isMobileFullscreen ? (
            // Simple burger button for mobile - just opens chats list
            <Button
              variant="ghost"
              size="icon"
              onClick={onBackToChats}
              className="h-7 w-7 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] flex-shrink-0 rounded-md"
              aria-label="All projects"
            >
              <AlignJustify className="h-4 w-4" />
            </Button>
          ) : (
            <AgentsHeaderControls
              isSidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
              hasUnseenChanges={hasAnyUnseenChanges}
            />
          )}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-y-auto relative">
        <div className="w-full max-w-2xl space-y-4 md:space-y-6 relative z-10 px-4">
          <div className="text-center">
            <h1 className="text-2xl md:text-4xl font-medium tracking-tight">
              {chatScope === "global"
                ? "Start a global chat"
                : chatScope === "task"
                  ? "Start a task chat"
                  : "Start a project chat"}
            </h1>
            {chatScope === "project" && validatedProject?.name ? (
              <p className="mt-2 text-sm text-muted-foreground">
                For
                <span
                  className="ml-2 text-base font-semibold md:text-lg"
                  style={{ color: selectedProjectColor }}
                >
                  {validatedProject.name}
                </span>
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {chatScope === "global"
                  ? "No repo is attached until you choose one."
                  : chatScope === "task"
                    ? selectedTask
                      ? `${validatedProject?.name ?? "Project"} / ${selectedTask.name}`
                      : "Choose a task before sending."
                    : "Choose a repo before sending."}
              </p>
            )}
          </div>

          {/* Input Area */}
          <div
            className="relative w-full"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div
              className="relative w-full cursor-text"
              data-tour="prompt"
              onClick={handleContainerClick}
            >
              {/* Target selectors - directly above input */}
              <div className="mb-2 ml-[5px] flex flex-wrap items-center gap-2" data-tour="scope">
                <div className="flex items-center gap-1 rounded-md bg-muted/40 p-0.5">
                  {(["global", "project", "task"] as const).map((scope) => {
                    const disabled =
                      (scope === "project" && !validatedProject) ||
                      (scope === "task" && (!validatedProject || !projectTasks?.length))
                    return (
                      <button
                        key={scope}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          setChatScope(scope)
                          persistDraftDestination(scope, validatedProject)
                        }}
                        className={cn(
                          "rounded px-2 py-1 text-xs font-medium transition-colors",
                          chatScope === scope
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                          disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
                        )}
                      >
                        {scope === "global" ? "Global" : scope === "project" ? "Project" : "Task"}
                      </button>
                    )
                  })}
                </div>

                <ProjectSelector
                  onProjectChange={(project) => persistDraftDestination(chatScope, project)}
                />

                {chatScope === "task" && validatedProject && (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={!projectTasks?.length}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-[background-color,color] duration-150 ease-out rounded-md hover:bg-muted/50 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="truncate max-w-[140px]">
                        {selectedTask?.name ?? "No tasks"}
                      </span>
                      <IconChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" sideOffset={6} className="min-w-[220px]">
                      {projectTasks?.map((task) => (
                        <DropdownMenuItem
                          key={task.id}
                          onClick={() => setSelectedTaskId(task.id)}
                          className="justify-between gap-2"
                        >
                          <span className="truncate">{task.name}</span>
                          {selectedTaskId === task.id && (
                            <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Work mode selector - between project and branch */}
                {validatedProject && chatScope === "project" && (
                  <WorkModeSelector
                    value={workMode}
                    onChange={setWorkMode}
                    disabled={createChatMutation.isPending}
                  />
                )}

                {/* Branch selector - only visible when worktree mode is selected */}
                {validatedProject && chatScope === "project" && workMode === "worktree" && (
                  <Popover
                    open={branchPopoverOpen}
                    onOpenChange={(open) => {
                      if (!open) {
                        setBranchSearch("") // Clear search on close
                      }
                      setBranchPopoverOpen(open)
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-[background-color,color] duration-150 ease-out rounded-md hover:bg-muted/50 outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                        disabled={branchesQuery.isLoading}
                      >
                        <BranchIcon className="w-4 h-4" />
                        <span className="truncate max-w-[100px]">
                          {selectedBranch || branchesQuery.data?.defaultBranch || "main"}
                        </span>
                        <IconChevronDown className="w-3 h-3 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      {/* Search input with Create button */}
                      <div className="flex items-center gap-1.5 h-7 px-1.5 mx-1 my-1 rounded-md bg-muted/50">
                        <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <input
                          type="text"
                          placeholder="Search branches..."
                          value={branchSearch}
                          onChange={(e) => setBranchSearch(e.target.value)}
                          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 flex items-center gap-1 text-xs shrink-0"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setCreateBranchDialogOpen(true)
                            setBranchPopoverOpen(false)
                          }}
                        >
                          <Plus className="h-3 w-3" />
                          Create
                        </Button>
                      </div>

                      {/* Virtualized branch list */}
                      {filteredBranches.length === 0 ? (
                        <div className="py-6 text-center text-sm text-muted-foreground">
                          No branches found.
                        </div>
                      ) : (
                        <div
                          ref={branchListRef}
                          className="overflow-auto py-1 scrollbar-hide"
                          style={{
                            height: Math.min(filteredBranches.length * 32 + 8, 300),
                          }}
                        >
                          <div
                            style={{
                              height: `${branchVirtualizer.getTotalSize()}px`,
                              width: "100%",
                              position: "relative",
                            }}
                          >
                            {branchVirtualizer.getVirtualItems().map((virtualItem) => {
                              const branch = filteredBranches[virtualItem.index]
                              const isSelected =
                                (selectedBranch === branch.name &&
                                  selectedBranchType === branch.type) ||
                                (!selectedBranch && branch.isDefault && branch.type === "local")
                              return (
                                <button
                                  key={`${branch.type}-${branch.name}`}
                                  onClick={() => {
                                    setSelectedBranch(branch.name, branch.type)
                                    setBranchPopoverOpen(false)
                                    setBranchSearch("")
                                  }}
                                  className={cn(
                                    "flex items-center gap-1.5 w-[calc(100%-8px)] mx-1 px-1.5 text-sm text-left absolute left-0 top-0 rounded-md cursor-default select-none outline-none transition-colors",
                                    isSelected
                                      ? "dark:bg-neutral-800 text-foreground"
                                      : "dark:hover:bg-neutral-800 hover:text-foreground",
                                  )}
                                  style={{
                                    height: `${virtualItem.size}px`,
                                    transform: `translateY(${virtualItem.start}px)`,
                                  }}
                                >
                                  <BranchIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                                  <span className="truncate flex-1">{branch.name}</span>
                                  <span
                                    className={cn(
                                      "text-[10px] px-1.5 py-0.5 rounded shrink-0",
                                      branch.type === "local"
                                        ? "bg-blue-500/10 text-blue-500"
                                        : "bg-orange-500/10 text-orange-500",
                                    )}
                                  >
                                    {branch.type}
                                  </span>
                                  {branch.committedAt && (
                                    <span className="text-xs text-muted-foreground/70 shrink-0">
                                      {formatRelativeTime(branch.committedAt)}
                                    </span>
                                  )}
                                  {branch.isDefault && (
                                    <span className="text-[10px] text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded shrink-0">
                                      default
                                    </span>
                                  )}
                                  {isSelected && <CheckIcon className="h-4 w-4 shrink-0 ml-auto" />}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                )}

                {/* Create Branch Dialog */}
                {validatedProject && (
                  <CreateBranchDialog
                    open={createBranchDialogOpen}
                    onOpenChange={setCreateBranchDialogOpen}
                    projectPath={validatedProject.path}
                    branches={branches}
                    defaultBranch={branchesQuery.data?.defaultBranch || "main"}
                    onBranchCreated={(branchName) => {
                      setSelectedBranch(branchName, "local")
                    }}
                  />
                )}
              </div>
              {featureVisibility.isVisible("agent-profiles") && (
                <NewChatAgentProfileSelector
                  scope={chatScope}
                  projectId={chatScope === "global" ? undefined : validatedProject?.id}
                  taskId={chatScope === "task" ? selectedTask?.id : undefined}
                  permissionMode={effectivePermissionMode}
                  runtimePreference={runtimePreference}
                  onSelectionChange={setAgentProfileSelection}
                />
              )}
              <PromptInput
                className={cn(
                  "border bg-input-background relative z-10 p-2 rounded-xl transition-[border-color,box-shadow] duration-150",
                  isDragOver && "border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]",
                  isFocused &&
                    !isDragOver &&
                    "border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.18)]",
                )}
                maxHeight={240}
                onSubmit={handleSend}
                contextItems={contextItems}
              >
                <PromptInputContextItems />
                <div className="relative">
                  <AgentsMentionsEditor
                    ref={editorRef}
                    onTrigger={handleMentionTrigger}
                    onCloseTrigger={handleCloseTrigger}
                    onSlashTrigger={handleSlashTrigger}
                    onCloseSlashTrigger={handleCloseSlashTrigger}
                    onContentChange={handleContentChange}
                    onSubmit={handleSend}
                    onShiftTab={toggleMode}
                    placeholder="Plan, @ for context, / for commands"
                    className={cn(
                      "bg-transparent max-h-[240px] overflow-y-auto p-1",
                      isMobileFullscreen ? "min-h-[56px]" : "min-h-[44px]",
                    )}
                    onPaste={handlePaste}
                    disabled={createChatMutation.isPending}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                  />
                </div>
                <PromptInputActions className="w-full">
                  <div className="flex items-center gap-0.5 flex-1 min-w-0">
                    <div className="group/model-controls flex min-w-0 items-center gap-0.5">
                      <AgentModelSelector
                        open={isModelDropdownOpen}
                        onOpenChange={setIsModelDropdownOpen}
                        selectedAgentId={selectedAgent.id as AgentProviderId}
                        onSelectedAgentIdChange={(provider) => {
                          if (provider === "claude-code") {
                            setSelectedAgent(claudeAgent)
                          } else {
                            setSelectedAgent(
                              enabledAgents.find((agent) => agent.id === provider) || fallbackAgent,
                            )
                          }
                          setLastSelectedAgentId(provider)
                        }}
                        selectedModelLabel={selectedModelLabel}
                        triggerClassName="max-w-[250px] min-w-0"
                        onOpenModelsSettings={() => {
                          setSettingsActiveTab("models")
                          setSettingsDialogOpen(true)
                        }}
                        claude={{
                          models: availableModels.models.filter(
                            (m) => !hiddenModels.includes(m.id),
                          ),
                          selectedModelId: selectedModel?.id,
                          onSelectModel: (modelId) => {
                            const model =
                              availableModels.models.find((m) => m.id === modelId) ||
                              availableModels.models[0]
                            if (!model) return
                            setSelectedModel(model)
                            setLastSelectedModelId(model.id)
                          },
                          hasCustomModelConfig: hasCustomClaudeConfig,
                          isOffline: availableModels.isOffline && availableModels.hasOllama,
                          ollamaModels: availableModels.ollamaModels,
                          selectedOllamaModel: currentOllamaModel,
                          recommendedOllamaModel: availableModels.recommendedModel,
                          onSelectOllamaModel: setSelectedOllamaModel,
                          isConnected: isClaudeConnected,
                          reasoningOutputEnabled,
                          onReasoningOutputChange: setReasoningOutputEnabled,
                          selectedEffort: selectedClaudeEffort,
                          onSelectEffort: setLastSelectedClaudeEffort,
                        }}
                        codex={{
                          models: codexUiModels,
                          selectedModelId: selectedCodexModel.id,
                          onSelectModel: (modelId) => {
                            const model = codexUiModels.find((item) => item.id === modelId)
                            if (!model) return
                            const nextReasoning = model.reasoningLevels.includes(
                              lastSelectedCodexReasoning as CodexReasoningLevel,
                            )
                              ? (lastSelectedCodexReasoning as CodexReasoningLevel)
                              : model.reasoningLevels.includes("high")
                                ? "high"
                                : model.reasoningLevels[0]!

                            setLastSelectedCodexModelId(model.id)
                            setLastSelectedCodexReasoning(nextReasoning)
                            if (!model.supportsFastMode) {
                              setLastSelectedCodexFastMode(false)
                            }
                          },
                          selectedReasoning: selectedCodexReasoning,
                          onSelectReasoning: setLastSelectedCodexReasoning,
                          fastModeEnabled: codexFastModeEnabled,
                          onFastModeChange: (enabled) =>
                            setLastSelectedCodexFastMode(
                              selectedCodexModel.supportsFastMode ? enabled : false,
                            ),
                          isConnected: codexIntegration?.isConnected === true,
                        }}
                        cursor={{
                          models: cursorUiModels,
                          selectedModelId: selectedCursorModel.id,
                          onSelectModel: (modelId) => {
                            const model = cursorUiModels.find((item) => item.id === modelId)
                            if (model) setLastSelectedCursorModelId(model.id)
                          },
                          isConnected: cursorIntegration?.isConnected === true,
                          isLoginPending: cursorLoginMutation.isPending,
                          onLogin: () => cursorLoginMutation.mutate(),
                        }}
                        opencode={{
                          openrouter: {
                            label: "OpenRouter",
                            models: (openrouterCatalog?.models || [])
                              .filter((model) =>
                                enabledOpencodeModels.openrouter.includes(`openrouter/${model.id}`),
                              )
                              .map((model) => ({
                                id: `openrouter/${model.id}`,
                                name: model.label,
                              })),
                            selectedModelId: lastSelectedOpencodeModels.openrouter,
                            onSelectModel: (modelId) =>
                              setLastSelectedOpencodeModels((current) => ({
                                ...current,
                                openrouter: modelId,
                              })),
                          },
                          nanogpt: {
                            label: "NanoGPT",
                            models: (nanogptCatalog?.models || [])
                              .filter((model) =>
                                enabledOpencodeModels.nanogpt.includes(`nanogpt/${model.id}`),
                              )
                              .map((model) => ({
                                id: `nanogpt/${model.id}`,
                                name: model.label,
                              })),
                            selectedModelId: lastSelectedOpencodeModels.nanogpt,
                            onSelectModel: (modelId) =>
                              setLastSelectedOpencodeModels((current) => ({
                                ...current,
                                nanogpt: modelId,
                              })),
                          },
                        }}
                        local={{
                          ...localModelPicker,
                          onOpenSettings: () => {
                            setSettingsActiveTab("local-models")
                            setSettingsDialogOpen(true)
                          },
                        }}
                      />
                      <AgentModelTuningSelector
                        selectedAgentId={selectedAgent.id as AgentProviderId}
                        reasoningEnabled={reasoningOutputEnabled}
                        onReasoningEnabledChange={setReasoningOutputEnabled}
                        claude={{
                          models: availableModels.models.filter(
                            (model) => !hiddenModels.includes(model.id),
                          ),
                          selectedModelId: selectedModel?.id,
                          hasCustomModelConfig: hasCustomClaudeConfig,
                          isOffline: availableModels.isOffline && availableModels.hasOllama,
                          selectedEffort: selectedClaudeEffort,
                          onSelectEffort: setLastSelectedClaudeEffort,
                        }}
                        codex={{
                          models: codexUiModels,
                          selectedModelId: selectedCodexModel.id,
                          selectedReasoning: selectedCodexReasoning,
                          onSelectReasoning: setLastSelectedCodexReasoning,
                          fastModeEnabled: codexFastModeEnabled,
                          onFastModeChange: (enabled) =>
                            setLastSelectedCodexFastMode(
                              selectedCodexModel.supportsFastMode ? enabled : false,
                            ),
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5 ml-auto flex-shrink-0">
                    {/* Hidden file input */}
                    <input
                      type="file"
                      ref={fileInputRef}
                      hidden
                      multiple
                      onChange={(e) => {
                        const inputFiles = Array.from(e.target.files || [])
                        handleAddAttachments(inputFiles)
                        e.target.value = "" // Reset to allow same file selection
                      }}
                    />
                    {/* Voice wave indicator or Attachment button */}
                    {isVoiceRecording ? (
                      <VoiceWaveIndicator
                        isRecording={isVoiceRecording}
                        audioLevel={voiceAudioLevel}
                      />
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-sm outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={images.length >= 5 && files.length >= 10}
                      >
                        <AttachIcon className="h-4 w-4" />
                      </Button>
                    )}
                    {featureVisibility.isVisible("voice") && (
                      <AgentVoiceButton
                        isRecording={isVoiceRecording}
                        isStarting={isVoiceStarting}
                        isTranscribing={isTranscribing}
                        voiceInputReady={isVoiceReady}
                        voiceStatusLabel={voiceStatusLabel}
                        onUnavailableClick={showVoiceSetup}
                        onStart={() => void handleVoiceMouseDown()}
                        onStop={() => void handleVoiceMouseUp()}
                      />
                    )}
                    <div className="ml-0.5">
                      <AgentSendButton
                        isStreaming={false}
                        isSubmitting={createChatMutation.isPending || isUploading}
                        disabled={Boolean(
                          !hasContent ||
                          isUploading ||
                          ((chatScope === "project" || chatScope === "task") &&
                            !validatedProject) ||
                          (chatScope === "task" && !selectedTask) ||
                          runtimeBlockedReason,
                        )}
                        onClick={handleSend}
                        mode={agentMode}
                        hasContent={hasContent}
                      />
                    </div>
                  </div>
                </PromptInputActions>
              </PromptInput>

              {runtimeBlockedReason ? (
                <p role="alert" className="mt-2 px-2 text-xs text-amber-600 dark:text-amber-300">
                  {runtimeBlockedReason} Choose Flapstack Native to launch now.
                </p>
              ) : null}

              <div className="mt-1.5 ml-[5px] flex flex-wrap items-center gap-2 md:mt-2">
                {featureVisibility.isVisible("runtimes") && (
                  <RuntimeSelector
                    harness={selectedAgent.id}
                    value={runtimePreference}
                    automaticPreference={resolvedRuntimePreference}
                    onChange={setRuntimePreference}
                    disabled={createChatMutation.isPending}
                  />
                )}
                <PermissionSelector
                  harness={selectedAgent.id}
                  value={effectivePermissionMode}
                  options={selectableNewChatPermissionModes}
                  onChange={(mode) => {
                    if (mode !== "custom") setPermissionModeOverride(mode)
                  }}
                  disabled={createChatMutation.isPending || isReadOnlyChatMode(agentMode)}
                />
                <AgentModeSelector
                  value={agentMode}
                  onChange={setAgentMode}
                  disabled={createChatMutation.isPending}
                />
              </div>

              {/* Worktree config banner - moved to corner banner below */}

              {/* File mention dropdown */}
              {/* Desktop: use projectPath for local file search */}
              <AgentsFileMention
                isOpen={showMentionDropdown && !!validatedProject}
                onClose={() => {
                  setShowMentionDropdown(false)
                  // Reset subpage state when dropdown closes
                  setShowingFilesList(false)
                  setShowingSkillsList(false)
                  setShowingAgentsList(false)
                  setShowingToolsList(false)
                }}
                onSelect={handleMentionSelect}
                searchText={mentionSearchText}
                position={mentionPosition}
                projectPath={validatedProject?.path}
                showingFilesList={showingFilesList}
                showingSkillsList={showingSkillsList}
                showingAgentsList={showingAgentsList}
                showingToolsList={showingToolsList}
              />

              {/* Slash command dropdown */}
              <AgentsSlashCommand
                isOpen={showSlashDropdown}
                onClose={handleCloseSlashTrigger}
                onSelect={handleSlashSelect}
                searchText={slashSearchText}
                position={slashPosition}
                projectPath={validatedProject?.path}
                mode={agentMode}
                disabledCommands={["clear"]}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Worktree config banner - fixed bottom-right corner */}
      {showWorktreeBanner && chatScope === "project" && (
        <div className="absolute bottom-4 right-4 max-w-sm p-3 pb-4 bg-muted/50 backdrop-blur-sm rounded-lg border border-border space-y-3 shadow-lg z-50">
          <p className="text-sm text-muted-foreground">
            Configure a worktree setup script to install dependencies or copy environment variables.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={handleConfigureWorktree}>
              Settings
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const prompt = COMMAND_PROMPTS["worktree-setup"]
                if (prompt && validatedProject) {
                  createChatMutation.mutate({
                    projectId: validatedProject.id,
                    scope: "project",
                    name: "Worktree Setup",
                    harness: selectedAgent.id,
                    model: selectedChatModel,
                    initialMessageParts: [{ type: "text", text: prompt }],
                    useWorktree: false,
                    mode: "write",
                  })
                }
              }}
            >
              Fill with AI
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
