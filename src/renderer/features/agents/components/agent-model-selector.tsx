"use client"

import { Brain, ChevronRight, Zap } from "lucide-react"
import { useAtom, useSetAtom } from "jotai"
import { lazy, Suspense, useCallback, useMemo, useRef, useState, type RefObject } from "react"
import {
  showLegacyModelsAtom,
  agentsLoginModalOpenAtom,
  codexLoginModalOpenAtom,
} from "../../../lib/atoms"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../../components/ui/dialog"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../../../components/ui/command"
import { CheckIcon, IconChevronDown } from "../../../components/ui/icons"
import { Switch } from "../../../components/ui/switch"
import { Button } from "../../../components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover"
import { cn } from "../../../lib/utils"
import type { ClaudeEffortLevel, CodexReasoningLevel } from "../lib/models"
import { formatClaudeEffortLabel, formatCodexReasoningLevelLabel } from "../lib/models"
import { isLegacyPickerModel } from "../../../../shared/model-catalog"
import type { ContinueWithProvider, HandoffSource } from "./compact-handoff-action"
import { getHarnessChipMeta } from "../constants"
import { ProviderChipIcon } from "./provider-chip-icon"
import { quotaSeverityClass, useRemainingQuota } from "../lib/remaining-quota"

const CompactHandoffAction = lazy(() => import("./compact-handoff-action"))

export type AgentProviderId =
  "claude-code" | "codex" | "antigravity" | "cursor-agent" | "openrouter" | "nanogpt" | "local"

type ClaudeModelOption = {
  id: string
  name: string
  version: string
  efforts?: readonly ClaudeEffortLevel[]
}

type CodexModelOption = {
  id: string
  name: string
  reasoningLevels: readonly CodexReasoningLevel[]
  supportsFastMode?: boolean
}

type CursorModelOption = {
  id: string
  name: string
}

type OpencodeModelOption = { id: string; name: string }
type LocalModelOption = {
  id: string
  name: string
  chat: "supported" | "unsupported" | "unknown"
  tools: "supported" | "unsupported" | "unknown"
  selectable: boolean
  limitations: string[]
}

interface AgentModelSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedAgentId: AgentProviderId
  onSelectedAgentIdChange: (provider: AgentProviderId) => void
  selectedModelLabel: string
  allowProviderSwitch?: boolean
  triggerClassName?: string
  contentClassName?: string
  onOpenModelsSettings?: () => void
  continuationSource?: HandoffSource
  onContinueWithProvider?: ContinueWithProvider
  onDelegateWithProvider?: (provider: AgentProviderId, targetModel: string) => void
  claude: {
    models: ClaudeModelOption[]
    selectedModelId?: string
    onSelectModel: (modelId: string) => void
    hasCustomModelConfig: boolean
    isOffline: boolean
    ollamaModels: string[]
    selectedOllamaModel?: string
    recommendedOllamaModel?: string
    onSelectOllamaModel: (modelId: string) => void
    isConnected: boolean
    reasoningOutputEnabled: boolean
    onReasoningOutputChange: (enabled: boolean) => void
    selectedEffort: ClaudeEffortLevel
    onSelectEffort: (effort: ClaudeEffortLevel) => void
  }
  codex: {
    models: CodexModelOption[]
    selectedModelId: string
    onSelectModel: (modelId: string) => void
    selectedReasoning: CodexReasoningLevel
    onSelectReasoning: (reasoning: CodexReasoningLevel) => void
    fastModeEnabled: boolean
    onFastModeChange: (enabled: boolean) => void
    isConnected: boolean
  }
  cursor: {
    models: CursorModelOption[]
    selectedModelId: string
    onSelectModel: (modelId: string) => void
    isConnected: boolean
    isLoginPending: boolean
    onLogin: () => void
  }
  antigravity: {
    models: { id: string; name: string }[]
    selectedModelId?: string | null
    onSelectModel: (id: string) => void
    status: string | null
    canRetry: boolean
    retry: () => void
  }
  opencode?: Record<
    "openrouter" | "nanogpt",
    {
      label: string
      models: OpencodeModelOption[]
      selectedModelId: string
      onSelectModel: (modelId: string) => void
    }
  >
  local?: {
    catalogState:
      "not-checked" | "invalid-endpoint" | "ready" | "empty" | "stale" | "unavailable" | "error"
    models: LocalModelOption[]
    selectedModelId: string | null
    canLaunch: boolean
    onSelectModel: (modelId: string | null) => void
    onOpenSettings: () => void
  }
}

const EMPTY_OPENCODE_PROVIDERS: NonNullable<AgentModelSelectorProps["opencode"]> = {
  openrouter: { label: "OpenRouter", models: [], selectedModelId: "", onSelectModel: () => {} },
  nanogpt: { label: "NanoGPT", models: [], selectedModelId: "", onSelectModel: () => {} },
}

type FlatModelItem =
  | { type: "claude"; model: ClaudeModelOption }
  | { type: "codex"; model: CodexModelOption }
  | { type: "cursor"; model: CursorModelOption }
  | { type: "antigravity"; model: { id: string; name: string } }
  | { type: "opencode"; provider: "openrouter" | "nanogpt"; model: OpencodeModelOption }
  | { type: "local"; model: LocalModelOption }
  | { type: "ollama"; modelName: string; isRecommended: boolean }
  | { type: "custom" }

type ModelGroup = {
  id: AgentProviderId
  label: string
  items: FlatModelItem[]
}

interface AgentModelTuningSelectorProps {
  antigravity?: {
    efforts: { id: string; label: string; selected: boolean; onSelect: () => void }[]
    selectedEffort?: string
  }
  selectedAgentId: AgentProviderId
  reasoningEnabled: boolean
  onReasoningEnabledChange: (enabled: boolean) => void
  claude: Pick<
    AgentModelSelectorProps["claude"],
    | "models"
    | "selectedModelId"
    | "hasCustomModelConfig"
    | "isOffline"
    | "selectedEffort"
    | "onSelectEffort"
  >
  codex: Pick<
    AgentModelSelectorProps["codex"],
    | "models"
    | "selectedModelId"
    | "selectedReasoning"
    | "onSelectReasoning"
    | "fastModeEnabled"
    | "onFastModeChange"
  >
}

export function AgentModelTuningSelector({
  selectedAgentId,
  reasoningEnabled,
  onReasoningEnabledChange,
  claude,
  codex,
  antigravity,
}: AgentModelTuningSelectorProps) {
  if (selectedAgentId === "local")
    return <span className="sr-only">Reasoning unavailable for local models.</span>
  const selectedClaudeModel = claude.models.find((model) => model.id === claude.selectedModelId)
  const claudeEfforts =
    selectedAgentId === "claude-code" && !claude.isOffline && !claude.hasCustomModelConfig
      ? selectedClaudeModel?.efforts
      : undefined
  const selectedClaudeEffort = claudeEfforts?.includes(claude.selectedEffort)
    ? claude.selectedEffort
    : claudeEfforts?.includes("high")
      ? "high"
      : claudeEfforts?.[0]

  const selectedCodexModel = codex.models.find((model) => model.id === codex.selectedModelId)
  const codexReasoningLevels =
    selectedAgentId === "codex" ? selectedCodexModel?.reasoningLevels : undefined
  const selectedCodexReasoning =
    selectedAgentId === "codex" && (!selectedCodexModel || codexReasoningLevels?.length)
      ? codex.selectedReasoning
      : undefined
  const fastModeAvailable =
    selectedAgentId === "codex" && selectedCodexModel?.supportsFastMode === true
  const fastModeEnabled = fastModeAvailable && codex.fastModeEnabled

  const selectedValue =
    selectedAgentId === "claude-code" && selectedClaudeEffort
      ? formatClaudeEffortLabel(selectedClaudeEffort)
      : selectedAgentId === "codex" && selectedCodexReasoning
        ? formatCodexReasoningLevelLabel(selectedCodexReasoning)
        : selectedAgentId === "antigravity"
          ? antigravity?.selectedEffort
          : null

  const options =
    selectedAgentId === "claude-code" && selectedClaudeEffort
      ? claudeEfforts?.map((value) => ({
          value,
          label: formatClaudeEffortLabel(value),
          selected: value === selectedClaudeEffort,
          onSelect: () => claude.onSelectEffort(value),
        }))
      : selectedAgentId === "codex" && selectedCodexReasoning
        ? codexReasoningLevels?.map((value) => ({
            value,
            label: formatCodexReasoningLevelLabel(value),
            selected: value === selectedCodexReasoning,
            onSelect: () => codex.onSelectReasoning(value),
          }))
        : selectedAgentId === "antigravity"
          ? antigravity?.efforts.map((effort) => ({
              value: effort.id,
              label: effort.label,
              selected: effort.selected,
              onSelect: effort.onSelect,
            }))
          : []

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Model tuning: reasoning ${reasoningEnabled ? "on" : "off"}${selectedValue ? `, ${selectedValue}` : ""}${fastModeEnabled ? ", Fast" : ""}`}
          className="flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-xs text-foreground transition-colors hover:bg-accent outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70"
        >
          <Brain className="h-3 w-3 text-muted-foreground" />
          <span>{reasoningEnabled ? selectedValue || "Reasoning" : "Reasoning off"}</span>
          {fastModeEnabled && (
            <span className="flex items-center gap-0.5 text-amber-500">
              <Zap className="h-3 w-3" />
              <span>Fast</span>
            </span>
          )}
          <IconChevronDown className="h-2.5 w-2.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start" side="top" forceDark={false}>
        <div className="flex min-h-[32px] items-center justify-between px-2 py-1.5">
          <span className="flex items-center gap-1.5 text-sm">
            <Brain className="h-3.5 w-3.5 text-muted-foreground" />
            Show reasoning
          </span>
          <Switch
            aria-label="Show reasoning"
            checked={reasoningEnabled}
            onCheckedChange={onReasoningEnabledChange}
            className="scale-75"
          />
        </div>
        {options?.length ? <div className="my-1 h-px bg-border" /> : null}
        {options?.length ? (
          <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
            {selectedAgentId === "codex" ? "Reasoning depth" : "Effort"}
          </div>
        ) : null}
        {options?.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={option.onSelect}
            className="flex min-h-[32px] w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
          >
            <span>{option.label}</span>
            {option.selected && <CheckIcon className="h-3.5 w-3.5" />}
          </button>
        ))}
        {fastModeAvailable && (
          <>
            <div className="my-1 h-px bg-border" />
            <div className="flex min-h-[32px] items-center justify-between px-2 py-1.5">
              <span className="flex items-center gap-1.5 text-sm">
                <Zap className="h-3.5 w-3.5 text-amber-500" />
                Fast mode
              </span>
              <Switch
                aria-label="Fast mode"
                checked={fastModeEnabled}
                onCheckedChange={codex.onFastModeChange}
                className="scale-75"
              />
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

function CrossProviderConfirmDialog({
  isOpen,
  providerName,
  continueAction,
  onDelegate,
  onClose,
  returnFocusRef,
}: {
  isOpen: boolean
  providerName: string
  continueAction: React.ReactNode
  onDelegate?: () => void
  onClose: () => void
  returnFocusRef: RefObject<HTMLButtonElement | null>
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        ref={contentRef}
        aria-modal="true"
        showCloseButton={false}
        className="w-[90vw] max-w-[400px] gap-0 p-0 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(event) => event.stopPropagation()}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          cancelRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (
            document.activeElement === document.body ||
            contentRef.current?.contains(document.activeElement)
          ) {
            returnFocusRef.current?.focus()
          }
        }}
      >
        <div className="p-6">
          <DialogTitle className="text-xl font-semibold mb-2 leading-normal tracking-normal">
            Switch to {providerName}
          </DialogTitle>
          <DialogDescription>
            Continue in a new chat with the full conversation history from this chat.
          </DialogDescription>
        </div>
        {continueAction}
        <div className="bg-muted p-4 flex items-center justify-end border-t border-border rounded-b-xl">
          <div className="flex items-center gap-2">
            <Button ref={cancelRef} onClick={onClose} variant="ghost" className="rounded-md">
              Cancel
            </Button>
            {onDelegate ? (
              <Button onClick={onDelegate} variant="outline" className="rounded-md">
                Delegate task
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AgentModelSelector({
  open,
  onOpenChange,
  selectedAgentId,
  onSelectedAgentIdChange,
  selectedModelLabel,
  allowProviderSwitch = true,
  triggerClassName,
  contentClassName,
  onOpenModelsSettings,
  continuationSource,
  onContinueWithProvider,
  onDelegateWithProvider,
  claude,
  codex,
  cursor,
  antigravity,
  opencode = EMPTY_OPENCODE_PROVIDERS,
  local,
}: AgentModelSelectorProps) {
  const [showLegacyModels, setShowLegacyModels] = useAtom(showLegacyModelsAtom)
  const [search, setSearch] = useState("")
  const setClaudeLoginOpen = useSetAtom(agentsLoginModalOpenAtom)
  const setCodexLoginOpen = useSetAtom(codexLoginModalOpenAtom)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const modelTriggerRef = useRef<HTMLButtonElement>(null)
  const [pendingContinuation, setPendingContinuation] = useState<{
    provider: AgentProviderId
    targetModelId: string
    targetModelLabel: string
  } | null>(null)
  const [providerFilter, setProviderFilter] = useState<AgentProviderId | "all" | null>(null)
  const selectQuota = useRemainingQuota(open)
  const currentFilter = providerFilter ?? selectedAgentId

  const canSelectProvider = (provider: AgentProviderId) =>
    allowProviderSwitch || selectedAgentId === provider

  const modelGroups = useMemo<ModelGroup[]>(() => {
    const claudeItems: FlatModelItem[] = []

    if (claude.isOffline && claude.ollamaModels.length > 0) {
      for (const m of claude.ollamaModels) {
        claudeItems.push({
          type: "ollama",
          modelName: m,
          isRecommended: m === claude.recommendedOllamaModel,
        })
      }
    } else if (claude.hasCustomModelConfig) {
      claudeItems.push({ type: "custom" })
    } else {
      for (const m of claude.models) {
        if (
          !showLegacyModels &&
          isLegacyPickerModel(m.id) &&
          !(selectedAgentId === "claude-code" && m.id === claude.selectedModelId)
        )
          continue
        claudeItems.push({ type: "claude", model: m })
      }
    }

    const codexItems: FlatModelItem[] = []
    for (const m of codex.models) {
      if (
        !showLegacyModels &&
        isLegacyPickerModel(m.id) &&
        !(selectedAgentId === "codex" && m.id === codex.selectedModelId)
      )
        continue
      codexItems.push({ type: "codex", model: m })
    }

    const cursorItems: FlatModelItem[] = cursor.models.map((model) => ({
      type: "cursor",
      model,
    }))

    const groups: ModelGroup[] = [
      { id: "codex", label: "Codex", items: codexItems },
      { id: "claude-code", label: "Claude", items: claudeItems },
      {
        id: "antigravity",
        label: "Gemini",
        items: antigravity.models.map((model) => ({ type: "antigravity", model })),
      },
      { id: "cursor-agent", label: "Cursor", items: cursorItems },
    ]
    for (const provider of ["openrouter", "nanogpt"] as const) {
      if (!opencode[provider].models.length && selectedAgentId !== provider) continue
      groups.push({
        id: provider,
        label: opencode[provider].label,
        items: opencode[provider].models.map((model) => ({ type: "opencode", provider, model })),
      })
    }
    if (local)
      groups.push({
        id: "local",
        label: "Local",
        items: (local?.models ?? []).map((model) => ({ type: "local", model })),
      })
    return groups
  }, [
    claude,
    codex,
    cursor,
    antigravity.models,
    opencode,
    local,
    showLegacyModels,
    selectedAgentId,
  ])

  // Filter by search
  const filteredGroups = useMemo(() => {
    const groups = modelGroups.filter(
      (group) => currentFilter === "all" || group.id === currentFilter,
    )
    const q = search.toLowerCase().trim()
    if (!q) return groups
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (group.label.toLowerCase().includes(q)) return true
          switch (item.type) {
            case "claude":
              return (
                item.model.name.toLowerCase().includes(q) ||
                item.model.version.toLowerCase().includes(q) ||
                item.model.id.toLowerCase().includes(q) ||
                `${item.model.name} ${item.model.version}`.toLowerCase().includes(q)
              )
            case "codex":
              return item.model.name.toLowerCase().includes(q) || item.model.id.includes(q)
            case "antigravity":
            case "cursor":
              return item.model.name.toLowerCase().includes(q) || item.model.id.includes(q)
            case "opencode":
              return item.model.name.toLowerCase().includes(q) || item.model.id.includes(q)
            case "local":
              return item.model.name.toLowerCase().includes(q) || item.model.id.includes(q)
            case "ollama":
              return item.modelName.toLowerCase().includes(q)
            case "custom":
              return "custom model".includes(q)
          }
        }),
      }))
      .filter((group) => group.items.length > 0)
  }, [modelGroups, search, currentFilter])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen)
      if (!nextOpen) {
        setSearch("")
        setProviderFilter(null)
      }
    },
    [onOpenChange],
  )

  const selectedProviderMeta = getHarnessChipMeta(selectedAgentId)
  const triggerIcon =
    selectedAgentId === "claude-code" && claude.isOffline && claude.ollamaModels.length > 0 ? (
      <Zap className="h-3 w-3" />
    ) : (
      <ProviderChipIcon provider={selectedAgentId} className="h-3 w-3 shrink-0" />
    )

  const isItemSelected = (item: FlatModelItem): boolean => {
    switch (item.type) {
      case "claude":
        return selectedAgentId === "claude-code" && claude.selectedModelId === item.model.id
      case "codex":
        return selectedAgentId === "codex" && codex.selectedModelId === item.model.id
      case "antigravity":
        return selectedAgentId === "antigravity" && antigravity.selectedModelId === item.model.id
      case "cursor":
        return selectedAgentId === "cursor-agent" && cursor.selectedModelId === item.model.id
      case "opencode":
        return (
          selectedAgentId === item.provider &&
          opencode[item.provider].selectedModelId === item.model.id
        )
      case "local":
        return selectedAgentId === "local" && local?.selectedModelId === item.model.id
      case "ollama":
        return selectedAgentId === "claude-code" && claude.selectedOllamaModel === item.modelName
      case "custom":
        return selectedAgentId === "claude-code"
    }
  }

  const getItemProvider = (item: FlatModelItem): AgentProviderId | null => {
    if (item.type === "codex") return "codex"
    if (item.type === "antigravity") return "antigravity"
    if (item.type === "cursor") return "cursor-agent"
    if (item.type === "opencode") return item.provider
    if (item.type === "local") return "local"
    return "claude-code"
  }

  const isItemDisabled = (item: FlatModelItem): boolean => {
    if (item.type === "local" && !item.model.selectable) return true
    const provider = getItemProvider(item)
    if (!provider) return false
    if (canSelectProvider(provider)) return false
    // When onContinueWithProvider is available, cross-provider items are clickable (not disabled)
    if (onContinueWithProvider || onDelegateWithProvider) return false
    return true
  }

  const isItemCrossProvider = (item: FlatModelItem): boolean => {
    const provider = getItemProvider(item)
    return Boolean(
      provider &&
      !canSelectProvider(provider) &&
      (onContinueWithProvider || onDelegateWithProvider),
    )
  }

  const handleCloseConfirmDialog = useCallback(() => {
    setConfirmDialogOpen(false)
    setPendingContinuation(null)
  }, [])

  const handleDelegateCrossProvider = useCallback(() => {
    setConfirmDialogOpen(false)
    if (pendingContinuation && onDelegateWithProvider) {
      onDelegateWithProvider(pendingContinuation.provider, pendingContinuation.targetModelId)
    }
    setPendingContinuation(null)
  }, [pendingContinuation, onDelegateWithProvider])

  const handleItemClick = (item: FlatModelItem) => {
    const provider = getItemProvider(item)

    if (!provider) return

    // Cross-provider click → show confirmation or continue directly
    if (!canSelectProvider(provider) && (onContinueWithProvider || onDelegateWithProvider)) {
      const targetModelId = getItemModelId(item)
      if (!targetModelId) return
      handleOpenChange(false)
      setPendingContinuation({
        provider,
        targetModelId,
        targetModelLabel: getItemLabel(item),
      })
      setConfirmDialogOpen(true)
      return
    }

    switch (item.type) {
      case "claude":
        if (!canSelectProvider("claude-code")) return
        onSelectedAgentIdChange("claude-code")
        claude.onSelectModel(item.model.id)
        break
      case "codex":
        if (!canSelectProvider("codex")) return
        onSelectedAgentIdChange("codex")
        codex.onSelectModel(item.model.id)
        break
      case "cursor":
        if (!canSelectProvider("cursor-agent")) return
        onSelectedAgentIdChange("cursor-agent")
        cursor.onSelectModel(item.model.id)
        break
      case "antigravity":
        if (!canSelectProvider("antigravity")) return
        onSelectedAgentIdChange("antigravity")
        antigravity.onSelectModel(item.model.id)
        break
      case "opencode":
        if (!canSelectProvider(item.provider)) return
        onSelectedAgentIdChange(item.provider)
        opencode[item.provider].onSelectModel(item.model.id)
        break
      case "local":
        if (!canSelectProvider("local") || !item.model.selectable) return
        local?.onSelectModel(item.model.id)
        onSelectedAgentIdChange("local")
        break
      case "ollama":
        if (!canSelectProvider("claude-code")) return
        onSelectedAgentIdChange("claude-code")
        claude.onSelectOllamaModel(item.modelName)
        break
      case "custom":
        if (!canSelectProvider("claude-code")) return
        onSelectedAgentIdChange("claude-code")
        break
    }
    handleOpenChange(false)
  }

  const getItemLabel = (item: FlatModelItem): string => {
    switch (item.type) {
      case "claude":
        return `${item.model.name} ${item.model.version}`
      case "codex":
        return item.model.name
      case "antigravity":
      case "cursor":
        return item.model.name
      case "opencode":
        return item.model.name
      case "local":
        return item.model.name
      case "ollama":
        return item.modelName + (item.isRecommended ? " (recommended)" : "")
      case "custom":
        return "Custom Model"
    }
  }

  const getItemModelId = (item: FlatModelItem): string | null => {
    if (item.type === "ollama") return item.modelName
    if (item.type === "custom") return claude.selectedModelId?.trim() || null
    return item.model.id
  }

  const getItemKey = (item: FlatModelItem): string => {
    switch (item.type) {
      case "claude":
        return `claude-${item.model.id}`
      case "codex":
        return `codex-${item.model.id}`
      case "antigravity":
        return `antigravity-${item.model.id}`
      case "cursor":
        return `cursor-${item.model.id}`
      case "opencode":
        return `${item.provider}-${item.model.id}`
      case "local":
        return `local-${item.model.id}`
      case "ollama":
        return `ollama-${item.modelName}`
      case "custom":
        return "custom"
    }
  }

  function renderHandoffAction(
    target: { provider: AgentProviderId; targetModelId: string; targetModelLabel: string },
    onCreated: () => void,
  ) {
    if (!continuationSource || !onContinueWithProvider) return null
    return (
      <Suspense
        fallback={
          <span role="status" className="px-2 text-xs">
            Preparing handoff…
          </span>
        }
      >
        <CompactHandoffAction
          key={target.provider + target.targetModelId}
          source={continuationSource}
          provider={target.provider}
          model={target.targetModelId}
          modelLabel={target.targetModelLabel}
          onContinue={onContinueWithProvider}
          onCreated={onCreated}
        />
      </Suspense>
    )
  }

  const sharedQuota = (provider: AgentProviderId) =>
    provider === "claude-code" && (claude.isOffline || claude.hasCustomModelConfig)
      ? null
      : selectQuota(provider)
  const filterQuota = currentFilter === "all" ? null : sharedQuota(currentFilter)
  const showSwitchNotice =
    currentFilter !== "all" && !canSelectProvider(currentFilter) && Boolean(onContinueWithProvider)
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          ref={modelTriggerRef}
          data-tour="model"
          className={cn(
            "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs transition-[background-color,color,border-color] duration-150 ease-out outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
            selectedProviderMeta.className,
            triggerClassName,
          )}
        >
          {triggerIcon}
          <span className="truncate">{selectedModelLabel}</span>
          <IconChevronDown className="h-2.5 w-2.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        collisionPadding={8}
        forceDark={false}
        className={cn(
          "flex w-80 min-w-0 max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0",
          contentClassName,
        )}
      >
        <Command shouldFilter={false} className="min-h-0">
          <CommandList className="min-h-0 max-h-[min(360px,50vh)] overflow-y-auto">
            {filteredGroups.length > 0 ? (
              filteredGroups.map((group) => {
                const groupMeta = getHarnessChipMeta(group.id)
                const shared = currentFilter === "all" ? sharedQuota(group.id)?.effective : null
                return (
                  <CommandGroup key={group.id} aria-label={group.label}>
                    {currentFilter === "all" && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
                        <ProviderChipIcon
                          provider={group.id}
                          className={cn("size-3 shrink-0 rounded-sm", groupMeta.className)}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
                        {shared && (
                          <span
                            className={cn(
                              "shrink-0 tabular-nums",
                              quotaSeverityClass[shared.severity],
                            )}
                          >
                            {shared.windowLabel} {shared.stale ? "~" : ""}
                            {shared.displayValue}
                          </span>
                        )}
                      </div>
                    )}
                    {group.items.map((item) => {
                      const selected = isItemSelected(item)
                      const disabled = isItemDisabled(item)
                      const crossProvider =
                        isItemCrossProvider(item) && Boolean(onContinueWithProvider)
                      const quota =
                        item.type === "ollama" || item.type === "custom"
                          ? null
                          : selectQuota(group.id, getItemModelId(item))?.effective
                      const modelQuota = quota?.scope === "model-specific" ? quota : null
                      return (
                        <CommandItem
                          key={getItemKey(item)}
                          value={getItemKey(item)}
                          onSelect={() => handleItemClick(item)}
                          disabled={disabled}
                          className={cn(
                            "gap-2 border border-transparent",
                            selected && groupMeta.className,
                          )}
                        >
                          <ProviderChipIcon provider={group.id} className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate" title={getItemLabel(item)}>
                              {getItemLabel(item)}
                            </span>
                            {crossProvider && (
                              <span className="block text-[11px] text-muted-foreground">
                                Continue in new chat
                              </span>
                            )}
                            {item.type === "local" &&
                              (!item.model.selectable || item.model.tools !== "supported") && (
                                <span className="block truncate text-[11px] text-muted-foreground">
                                  {item.model.limitations[0] ?? "Tool support unavailable"}
                                </span>
                              )}
                          </span>
                          {modelQuota && (
                            <span
                              className={cn(
                                "shrink-0 rounded border px-1 text-[11px] tabular-nums",
                                quotaSeverityClass[modelQuota.severity],
                              )}
                            >
                              {modelQuota.stale ? "~" : ""}
                              {modelQuota.displayValue}
                            </span>
                          )}
                          {selected && <CheckIcon className="h-4 w-4 shrink-0" />}
                        </CommandItem>
                      )
                    })}

                    {group.id === "antigravity" && antigravity.status && (
                      <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                        <span role="status">{antigravity.status}</span>
                        {antigravity.canRetry && (
                          <Button size="sm" variant="secondary" onClick={antigravity.retry}>
                            Retry
                          </Button>
                        )}
                      </div>
                    )}
                    {group.id === "local" && local && (
                      <div className="mx-1 my-1 rounded-md border border-green-500/20 bg-green-500/5 px-2 py-2 text-xs">
                        <p className="text-muted-foreground">
                          {local.catalogState === "not-checked"
                            ? "Refresh the Ollama catalog in Local Models settings."
                            : local.catalogState === "invalid-endpoint"
                              ? "Fix the loopback endpoint in Local Models settings."
                              : local.catalogState === "ready"
                                ? "Inspect capability and permission limits before local launch."
                                : `Local catalog: ${local.catalogState}.`}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Local failures never fall back to a cloud provider. Reasoning output is
                          unavailable for local models.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            local.onOpenSettings()
                            handleOpenChange(false)
                          }}
                          className="mt-2 inline-flex items-center gap-1 font-medium text-green-700 hover:underline dark:text-green-300"
                        >
                          Open Local Models settings
                          <ChevronRight className="h-3 w-3" />
                        </button>
                      </div>
                    )}

                    {((group.id === "claude-code" && !claude.isConnected) ||
                      (group.id === "codex" && !codex.isConnected) ||
                      (group.id === "cursor-agent" && !cursor.isConnected)) && (
                      <>
                        <div className="flex items-center justify-between gap-3 px-2 py-2 text-xs text-muted-foreground">
                          <span>{group.label} CLI is not connected.</span>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={group.id === "cursor-agent" && cursor.isLoginPending}
                            onClick={() => {
                              if (group.id === "claude-code") setClaudeLoginOpen(true)
                              else if (group.id === "codex") setCodexLoginOpen(true)
                              else cursor.onLogin()
                            }}
                          >
                            {group.id === "cursor-agent" && cursor.isLoginPending
                              ? "Opening…"
                              : "Connect"}
                          </Button>
                        </div>
                        <CommandSeparator />
                      </>
                    )}
                  </CommandGroup>
                )
              })
            ) : (
              <CommandEmpty>No models found.</CommandEmpty>
            )}
          </CommandList>

          <div className="shrink-0">
            {filterQuota && (
              <p className="flex flex-wrap gap-x-2 gap-y-0.5 border-t px-2.5 py-1.5 text-xs tabular-nums">
                {filterQuota.windows.map((window) => (
                  <span key={window.key} className={quotaSeverityClass[window.severity]}>
                    {window.windowLabel} {window.stale ? "~" : ""}
                    {window.displayValue}
                  </span>
                ))}
              </p>
            )}
            {showSwitchNotice && (
              <p className="border-t bg-amber-500/10 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200">
                This chat uses {selectedProviderMeta.name}. Pick a{" "}
                {getHarnessChipMeta(currentFilter).name} model to continue in a new chat with this
                conversation’s history.
              </p>
            )}
            <div
              className="flex items-center justify-between gap-2 border-t px-2.5 py-1"
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") event.stopPropagation()
              }}
            >
              {onOpenModelsSettings && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenModelsSettings()
                    handleOpenChange(false)
                  }}
                  className="flex min-h-7 items-center gap-1 rounded-sm text-xs font-medium hover:underline focus-visible:outline focus-visible:outline-ring"
                >
                  Add Models <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                </button>
              )}
              <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                Show legacy models
                <Switch
                  checked={showLegacyModels}
                  onCheckedChange={setShowLegacyModels}
                  className="scale-75"
                />
              </label>
            </div>
            <CommandInput
              aria-label="Search models"
              placeholder="Search models..."
              value={search}
              onValueChange={setSearch}
              wrapperClassName="mx-2.5 mb-2 mt-1"
              className="min-w-0"
            />
            <div
              role="group"
              aria-label="Filter by provider"
              className="flex gap-1 overflow-x-auto border-t p-1.5"
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") event.stopPropagation()
              }}
            >
              {[{ id: "all" as const, label: "All" }, ...modelGroups].map(({ id, label }) => {
                const meta = id === "all" ? null : getHarnessChipMeta(id)
                return (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={currentFilter === id}
                    className={cn(
                      "flex shrink-0 items-center gap-1 rounded border border-transparent px-1.5 py-1 text-xs hover:bg-accent focus-visible:outline focus-visible:outline-ring",
                      currentFilter === id && (meta?.className ?? "bg-muted text-foreground"),
                    )}
                    onClick={() => setProviderFilter(id)}
                  >
                    {id !== "all" && (
                      <ProviderChipIcon
                        provider={id}
                        className={cn("size-3 rounded-sm", meta?.className)}
                      />
                    )}
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </Command>
      </PopoverContent>

      <CrossProviderConfirmDialog
        returnFocusRef={modelTriggerRef}
        isOpen={confirmDialogOpen}
        providerName={getHarnessChipMeta(pendingContinuation?.provider).name}
        continueAction={
          pendingContinuation && renderHandoffAction(pendingContinuation, handleCloseConfirmDialog)
        }
        onDelegate={onDelegateWithProvider ? handleDelegateCrossProvider : undefined}
        onClose={handleCloseConfirmDialog}
      />
    </Popover>
  )
}
