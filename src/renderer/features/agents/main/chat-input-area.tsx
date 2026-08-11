"use client"

import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { AlertTriangle, Camera, ChevronDown, ListTodo, Plus, RefreshCw, Target } from "lucide-react"
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "../../../components/ui/button"
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import { AttachIcon, CheckIcon, IconSpinner, OriginalMCPIcon } from "../../../components/ui/icons"
import { Kbd } from "../../../components/ui/kbd"
import {
  PromptInput,
  PromptInputActions,
  PromptInputContextItems,
} from "../../../components/ui/prompt-input"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover"
import { Switch } from "../../../components/ui/switch"
import { ProgressiveOverflowRow } from "../../../components/progressive-overflow-row"
import {
  agentsSettingsDialogActiveTabAtom,
  agentsSettingsDialogOpenAtom,
  hiddenModelsAtom,
  selectedOllamaModelAtom,
} from "../../../lib/atoms"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { measurePerformanceNextFrame } from "../../../lib/performance-counters"
import {
  enabledOpencodeModelsAtom,
  enabledCursorModelsAtom,
  lastSelectedCodexModelIdAtom,
  lastSelectedClaudeEffortAtom,
  lastSelectedCodexFastModeAtom,
  lastSelectedCodexReasoningAtom,
  lastSelectedCursorModelIdAtom,
  lastSelectedModelIdAtom,
  subChatClaudeEffortAtomFamily,
  subChatCodexFastModeAtomFamily,
  subChatCodexModelIdAtomFamily,
  subChatCodexReasoningAtomFamily,
  subChatCursorModelIdAtomFamily,
  subChatOpencodeModelsAtomFamily,
  subChatReasoningEnabledAtomFamily,
  subChatModelIdAtomFamily,
  subChatModeAtomFamily,
  selectedTargetWorktreePathAtomFamily,
  selectedAgentChatIdAtom,
  getNextMode,
  type AgentMode,
  type SubChatFileChange,
} from "../atoms"
import {
  RuntimeSelector,
  resolveConfiguredRuntimePreference,
  resolvedRuntimeAdapter,
  runtimePreferenceLabel,
} from "../runtime-settings"
import { useAgentSubChatStoreApi } from "../stores/sub-chat-store"
import { agentChatStore } from "../stores/agent-chat-store"
import { AgentsSlashCommand, type SlashCommandOption } from "../commands"
import {
  AgentModelSelector,
  AgentModelTuningSelector,
  type AgentProviderId,
} from "../components/agent-model-selector"
import { AgentSendButton, AgentVoiceButton } from "../components/agent-send-button"
import { AgentModeSelector } from "../components/agent-mode-selector"
import { PermissionSelector } from "../components/permission-selector"
import type { UploadedFile, UploadedImage } from "../hooks/use-agents-file-upload"
import { useAvailableModels } from "../hooks/use-available-models"
import { useVoiceInputHotkey } from "../hooks/use-voice-input-hotkey"
import {
  clearSubChatDraft,
  DRAFTS_CHANGE_EVENT,
  getSubChatDraft,
  saveSubChatDraftWithAttachments,
  updateSubChatDraftText,
} from "../lib/drafts"
import {
  CODEX_MODELS,
  CURSOR_MODELS,
  DEFAULT_OPENCODE_MODELS,
  type ClaudeEffortLevel,
  type CodexReasoningLevel,
} from "../lib/models"
import type { DiffTextContext, SelectedTextContext } from "../lib/queue-utils"
import {
  AgentsFileMention,
  AgentsMentionsEditor,
  type AgentsMentionsEditorHandle,
  type FileMentionOption,
} from "../mentions"
import { AgentContextIndicator, type MessageTokenData } from "../ui/agent-context-indicator"
import { AgentDiffTextContextItem } from "../ui/agent-diff-text-context-item"
import { AgentFileItem } from "../ui/agent-file-item"
import { AgentImageItem } from "../ui/agent-image-item"
import { AgentPastedTextItem } from "../ui/agent-pasted-text-item"
import { AgentTextContextItem } from "../ui/agent-text-context-item"
import { VoiceWaveIndicator } from "../ui/voice-wave-indicator"
import { VisualCaptureDialog } from "../ui/visual-capture-dialog"
import { McpStatusDot } from "../../../components/dialogs/settings-tabs/agents-mcp-tab"
import { handlePasteEvent } from "../utils/paste-text"
import type { PastedTextFile } from "../hooks/use-pasted-text-files"
import { useLocalDictationSetup } from "../hooks/use-local-dictation-setup"
import { useLocalModelPickerSurface } from "../../local-models/use-local-model-picker-surface"
import { toast } from "sonner"
import { useDictationSession } from "../voice/dictation-session"
import { registerVoiceHistoryInsertTarget } from "../../../lib/voice-history-insert"
import { registerPermissionUiTestControl } from "../lib/permission-ui-test-control"
import type { RunPermissionMode } from "../../../../shared/harness-types"
import { isReadOnlyChatMode, resolveChatModePermission } from "../../../../shared/chat-mode"
import type { AgentRuntimePreference } from "../../../../shared/agent-runtime"
import {
  customPermissionCapabilityKeys,
  disabledCustomPermissions,
  type CustomPermissionCapabilities,
} from "../../../../shared/permission-capabilities"
import {
  formatPermissionMode,
  getSelectableRunPermissionModes,
  RUN_PERMISSION_MODE_LABELS,
} from "../constants"
import { ChatAgentProfileControl } from "../../agent-profiles/chat-agent-profile-control"
import { useFeatureVisibility } from "../../settings/use-feature-visibility"

const CUSTOM_PERMISSION_LABELS: Record<(typeof customPermissionCapabilityKeys)[number], string> = {
  projectWrite: "Project edits",
  shell: "Shell",
  network: "Network",
  git: "Git",
  browser: "Browser",
  secrets: "Secrets",
  subagents: "Subagents",
  thirdPartyMcp: "Third-party MCP",
  productMcpRead: "Product MCP reads",
  productMcpWrite: "Product MCP writes",
  productMcpTier3: "Product MCP Tier 3",
}

export interface ChatInputAreaProps {
  // Editor ref - passed from parent for external access
  editorRef: React.RefObject<AgentsMentionsEditorHandle | null>
  // File input ref - for attachment button
  fileInputRef: React.RefObject<HTMLInputElement | null>
  // Core callbacks
  onSend: (inputValueOverride?: string) => void
  onForceSend: () => void // Opt+Enter: stop stream and send immediately, bypassing queue
  onStop: () => Promise<void>
  onCompact: () => void
  onModeChange?: (newMode: AgentMode) => void
  // State from parent
  isStreaming: boolean
  isCompacting: boolean
  // File uploads
  images: UploadedImage[]
  files: UploadedFile[]
  onAddAttachments: (files: File[]) => void
  onPersistAttachments?: (files: File[]) => void
  onRemoveImage: (id: string) => void
  onRemoveFile: (id: string) => void
  isUploading: boolean
  // Text context from selected assistant message text
  textContexts: SelectedTextContext[]
  onRemoveTextContext: (id: string) => void
  // Diff text context from selected diff sidebar text
  diffTextContexts?: DiffTextContext[]
  onRemoveDiffTextContext?: (id: string) => void
  // Pasted text files (large pasted text saved as files)
  pastedTexts?: PastedTextFile[]
  onAddPastedText?: (text: string) => Promise<void>
  onRemovePastedText?: (id: string) => void
  // Callback to cache file content for dropped text files (content added to prompt on send)
  onCacheFileContent?: (mentionId: string, content: string) => void
  // Pre-computed token data for context indicator (avoids passing messages array)
  messageTokenData: MessageTokenData
  // Context
  subChatId: string
  parentChatId: string
  provider?: AgentProviderId
  targetWorktreePath?: string | null
  onTargetWorktreePathChange?: (path: string | null) => void
  teamId?: string
  repository?: string
  chatName?: string | null
  projectLabel?: string | null
  sandboxId?: string
  projectPath?: string
  changedFiles: SubChatFileChange[]
  // Mobile
  isMobile?: boolean
  // Queue - for sending from queue when input is empty
  queueLength?: number
  onSendFromQueue?: (itemId: string) => void
  firstQueueItemId?: string
  // Callback to notify parent when input has content (for custom text with questions)
  onInputContentChange?: (hasContent: boolean) => void
  // Callback to send message with question answer (Enter sends immediately, not to queue)
  onSubmitWithQuestionAnswer?: () => void
  // Callback to switch provider for brand new (empty) sub-chats
  onProviderChange?: (provider: AgentProviderId) => void
  // Callback to continue chat with a different provider (creates new sub-chat with history)
  onContinueWithProvider?: (provider: AgentProviderId, targetModel: string) => void
  // Callback to delegate a bounded task to a distinct provider child Chat.
  onDelegateWithProvider?: (provider: AgentProviderId, targetModel: string) => void
  // Whether this sub-chat tab is the active/visible one (prevents window-level hotkeys in background tabs)
  isActive?: boolean
}

/**
 * Custom comparison for memo to prevent re-renders from unstable array references.
 * Compares messages by length and last message id, changedFiles by length and paths.
 */
function arePropsEqual(prevProps: ChatInputAreaProps, nextProps: ChatInputAreaProps): boolean {
  // Compare primitives and stable references first (fast path)
  if (
    prevProps.isStreaming !== nextProps.isStreaming ||
    prevProps.isCompacting !== nextProps.isCompacting ||
    prevProps.isUploading !== nextProps.isUploading ||
    prevProps.subChatId !== nextProps.subChatId ||
    prevProps.parentChatId !== nextProps.parentChatId ||
    prevProps.provider !== nextProps.provider ||
    prevProps.targetWorktreePath !== nextProps.targetWorktreePath ||
    prevProps.teamId !== nextProps.teamId ||
    prevProps.repository !== nextProps.repository ||
    prevProps.chatName !== nextProps.chatName ||
    prevProps.projectLabel !== nextProps.projectLabel ||
    prevProps.sandboxId !== nextProps.sandboxId ||
    prevProps.projectPath !== nextProps.projectPath ||
    prevProps.isMobile !== nextProps.isMobile ||
    prevProps.queueLength !== nextProps.queueLength ||
    prevProps.firstQueueItemId !== nextProps.firstQueueItemId ||
    prevProps.isActive !== nextProps.isActive
  ) {
    return false
  }

  // Compare refs by identity (they should be stable)
  if (
    prevProps.editorRef !== nextProps.editorRef ||
    prevProps.fileInputRef !== nextProps.fileInputRef
  ) {
    return false
  }

  // Compare callbacks by identity (they should be memoized in parent)
  if (
    prevProps.onSend !== nextProps.onSend ||
    prevProps.onForceSend !== nextProps.onForceSend ||
    prevProps.onStop !== nextProps.onStop ||
    prevProps.onCompact !== nextProps.onCompact ||
    prevProps.onModeChange !== nextProps.onModeChange ||
    prevProps.onAddAttachments !== nextProps.onAddAttachments ||
    prevProps.onPersistAttachments !== nextProps.onPersistAttachments ||
    prevProps.onRemoveImage !== nextProps.onRemoveImage ||
    prevProps.onRemoveFile !== nextProps.onRemoveFile ||
    prevProps.onRemoveTextContext !== nextProps.onRemoveTextContext ||
    prevProps.onAddPastedText !== nextProps.onAddPastedText ||
    prevProps.onRemovePastedText !== nextProps.onRemovePastedText ||
    prevProps.onCacheFileContent !== nextProps.onCacheFileContent ||
    prevProps.onInputContentChange !== nextProps.onInputContentChange ||
    prevProps.onSubmitWithQuestionAnswer !== nextProps.onSubmitWithQuestionAnswer ||
    prevProps.onProviderChange !== nextProps.onProviderChange ||
    prevProps.onContinueWithProvider !== nextProps.onContinueWithProvider ||
    prevProps.onDelegateWithProvider !== nextProps.onDelegateWithProvider ||
    prevProps.onTargetWorktreePathChange !== nextProps.onTargetWorktreePathChange ||
    prevProps.onSendFromQueue !== nextProps.onSendFromQueue
  ) {
    return false
  }

  // Compare textContexts array - by length and ids
  if (!prevProps.textContexts || !nextProps.textContexts) {
    return prevProps.textContexts === nextProps.textContexts
  }
  if (prevProps.textContexts.length !== nextProps.textContexts.length) {
    return false
  }
  for (let i = 0; i < prevProps.textContexts.length; i++) {
    if (prevProps.textContexts[i]?.id !== nextProps.textContexts[i]?.id) {
      return false
    }
  }

  // Compare diffTextContexts array - by length and ids
  const prevDiff = prevProps.diffTextContexts || []
  const nextDiff = nextProps.diffTextContexts || []
  if (prevDiff.length !== nextDiff.length) {
    return false
  }
  for (let i = 0; i < prevDiff.length; i++) {
    if (prevDiff[i]?.id !== nextDiff[i]?.id) {
      return false
    }
  }

  // Compare images array - by length and ids
  if (!prevProps.images || !nextProps.images) {
    return prevProps.images === nextProps.images
  }
  if (prevProps.images.length !== nextProps.images.length) {
    return false
  }
  for (let i = 0; i < prevProps.images.length; i++) {
    if (prevProps.images[i]?.id !== nextProps.images[i]?.id) {
      return false
    }
  }

  // Compare files array - by length and ids
  if (!prevProps.files || !nextProps.files) {
    return prevProps.files === nextProps.files
  }
  if (prevProps.files.length !== nextProps.files.length) {
    return false
  }
  for (let i = 0; i < prevProps.files.length; i++) {
    if (prevProps.files[i]?.id !== nextProps.files[i]?.id) {
      return false
    }
  }

  // Compare pastedTexts array - by length and ids
  const prevPasted = prevProps.pastedTexts || []
  const nextPasted = nextProps.pastedTexts || []
  if (prevPasted.length !== nextPasted.length) {
    return false
  }
  for (let i = 0; i < prevPasted.length; i++) {
    if (prevPasted[i]?.id !== nextPasted[i]?.id) {
      return false
    }
  }

  // Compare messageTokenData - only re-render when token counts actually change
  // This is much more stable than comparing messages array reference
  if (
    prevProps.messageTokenData.totalInputTokens !== nextProps.messageTokenData.totalInputTokens ||
    prevProps.messageTokenData.totalOutputTokens !== nextProps.messageTokenData.totalOutputTokens ||
    prevProps.messageTokenData.totalChatTokens !== nextProps.messageTokenData.totalChatTokens ||
    prevProps.messageTokenData.contextWindow !== nextProps.messageTokenData.contextWindow ||
    prevProps.messageTokenData.messageCount !== nextProps.messageTokenData.messageCount
  ) {
    return false
  }

  // Compare changedFiles - by length and filePaths
  if (!prevProps.changedFiles || !nextProps.changedFiles) {
    return prevProps.changedFiles === nextProps.changedFiles
  }
  if (prevProps.changedFiles.length !== nextProps.changedFiles.length) {
    return false
  }
  for (let i = 0; i < prevProps.changedFiles.length; i++) {
    if (prevProps.changedFiles[i]?.filePath !== nextProps.changedFiles[i]?.filePath) {
      return false
    }
  }

  return true
}

/**
 * ChatInputArea - Isolated input component to prevent re-renders of parent
 *
 * This component manages its own state for:
 * - hasContent (whether input has text)
 * - isFocused (editor focus state)
 * - isDragOver (drag/drop state)
 * - Mention dropdown state (showMentionDropdown, mentionSearchText, etc.)
 * - Slash command dropdown state
 * - Mode dropdown state
 * - Model dropdown state
 *
 * When user types, only this component re-renders, not the entire ChatViewInner.
 */
export const ChatInputArea = memo(function ChatInputArea({
  editorRef,
  fileInputRef,
  onSend,
  onForceSend,
  onStop,
  onCompact,
  onModeChange,
  isStreaming,
  isCompacting,
  images,
  files,
  onAddAttachments,
  onPersistAttachments,
  onRemoveImage,
  onRemoveFile,
  isUploading,
  textContexts,
  onRemoveTextContext,
  diffTextContexts,
  onRemoveDiffTextContext,
  pastedTexts = [],
  onAddPastedText,
  onRemovePastedText,
  onCacheFileContent,
  messageTokenData,
  subChatId,
  parentChatId,
  provider = "claude-code",
  targetWorktreePath,
  onTargetWorktreePathChange,
  teamId,
  repository,
  chatName,
  projectLabel,
  sandboxId,
  projectPath,
  changedFiles,
  isMobile = false,
  queueLength = 0,
  onSendFromQueue,
  firstQueueItemId,
  onInputContentChange,
  onSubmitWithQuestionAnswer,
  onProviderChange,
  onContinueWithProvider,
  onDelegateWithProvider,
  isActive = true,
}: ChatInputAreaProps) {
  const subChatStore = useAgentSubChatStoreApi()
  // Local state - changes here don't re-render parent
  const [hasContent, setHasContent] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [inputWidth, setInputWidth] = useState(Number.POSITIVE_INFINITY)
  const inputResizeObserverRef = useRef<ResizeObserver | null>(null)
  const inputMeasureFrameRef = useRef<number | null>(null)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const { data: runtimeChat } = trpc.chats.getMetadata.useQuery(
    { id: parentChatId },
    { staleTime: 30_000, refetchOnMount: false },
  )
  const { data: runtimeTask } = trpc.tasks.get.useQuery(
    { id: runtimeChat?.taskId ?? "" },
    { enabled: Boolean(runtimeChat?.taskId) },
  )
  const featureVisibility = useFeatureVisibility()
  const [visualCaptureOpen, setVisualCaptureOpen] = useState(false)
  const selectedSpeechContext = useMemo(
    () => ({
      project:
        projectLabel || repository || projectPath?.split(/[\\/]/).filter(Boolean).pop() || null,
      task: runtimeTask?.name ?? null,
      chat: chatName || `Chat ${parentChatId.slice(0, 8)}`,
    }),
    [chatName, parentChatId, projectLabel, projectPath, repository, runtimeTask?.name],
  )
  const { data: runtimeReleases = [] } = trpc.agentRuntimeDefaults.capabilities.useQuery(
    undefined,
    {
      staleTime: 5 * 60_000,
      refetchOnMount: false,
    },
  )
  const { data: runtimeDefaults = [] } = trpc.agentRuntimeDefaults.list.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnMount: false,
  })
  const runtimePreference = (runtimeChat?.runtimePreference ?? "auto") as AgentRuntimePreference
  const resolvedRuntimePreference = resolveConfiguredRuntimePreference({
    harness: provider,
    chatPreference: runtimePreference,
    projectId: runtimeChat?.projectId,
    defaults: runtimeDefaults,
  })
  const resolvedRuntime = resolvedRuntimeAdapter(resolvedRuntimePreference, provider)
  const runtimeBlockedReason = runtimeReleases.find(
    (release) => release.runtime === resolvedRuntime && !release.enabledForNewLaunches,
  )?.reason
  const [pendingRuntimeContinuation, setPendingRuntimeContinuation] =
    useState<AgentRuntimePreference | null>(null)
  const runtimeContinuationRequestRef = useRef<string | null>(null)
  const setRuntimePreferenceMutation = trpc.chats.setRuntimePreference.useMutation()
  const continueWithRuntimeMutation = trpc.chats.continueWithRuntime.useMutation()
  const selectedTargetWorktreePathAtom = useMemo(
    () => selectedTargetWorktreePathAtomFamily(subChatId),
    [subChatId],
  )
  const [storedTargetWorktreePath, setStoredTargetWorktreePath] = useAtom(
    selectedTargetWorktreePathAtom,
  )
  const currentTargetWorktreePath = targetWorktreePath ?? storedTargetWorktreePath
  const [newWorktreeName, setNewWorktreeName] = useState("")
  const [newWorktreeParentDirectory, setNewWorktreeParentDirectory] = useState<string | null>(null)
  const [customWorktreeInput, setCustomWorktreeInput] = useState("")
  const customWorktreeValidationRef = useRef(0)
  const [customWorktreeError, setCustomWorktreeError] = useState<string | null>(null)
  const [isValidatingCustomWorktree, setIsValidatingCustomWorktree] = useState(false)
  const [isWorktreeMenuOpen, setIsWorktreeMenuOpen] = useState(false)
  const trpcUtils = trpc.useUtils()
  const handleRuntimeChange = useCallback(
    async (preference: AgentRuntimePreference) => {
      if (preference === runtimePreference || isStreaming) return
      try {
        await setRuntimePreferenceMutation.mutateAsync({ chatId: parentChatId, preference })
        await Promise.all([
          trpcUtils.chats.get.invalidate({ id: parentChatId }),
          trpcUtils.chats.list.invalidate(),
        ])
        toast.success(`Runtime changed to ${runtimePreferenceLabel(preference)}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes("Started chats cannot change Runtime")) {
          runtimeContinuationRequestRef.current = crypto.randomUUID()
          setPendingRuntimeContinuation(preference)
          return
        }
        toast.error(message)
      }
    },
    [
      isStreaming,
      parentChatId,
      runtimePreference,
      setRuntimePreferenceMutation,
      trpcUtils.chats.get,
      trpcUtils.chats.list,
    ],
  )
  const confirmRuntimeContinuation = useCallback(async () => {
    if (!pendingRuntimeContinuation || continueWithRuntimeMutation.isPending) return
    const requestId = runtimeContinuationRequestRef.current ?? crypto.randomUUID()
    runtimeContinuationRequestRef.current = requestId
    try {
      const created = await continueWithRuntimeMutation.mutateAsync({
        sourceChatId: parentChatId,
        preference: pendingRuntimeContinuation,
        requestId,
      })
      await trpcUtils.chats.list.invalidate()
      setPendingRuntimeContinuation(null)
      runtimeContinuationRequestRef.current = null
      setSelectedChatId(created.chatId)
      toast.success(`Continued with ${runtimePreferenceLabel(created.runtimePreference)}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }, [
    continueWithRuntimeMutation,
    parentChatId,
    pendingRuntimeContinuation,
    setSelectedChatId,
    trpcUtils.chats.list,
  ])
  const updateTargetWorktreePath = useCallback(
    (path: string | null) => {
      setStoredTargetWorktreePath(path)
      onTargetWorktreePathChange?.(path)
      agentChatStore.delete(subChatId)
    },
    [onTargetWorktreePathChange, setStoredTargetWorktreePath, subChatId],
  )

  // Mention dropdown state
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionSearchText, setMentionSearchText] = useState("")
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 })

  // Mention dropdown subpage navigation state
  const [showingFilesList, setShowingFilesList] = useState(false)
  const [showingSkillsList, setShowingSkillsList] = useState(false)
  const [showingAgentsList, setShowingAgentsList] = useState(false)
  const [showingToolsList, setShowingToolsList] = useState(false)

  // Slash command dropdown state
  const [showSlashDropdown, setShowSlashDropdown] = useState(false)
  const [slashSearchText, setSlashSearchText] = useState("")
  const [slashPosition, setSlashPosition] = useState({ top: 0, left: 0 })

  // Model dropdown state
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const subChatModelIdAtom = useMemo(() => subChatModelIdAtomFamily(subChatId), [subChatId])
  const [selectedSubChatModelId, setSelectedSubChatModelId] = useAtom(subChatModelIdAtom)
  const subChatCodexModelIdAtom = useMemo(
    () => subChatCodexModelIdAtomFamily(subChatId),
    [subChatId],
  )
  const [selectedSubChatCodexModelId, setSelectedSubChatCodexModelId] =
    useAtom(subChatCodexModelIdAtom)
  const subChatCodexReasoningAtom = useMemo(
    () => subChatCodexReasoningAtomFamily(subChatId),
    [subChatId],
  )
  const [selectedSubChatCodexReasoning, setSelectedSubChatCodexReasoning] =
    useAtom(subChatCodexReasoningAtom)
  const subChatClaudeEffortAtom = useMemo(
    () => subChatClaudeEffortAtomFamily(subChatId),
    [subChatId],
  )
  const [selectedSubChatClaudeEffort, setSelectedSubChatClaudeEffort] =
    useAtom(subChatClaudeEffortAtom)
  const subChatCodexFastModeAtom = useMemo(
    () => subChatCodexFastModeAtomFamily(subChatId),
    [subChatId],
  )
  const [selectedSubChatCodexFastMode, setSelectedSubChatCodexFastMode] =
    useAtom(subChatCodexFastModeAtom)
  const subChatCursorModelIdAtom = useMemo(
    () => subChatCursorModelIdAtomFamily(subChatId),
    [subChatId],
  )
  const [selectedSubChatCursorModelId, setSelectedSubChatCursorModelId] =
    useAtom(subChatCursorModelIdAtom)
  const subChatOpencodeModelsAtom = useMemo(
    () => subChatOpencodeModelsAtomFamily(subChatId),
    [subChatId],
  )
  const [selectedOpencodeModels, setSelectedOpencodeModels] = useAtom(subChatOpencodeModelsAtom)
  const enabledOpencodeModels = useAtomValue(enabledOpencodeModelsAtom)
  const setLastSelectedModelId = useSetAtom(lastSelectedModelIdAtom)
  const setLastSelectedClaudeEffort = useSetAtom(lastSelectedClaudeEffortAtom)
  const setLastSelectedCodexModelId = useSetAtom(lastSelectedCodexModelIdAtom)
  const setLastSelectedCodexReasoning = useSetAtom(lastSelectedCodexReasoningAtom)
  const setLastSelectedCodexFastMode = useSetAtom(lastSelectedCodexFastModeAtom)
  const setLastSelectedCursorModelId = useSetAtom(lastSelectedCursorModelIdAtom)
  const [selectedOllamaModel, setSelectedOllamaModel] = useAtom(selectedOllamaModelAtom)
  const availableModels = useAvailableModels()
  const [selectedModel, setSelectedModel] = useState(
    () =>
      availableModels.models.find((m) => m.id === selectedSubChatModelId) ||
      availableModels.models[0],
  )

  useEffect(() => {
    for (const providerId of ["openrouter", "nanogpt"] as const) {
      if (enabledOpencodeModels[providerId].includes(selectedOpencodeModels[providerId])) continue
      setSelectedOpencodeModels({
        [providerId]:
          enabledOpencodeModels[providerId][0] ?? DEFAULT_OPENCODE_MODELS[providerId][0].id,
      })
    }
  }, [enabledOpencodeModels, selectedOpencodeModels, setSelectedOpencodeModels])

  // Sync selectedModel when per-subChat atom value changes (e.g., after localStorage hydration)
  useEffect(() => {
    const model = availableModels.models.find((m) => m.id === selectedSubChatModelId)
    if (model && model.id !== selectedModel.id) {
      setSelectedModel(model)
    }
  }, [availableModels.models, selectedModel.id, selectedSubChatModelId])

  // Materialize the resolved Claude model into per-subChat storage once mounted.
  // This prevents later global default changes from affecting existing sub-chats.
  useEffect(() => {
    if (provider !== "claude-code") return
    if (!selectedModel?.id) return
    setSelectedSubChatModelId(selectedModel.id)
  }, [provider, selectedModel?.id, setSelectedSubChatModelId])

  const selectedClaudeEffort = useMemo<ClaudeEffortLevel>(() => {
    const efforts = selectedModel && "efforts" in selectedModel ? selectedModel.efforts : undefined
    if (!efforts || efforts.length === 0) return "high"
    if (efforts.includes(selectedSubChatClaudeEffort as ClaudeEffortLevel)) {
      return selectedSubChatClaudeEffort as ClaudeEffortLevel
    }
    if (efforts.includes("high")) return "high"
    return efforts[0]!
  }, [selectedModel, selectedSubChatClaudeEffort])

  useEffect(() => {
    if (provider !== "claude-code") return
    if (selectedSubChatClaudeEffort === selectedClaudeEffort) return
    setSelectedSubChatClaudeEffort(selectedClaudeEffort)
  }, [provider, selectedClaudeEffort, selectedSubChatClaudeEffort, setSelectedSubChatClaudeEffort])

  const { data: codexCredentialStatus } = trpc.credentials.status.useQuery(
    { id: "codex.api-key" },
    {
      enabled: isModelDropdownOpen || provider === "codex",
      staleTime: 5 * 60_000,
      refetchOnMount: false,
    },
  )
  const hasAppCodexApiKey = codexCredentialStatus?.configured === true
  const hiddenModels = useAtomValue(hiddenModelsAtom)
  const enabledCursorModels = useAtomValue(enabledCursorModelsAtom)

  // Connection status for providers
  const { data: claudeCodeIntegration } = trpc.claudeCode.getIntegration.useQuery(undefined, {
    enabled: isModelDropdownOpen || provider === "claude-code",
    staleTime: 60_000,
    refetchOnMount: false,
  })
  const { data: cursorIntegration } = trpc.cursor.getIntegration.useQuery(undefined, {
    enabled: isModelDropdownOpen || provider === "cursor-agent",
    staleTime: 30_000,
    refetchOnMount: false,
    refetchInterval: (query) =>
      isModelDropdownOpen && !query.state.data?.isConnected ? 2_000 : false,
  })
  const { data: codexIntegration } = trpc.codex.getIntegration.useQuery(undefined, {
    enabled: isModelDropdownOpen || provider === "codex",
    staleTime: 60_000,
    refetchOnMount: false,
  })
  const { data: cursorModelData } = trpc.cursor.listModels.useQuery(undefined, {
    enabled: isModelDropdownOpen || provider === "cursor-agent",
    staleTime: 5 * 60_000,
    refetchOnMount: false,
  })
  const { data: openrouterCatalog } = trpc.opencode.listModels.useQuery(
    { provider: "openrouter" },
    {
      enabled: isModelDropdownOpen || provider === "openrouter",
      staleTime: 5 * 60_000,
      refetchOnMount: false,
    },
  )
  const { data: nanogptCatalog } = trpc.opencode.listModels.useQuery(
    { provider: "nanogpt" },
    {
      enabled: isModelDropdownOpen || provider === "nanogpt",
      staleTime: 5 * 60_000,
      refetchOnMount: false,
    },
  )
  const cursorLoginMutation = trpc.cursor.startLogin.useMutation({
    onSuccess: () => {
      toast.info("Complete Cursor login in the browser, then reopen this menu.")
      void trpcUtils.cursor.getIntegration.invalidate()
    },
    onError: (error) => toast.error(`Could not start Cursor login: ${error.message}`),
  })
  const codexUiModels = useMemo(() => {
    const authSurface = hasAppCodexApiKey ? "api-key" : "chatgpt"
    const models = CODEX_MODELS.filter((model) => model.authSurfaces.includes(authSurface))
    return models.filter((model) => !hiddenModels.includes(model.id))
  }, [hasAppCodexApiKey, hiddenModels])
  const selectedCodexModel = useMemo(
    () =>
      codexUiModels.find((model) => model.id === selectedSubChatCodexModelId) ||
      codexUiModels[0] ||
      CODEX_MODELS[0]!,
    [codexUiModels, selectedSubChatCodexModelId],
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
      cursorUiModels.find((model) => model.id === selectedSubChatCursorModelId) ||
      cursorUiModels[0] || { id: "auto", name: "Auto" },
    [cursorUiModels, selectedSubChatCursorModelId],
  )

  const codexFastModeEnabled =
    selectedCodexModel.supportsFastMode === true && selectedSubChatCodexFastMode

  const selectedCodexReasoning = useMemo<CodexReasoningLevel>(() => {
    if (
      selectedCodexModel.reasoningLevels.includes(
        selectedSubChatCodexReasoning as CodexReasoningLevel,
      )
    ) {
      return selectedSubChatCodexReasoning as CodexReasoningLevel
    }

    if (selectedCodexModel.reasoningLevels.includes("high")) {
      return "high"
    }

    return selectedCodexModel.reasoningLevels[0]!
  }, [selectedCodexModel, selectedSubChatCodexReasoning])

  useEffect(() => {
    if (
      selectedCodexModel.reasoningLevels.includes(
        selectedSubChatCodexReasoning as CodexReasoningLevel,
      )
    ) {
      return
    }

    setSelectedSubChatCodexReasoning(selectedCodexReasoning)
  }, [
    selectedCodexModel,
    selectedSubChatCodexReasoning,
    selectedCodexReasoning,
    setSelectedSubChatCodexReasoning,
  ])

  useEffect(() => {
    if (selectedCodexModel.supportsFastMode || !selectedSubChatCodexFastMode) return
    setSelectedSubChatCodexFastMode(false)
  }, [
    selectedCodexModel.supportsFastMode,
    selectedSubChatCodexFastMode,
    setSelectedSubChatCodexFastMode,
  ])

  // Materialize resolved Codex model/reasoning into per-subChat storage once mounted.
  // This prevents later global default changes from affecting existing sub-chats.
  useEffect(() => {
    if (provider !== "codex") return
    if (selectedCodexModel?.id) {
      setSelectedSubChatCodexModelId(selectedCodexModel.id)
    }
    setSelectedSubChatCodexReasoning(selectedCodexReasoning)
  }, [
    provider,
    selectedCodexModel?.id,
    selectedCodexReasoning,
    setSelectedSubChatCodexModelId,
    setSelectedSubChatCodexReasoning,
  ])

  useEffect(() => {
    if (provider !== "cursor-agent") return
    if (selectedCursorModel.id) setSelectedSubChatCursorModelId(selectedCursorModel.id)
  }, [provider, selectedCursorModel.id, setSelectedSubChatCursorModelId])

  const { data: customClaudeCredentialStatus } = trpc.credentials.status.useQuery(
    { id: "claude.custom-api-token" },
    {
      enabled: isModelDropdownOpen || provider === "claude-code",
      staleTime: 5 * 60_000,
      refetchOnMount: false,
    },
  )
  const hasCustomClaudeConfig = customClaudeCredentialStatus?.configured === true
  const isClaudeConnected = Boolean(claudeCodeIntegration?.isConnected) || hasCustomClaudeConfig

  // Determine current Ollama model (selected or recommended)
  const currentOllamaModel =
    selectedOllamaModel || availableModels.recommendedModel || availableModels.ollamaModels[0]

  const [reasoningOutputEnabled, setReasoningOutputEnabled] = useAtom(
    subChatReasoningEnabledAtomFamily(subChatId),
  )
  const localModelPicker = useLocalModelPickerSurface()

  const selectedModelContextWindow = useMemo(() => {
    if (provider === "claude-code") return selectedModel?.contextWindow
    if (provider === "codex") return selectedCodexModel.contextWindow
    if (provider === "openrouter" || provider === "nanogpt") {
      const catalog = provider === "openrouter" ? openrouterCatalog : nanogptCatalog
      const selectedId = selectedOpencodeModels[provider]
      return catalog?.models.find((model) => `${provider}/${model.id}` === selectedId)
        ?.contextWindow
    }
    if (provider === "local") {
      return (
        localModelPicker.models.find((model) => model.id === localModelPicker.selectedModelId)
          ?.contextWindow ?? undefined
      )
    }
    return undefined
  }, [
    localModelPicker.models,
    localModelPicker.selectedModelId,
    nanogptCatalog,
    openrouterCatalog,
    provider,
    selectedCodexModel.contextWindow,
    selectedModel?.contextWindow,
    selectedOpencodeModels,
  ])
  const contextTokenData = useMemo(
    () => ({
      ...messageTokenData,
      contextWindow: messageTokenData.contextWindow ?? selectedModelContextWindow,
    }),
    [messageTokenData, selectedModelContextWindow],
  )

  const selectedModelLabel = useMemo(() => {
    if (provider === "local") {
      return localModelPicker.selectedModelId ?? "Choose local model"
    }
    if (provider === "codex") {
      return selectedCodexModel.name
    }

    if (provider === "cursor-agent") {
      return selectedCursorModel.name
    }

    if (provider === "openrouter" || provider === "nanogpt") {
      const modelId = selectedOpencodeModels[provider]
      const catalog = provider === "openrouter" ? openrouterCatalog : nanogptCatalog
      return (
        catalog?.models.find((model) => `${provider}/${model.id}` === modelId)?.label || modelId
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
    provider,
    localModelPicker.selectedModelId,
    selectedCodexModel.name,
    selectedCursorModel.name,
    selectedOpencodeModels,
    openrouterCatalog,
    nanogptCatalog,
    availableModels.isOffline,
    availableModels.hasOllama,
    currentOllamaModel,
    hasCustomClaudeConfig,
    selectedModel,
  ])

  const { data: permissionResolution } = trpc.permissions.resolveForChat.useQuery(
    { chatId: parentChatId },
    { enabled: !!parentChatId },
  )
  const { data: permissionPreferences } = trpc.permissions.getPreferences.useQuery()
  const resolvedPermissionMode = permissionResolution?.mode ?? "ask-before-edits"
  const [requestedPermissionMode, setRequestedPermissionMode] =
    useState<RunPermissionMode>(resolvedPermissionMode)
  const selectablePermissionModes = getSelectableRunPermissionModes(provider)
  const [pendingPermissionMode, setPendingPermissionMode] = useState<RunPermissionMode | null>(null)
  const [pendingPermissionScope, setPendingPermissionScope] = useState<
    "all-chats" | "current-chat"
  >("all-chats")
  const [rememberPermissionScope, setRememberPermissionScope] = useState(false)
  const [pendingCustomPermissions, setPendingCustomPermissions] =
    useState<CustomPermissionCapabilities>(disabledCustomPermissions)
  const [pendingCustomReviewed, setPendingCustomReviewed] = useState(false)
  const permissionConfirmationInFlightRef = useRef(false)
  const setChatPermissionModeMutation = trpc.permissions.setChatMode.useMutation({
    onSuccess: (result) => {
      setRequestedPermissionMode(result.mode)
      setPendingPermissionMode(null)
      trpcUtils.permissions.getPreferences.invalidate()
      trpcUtils.permissions.getGlobalDefault.invalidate()
      trpcUtils.permissions.listChatModes.invalidate()
      trpcUtils.permissions.resolveForChat.invalidate()
      trpcUtils.chats.list.invalidate()
      trpcUtils.chats.listArchived.invalidate()
      trpcUtils.projects.list.invalidate()
      trpcUtils.projects.listArchived.invalidate()
      trpcUtils.tasks.list.invalidate()
      trpcUtils.tasks.listArchived.invalidate()
      toast.success(
        result.scope === "all-chats" ? "Permission updated for all chats" : "Permission updated",
      )
    },
    onError: (error) => {
      setRequestedPermissionMode(resolvedPermissionMode)
      toast.error(`Failed to update permission mode: ${error.message}`)
    },
  })

  useEffect(() => {
    setRequestedPermissionMode(resolvedPermissionMode)
  }, [parentChatId, resolvedPermissionMode])

  const applyPermissionMode = useCallback(
    (
      mode: RunPermissionMode,
      scope: "all-chats" | "current-chat",
      rememberBehavior?: "all-chats" | "current-chat",
      customPermissions?: CustomPermissionCapabilities,
    ) => {
      return setChatPermissionModeMutation.mutateAsync({
        chatId: parentChatId,
        mode,
        scope,
        ...(rememberBehavior ? { rememberBehavior } : {}),
        ...(mode === "custom"
          ? {
              customPermissions:
                customPermissions ??
                permissionResolution?.customPermissions ??
                disabledCustomPermissions,
            }
          : {}),
      })
    },
    [parentChatId, permissionResolution?.customPermissions, setChatPermissionModeMutation],
  )

  const handlePermissionModeChange = useCallback(
    (mode: RunPermissionMode) => {
      if (mode === requestedPermissionMode || setChatPermissionModeMutation.isPending) return

      const behavior = permissionPreferences?.changeBehavior ?? "ask"
      if (mode === "custom") {
        setPendingCustomPermissions(
          permissionResolution?.customPermissions ?? disabledCustomPermissions,
        )
        setPendingCustomReviewed(false)
        setPendingPermissionMode(mode)
        setPendingPermissionScope(behavior === "current-chat" ? "current-chat" : "all-chats")
        setRememberPermissionScope(false)
        return
      }
      if (behavior === "ask") {
        setPendingPermissionMode(mode)
        setPendingPermissionScope("all-chats")
        setRememberPermissionScope(false)
        return
      }

      void applyPermissionMode(mode, behavior)
    },
    [
      applyPermissionMode,
      permissionPreferences?.changeBehavior,
      permissionResolution?.customPermissions,
      requestedPermissionMode,
      setChatPermissionModeMutation.isPending,
    ],
  )

  const handleConfirmPermissionModeChange = useCallback(async () => {
    if (!pendingPermissionMode || permissionConfirmationInFlightRef.current) return
    permissionConfirmationInFlightRef.current = true
    try {
      await applyPermissionMode(
        pendingPermissionMode,
        pendingPermissionScope,
        rememberPermissionScope ? pendingPermissionScope : undefined,
        pendingPermissionMode === "custom" ? pendingCustomPermissions : undefined,
      )
    } catch {
      // The mutation's onError handler restores the selector and reports the failure.
    } finally {
      permissionConfirmationInFlightRef.current = false
    }
  }, [
    applyPermissionMode,
    pendingCustomPermissions,
    pendingPermissionMode,
    pendingPermissionScope,
    rememberPermissionScope,
  ])

  useEffect(() => {
    const state = () => ({
      chatId: parentChatId,
      provider,
      storedMode: resolvedPermissionMode,
      requestedMode: requestedPermissionMode,
      changeBehavior: permissionPreferences?.changeBehavior ?? "ask",
      selectableModes: [...selectablePermissionModes],
      dialogOpen: pendingPermissionMode !== null,
      pendingMode: pendingPermissionMode,
      pendingScope: pendingPermissionScope,
      rememberScope: rememberPermissionScope,
      customReviewed: pendingCustomReviewed,
      customPermissions: pendingPermissionMode === "custom" ? pendingCustomPermissions : null,
      mutationPending: setChatPermissionModeMutation.isPending,
    })

    return registerPermissionUiTestControl(async (command) => {
      if (command.command === "permissions.ui.get") return state()
      if (command.operation === "select-mode") {
        handlePermissionModeChange(command.mode!)
      } else if (command.operation === "set-scope") {
        setPendingPermissionScope(command.scope!)
      } else if (command.operation === "set-remember") {
        setRememberPermissionScope(command.enabled!)
      } else if (command.operation === "set-custom-reviewed") {
        setPendingCustomReviewed(command.enabled!)
      } else if (command.operation === "set-custom-capability") {
        const capability = command.capability as (typeof customPermissionCapabilityKeys)[number]
        if (!customPermissionCapabilityKeys.includes(capability)) {
          throw new Error("Unknown custom permission capability")
        }
        setPendingCustomPermissions((current) => ({
          ...current,
          [capability]: command.enabled!,
        }))
      } else if (command.operation === "apply") {
        await handleConfirmPermissionModeChange()
      } else {
        setPendingPermissionMode(null)
        setPendingCustomReviewed(false)
      }
      return state()
    })
  }, [
    handleConfirmPermissionModeChange,
    handlePermissionModeChange,
    parentChatId,
    pendingCustomPermissions,
    pendingCustomReviewed,
    pendingPermissionMode,
    pendingPermissionScope,
    permissionPreferences?.changeBehavior,
    provider,
    rememberPermissionScope,
    requestedPermissionMode,
    resolvedPermissionMode,
    selectablePermissionModes,
    setChatPermissionModeMutation.isPending,
  ])
  const { data: worktreeOptions = [] } = trpc.chats.listWorktreeOptions.useQuery(
    { id: parentChatId },
    {
      enabled:
        !!parentChatId &&
        !sandboxId &&
        (isWorktreeMenuOpen || Boolean(currentTargetWorktreePath || runtimeChat?.worktreePath)),
      staleTime: 60_000,
      refetchOnMount: false,
    },
  )
  const createWorktreeMutation = trpc.chats.createWorktreeForExistingChat.useMutation({
    onSuccess: (chat) => {
      setNewWorktreeName("")
      setNewWorktreeParentDirectory(null)
      updateTargetWorktreePath(chat.worktreePath ?? null)
      trpcUtils.chats.list.invalidate()
      trpcUtils.chats.get.invalidate({ id: parentChatId })
      trpcUtils.chats.listWorktreeOptions.invalidate({ id: parentChatId })
      toast.success("Worktree created", {
        description: chat.worktreePath ?? undefined,
      })
    },
    onError: (error) => {
      toast.error(
        error.message.startsWith("Failed to create worktree:")
          ? error.message
          : `Failed to create worktree: ${error.message}`,
      )
    },
  })
  const selectWorktreeMutation = trpc.chats.selectWorktree.useMutation()
  const repairUnavailableCheckoutMutation = trpc.chats.repairUnavailableCheckout.useMutation()
  const reconnectReplacedCheckoutMutation = trpc.chats.reconnectReplacedCheckout.useMutation()
  const chooseReplacementCheckoutMutation = trpc.chats.chooseReplacementCheckout.useMutation()
  const chooseCheckoutMutation = trpc.chats.chooseCheckout.useMutation()
  const chooseWorktreeParentDirectoryMutation =
    trpc.chats.chooseWorktreeParentDirectory.useMutation()

  const defaultWorktreeOption = useMemo(
    () => worktreeOptions.find((option) => option.isDefault) ?? worktreeOptions[0],
    [worktreeOptions],
  )
  const selectedWorktreePath =
    currentTargetWorktreePath ??
    runtimeChat?.worktreePath ??
    defaultWorktreeOption?.path ??
    projectPath
  const selectedWorktreeOption = useMemo(
    () => worktreeOptions.find((option) => option.path === selectedWorktreePath),
    [selectedWorktreePath, worktreeOptions],
  )
  const hasWorktreeChoices = Boolean(parentChatId) && !sandboxId
  const selectedWorktreeLabel =
    selectedWorktreeOption?.label ?? (selectedWorktreePath ? "Custom path" : "No worktree")
  const trimmedCustomWorktree = customWorktreeInput.trim()
  const isValidCustomWorktree =
    trimmedCustomWorktree.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmedCustomWorktree)
  const isNonDefaultWorktree =
    Boolean(selectedWorktreePath) &&
    Boolean(defaultWorktreeOption?.path) &&
    selectedWorktreePath !== defaultWorktreeOption?.path
  const canCreateWorktree = Boolean(parentChatId) && Boolean(projectPath) && !sandboxId
  const { data: resolvedWorktreeStatus } = trpc.chats.resolveWorktreeStatus.useQuery(
    {
      id: parentChatId,
      ...(selectedWorktreePath ? { path: selectedWorktreePath } : {}),
    },
    {
      enabled: Boolean(parentChatId) && !sandboxId,
      staleTime: 60_000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  )
  const worktreeWasReplaced = resolvedWorktreeStatus?.status === "replaced"
  const worktreeNeedsRefresh = resolvedWorktreeStatus?.status === "unknown" || worktreeWasReplaced
  const worktreeIsDetached = resolvedWorktreeStatus?.status === "detached"
  const worktreeDisplayLabel = worktreeIsDetached ? "No project files" : selectedWorktreeLabel
  const worktreeBlockedReason = worktreeWasReplaced
    ? resolvedWorktreeStatus.error
    : worktreeNeedsRefresh
      ? `${selectedWorktreeLabel} was removed. Fix automatically uses the project checkout when available; otherwise this Chat continues without project files.`
      : null
  const detachedWorktreeWarning = worktreeIsDetached
    ? "The original checkout was removed. This Chat still works, but it has no project files."
    : null

  const persistTargetWorktreePath = useCallback(
    async (requestedPath: string) => {
      const result = await selectWorktreeMutation.mutateAsync({
        id: parentChatId,
        path: requestedPath,
      })
      if (result.status !== "repaired") return
      updateTargetWorktreePath(result.path)
      await Promise.all([
        trpcUtils.chats.get.invalidate({ id: parentChatId }),
        trpcUtils.chats.list.invalidate(),
        trpcUtils.chats.listWorktreeOptions.invalidate({ id: parentChatId }),
        trpcUtils.chats.resolveWorktreeStatus.invalidate(),
      ])
    },
    [
      parentChatId,
      selectWorktreeMutation,
      trpcUtils.chats.get,
      trpcUtils.chats.list,
      trpcUtils.chats.listWorktreeOptions,
      trpcUtils.chats.resolveWorktreeStatus,
      updateTargetWorktreePath,
    ],
  )

  const repairUnavailableCheckout = useCallback(async () => {
    try {
      if (worktreeWasReplaced && selectedWorktreePath) {
        const result = await reconnectReplacedCheckoutMutation.mutateAsync({
          id: parentChatId,
          path: selectedWorktreePath,
        })
        updateTargetWorktreePath(result.path)
        await Promise.all([
          trpcUtils.chats.get.invalidate({ id: parentChatId }),
          trpcUtils.chats.list.invalidate(),
          trpcUtils.chats.listWorktreeOptions.invalidate({ id: parentChatId }),
          trpcUtils.chats.resolveWorktreeStatus.invalidate(),
        ])
        toast.success("Repository reconnected", {
          description: "Flapstack verified and saved the current folder identity.",
        })
        return
      }
      const result = await repairUnavailableCheckoutMutation.mutateAsync({
        id: parentChatId,
        ...(selectedWorktreePath ? { unavailablePath: selectedWorktreePath } : {}),
      })
      if (result.status === "cancelled") return
      updateTargetWorktreePath(result.path)
      await Promise.all([
        trpcUtils.chats.get.invalidate({ id: parentChatId }),
        trpcUtils.chats.list.invalidate(),
        trpcUtils.chats.listWorktreeOptions.invalidate({ id: parentChatId }),
        trpcUtils.chats.resolveWorktreeStatus.invalidate(),
      ])
      if (result.detached) {
        toast.warning("Continued without project files", {
          description:
            result.repairedChatIds.length === 1
              ? "The Chat stayed in its project. Choose a repository later to reconnect it."
              : `${result.repairedChatIds.length} Chats stayed in their project. Choose a repository later to reconnect them.`,
        })
      } else {
        toast.success(
          result.repairedChatIds.length === 1
            ? "Using the project checkout"
            : `${result.repairedChatIds.length} Chats now use the project checkout`,
          { description: result.path },
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error("Could not fix checkout", {
        description: `${message} No Chats were changed.`,
      })
    }
  }, [
    parentChatId,
    reconnectReplacedCheckoutMutation,
    repairUnavailableCheckoutMutation,
    selectedWorktreePath,
    trpcUtils.chats.get,
    trpcUtils.chats.list,
    trpcUtils.chats.listWorktreeOptions,
    trpcUtils.chats.resolveWorktreeStatus,
    updateTargetWorktreePath,
    worktreeWasReplaced,
  ])

  const chooseReplacementCheckout = useCallback(async () => {
    try {
      const result = await chooseReplacementCheckoutMutation.mutateAsync({ id: parentChatId })
      if (result.status === "cancelled") return
      updateTargetWorktreePath(result.path)
      await Promise.all([
        trpcUtils.chats.get.invalidate({ id: parentChatId }),
        trpcUtils.chats.list.invalidate(),
        trpcUtils.chats.listWorktreeOptions.invalidate({ id: parentChatId }),
        trpcUtils.chats.resolveWorktreeStatus.invalidate(),
      ])
      toast.success(
        result.repairedChatIds.length === 1
          ? "Repository reconnected"
          : `${result.repairedChatIds.length} Chats reconnected`,
        { description: result.path },
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes("not its parent folder")) {
        toast.error("Choose a repository, not its parent folder", {
          description:
            "Select a folder where Git works, such as …/GitHub/flapstack—not …/GitHub. No Chats were changed.",
        })
      } else {
        toast.error("Could not reconnect repository", {
          description: `${message} No Chats were changed.`,
        })
      }
    }
  }, [
    chooseReplacementCheckoutMutation,
    parentChatId,
    trpcUtils.chats.get,
    trpcUtils.chats.list,
    trpcUtils.chats.listWorktreeOptions,
    trpcUtils.chats.resolveWorktreeStatus,
    updateTargetWorktreePath,
  ])

  const browseExistingCheckout = useCallback(async () => {
    try {
      const result = await chooseCheckoutMutation.mutateAsync({ id: parentChatId })
      if (result.status === "cancelled") return
      updateTargetWorktreePath(result.path)
      await Promise.all([
        trpcUtils.chats.get.invalidate({ id: parentChatId }),
        trpcUtils.chats.list.invalidate(),
        trpcUtils.chats.listWorktreeOptions.invalidate({ id: parentChatId }),
        trpcUtils.chats.resolveWorktreeStatus.invalidate(),
      ])
      toast.success("Existing checkout selected", { description: result.path })
    } catch (error) {
      toast.error("Could not use checkout", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [
    chooseCheckoutMutation,
    parentChatId,
    trpcUtils.chats.get,
    trpcUtils.chats.list,
    trpcUtils.chats.listWorktreeOptions,
    trpcUtils.chats.resolveWorktreeStatus,
    updateTargetWorktreePath,
  ])

  const chooseWorktreeLocation = useCallback(async () => {
    try {
      const selectedDirectory = await chooseWorktreeParentDirectoryMutation.mutateAsync()
      if (selectedDirectory) setNewWorktreeParentDirectory(selectedDirectory)
    } catch (error) {
      toast.error("Could not choose worktree location", {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }, [chooseWorktreeParentDirectoryMutation])

  useEffect(() => {
    if (currentTargetWorktreePath) return
    if (runtimeChat?.worktreePath) return
    if (!defaultWorktreeOption?.path) return
    setStoredTargetWorktreePath(defaultWorktreeOption.path)
  }, [
    currentTargetWorktreePath,
    defaultWorktreeOption?.path,
    runtimeChat?.worktreePath,
    setStoredTargetWorktreePath,
  ])
  const hasStartedChat = messageTokenData.messageCount > 0
  const canSwitchProvider = !hasStartedChat && !isStreaming && !sandboxId

  // MCP status - from getAllMcpConfig query (provides global/local grouping)
  const setSettingsOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const handleOpenVoiceSettings = useCallback(() => {
    setSettingsTab("voice")
    setSettingsOpen(true)
  }, [setSettingsOpen, setSettingsTab])
  const handleOpenPermissionSettings = useCallback(() => {
    setSettingsTab("permissions")
    setSettingsOpen(true)
  }, [setSettingsOpen, setSettingsTab])

  const {
    data: allMcpConfig,
    isLoading: isMcpLoading,
    refetch: refetchMcp,
  } = trpc.claude.getAllMcpConfig.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  })

  const [isMcpRefreshing, setIsMcpRefreshing] = useState(false)
  const isMcpBusy = isMcpLoading || isMcpRefreshing

  const handleRefreshMcp = useCallback(async () => {
    setIsMcpRefreshing(true)
    try {
      await refetchMcp()
    } finally {
      setIsMcpRefreshing(false)
    }
  }, [refetchMcp])

  // Extract global MCPs and project-specific MCPs
  const mcpGroups = useMemo(() => {
    if (!allMcpConfig?.groups) return { global: [], local: [] }

    const globalGroup = allMcpConfig.groups.find((g) => g.groupName === "Global")
    const localGroup = allMcpConfig.groups.find(
      (g) => g.projectPath && projectPath && g.projectPath === projectPath,
    )

    return {
      global: globalGroup?.mcpServers || [],
      local: localGroup?.mcpServers || [],
    }
  }, [allMcpConfig?.groups, projectPath])

  const totalMcps = mcpGroups.global.length + mcpGroups.local.length
  const connectedMcps =
    mcpGroups.global.filter((s) => s.status === "connected").length +
    mcpGroups.local.filter((s) => s.status === "connected").length

  const handleOpenMcpSettings = useCallback(() => {
    setSettingsTab("mcp")
    setSettingsOpen(true)
  }, [setSettingsTab, setSettingsOpen])

  // Auto-switch model based on network status (only if offline features enabled)
  // Note: When offline, we show Ollama models selector instead of Claude models
  // The selectedOllamaModel atom is used to track which Ollama model is selected

  // Plan mode - per-subChat using atomFamily
  const subChatModeAtom = useMemo(() => subChatModeAtomFamily(subChatId), [subChatId])
  const [subChatMode, setSubChatMode] = useAtom(subChatModeAtom)
  const effectivePermissionMode = resolveChatModePermission(subChatMode, requestedPermissionMode)
  const { data: permissionPreview } = trpc.permissions.previewHarness.useQuery({
    harness: provider,
    mode: effectivePermissionMode,
    chatMode: subChatMode,
    cwd: selectedWorktreePath ?? null,
    customPermissions:
      effectivePermissionMode === "custom"
        ? (permissionResolution?.customPermissions ?? disabledCustomPermissions)
        : null,
  })

  // Helper to update mode (atomFamily + Zustand store sync)
  const updateMode = useCallback(
    (newMode: AgentMode) => {
      if (onModeChange) {
        onModeChange(newMode)
        return
      }
      setSubChatMode(newMode)
      subChatStore.getState().updateSubChatMode(subChatId, newMode)
    },
    [onModeChange, setSubChatMode, subChatId],
  )

  // Toggle mode helper
  const toggleMode = useCallback(() => {
    updateMode(getNextMode(subChatMode))
  }, [subChatMode, updateMode])

  // Voice capture lives above chat navigation. This composer supplies an
  // immutable origin and remains only a view over that origin-owned draft.
  const currentDraftTextRef = useRef<string>("")
  const dictationTargetKey = `chat:${parentChatId}:${subChatId}`
  const dictation = useDictationSession()
  const ownsDictation = dictation.activeTargetKey === dictationTargetKey
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
    if (!ownsDictation) return
    const syncOriginDraft = () => {
      const text = getSubChatDraft(parentChatId, subChatId) ?? ""
      currentDraftTextRef.current = text
      editorRef.current?.setValue(text)
    }
    window.addEventListener(DRAFTS_CHANGE_EVENT, syncOriginDraft)
    return () => window.removeEventListener(DRAFTS_CHANGE_EVENT, syncOriginDraft)
  }, [editorRef, ownsDictation, parentChatId, subChatId])

  useEffect(() => {
    if (!isActive) return
    return registerVoiceHistoryInsertTarget(dictationTargetKey, (value) => {
      const text = value.trim()
      if (!text) return
      const current = editorRef.current?.getValue() || ""
      const next = `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`
      currentDraftTextRef.current = next
      updateSubChatDraftText(parentChatId, subChatId, next)
      editorRef.current?.setValue(next)
      editorRef.current?.focus()
    })
  }, [dictationTargetKey, editorRef, isActive, parentChatId, subChatId])

  // Get resolved voice input hotkey

  // Refs for draft saving
  const currentSubChatIdRef = useRef<string>(subChatId)
  const currentChatIdRef = useRef<string | null>(parentChatId)
  currentSubChatIdRef.current = subChatId
  currentChatIdRef.current = parentChatId

  // Keyboard shortcut: Cmd+/ to open model selector
  useEffect(() => {
    if (!isActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "/") {
        e.preventDefault()
        e.stopPropagation()
        const shouldBlockForCustomClaude = provider === "claude-code" && hasCustomClaudeConfig
        if (!shouldBlockForCustomClaude) {
          setIsModelDropdownOpen(true)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [hasCustomClaudeConfig, provider, isActive])

  // Voice input handlers
  const handleVoiceMouseDown = useCallback(async () => {
    if (isTranscribing || isVoiceStarting || isVoiceRecording) return
    if (!isVoiceReady) {
      showVoiceSetup()
      return
    }
    await dictation.start({
      key: dictationTargetKey,
      chatId: parentChatId,
      subChatId,
      projectLabel:
        projectLabel ||
        repository ||
        projectPath?.split(/[\\/]/).filter(Boolean).pop() ||
        "Project",
      chatLabel: chatName || `Chat ${parentChatId.slice(0, 8)}`,
      getText: () => editorRef.current?.getValue() || currentDraftTextRef.current,
      commitText: (text) => {
        currentDraftTextRef.current = text
        updateSubChatDraftText(parentChatId, subChatId, text)
      },
      showText: (text) => {
        currentDraftTextRef.current = text
        editorRef.current?.setValue(text)
      },
      selectedContext: selectedSpeechContext,
    })
  }, [
    dictation,
    dictationTargetKey,
    editorRef,
    isTranscribing,
    isVoiceStarting,
    isVoiceRecording,
    isVoiceReady,
    parentChatId,
    projectPath,
    projectLabel,
    repository,
    chatName,
    showVoiceSetup,
    selectedSpeechContext,
    subChatId,
  ])

  const handleVoiceMouseUp = useCallback(() => dictation.stop(), [dictation])

  const finishVoiceBeforeSend = useCallback(async () => {
    if (ownsDictation) await dictation.stop()
  }, [dictation, ownsDictation])

  useVoiceInputHotkey({
    enabled: isActive,
    isRecording: isVoiceRecording,
    isStarting: isVoiceStarting,
    isTranscribing,
    ownsDictation,
    onStart: handleVoiceMouseDown,
    onStop: handleVoiceMouseUp,
  })

  // Save draft on blur (with attachments and text contexts)
  const handleEditorBlur = useCallback(async () => {
    setIsFocused(false)

    const draft = editorRef.current?.getValue() || ""
    const chatId = currentChatIdRef.current
    const subChatIdValue = currentSubChatIdRef.current

    // Update ref for unmount save
    currentDraftTextRef.current = draft

    if (!chatId) return

    const hasContent =
      draft.trim() ||
      images.length > 0 ||
      files.length > 0 ||
      textContexts.length > 0 ||
      (diffTextContexts?.length ?? 0) > 0

    if (hasContent) {
      await saveSubChatDraftWithAttachments(chatId, subChatIdValue, draft, {
        images,
        files,
        textContexts,
      })
    } else {
      clearSubChatDraft(chatId, subChatIdValue)
    }
  }, [editorRef, images, files, textContexts, diffTextContexts])

  // Content change handler
  const handleContentChange = useCallback(
    (newHasContent: boolean) => {
      setHasContent(newHasContent)
      onInputContentChange?.(newHasContent)
      // Sync the draft text ref for unmount save
      const draft = editorRef.current?.getValue() || ""
      currentDraftTextRef.current = draft
      updateSubChatDraftText(parentChatId, subChatId, draft)
    },
    [editorRef, onInputContentChange, parentChatId, subChatId],
  )

  // Terminal-style input history: ArrowUp recalls previously sent messages,
  // ArrowDown walks back toward the newest and then restores the blank/stashed draft.
  const historyIndexRef = useRef<number | null>(null)
  const historyStashedDraftRef = useRef("")
  const historyLastSetValueRef = useRef<string | null>(null)

  useEffect(() => {
    historyIndexRef.current = null
    historyStashedDraftRef.current = ""
    historyLastSetValueRef.current = null
  }, [subChatId])

  const getSentMessageHistory = useCallback((): string[] => {
    const messages = agentChatStore.get(subChatId)?.messages ?? []
    const entries: string[] = []
    for (const message of messages) {
      if (message.role !== "user") continue
      const text = (message.parts ?? [])
        .filter((part: any) => part.type === "text" && typeof part.text === "string")
        .map((part: any) => part.text)
        .join("\n")
        .trim()
      if (!text) continue
      // Collapse consecutive duplicates like shell history
      if (entries[entries.length - 1] === text) continue
      entries.push(text)
    }
    return entries
  }, [subChatId])

  const handleHistoryNavigate = useCallback(
    (direction: "up" | "down"): boolean => {
      const editor = editorRef.current
      if (!editor) return false
      const value = editor.getValue()
      // Any manual edit since the last recall exits browsing mode
      const isBrowsing =
        historyIndexRef.current !== null && value === historyLastSetValueRef.current

      if (direction === "up") {
        const entries = getSentMessageHistory()
        if (entries.length === 0) return false
        if (isBrowsing) {
          const nextIndex = Math.min(historyIndexRef.current!, entries.length) - 1
          if (nextIndex < 0) return true // already at oldest; swallow like a shell
          historyIndexRef.current = nextIndex
          historyLastSetValueRef.current = entries[nextIndex]
          editor.setValue(entries[nextIndex])
          return true
        }
        // Only engage from an empty input so ArrowUp still moves the caret while typing
        if (value.trim().length > 0) return false
        historyStashedDraftRef.current = value
        historyIndexRef.current = entries.length - 1
        historyLastSetValueRef.current = entries[entries.length - 1]
        editor.setValue(entries[entries.length - 1])
        return true
      }

      if (!isBrowsing) return false
      const entries = getSentMessageHistory()
      const nextIndex = historyIndexRef.current! + 1
      if (nextIndex >= entries.length) {
        // Walked past the newest message: restore whatever was there before browsing
        historyIndexRef.current = null
        historyLastSetValueRef.current = null
        editor.setValue(historyStashedDraftRef.current)
        historyStashedDraftRef.current = ""
        return true
      }
      historyIndexRef.current = nextIndex
      historyLastSetValueRef.current = entries[nextIndex]
      editor.setValue(entries[nextIndex])
      return true
    },
    [editorRef, getSentMessageHistory],
  )

  // Editor submit handler - handles Enter key with queue logic
  // If input is empty and queue has items, stop stream and send first from queue
  const handleEditorSubmit = useCallback(async () => {
    if (worktreeBlockedReason) {
      toast.error(worktreeWasReplaced ? "Checkout was replaced" : "Checkout unavailable", {
        description: worktreeBlockedReason,
      })
      return
    }

    // Capture the chat-bound callback before transcription finishes. The input can
    // unmount while the user navigates, but this send must keep its original target.
    const sendToCapturedChat = onSend
    await finishVoiceBeforeSend()
    const inputValue = editorRef.current?.getValue() || currentDraftTextRef.current
    const hasText = inputValue.trim().length > 0
    const hasAttachments =
      images.length > 0 ||
      files.length > 0 ||
      textContexts.length > 0 ||
      (diffTextContexts?.length ?? 0) > 0

    if (!hasText && !hasAttachments && queueLength > 0 && onSendFromQueue && firstQueueItemId) {
      // Input empty, queue has items - stop stream and send from queue
      await onStop()
      onSendFromQueue(firstQueueItemId)
    } else {
      sendToCapturedChat(inputValue)
    }
  }, [
    editorRef,
    images,
    files,
    textContexts,
    diffTextContexts,
    queueLength,
    onSendFromQueue,
    firstQueueItemId,
    onStop,
    onSend,
    finishVoiceBeforeSend,
    worktreeBlockedReason,
    worktreeWasReplaced,
  ])

  // Mention select handler
  const handleMentionSelect = useCallback(
    (mention: FileMentionOption) => {
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
    },
    [editorRef],
  )

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
            toast.info("Create a new chat from the left sidebar")
            return
          case "plan":
            if (subChatMode !== "plan") {
              updateMode("plan")
            }
            return
          case "write":
            updateMode("write")
            return
          case "review":
            updateMode("review")
            return
          case "compact":
            // Trigger context compaction
            onCompact()
            return
        }
      }

      // For all other commands (builtin prompts and custom):
      // insert the command and let user add arguments or press Enter to send
      editorRef.current?.setValue(`/${command.name} `)
    },
    [subChatMode, updateMode, onCompact, editorRef],
  )

  // Paste handler for images, plain text, and large text (saved as files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => handlePasteEvent(e, onAddAttachments, onAddPastedText),
    [onAddAttachments, onAddPastedText],
  )

  // Drag/drop handlers
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

      if (otherFiles.length > 0) {
        onPersistAttachments?.(otherFiles)
      }

      // Handle images via existing attachment system (base64)
      if (imageFiles.length > 0) {
        onAddAttachments(imageFiles)
      }

      // Process other files - for text files, read content and add as file mention
      for (const file of otherFiles) {
        const filePath: string | undefined =
          window.webUtils?.getPathForFile?.(file) || (file as File & { path?: string }).path

        let mentionId: string
        let mentionPath: string

        if (projectPath && filePath && filePath.startsWith(projectPath)) {
          // File is inside project - use relative path
          const relativePath = filePath.slice(projectPath.length).replace(/^\//, "")
          mentionId = `file:local:${relativePath}`
          mentionPath = relativePath
        } else if (filePath) {
          // External file - use absolute path
          mentionId = `file:external:${filePath}`
          mentionPath = filePath
        } else {
          // No path available (shouldn't happen in Electron) - use filename
          mentionId = `file:external:${file.name}`
          mentionPath = file.name
        }

        const fileName = file.name
        const ext = fileName.includes(".") ? "." + fileName.split(".").pop()?.toLowerCase() : ""
        // Files without extension are likely directories or special files - skip content reading
        const hasExtension = ext !== ""
        const isTextFile = hasExtension && TEXT_FILE_EXTENSIONS.has(ext)
        const isSmallEnough = file.size <= MAX_FILE_SIZE_FOR_CONTENT

        // For text files that are small enough, read content and cache it
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
            onCacheFileContent?.(mentionId, content)
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
    [editorRef, projectPath, onCacheFileContent, onAddAttachments, onPersistAttachments, trpcUtils],
  )

  const composerSettingLabels = [
    ...(featureVisibility.isVisible("runtimes") ? ["Runtime"] : []),
    "Permissions",
    "Mode",
    ...(featureVisibility.isVisible("agent-profiles") ? ["Agent profile"] : []),
    ...(permissionPreview?.degraded ? ["Warning"] : []),
    ...(requestedPermissionMode === "custom" ? ["Capabilities"] : []),
    ...(hasWorktreeChoices ? ["Project checkout"] : []),
  ]

  const setInputContainerRef = useCallback((element: HTMLDivElement | null) => {
    inputResizeObserverRef.current?.disconnect()
    inputResizeObserverRef.current = null
    if (inputMeasureFrameRef.current !== null) {
      cancelAnimationFrame(inputMeasureFrameRef.current)
      inputMeasureFrameRef.current = null
    }
    if (!element) return
    let pendingSize = { width: 0, height: 0 }
    let appliedSize = { width: -1, height: -1 }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      pendingSize = entry.contentRect
      if (inputMeasureFrameRef.current !== null) return
      inputMeasureFrameRef.current = requestAnimationFrame(() => {
        inputMeasureFrameRef.current = null
        const { width, height } = pendingSize
        if (appliedSize.width === width && appliedSize.height === height) return
        appliedSize = { width, height }
        element.style.setProperty("--chat-input-height", `${height}px`)
        element.style.setProperty("--chat-input-width", `${width}px`)
        element.parentElement?.style.setProperty("--chat-input-height", `${height}px`)
        element.parentElement?.style.setProperty("--chat-input-width", `${width}px`)
        setInputWidth((current) => (current === width ? current : width))
      })
    })
    observer.observe(element)
    inputResizeObserverRef.current = observer
  }, [])

  useEffect(
    () => () => {
      inputResizeObserverRef.current?.disconnect()
      if (inputMeasureFrameRef.current !== null) cancelAnimationFrame(inputMeasureFrameRef.current)
    },
    [],
  )

  return (
    <div
      ref={setInputContainerRef}
      className="px-2 pb-3 shadow-sm shadow-background relative z-10"
      data-compact-input={inputWidth < 560 || undefined}
    >
      <div className="w-full max-w-2xl mx-auto">
        <div
          className="relative w-full"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div
            className="relative w-full cursor-text"
            data-tour="prompt"
            onClick={(event) => {
              if (
                event.target === event.currentTarget ||
                !(event.target as HTMLElement).closest("button, [contenteditable]")
              ) {
                editorRef.current?.focus()
              }
            }}
          >
            <PromptInput
              className={cn(
                "border bg-input-background relative z-10 p-2 rounded-xl transition-[border-color,box-shadow] duration-150",
                isDragOver && "border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]",
                isFocused &&
                  !isDragOver &&
                  "border-primary/60 shadow-[0_0_0_1px_hsl(var(--primary)/0.18)]",
              )}
              maxHeight={200}
              onSubmit={handleEditorSubmit}
              contextItems={
                images.length > 0 ||
                files.length > 0 ||
                textContexts.length > 0 ||
                (diffTextContexts?.length ?? 0) > 0 ||
                pastedTexts.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-[6px]">
                    {(() => {
                      // Build allImages array for gallery navigation
                      const allImages = images
                        .filter(
                          (img): img is typeof img & { url: string } => !!img.url && !img.isLoading,
                        )
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
                          url={img.url || ""}
                          isLoading={img.isLoading}
                          onRemove={() => onRemoveImage(img.id)}
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
                        onRemove={() => onRemoveFile(f.id)}
                      />
                    ))}
                    {textContexts.map((tc) => (
                      <AgentTextContextItem
                        key={tc.id}
                        text={tc.text}
                        preview={tc.preview}
                        onRemove={() => onRemoveTextContext(tc.id)}
                      />
                    ))}
                    {diffTextContexts?.map((dtc) => (
                      <AgentDiffTextContextItem
                        key={dtc.id}
                        text={dtc.text}
                        preview={dtc.preview}
                        filePath={dtc.filePath}
                        lineNumber={dtc.lineNumber}
                        lineType={dtc.lineType}
                        onRemove={
                          onRemoveDiffTextContext
                            ? () => onRemoveDiffTextContext(dtc.id)
                            : undefined
                        }
                      />
                    ))}
                    {pastedTexts.map((pt) => (
                      <AgentPastedTextItem
                        key={pt.id}
                        filePath={pt.filePath}
                        filename={pt.filename}
                        size={pt.size}
                        preview={pt.preview}
                        kind={pt.kind}
                        onRemove={onRemovePastedText ? () => onRemovePastedText(pt.id) : undefined}
                      />
                    ))}
                  </div>
                ) : null
              }
            >
              <PromptInputContextItems />
              <div className="relative">
                <AgentsMentionsEditor
                  ref={editorRef}
                  onTrigger={({ searchText, rect }) => {
                    // Desktop: use projectPath for local file search
                    if (projectPath || repository) {
                      setMentionSearchText(searchText)
                      setMentionPosition({ top: rect.top, left: rect.left })
                      setShowMentionDropdown(true)
                    }
                  }}
                  onCloseTrigger={() => {
                    setShowMentionDropdown(false)
                    // Reset subpage state when closing
                    setShowingFilesList(false)
                    setShowingSkillsList(false)
                    setShowingAgentsList(false)
                    setShowingToolsList(false)
                  }}
                  onSlashTrigger={handleSlashTrigger}
                  onCloseSlashTrigger={handleCloseSlashTrigger}
                  onContentChange={handleContentChange}
                  onSubmit={onSubmitWithQuestionAnswer || handleEditorSubmit}
                  onForceSubmit={onForceSend}
                  onShiftTab={toggleMode}
                  onHistoryNavigate={handleHistoryNavigate}
                  placeholder={
                    isStreaming ? "Add to the queue" : "Plan, @ for context, / for commands"
                  }
                  className={cn(
                    "bg-transparent max-h-[200px] overflow-y-auto p-1",
                    isMobile && "min-h-[56px]",
                  )}
                  onPaste={handlePaste}
                  onFocus={() => setIsFocused(true)}
                  onBlur={handleEditorBlur}
                />
              </div>
              <PromptInputActions className="w-full">
                <div className="relative flex items-center gap-0.5 flex-1 min-w-0">
                  <div className="group/model-controls flex min-w-0 items-center gap-0.5">
                    <AgentModelSelector
                      open={isModelDropdownOpen}
                      onOpenChange={(open) => {
                        measurePerformanceNextFrame(open ? "menu-open" : "menu-close")
                        setIsModelDropdownOpen(open)
                      }}
                      selectedAgentId={provider}
                      onSelectedAgentIdChange={(nextProvider) => {
                        if (!canSwitchProvider) return
                        if (nextProvider === provider) return
                        onProviderChange?.(nextProvider)
                      }}
                      allowProviderSwitch={canSwitchProvider}
                      triggerClassName="max-w-[250px] min-w-0"
                      onContinueWithProvider={
                        !canSwitchProvider ? onContinueWithProvider : undefined
                      }
                      onDelegateWithProvider={
                        !canSwitchProvider ? onDelegateWithProvider : undefined
                      }
                      selectedModelLabel={selectedModelLabel}
                      onOpenModelsSettings={() => {
                        setSettingsTab("models")
                        setSettingsOpen(true)
                      }}
                      claude={{
                        models: availableModels.models.filter((m) => !hiddenModels.includes(m.id)),
                        selectedModelId: selectedModel?.id,
                        onSelectModel: (modelId) => {
                          const model =
                            availableModels.models.find((item) => item.id === modelId) ||
                            availableModels.models[0]
                          if (!model) return
                          setSelectedModel(model)
                          setSelectedSubChatModelId(model.id)
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
                        onSelectEffort: (effort) => {
                          setSelectedSubChatClaudeEffort(effort)
                          setLastSelectedClaudeEffort(effort)
                        },
                      }}
                      codex={{
                        models: codexUiModels,
                        selectedModelId: selectedCodexModel.id,
                        onSelectModel: (modelId) => {
                          const model = codexUiModels.find((item) => item.id === modelId)
                          if (!model) return
                          const nextReasoning = model.reasoningLevels.includes(
                            selectedSubChatCodexReasoning as CodexReasoningLevel,
                          )
                            ? (selectedSubChatCodexReasoning as CodexReasoningLevel)
                            : model.reasoningLevels.includes("high")
                              ? "high"
                              : model.reasoningLevels[0]!

                          setSelectedSubChatCodexModelId(model.id)
                          setSelectedSubChatCodexReasoning(nextReasoning)
                          if (!model.supportsFastMode) {
                            setSelectedSubChatCodexFastMode(false)
                            setLastSelectedCodexFastMode(false)
                          }
                          setLastSelectedCodexModelId(model.id)
                          setLastSelectedCodexReasoning(nextReasoning)
                        },
                        selectedReasoning: selectedCodexReasoning,
                        onSelectReasoning: (reasoning) => {
                          setSelectedSubChatCodexReasoning(reasoning)
                          setLastSelectedCodexReasoning(reasoning)
                        },
                        fastModeEnabled: codexFastModeEnabled,
                        onFastModeChange: (enabled) => {
                          const nextEnabled = selectedCodexModel.supportsFastMode ? enabled : false
                          setSelectedSubChatCodexFastMode(nextEnabled)
                          setLastSelectedCodexFastMode(nextEnabled)
                        },
                        isConnected: codexIntegration?.isConnected === true,
                      }}
                      cursor={{
                        models: cursorUiModels,
                        selectedModelId: selectedCursorModel.id,
                        onSelectModel: (modelId) => {
                          const model = cursorUiModels.find((item) => item.id === modelId)
                          if (!model) return
                          setSelectedSubChatCursorModelId(model.id)
                          setLastSelectedCursorModelId(model.id)
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
                          selectedModelId: selectedOpencodeModels.openrouter,
                          onSelectModel: (modelId) =>
                            setSelectedOpencodeModels({ openrouter: modelId }),
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
                          selectedModelId: selectedOpencodeModels.nanogpt,
                          onSelectModel: (modelId) =>
                            setSelectedOpencodeModels({ nanogpt: modelId }),
                        },
                      }}
                      local={{
                        ...localModelPicker,
                        onOpenSettings: () => {
                          setSettingsTab("local-models")
                          setSettingsOpen(true)
                        },
                      }}
                    />
                    <AgentModelTuningSelector
                      selectedAgentId={provider}
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
                        onSelectEffort: (effort) => {
                          setSelectedSubChatClaudeEffort(effort)
                          setLastSelectedClaudeEffort(effort)
                        },
                      }}
                      codex={{
                        models: codexUiModels,
                        selectedModelId: selectedCodexModel.id,
                        selectedReasoning: selectedCodexReasoning,
                        onSelectReasoning: (reasoning) => {
                          setSelectedSubChatCodexReasoning(reasoning)
                          setLastSelectedCodexReasoning(reasoning)
                        },
                        fastModeEnabled: codexFastModeEnabled,
                        onFastModeChange: (enabled) => {
                          const nextEnabled = selectedCodexModel.supportsFastMode ? enabled : false
                          setSelectedSubChatCodexFastMode(nextEnabled)
                          setLastSelectedCodexFastMode(nextEnabled)
                        },
                      }}
                    />
                  </div>

                  <ProgressiveOverflowRow
                    usageRatio={0.8}
                    menuLabel="More composer settings"
                    className="min-w-0 flex-1 text-xs"
                    gap={4}
                    align="start"
                    side="top"
                    forceOverflow={hasStartedChat}
                    overflowLabels={composerSettingLabels}
                    overflowLayout="rows"
                  >
                    {featureVisibility.isVisible("runtimes") && (
                      <RuntimeSelector
                        harness={provider}
                        value={runtimePreference}
                        automaticPreference={resolvedRuntimePreference}
                        onChange={(preference) => void handleRuntimeChange(preference)}
                        disabled={isStreaming || setRuntimePreferenceMutation.isPending}
                        locked={hasStartedChat}
                      />
                    )}
                    <PermissionSelector
                      harness={provider}
                      value={effectivePermissionMode}
                      options={selectablePermissionModes}
                      onChange={handlePermissionModeChange}
                      disabled={isReadOnlyChatMode(subChatMode)}
                      onOpenSettings={handleOpenPermissionSettings}
                      settingsMeta={
                        permissionPreferences?.changeBehavior === "all-chats"
                          ? "All chats"
                          : permissionPreferences?.changeBehavior === "current-chat"
                            ? "This chat"
                            : "Ask every time"
                      }
                      customHint="New custom mode starts with every capability disabled until configured."
                    />
                    <AgentModeSelector value={subChatMode} onChange={updateMode} />
                    {featureVisibility.isVisible("agent-profiles") && (
                      <ChatAgentProfileControl chatId={parentChatId} locked={hasStartedChat} />
                    )}

                    {permissionPreview?.degraded && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-amber-600 hover:bg-amber-500/10"
                            aria-label="Permission limitations"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" sideOffset={6} className="w-64 text-xs">
                          <div className="font-medium text-foreground">Permission warning</div>
                          <p className="mt-1 text-muted-foreground">{permissionPreview.reason}</p>
                        </PopoverContent>
                      </Popover>
                    )}

                    {requestedPermissionMode === "custom" && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
                            Custom
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          sideOffset={6}
                          className="w-64 text-xs"
                          onOpenAutoFocus={(e) => e.preventDefault()}
                        >
                          <div className="space-y-2">
                            <div className="font-medium text-foreground">Custom capabilities</div>
                            <div className="grid grid-cols-2 gap-1.5 text-muted-foreground">
                              {customPermissionCapabilityKeys.map((key) => {
                                const capabilities =
                                  permissionResolution?.customPermissions ??
                                  disabledCustomPermissions
                                const enabled = capabilities[key]
                                return (
                                  <button
                                    type="button"
                                    key={key}
                                    aria-pressed={enabled}
                                    className={cn(
                                      "rounded border px-2 py-1 text-left",
                                      enabled
                                        ? "border-primary/40 bg-primary/10 text-foreground"
                                        : "bg-muted/20",
                                    )}
                                    onClick={() => {
                                      const next: CustomPermissionCapabilities = {
                                        ...capabilities,
                                        [key]: !enabled,
                                      }
                                      void setChatPermissionModeMutation.mutateAsync({
                                        chatId: parentChatId,
                                        mode: "custom",
                                        scope: "current-chat",
                                        customPermissions: next,
                                      })
                                    }}
                                  >
                                    {CUSTOM_PERMISSION_LABELS[key]}
                                  </button>
                                )
                              })}
                            </div>
                            <p className="text-muted-foreground">
                              Disabled capabilities fail closed. Provider limitations stay visible.
                            </p>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}

                    {hasWorktreeChoices && (
                      <DropdownMenu
                        open={isWorktreeMenuOpen}
                        onOpenChange={(open) => {
                          setIsWorktreeMenuOpen(open)
                          if (open) {
                            void trpcUtils.chats.listWorktreeOptions.invalidate({
                              id: parentChatId,
                            })
                            void trpcUtils.chats.resolveWorktreeStatus.invalidate({
                              id: parentChatId,
                            })
                          }
                        }}
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            className={cn(
                              "flex max-w-[190px] items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
                              (worktreeNeedsRefresh || worktreeIsDetached) &&
                                "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            <span className="truncate">
                              {worktreeNeedsRefresh
                                ? `${worktreeWasReplaced ? "Checkout replaced" : "Checkout removed"}: ${selectedWorktreeLabel}`
                                : worktreeIsDetached
                                  ? worktreeDisplayLabel
                                  : `${isNonDefaultWorktree ? "Worktree: " : ""}${worktreeDisplayLabel}`}
                            </span>
                            <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          sideOffset={6}
                          className="!min-w-[360px] max-w-[440px]"
                          onCloseAutoFocus={(e) => e.preventDefault()}
                        >
                          {worktreeNeedsRefresh && (
                            <>
                              <DropdownMenuItem
                                disabled={
                                  repairUnavailableCheckoutMutation.isPending ||
                                  reconnectReplacedCheckoutMutation.isPending
                                }
                                onClick={() => void repairUnavailableCheckout()}
                                className="items-start gap-3"
                              >
                                <RefreshCw
                                  className={cn(
                                    "h-3.5 w-3.5 mt-0.5 shrink-0",
                                    (repairUnavailableCheckoutMutation.isPending ||
                                      reconnectReplacedCheckoutMutation.isPending) &&
                                      "animate-spin",
                                  )}
                                />
                                <div className="min-w-0">
                                  <div>
                                    {repairUnavailableCheckoutMutation.isPending ||
                                    reconnectReplacedCheckoutMutation.isPending
                                      ? "Fixing checkout..."
                                      : worktreeWasReplaced
                                        ? "Review and reconnect"
                                        : "Fix automatically"}
                                  </div>
                                  <div className="text-[11px] text-muted-foreground">
                                    {worktreeWasReplaced
                                      ? "Reconnect only after confirming this is the repository you expect."
                                      : "Use the project checkout. If it is also gone, continue without project files."}
                                  </div>
                                </div>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={chooseReplacementCheckoutMutation.isPending}
                                onClick={() => void chooseReplacementCheckout()}
                                className="items-start gap-3"
                              >
                                <div className="min-w-0 pl-6">
                                  <div>Choose a repository instead</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    Select the repository folder itself, not its parent folder.
                                  </div>
                                </div>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          {worktreeIsDetached && (
                            <>
                              <DropdownMenuItem
                                disabled={chooseReplacementCheckoutMutation.isPending}
                                onClick={() => void chooseReplacementCheckout()}
                                className="items-start gap-3"
                              >
                                <div className="min-w-0">
                                  <div>Reconnect a repository</div>
                                  <div className="text-[11px] text-muted-foreground">
                                    Restore project files without moving this Chat.
                                  </div>
                                </div>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          {worktreeOptions.map((option) => (
                            <DropdownMenuItem
                              key={option.path}
                              onClick={() => void persistTargetWorktreePath(option.path)}
                              className="items-start justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <div className="truncate">
                                  {option.label}
                                  {option.isDefault ? " (default)" : ""}
                                </div>
                                <div className="truncate text-[11px] text-muted-foreground">
                                  {option.path}
                                </div>
                              </div>
                              {selectedWorktreePath === option.path && (
                                <CheckIcon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                              )}
                            </DropdownMenuItem>
                          ))}
                          {worktreeNeedsRefresh && (
                            <div className="px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                              {resolvedWorktreeStatus.error}
                            </div>
                          )}
                          <DropdownMenuSeparator />
                          <div
                            className="space-y-2 px-2 py-1.5"
                            onKeyDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div>
                              <div className="text-xs font-medium text-foreground">
                                Create worktree
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                Runs Git, creates a branch, then runs setup commands.
                              </div>
                            </div>
                            <label className="block">
                              <span className="mb-1 block text-[11px] text-muted-foreground">
                                Name
                              </span>
                              <div className="flex items-center gap-1">
                                <input
                                  value={newWorktreeName}
                                  onChange={(event) => setNewWorktreeName(event.target.value)}
                                  placeholder="feature-name"
                                  spellCheck={false}
                                  autoCapitalize="none"
                                  className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                                />
                                <button
                                  type="button"
                                  disabled={
                                    !canCreateWorktree ||
                                    !newWorktreeName.trim() ||
                                    createWorktreeMutation.isPending
                                  }
                                  onClick={() =>
                                    createWorktreeMutation.mutate({
                                      id: parentChatId,
                                      name: newWorktreeName.trim(),
                                      ...(newWorktreeParentDirectory
                                        ? { parentDirectory: newWorktreeParentDirectory }
                                        : {}),
                                    })
                                  }
                                  className="flex h-7 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted/50 disabled:opacity-50"
                                >
                                  <RefreshCw
                                    className={cn(
                                      "h-3 w-3",
                                      createWorktreeMutation.isPending && "animate-spin",
                                    )}
                                  />
                                  {createWorktreeMutation.isPending ? "Creating..." : "Create"}
                                </button>
                              </div>
                            </label>
                            <div>
                              <div className="mb-1 text-[11px] text-muted-foreground">Location</div>
                              <div className="flex items-center gap-1">
                                <div
                                  className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
                                  title={newWorktreeParentDirectory ?? "Default Flapstack location"}
                                >
                                  {newWorktreeParentDirectory ?? "Default Flapstack location"}
                                </div>
                                {newWorktreeParentDirectory && (
                                  <button
                                    type="button"
                                    onClick={() => setNewWorktreeParentDirectory(null)}
                                    className="h-7 shrink-0 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                  >
                                    Reset
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={chooseWorktreeParentDirectoryMutation.isPending}
                                  onClick={() => void chooseWorktreeLocation()}
                                  className="h-7 shrink-0 rounded-md border border-border px-2 text-xs hover:bg-muted/50 disabled:opacity-50"
                                >
                                  {chooseWorktreeParentDirectoryMutation.isPending
                                    ? "Choosing..."
                                    : "Choose..."}
                                </button>
                              </div>
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              Spaces become hyphens. The name labels the worktree folder and chip.
                            </div>
                          </div>
                          <DropdownMenuSeparator />
                          <div
                            className="space-y-1 px-2 py-1.5"
                            onKeyDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div>
                              <div className="text-xs font-medium text-foreground">
                                Use existing checkout
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                Browse to an existing Git worktree or repository.
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <input
                                value={customWorktreeInput}
                                onChange={(e) => {
                                  customWorktreeValidationRef.current += 1
                                  setCustomWorktreeInput(e.target.value)
                                  setCustomWorktreeError(null)
                                }}
                                placeholder="/absolute/path/to/checkout"
                                spellCheck={false}
                                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                              />
                              <button
                                type="button"
                                disabled={chooseCheckoutMutation.isPending}
                                onClick={() => void browseExistingCheckout()}
                                className="h-7 shrink-0 rounded-md border border-border px-2 text-xs hover:bg-muted/50 disabled:opacity-50"
                              >
                                {chooseCheckoutMutation.isPending ? "Choosing..." : "Browse..."}
                              </button>
                              <button
                                type="button"
                                disabled={!isValidCustomWorktree || isValidatingCustomWorktree}
                                onClick={async () => {
                                  const requestedPath = trimmedCustomWorktree
                                  const requestId = ++customWorktreeValidationRef.current
                                  setIsValidatingCustomWorktree(true)
                                  setCustomWorktreeError(null)
                                  try {
                                    const result =
                                      await trpcUtils.chats.validateCustomWorktreePath.fetch({
                                        path: trimmedCustomWorktree,
                                      })
                                    if (customWorktreeValidationRef.current !== requestId) return
                                    if (!result.valid) {
                                      setCustomWorktreeError(result.error)
                                      return
                                    }
                                    if (
                                      result.path !== requestedPath &&
                                      customWorktreeInput.trim() !== requestedPath
                                    )
                                      return
                                    await persistTargetWorktreePath(result.path)
                                    setCustomWorktreeInput("")
                                  } catch (error) {
                                    if (customWorktreeValidationRef.current !== requestId) return
                                    setCustomWorktreeError(
                                      error instanceof Error
                                        ? error.message
                                        : "Could not validate this checkout.",
                                    )
                                  } finally {
                                    if (customWorktreeValidationRef.current === requestId) {
                                      setIsValidatingCustomWorktree(false)
                                    }
                                  }
                                }}
                                className="h-7 shrink-0 rounded-md border border-border px-2 text-xs hover:bg-muted/50 disabled:opacity-50"
                              >
                                {isValidatingCustomWorktree ? "Checking..." : "Use"}
                              </button>
                            </div>
                            {trimmedCustomWorktree && !isValidCustomWorktree && (
                              <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                                Enter an absolute path.
                              </div>
                            )}
                            {customWorktreeError && (
                              <div className="mt-1 text-[11px] text-destructive">
                                {customWorktreeError}
                              </div>
                            )}
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </ProgressiveOverflowRow>
                </div>

                {/* Hidden file input - accepts any files */}
                <input
                  type="file"
                  ref={fileInputRef}
                  hidden
                  multiple
                  onChange={(e) => {
                    const inputFiles = Array.from(e.target.files || [])
                    onAddAttachments(inputFiles)
                    e.target.value = ""
                  }}
                />

                <ProgressiveOverflowRow
                  usageRatio={0.94}
                  menuLabel="More composer actions"
                  className="ml-auto min-w-0 flex-1 justify-end"
                  contentClassName="gap-1"
                  gap={2}
                  align="end"
                  side="top"
                  pinnedEnd={
                    <AgentSendButton
                      isStreaming={isStreaming}
                      isSubmitting={false}
                      disabled={
                        (!hasContent &&
                          images.length === 0 &&
                          files.length === 0 &&
                          textContexts.length === 0 &&
                          (diffTextContexts?.length ?? 0) === 0 &&
                          queueLength === 0) ||
                        isUploading ||
                        Boolean(runtimeBlockedReason) ||
                        Boolean(worktreeBlockedReason)
                      }
                      hasContent={
                        hasContent ||
                        images.length > 0 ||
                        files.length > 0 ||
                        textContexts.length > 0 ||
                        (diffTextContexts?.length ?? 0) > 0
                      }
                      onClick={() => {
                        if (
                          !hasContent &&
                          images.length === 0 &&
                          files.length === 0 &&
                          queueLength > 0 &&
                          onSendFromQueue &&
                          firstQueueItemId
                        ) {
                          onSendFromQueue(firstQueueItemId)
                        } else {
                          void handleEditorSubmit()
                        }
                      }}
                      onStop={onStop}
                      mode={subChatMode}
                    />
                  }
                >
                  {isVoiceRecording && (
                    <VoiceWaveIndicator
                      isRecording={isVoiceRecording}
                      audioLevel={voiceAudioLevel}
                    />
                  )}
                  {isTranscribing && !isVoiceRecording && (
                    <div className="flex h-5 items-center px-2">
                      <IconSpinner className="size-3.5 text-muted-foreground" />
                    </div>
                  )}
                  {!isVoiceRecording && !isTranscribing && (
                    <AgentContextIndicator
                      tokenData={contextTokenData}
                      className="h-7 w-7"
                      isCompacting={isCompacting}
                      disabled={isStreaming}
                    />
                  )}
                  {!isVoiceRecording && !isTranscribing && (
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 rounded-sm outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
                              aria-label="Add to chat"
                            >
                              <Plus className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="top">Add to chat</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent
                        align="end"
                        side="top"
                        sideOffset={6}
                        className="min-w-56"
                        onCloseAutoFocus={(event) => event.preventDefault()}
                      >
                        <DropdownMenuItem
                          disabled={images.length >= 5 && files.length >= 10}
                          onSelect={() => fileInputRef.current?.click()}
                        >
                          <AttachIcon className="h-4 w-4" />
                          Add files
                        </DropdownMenuItem>
                        {featureVisibility.isVisible("visual-context") && (
                          <DropdownMenuItem
                            disabled={!runtimeChat?.projectId}
                            onSelect={() => setVisualCaptureOpen(true)}
                          >
                            <Camera className="h-4 w-4" />
                            Add screen or window
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => updateMode("plan")}>
                          <ListTodo className="h-4 w-4" />
                          Plan mode
                          {subChatMode === "plan" && <CheckIcon className="ml-auto h-3.5 w-3.5" />}
                        </DropdownMenuItem>
                        {provider === "codex" && (
                          <DropdownMenuItem
                            onSelect={() => {
                              const currentText = editorRef.current?.getValue().trim() ?? ""
                              editorRef.current?.setValue(
                                currentText ? `/goal ${currentText}` : "/goal ",
                              )
                              requestAnimationFrame(() => editorRef.current?.focus())
                            }}
                          >
                            <Target className="h-4 w-4" />
                            Set a goal
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                </ProgressiveOverflowRow>
                {featureVisibility.isVisible("visual-context") && runtimeChat?.projectId && (
                  <VisualCaptureDialog
                    open={visualCaptureOpen}
                    onOpenChange={setVisualCaptureOpen}
                    projectId={runtimeChat.projectId}
                    chatId={parentChatId}
                    taskId={runtimeChat.taskId ?? undefined}
                    onAddAttachments={onAddAttachments}
                  />
                )}
              </PromptInputActions>
            </PromptInput>
            {runtimeBlockedReason ? (
              <p role="alert" className="mt-2 px-2 text-xs text-amber-600 dark:text-amber-300">
                {runtimeBlockedReason} Continue with Flapstack Native to launch now.
              </p>
            ) : null}
            {worktreeBlockedReason ? (
              <div
                role="alert"
                className="mt-2 flex items-center gap-2 px-2 text-xs text-amber-600 dark:text-amber-300"
              >
                <span>{worktreeBlockedReason}</span>
                <button
                  type="button"
                  disabled={
                    repairUnavailableCheckoutMutation.isPending ||
                    reconnectReplacedCheckoutMutation.isPending
                  }
                  onClick={() => void repairUnavailableCheckout()}
                  className="shrink-0 rounded border border-amber-500/40 px-1.5 py-0.5 font-medium hover:bg-amber-500/10 disabled:opacity-50"
                >
                  {repairUnavailableCheckoutMutation.isPending ||
                  reconnectReplacedCheckoutMutation.isPending
                    ? "Fixing..."
                    : worktreeWasReplaced
                      ? "Review and reconnect"
                      : "Fix automatically"}
                </button>
              </div>
            ) : null}
            {detachedWorktreeWarning ? (
              <div
                role="status"
                className="mt-2 flex items-center gap-2 px-2 text-xs text-amber-600 dark:text-amber-300"
              >
                <span>{detachedWorktreeWarning}</span>
                <button
                  type="button"
                  disabled={chooseReplacementCheckoutMutation.isPending}
                  onClick={() => void chooseReplacementCheckout()}
                  className="shrink-0 rounded border border-amber-500/40 px-1.5 py-0.5 font-medium hover:bg-amber-500/10 disabled:opacity-50"
                >
                  {chooseReplacementCheckoutMutation.isPending
                    ? "Choosing..."
                    : "Choose repository"}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* File mention dropdown */}
      {/* Desktop: use projectPath for local file search */}
      <AgentsFileMention
        isOpen={showMentionDropdown && (!!projectPath || !!repository || !!sandboxId)}
        onClose={() => {
          setShowMentionDropdown(false)
          // Reset subpage state when closing
          setShowingFilesList(false)
          setShowingSkillsList(false)
          setShowingAgentsList(false)
          setShowingToolsList(false)
        }}
        onSelect={handleMentionSelect}
        searchText={mentionSearchText}
        position={mentionPosition}
        teamId={teamId}
        repository={repository}
        sandboxId={sandboxId}
        projectPath={projectPath}
        changedFiles={changedFiles}
        // Subpage navigation state
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
        projectPath={projectPath}
        mode={subChatMode}
      />

      <AlertDialog
        open={pendingRuntimeContinuation !== null}
        onOpenChange={(open) => {
          if (open || continueWithRuntimeMutation.isPending) return
          setPendingRuntimeContinuation(null)
          runtimeContinuationRequestRef.current = null
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Continue with {runtimePreferenceLabel(pendingRuntimeContinuation ?? "auto")}?
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2">
              This started chat stays unchanged. Flapstack creates one new sidebar chat, starts a
              fresh provider session on its first turn, and imports only visible history as labeled
              context.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={continueWithRuntimeMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={() => void confirmRuntimeContinuation()}
              disabled={continueWithRuntimeMutation.isPending}
            >
              {continueWithRuntimeMutation.isPending
                ? "Continuing…"
                : `Continue with ${runtimePreferenceLabel(pendingRuntimeContinuation ?? "auto")}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingPermissionMode !== null}
        onOpenChange={(open) => {
          if (!open && !setChatPermissionModeMutation.isPending) {
            setPendingPermissionMode(null)
            setPendingCustomReviewed(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change chat permissions?</AlertDialogTitle>
            <AlertDialogDescription className="mt-2">
              {RUN_PERMISSION_MODE_LABELS[requestedPermissionMode]} →{" "}
              {pendingPermissionMode ? RUN_PERMISSION_MODE_LABELS[pendingPermissionMode] : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody className="space-y-4">
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => setPendingPermissionScope("all-chats")}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  pendingPermissionScope === "all-chats"
                    ? "border-foreground/40 bg-foreground/5"
                    : "border-border hover:bg-foreground/[0.03]",
                )}
              >
                <span className="block text-sm font-medium">All chats</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Active and archived chats, project/task defaults, and new chats.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPendingPermissionScope("current-chat")}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  pendingPermissionScope === "current-chat"
                    ? "border-foreground/40 bg-foreground/5"
                    : "border-border hover:bg-foreground/[0.03]",
                )}
              >
                <span className="block text-sm font-medium">This chat only</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Keep every other chat and future default unchanged.
                </span>
              </button>
            </div>

            {pendingPermissionMode === "full-access" && pendingPermissionScope === "all-chats" && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                Full access will be enabled for every current and future chat.
              </div>
            )}

            {pendingPermissionMode === "custom" && (
              <div className="space-y-3 rounded-md border border-border p-3">
                <div>
                  <div className="text-sm font-medium">Custom capabilities</div>
                  <div className="text-xs text-muted-foreground">
                    Review the exact capabilities before applying Custom. All chats uses this same
                    set for every current and future chat.
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {customPermissionCapabilityKeys.map((key) => {
                    const enabled = pendingCustomPermissions[key]
                    return (
                      <button
                        type="button"
                        key={key}
                        aria-pressed={enabled}
                        onClick={() =>
                          setPendingCustomPermissions((current) => ({
                            ...current,
                            [key]: !current[key],
                          }))
                        }
                        className={cn(
                          "rounded border px-2 py-1 text-left",
                          enabled
                            ? "border-primary/40 bg-primary/10 text-foreground"
                            : "bg-muted/20 text-muted-foreground",
                        )}
                      >
                        {CUSTOM_PERMISSION_LABELS[key]}
                      </button>
                    )
                  })}
                </div>
                <label className="flex items-center justify-between gap-3 text-xs">
                  <span>I reviewed this complete capability set.</span>
                  <Switch
                    checked={pendingCustomReviewed}
                    onCheckedChange={setPendingCustomReviewed}
                  />
                </label>
              </div>
            )}

            <label className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="block font-medium">Remember my choice</span>
                <span className="block text-xs text-muted-foreground">
                  You can reset this to Ask every time in Settings → Permissions.
                </span>
              </span>
              <Switch
                checked={rememberPermissionScope}
                onCheckedChange={setRememberPermissionScope}
              />
            </label>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={setChatPermissionModeMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={() => void handleConfirmPermissionModeChange()}
              disabled={
                setChatPermissionModeMutation.isPending ||
                (pendingPermissionMode === "custom" && !pendingCustomReviewed)
              }
            >
              {setChatPermissionModeMutation.isPending ? "Applying..." : "Apply"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}, arePropsEqual)
