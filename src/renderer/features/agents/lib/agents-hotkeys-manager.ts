import * as React from "react"
import { useCallback } from "react"
import {
  executeAgentAction,
  getAvailableAgentActions,
  type AgentActionContext,
} from "./agents-actions"
import type { SettingsTab, CustomHotkeysConfig } from "../../../lib/atoms"
import {
  ALL_SHORTCUT_ACTIONS,
  detectConflicts,
  getResolvedHotkey,
  type ShortcutAction,
} from "../../../lib/hotkeys"

export function matchesHotkey(event: KeyboardEvent, hotkey: string): boolean {
  const parts = hotkey.toLowerCase().split("+")
  const key = parts.at(-1)
  if (!key) return false
  const modifiers = new Set(parts.slice(0, -1))
  const needsMeta = modifiers.has("cmd")
  const needsAlt = modifiers.has("opt")
  const needsCtrl = modifiers.has("ctrl")
  const needsShift = modifiers.has("shift") || key === "?"
  if (needsMeta !== event.metaKey) return false
  if (needsAlt !== event.altKey) return false
  if (needsCtrl !== event.ctrlKey) return false
  if (needsShift !== event.shiftKey) return false

  const eventKey = event.key.toLowerCase()
  const code = event.code.toLowerCase()
  if (eventKey === key) return true
  if (key === "esc") return eventKey === "escape"
  if (key === "space") return eventKey === " "
  if (key === "?" && code === "slash") return true
  if (key === "/" && code === "slash") return true
  if (key === "\\" && code === "backslash") return true
  if (key === "," && code === "comma") return true
  return key.length === 1 && code === `key${key}`
}

export function isShortcutFocusAllowed(
  action: ShortcutAction,
  target: EventTarget | null,
): boolean {
  if (action.focusPolicy === "global") return true
  if (!(target instanceof Element)) return true
  return !target.closest(
    'input, textarea, select, [contenteditable="true"], .monaco-editor, .xterm, [role="dialog"], [aria-modal="true"]',
  )
}

export function resolveRendererShortcut(
  event: KeyboardEvent,
  config: CustomHotkeysConfig,
  options: { availableActionIds?: ReadonlySet<string> } = {},
): ShortcutAction | null {
  const conflicts = detectConflicts(config)
  for (const action of ALL_SHORTCUT_ACTIONS) {
    if (action.dispatch !== "renderer") continue
    if (options.availableActionIds && !options.availableActionIds.has(action.actionId)) continue
    if (conflicts.has(action.id)) continue
    if (!isShortcutFocusAllowed(action, event.target)) continue
    const hotkey = getResolvedHotkey(action.id, config)
    if (hotkey && matchesHotkey(event, hotkey)) return action
  }
  return null
}

export interface AgentsHotkeysManagerConfig {
  setSelectedChatId?: (id: string | null) => void
  setSelectedDraftId?: (id: string | null) => void
  setShowNewChatForm?: (show: boolean) => void
  setDesktopView?: (view: import("../atoms").DesktopView) => void
  setSidebarOpen?: (open: boolean | ((prev: boolean) => boolean)) => void
  setSettingsActiveTab?: (tab: SettingsTab) => void
  setFileSearchDialogOpen?: (open: boolean) => void
  toggleChatSearch?: () => void
  selectedChatId?: string | null
  desktopView?: import("../atoms").DesktopView
  hasSelectedProject?: boolean
  customHotkeysConfig?: CustomHotkeysConfig
}

export interface UseAgentsHotkeysOptions {
  enabled?: boolean
  preventDefault?: boolean
}

export function useAgentsHotkeys(
  config: AgentsHotkeysManagerConfig,
  options: UseAgentsHotkeysOptions = {},
) {
  const { enabled = true, preventDefault = true } = options
  const createActionContext = useCallback(
    (): AgentActionContext => ({
      setSelectedChatId: config.setSelectedChatId,
      setSelectedDraftId: config.setSelectedDraftId,
      setShowNewChatForm: config.setShowNewChatForm,
      setDesktopView: config.setDesktopView,
      setSidebarOpen: config.setSidebarOpen,
      setSettingsActiveTab: config.setSettingsActiveTab,
      setFileSearchDialogOpen: config.setFileSearchDialogOpen,
      toggleChatSearch: config.toggleChatSearch,
      selectedChatId: config.selectedChatId,
      desktopView: config.desktopView,
      hasSelectedProject: config.hasSelectedProject,
    }),
    [
      config.setSelectedChatId,
      config.setSelectedDraftId,
      config.setShowNewChatForm,
      config.setDesktopView,
      config.setSidebarOpen,
      config.setSettingsActiveTab,
      config.setFileSearchDialogOpen,
      config.toggleChatSearch,
      config.selectedChatId,
      config.desktopView,
      config.hasSelectedProject,
    ],
  )

  const handleHotkeyAction = useCallback(
    async (actionId: string) => {
      const context = createActionContext()
      if (!getAvailableAgentActions(context).some((action) => action.id === actionId)) return
      await executeAgentAction(actionId, context, "hotkey")
    },
    [createActionContext],
  )

  React.useEffect(() => {
    if (!enabled || !window.desktopApi?.onShortcutNewAgent) return
    return window.desktopApi.onShortcutNewAgent(() => void handleHotkeyAction("create-new-agent"))
  }, [enabled, handleHotkeyAction])

  React.useEffect(() => {
    if (!enabled || !window.desktopApi?.onShortcutOpenSettings) return
    return window.desktopApi.onShortcutOpenSettings(() => void handleHotkeyAction("open-settings"))
  }, [enabled, handleHotkeyAction])

  React.useEffect(() => {
    if (!enabled) return
    const shortcutConfig = config.customHotkeysConfig ?? { version: 2, bindings: {} }
    const handleKeyDown = (event: KeyboardEvent) => {
      const context = createActionContext()
      const availableActionIds = new Set(
        getAvailableAgentActions(context).map((action) => action.id),
      )
      const action = resolveRendererShortcut(event, shortcutConfig, { availableActionIds })
      if (!action) return
      if (preventDefault) {
        event.preventDefault()
        event.stopPropagation()
      }
      void handleHotkeyAction(action.actionId)
    }
    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [config.customHotkeysConfig, createActionContext, enabled, handleHotkeyAction, preventDefault])

  return {
    executeAction: handleHotkeyAction,
    getAvailableActions: () => getAvailableAgentActions(createActionContext()),
    createActionContext,
  }
}
