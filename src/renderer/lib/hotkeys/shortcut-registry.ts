import type {
  CustomHotkeysConfig,
  ShortcutAction,
  ShortcutActionId,
  ShortcutCategory,
  ShortcutConflict,
  ShortcutPlatform,
  ShortcutValidationResult,
} from "./types"

const platformDefaults = (
  darwin: string | null,
  other: string | null,
): Record<ShortcutPlatform, string | null> => ({ darwin, win32: other, linux: other })

export const ALL_SHORTCUT_ACTIONS: ShortcutAction[] = [
  {
    id: "show-shortcuts",
    actionId: "open-shortcuts",
    label: "Keyboard shortcuts",
    description: "Open Keyboard Settings",
    category: "general",
    defaults: platformDefaults("?", "?"),
    editable: true,
    focusPolicy: "workspace",
    dispatch: "renderer",
    conflictGroup: "app",
  },
  {
    id: "open-settings",
    actionId: "open-settings",
    label: "Settings",
    description: "Open Settings",
    category: "general",
    defaults: platformDefaults("cmd+,", "ctrl+,"),
    editable: false,
    focusPolicy: "global",
    dispatch: "native",
    conflictGroup: "app",
    reservedReason: "Managed by the application menu",
  },
  {
    id: "toggle-sidebar",
    actionId: "toggle-sidebar",
    label: "Toggle sidebar",
    description: "Show or hide the left sidebar",
    category: "general",
    defaults: platformDefaults("cmd+\\", "ctrl+\\"),
    editable: true,
    focusPolicy: "global",
    dispatch: "renderer",
    conflictGroup: "app",
  },
  {
    id: "new-workspace",
    actionId: "create-new-agent",
    label: "New chat",
    description: "Create a new chat",
    category: "workspaces",
    defaults: platformDefaults("cmd+n", "ctrl+n"),
    editable: false,
    focusPolicy: "global",
    dispatch: "native",
    conflictGroup: "app",
    reservedReason: "Managed by the application menu",
  },
  {
    id: "search-in-chat",
    actionId: "toggle-chat-search",
    label: "Search current chat",
    description: "Search the visible transcript",
    category: "agents",
    defaults: platformDefaults("cmd+f", "ctrl+f"),
    editable: true,
    focusPolicy: "workspace",
    dispatch: "renderer",
    conflictGroup: "app",
  },
  {
    id: "new-agent",
    actionId: "new-agent",
    label: "New agent",
    description: "Create another agent in the current chat",
    category: "agents",
    defaults: platformDefaults("cmd+t", "ctrl+t"),
    editable: false,
    focusPolicy: "workspace",
    dispatch: "local",
    conflictGroup: "app",
    reservedReason: "Handled by the active chat surface",
  },
  {
    id: "archive-agent",
    actionId: "archive-agent",
    label: "Archive current agent",
    description: "Archive the selected agent conversation",
    category: "agents",
    defaults: platformDefaults("cmd+w", "ctrl+w"),
    editable: false,
    focusPolicy: "workspace",
    dispatch: "local",
    conflictGroup: "app",
    reservedReason: "Handled by the active chat surface",
  },
  {
    id: "stop-generation",
    actionId: "stop-generation",
    label: "Stop generation",
    description: "Stop the active agent run",
    category: "agents",
    defaults: platformDefaults("esc", "esc"),
    editable: false,
    focusPolicy: "workspace",
    dispatch: "local",
    conflictGroup: "app",
    reservedReason: "Safety shortcut handled by the active run",
    altKeys: ["ctrl", "C"],
  },
  {
    id: "toggle-details",
    actionId: "toggle-details",
    label: "Toggle details",
    description: "Show or hide the details sidebar",
    category: "agents",
    defaults: platformDefaults("cmd+shift+\\", "ctrl+shift+\\"),
    editable: false,
    focusPolicy: "workspace",
    dispatch: "local",
    conflictGroup: "app",
    reservedReason: "Handled by the details surface",
  },
  {
    id: "toggle-terminal",
    actionId: "toggle-terminal",
    label: "Toggle terminal",
    description: "Show or hide the terminal",
    category: "agents",
    defaults: platformDefaults("cmd+j", "ctrl+j"),
    editable: false,
    focusPolicy: "workspace",
    dispatch: "local",
    conflictGroup: "app",
    reservedReason: "Handled by the terminal surface",
  },
  {
    id: "open-diff",
    actionId: "open-diff",
    label: "Open changes",
    description: "Open the current chat diff",
    category: "agents",
    defaults: platformDefaults("cmd+d", "ctrl+d"),
    editable: false,
    focusPolicy: "workspace",
    dispatch: "local",
    conflictGroup: "app",
    reservedReason: "Handled by the active chat surface",
  },
  {
    id: "file-search",
    actionId: "file-search",
    label: "Go to file",
    description: "Search files in the current workspace",
    category: "agents",
    defaults: platformDefaults("cmd+p", "ctrl+p"),
    editable: true,
    focusPolicy: "workspace",
    dispatch: "renderer",
    conflictGroup: "app",
  },
  {
    id: "open-in-editor",
    actionId: "open-in-editor",
    label: "Open workspace in editor",
    description: "Open the current worktree in the preferred editor",
    category: "workspaces",
    defaults: platformDefaults("cmd+o", "ctrl+o"),
    editable: true,
    focusPolicy: "workspace",
    dispatch: "renderer",
    conflictGroup: "app",
  },
  {
    id: "open-file-in-editor",
    actionId: "open-file-in-editor",
    label: "Open file in editor",
    description: "Open the previewed file in the preferred editor",
    category: "agents",
    defaults: platformDefaults("cmd+shift+o", "ctrl+shift+o"),
    editable: true,
    focusPolicy: "workspace",
    dispatch: "renderer",
    conflictGroup: "app",
  },
  {
    id: "open-kanban",
    actionId: "open-kanban",
    label: "Open Kanban board",
    description: "Open the Kanban board when enabled",
    category: "workspaces",
    defaults: platformDefaults("cmd+shift+k", "ctrl+shift+k"),
    editable: true,
    focusPolicy: "workspace",
    dispatch: "renderer",
    conflictGroup: "app",
    availability: "kanban",
  },
  {
    id: "voice-input",
    actionId: "voice-input",
    label: "Voice input",
    description: "Hold to dictate into the active composer",
    category: "agents",
    defaults: platformDefaults("ctrl+opt", "ctrl+alt"),
    editable: false,
    focusPolicy: "workspace",
    dispatch: "local",
    conflictGroup: "app",
    reservedReason: "Hold shortcuts are configured by the voice control",
  },
]

export function getShortcutPlatform(
  platform = globalThis.navigator?.platform ?? "",
): ShortcutPlatform {
  const value = platform.toLowerCase()
  if (value.includes("mac")) return "darwin"
  if (value.includes("win")) return "win32"
  return "linux"
}

export function getShortcutsByCategory(
  options: { betaKanbanEnabled?: boolean } = {},
): Record<ShortcutCategory, ShortcutAction[]> {
  const visible = ALL_SHORTCUT_ACTIONS.filter(
    (action) => action.availability !== "kanban" || options.betaKanbanEnabled,
  )
  return {
    general: visible.filter((action) => action.category === "general"),
    workspaces: visible.filter((action) => action.category === "workspaces"),
    agents: visible.filter((action) => action.category === "agents"),
  }
}

export function getShortcutAction(id: ShortcutActionId): ShortcutAction | undefined {
  return ALL_SHORTCUT_ACTIONS.find((action) => action.id === id)
}

export function keysToHotkeyString(keys: string[]): string {
  return normalizeHotkey(keys.join("+"))
}

export function hotkeyStringToKeys(hotkey: string): string[] {
  return normalizeHotkey(hotkey)
    .split("+")
    .map((part) =>
      ["cmd", "ctrl", "opt", "shift"].includes(part)
        ? part
        : part.length === 1
          ? part.toUpperCase()
          : part,
    )
}

export function normalizeHotkey(hotkey: string): string {
  const aliases: Record<string, string> = {
    meta: "cmd",
    command: "cmd",
    control: "ctrl",
    alt: "opt",
    option: "opt",
    escape: "esc",
    " ": "space",
  }
  const parts = hotkey
    .toLowerCase()
    .split("+")
    .map((part) => aliases[part.trim()] ?? part.trim())
  const modifiers = ["cmd", "ctrl", "opt", "shift"].filter((modifier) => parts.includes(modifier))
  const keys = parts.filter((part) => part && !["cmd", "ctrl", "opt", "shift"].includes(part))
  return [...modifiers, ...keys].join("+")
}

const RESERVED_HOTKEYS: Record<ShortcutPlatform, Set<string>> = {
  darwin: new Set(["cmd+q", "cmd+tab", "cmd+space", "cmd+opt+esc"]),
  win32: new Set(["alt+f4", "ctrl+alt+delete", "cmd+l"]),
  linux: new Set(["alt+f4", "ctrl+alt+delete"]),
}

export function validateHotkey(
  hotkey: string,
  platform = getShortcutPlatform(),
): ShortcutValidationResult {
  const normalized = normalizeHotkey(hotkey)
  const parts = normalized.split("+").filter(Boolean)
  const keys = parts.filter((part) => !["cmd", "ctrl", "opt", "shift"].includes(part))
  if (keys.length !== 1) return { valid: false, reason: "Use one key with optional modifiers" }
  if (new Set(parts).size !== parts.length) return { valid: false, reason: "Duplicate modifier" }
  if (RESERVED_HOTKEYS[platform].has(normalized)) {
    return { valid: false, reason: "Reserved by the operating system" }
  }
  return { valid: true, hotkey: normalized }
}

export function getResolvedHotkey(
  actionId: ShortcutActionId,
  config: CustomHotkeysConfig,
  platform = getShortcutPlatform(),
): string | null {
  const action = getShortcutAction(actionId)
  if (!action) return null
  const override = action.editable ? config.bindings[actionId] : undefined
  if (override === null) return null
  if (typeof override === "string") {
    const validation = validateHotkey(override, platform)
    if (validation.valid) return validation.hotkey
  }
  return action.defaults[platform]
}

export function getResolvedKeys(
  actionId: ShortcutActionId,
  config: CustomHotkeysConfig,
  platform = getShortcutPlatform(),
): string[] | null {
  const hotkey = getResolvedHotkey(actionId, config, platform)
  return hotkey ? hotkeyStringToKeys(hotkey) : null
}

export function isCustomHotkey(actionId: ShortcutActionId, config: CustomHotkeysConfig): boolean {
  return getShortcutAction(actionId)?.editable === true && config.bindings[actionId] !== undefined
}

export function migrateHotkeysConfig(value: unknown): CustomHotkeysConfig {
  if (!value || typeof value !== "object") return { version: 2, bindings: {} }
  const raw = value as { bindings?: unknown }
  const bindings: Record<string, string | null> = {}
  if (raw.bindings && typeof raw.bindings === "object") {
    for (const action of ALL_SHORTCUT_ACTIONS) {
      if (!action.editable) continue
      const candidate = (raw.bindings as Record<string, unknown>)[action.id]
      if (candidate === null) bindings[action.id] = null
      if (typeof candidate === "string" && validateHotkey(candidate).valid) {
        bindings[action.id] = normalizeHotkey(candidate)
      }
    }
  }
  return { version: 2, bindings }
}

export function detectConflicts(
  config: CustomHotkeysConfig,
  platform = getShortcutPlatform(),
): Map<ShortcutActionId, ShortcutConflict> {
  const conflicts = new Map<ShortcutActionId, ShortcutConflict>()
  const byHotkey = new Map<string, ShortcutActionId[]>()
  for (const action of ALL_SHORTCUT_ACTIONS) {
    const hotkey = getResolvedHotkey(action.id, config, platform)
    if (!hotkey) continue
    byHotkey.set(hotkey, [...(byHotkey.get(hotkey) ?? []), action.id])
  }
  for (const [hotkey, actionIds] of byHotkey) {
    if (actionIds.length < 2) continue
    for (const actionId of actionIds) {
      conflicts.set(actionId, {
        actionId,
        conflictingActionIds: actionIds.filter((id) => id !== actionId),
        hotkey,
      })
    }
  }
  return conflicts
}

const KEY_DISPLAY_MAP: Record<string, string> = {
  cmd: "⌘",
  ctrl: "⌃",
  opt: "⌥",
  shift: "⇧",
  enter: "↵",
  backspace: "⌫",
  delete: "⌦",
  esc: "Esc",
  tab: "Tab",
  space: "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
}

export function keyToDisplay(key: string): string {
  return KEY_DISPLAY_MAP[key.toLowerCase()] ?? key.toUpperCase()
}

export function hotkeyToDisplay(hotkey: string): string {
  return hotkeyStringToKeys(hotkey).map(keyToDisplay).join("")
}

export function keysToDisplay(keys: string[]): string {
  return keys.map(keyToDisplay).join("")
}

export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  general: "General",
  workspaces: "Chats",
  agents: "Agents",
}
