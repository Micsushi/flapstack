"use client"

import { Brain, ChevronDown, ChevronRight, Zap } from "lucide-react"
import { useSetAtom } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { agentsLoginModalOpenAtom, codexLoginModalOpenAtom } from "../../../lib/atoms"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../../../components/ui/command"
import { CheckIcon, IconChevronDown, ReasoningOutputIcon } from "../../../components/ui/icons"
import { Switch } from "../../../components/ui/switch"
import { Checkbox } from "../../../components/ui/checkbox"
import { Button } from "../../../components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover"
import { cn } from "../../../lib/utils"
import type { ClaudeEffortLevel, CodexReasoningLevel } from "../lib/models"
import { formatClaudeEffortLabel, formatCodexReasoningLevelLabel } from "../lib/models"
import { getHarnessChipMeta } from "../constants"
import { ProviderChipIcon } from "./provider-chip-icon"

const CROSS_PROVIDER_DIALOG_DISMISSED_KEY = "agent-model-selector:skip-cross-provider-dialog"

export type AgentProviderId = "claude-code" | "codex" | "cursor-agent" | "openrouter" | "nanogpt"

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
  onContinueWithProvider?: (provider: AgentProviderId) => void
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
  | { type: "opencode"; provider: "openrouter" | "nanogpt"; model: OpencodeModelOption }
  | { type: "local"; model: LocalModelOption }
  | { type: "ollama"; modelName: string; isRecommended: boolean }
  | { type: "custom" }

type ModelGroup = {
  id: AgentProviderId | "local"
  label: string
  items: FlatModelItem[]
}

interface AgentModelTuningSelectorProps {
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
}: AgentModelTuningSelectorProps) {
  const selectedClaudeModel =
    claude.models.find((model) => model.id === claude.selectedModelId) || claude.models[0]
  const claudeEfforts =
    selectedAgentId === "claude-code" && !claude.isOffline && !claude.hasCustomModelConfig
      ? selectedClaudeModel?.efforts
      : undefined
  const selectedClaudeEffort = claudeEfforts?.includes(claude.selectedEffort)
    ? claude.selectedEffort
    : claudeEfforts?.includes("high")
      ? "high"
      : claudeEfforts?.[0]

  const selectedCodexModel =
    codex.models.find((model) => model.id === codex.selectedModelId) || codex.models[0]
  const codexReasoningLevels =
    selectedAgentId === "codex" ? selectedCodexModel?.reasoningLevels : undefined
  const selectedCodexReasoning = codexReasoningLevels?.includes(codex.selectedReasoning)
    ? codex.selectedReasoning
    : codexReasoningLevels?.includes("high")
      ? "high"
      : codexReasoningLevels?.[0]
  const fastModeAvailable =
    selectedAgentId === "codex" && selectedCodexModel?.supportsFastMode === true
  const fastModeEnabled = fastModeAvailable && codex.fastModeEnabled

  const selectedValue =
    selectedAgentId === "claude-code" && selectedClaudeEffort
      ? formatClaudeEffortLabel(selectedClaudeEffort)
      : selectedAgentId === "codex" && selectedCodexReasoning
        ? formatCodexReasoningLevelLabel(selectedCodexReasoning)
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
      <PopoverContent className="w-48 p-1" align="start">
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

const DIALOG_EASING = [0.55, 0.055, 0.675, 0.19] as const

function CrossProviderConfirmDialog({
  isOpen,
  providerName,
  onConfirm,
  onClose,
}: {
  isOpen: boolean
  providerName: string
  onConfirm: (dontShowAgain: boolean) => void
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const dontShowAgainRef = useRef(false)
  dontShowAgainRef.current = dontShowAgain

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isOpen) {
      setDontShowAgain(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        onConfirm(dontShowAgainRef.current)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onConfirm, onClose])

  if (!mounted) return null
  const portalTarget = typeof document !== "undefined" ? document.body : null
  if (!portalTarget) return null

  return createPortal(
    <AnimatePresence mode="wait" initial={false}>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.18, ease: DIALOG_EASING } }}
            exit={{
              opacity: 0,
              pointerEvents: "none" as const,
              transition: { duration: 0.15, ease: DIALOG_EASING },
            }}
            className="fixed inset-0 z-[45] bg-black/25"
            onClick={onClose}
            style={{ pointerEvents: "auto" }}
          />
          <div className="fixed top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] z-[46] pointer-events-none">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.2, ease: DIALOG_EASING }}
              className="w-[90vw] max-w-[400px] pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-background rounded-2xl border shadow-2xl overflow-hidden">
                <div className="p-6">
                  <h2 className="text-xl font-semibold mb-2">Switch to {providerName}</h2>
                  <p className="text-sm text-muted-foreground">
                    To use a different agent, a new chat will be created with your current
                    conversation history attached.
                  </p>
                </div>
                <div className="bg-muted p-4 flex items-center justify-between border-t border-border rounded-b-xl">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <Checkbox
                      checked={dontShowAgain}
                      onCheckedChange={(v) => setDontShowAgain(v === true)}
                    />
                    <span className="text-xs text-muted-foreground">Don't ask again</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <Button onClick={onClose} variant="ghost" className="rounded-md">
                      Cancel
                    </Button>
                    <Button
                      onClick={() => onConfirm(dontShowAgain)}
                      variant="default"
                      className="rounded-md"
                    >
                      New chat
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    portalTarget,
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
  onContinueWithProvider,
  claude,
  codex,
  cursor,
  opencode = EMPTY_OPENCODE_PROVIDERS,
  local,
}: AgentModelSelectorProps) {
  const [search, setSearch] = useState("")
  const setClaudeLoginOpen = useSetAtom(agentsLoginModalOpenAtom)
  const setCodexLoginOpen = useSetAtom(codexLoginModalOpenAtom)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [pendingProvider, setPendingProvider] = useState<AgentProviderId | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Record<ModelGroup["id"], boolean>>(() => ({
    "claude-code": selectedAgentId === "claude-code",
    codex: selectedAgentId === "codex",
    "cursor-agent": selectedAgentId === "cursor-agent",
    openrouter: selectedAgentId === "openrouter",
    nanogpt: selectedAgentId === "nanogpt",
    local: false,
  }))

  // On open: collapse everything except the current provider and scroll its
  // header to the top of the list (clamped, so short remainders end-align).
  useEffect(() => {
    if (!open) return
    setExpandedGroups({
      "claude-code": selectedAgentId === "claude-code",
      codex: selectedAgentId === "codex",
      "cursor-agent": selectedAgentId === "cursor-agent",
      openrouter: selectedAgentId === "openrouter",
      nanogpt: selectedAgentId === "nanogpt",
      local: false,
    })
    const frame = requestAnimationFrame(() => {
      document.getElementById(`model-group-${selectedAgentId}`)?.scrollIntoView({ block: "start" })
    })
    return () => cancelAnimationFrame(frame)
  }, [open, selectedAgentId])

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
        claudeItems.push({ type: "claude", model: m })
      }
    }

    const codexItems: FlatModelItem[] = []
    for (const m of codex.models) {
      codexItems.push({ type: "codex", model: m })
    }

    const cursorItems: FlatModelItem[] = cursor.models.map((model) => ({
      type: "cursor",
      model,
    }))

    const groups: ModelGroup[] = [
      { id: "claude-code", label: "Claude Code", items: claudeItems },
      { id: "codex", label: "Codex", items: codexItems },
      { id: "cursor-agent", label: "Cursor", items: cursorItems },
    ]
    for (const provider of ["openrouter", "nanogpt"] as const) {
      groups.push({
        id: provider,
        label: opencode[provider].label,
        items: opencode[provider].models.map((model) => ({ type: "opencode", provider, model })),
      })
    }
    groups.push({
      id: "local",
      label: "Local · Ollama",
      items: (local?.models ?? []).map((model) => ({ type: "local", model })),
    })
    return groups
  }, [claude, codex, cursor, opencode, local?.models])

  // Filter by search
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return modelGroups
    const q = search.toLowerCase().trim()
    return modelGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
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
  }, [modelGroups, search])

  const filteredModelCount = filteredGroups.reduce((count, group) => count + group.items.length, 0)

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      onOpenChange(nextOpen)
      if (!nextOpen) {
        setSearch("")
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
      case "cursor":
        return selectedAgentId === "cursor-agent" && cursor.selectedModelId === item.model.id
      case "opencode":
        return (
          selectedAgentId === item.provider &&
          opencode[item.provider].selectedModelId === item.model.id
        )
      case "local":
        return local?.selectedModelId === item.model.id
      case "ollama":
        return selectedAgentId === "claude-code" && claude.selectedOllamaModel === item.modelName
      case "custom":
        return selectedAgentId === "claude-code"
    }
  }

  const getItemProvider = (item: FlatModelItem): AgentProviderId | null => {
    if (item.type === "codex") return "codex"
    if (item.type === "cursor") return "cursor-agent"
    if (item.type === "opencode") return item.provider
    if (item.type === "local") return null
    return "claude-code"
  }

  const isItemDisabled = (item: FlatModelItem): boolean => {
    const provider = getItemProvider(item)
    if (!provider) return false
    if (canSelectProvider(provider)) return false
    // When onContinueWithProvider is available, cross-provider items are clickable (not disabled)
    if (onContinueWithProvider) return false
    return true
  }

  const isItemCrossProvider = (item: FlatModelItem): boolean => {
    const provider = getItemProvider(item)
    return Boolean(provider && !canSelectProvider(provider) && onContinueWithProvider)
  }

  const handleConfirmCrossProvider = useCallback(
    (dontShowAgain: boolean) => {
      if (dontShowAgain) {
        try {
          localStorage.setItem(CROSS_PROVIDER_DIALOG_DISMISSED_KEY, "true")
        } catch {}
      }
      setConfirmDialogOpen(false)
      if (pendingProvider && onContinueWithProvider) {
        onContinueWithProvider(pendingProvider)
      }
      setPendingProvider(null)
    },
    [pendingProvider, onContinueWithProvider],
  )

  const handleCloseConfirmDialog = useCallback(() => {
    setConfirmDialogOpen(false)
    setPendingProvider(null)
  }, [])

  const handleItemClick = (item: FlatModelItem) => {
    const provider = getItemProvider(item)

    if (item.type === "local") {
      local?.onOpenSettings()
      handleOpenChange(false)
      return
    }
    if (!provider) return

    // Cross-provider click → show confirmation or continue directly
    if (!canSelectProvider(provider) && onContinueWithProvider) {
      handleOpenChange(false)
      const dismissed = (() => {
        try {
          return localStorage.getItem(CROSS_PROVIDER_DIALOG_DISMISSED_KEY) === "true"
        } catch {
          return false
        }
      })()
      if (dismissed) {
        onContinueWithProvider(provider)
      } else {
        setPendingProvider(provider)
        setConfirmDialogOpen(true)
      }
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
      case "opencode":
        if (!canSelectProvider(item.provider)) return
        onSelectedAgentIdChange(item.provider)
        opencode[item.provider].onSelectModel(item.model.id)
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

  const getItemKey = (item: FlatModelItem): string => {
    switch (item.type) {
      case "claude":
        return `claude-${item.model.id}`
      case "codex":
        return `codex-${item.model.id}`
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

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
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
      <PopoverContent className={cn("w-64 p-0", contentClassName)} align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search models..." value={search} onValueChange={setSearch} />

          {/* Claude reasoning-output toggle */}
          {selectedAgentId === "claude-code" &&
            !claude.isOffline &&
            !claude.hasCustomModelConfig && (
              <>
                <div
                  className="flex items-center justify-between min-h-[32px] py-[5px] px-1.5 mx-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1.5">
                    <ReasoningOutputIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm">Reasoning output</span>
                  </div>
                  <Switch
                    checked={claude.reasoningOutputEnabled}
                    onCheckedChange={claude.onReasoningOutputChange}
                    className="scale-75"
                  />
                </div>
                <CommandSeparator />
              </>
            )}

          <CommandList className="max-h-[300px] overflow-y-auto">
            {filteredModelCount > 0 ? (
              filteredGroups.map((group, index) => {
                const isExpanded = search.trim() ? true : expandedGroups[group.id]
                const groupMeta = getHarnessChipMeta(group.id)
                return (
                  <CommandGroup key={group.id}>
                    {index > 0 && <CommandSeparator />}
                    <button
                      type="button"
                      id={`model-group-${group.id}`}
                      aria-expanded={isExpanded}
                      onPointerDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                      onClick={(e) => {
                        // The popover content is portaled but React events still
                        // bubble to ancestors (e.g. the chat input's focus-grabbing
                        // wrapper), which would blur the popover and dismiss it.
                        e.stopPropagation()
                        setExpandedGroups((current) => ({
                          ...current,
                          [group.id]: !current[group.id],
                        }))
                      }}
                      className={cn(
                        "mx-1 mt-1 flex w-[calc(100%-8px)] items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:brightness-110",
                        groupMeta.className,
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <ProviderChipIcon provider={group.id} className="h-3 w-3 shrink-0" />
                        <span>{group.label}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="rounded-sm bg-background/60 px-1.5 py-0.5 text-[10px] font-medium tracking-normal text-current">
                          {group.items.length}
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            !isExpanded && "-rotate-90",
                          )}
                        />
                      </span>
                    </button>
                    {isExpanded &&
                      group.items.map((item) => {
                        const selected = isItemSelected(item)
                        const disabled = isItemDisabled(item)
                        const crossProvider = isItemCrossProvider(item)
                        return (
                          <CommandItem
                            key={getItemKey(item)}
                            value={getItemKey(item)}
                            onSelect={() => handleItemClick(item)}
                            disabled={disabled}
                            className={cn(
                              "gap-2 border border-transparent pl-6",
                              selected && groupMeta.className,
                              crossProvider && "opacity-60",
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{getItemLabel(item)}</span>
                              {item.type === "local" && (
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  Chat {item.model.chat} · Tools {item.model.tools}
                                </span>
                              )}
                            </span>
                            {crossProvider && (
                              <span className="text-[10px] text-muted-foreground shrink-0">
                                New chat
                              </span>
                            )}
                            {selected && <CheckIcon className="h-4 w-4 shrink-0" />}
                          </CommandItem>
                        )
                      })}

                    {isExpanded && group.id === "local" && local && (
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
                          Local failures never fall back to a cloud provider.
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

          {onOpenModelsSettings && (
            <div className="border-t border-border/50 py-1">
              <button
                onClick={() => {
                  onOpenModelsSettings()
                  handleOpenChange(false)
                }}
                className="flex items-center gap-1.5 min-h-[32px] py-[5px] px-1.5 mx-1 w-[calc(100%-8px)] rounded-md text-sm cursor-default select-none outline-none dark:hover:bg-neutral-800 hover:text-foreground transition-colors"
              >
                <span className="flex-1 text-left">Add Models</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>

      <CrossProviderConfirmDialog
        isOpen={confirmDialogOpen}
        providerName={
          pendingProvider === "codex"
            ? "Codex"
            : pendingProvider === "cursor-agent"
              ? "Cursor"
              : "Claude Code"
        }
        onConfirm={handleConfirmCrossProvider}
        onClose={handleCloseConfirmDialog}
      />
    </Popover>
  )
}
