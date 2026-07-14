import type {
  CustomHotkeysConfig,
  ShortcutAction,
  ShortcutActionId,
  ShortcutCategory,
  ShortcutConflict,
  ParsedHotkeysConfig,
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
    defaults: { darwin: "cmd+shift+\\", win32: null, linux: null },
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
    defaults: { darwin: "cmd+j", win32: null, linux: null },
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
    defaults: { darwin: "cmd+d", win32: null, linux: null },
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
  options: { platform?: ShortcutPlatform } = {},
): Record<ShortcutCategory, ShortcutAction[]> {
  const platform = options.platform ?? getShortcutPlatform()
  const visible = ALL_SHORTCUT_ACTIONS.filter(
    (action) => action.defaults[platform] !== null || action.editable,
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
  win32: new Set(["opt+f4", "ctrl+opt+delete", "cmd+l"]),
  linux: new Set(["opt+f4", "ctrl+opt+delete"]),
}

export function validateHotkey(
  hotkey: string,
  platform = getShortcutPlatform(),
): ShortcutValidationResult {
  const rawParts = hotkey
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
  const modifierAliases: Record<string, string> = {
    meta: "cmd",
    command: "cmd",
    control: "ctrl",
    alt: "opt",
    option: "opt",
  }
  const rawModifiers = rawParts
    .map((part) => modifierAliases[part] ?? part)
    .filter((part) => ["cmd", "ctrl", "opt", "shift"].includes(part))
  if (new Set(rawModifiers).size !== rawModifiers.length) {
    return { valid: false, reason: "Duplicate modifier" }
  }
  const normalized = normalizeHotkey(hotkey)
  const parts = normalized.split("+").filter(Boolean)
  const keys = parts.filter((part) => !["cmd", "ctrl", "opt", "shift"].includes(part))
  if (keys.length !== 1) return { valid: false, reason: "Use one key with optional modifiers" }
  if (parts.length === 1 && !["?", "/", "esc", "enter", "tab"].includes(keys[0]!)) {
    return { valid: false, reason: "Use a modifier with this key" }
  }
  if (RESERVED_HOTKEYS[platform].has(normalized)) {
    return { valid: false, reason: "Reserved by the operating system" }
  }
  return { valid: true, hotkey: normalized }
}

export function getResolvedHotkey(
  actionId: ShortcutActionId,
  config: CustomHotkeysConfig | unknown,
  platform = getShortcutPlatform(),
): string | null {
  const action = getShortcutAction(actionId)
  if (!action) return null
  const safeConfig = migrateHotkeysConfig(config, platform)
  const override = action.editable ? safeConfig.bindings[actionId] : undefined
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
  const safeConfig = migrateHotkeysConfig(config)
  return (
    getShortcutAction(actionId)?.editable === true && safeConfig.bindings[actionId] !== undefined
  )
}

export function parseHotkeysConfig(
  value: unknown,
  platform = getShortcutPlatform(),
): ParsedHotkeysConfig {
  const diagnostics: ParsedHotkeysConfig["diagnostics"] = []
  if (!value || typeof value !== "object") {
    if (value != null) diagnostics.push({ actionId: "config", reason: "Invalid stored format" })
    return { config: { version: 2, bindings: {} }, diagnostics }
  }
  const raw = value as { bindings?: unknown }
  const bindings: Record<string, string | null> = {}
  if (raw.bindings && typeof raw.bindings === "object") {
    for (const action of ALL_SHORTCUT_ACTIONS) {
      if (!action.editable) continue
      const candidate = (raw.bindings as Record<string, unknown>)[action.id]
      if (candidate === null) bindings[action.id] = null
      if (typeof candidate === "string") {
        const validation = validateHotkey(candidate, platform)
        if (validation.valid) bindings[action.id] = validation.hotkey
        else diagnostics.push({ actionId: action.id, reason: validation.reason })
      } else if (candidate !== undefined && candidate !== null) {
        diagnostics.push({ actionId: action.id, reason: "Invalid stored binding" })
      }
    }
    for (const actionId of Object.keys(raw.bindings as Record<string, unknown>)) {
      if (!getShortcutAction(actionId as ShortcutActionId)) {
        diagnostics.push({ actionId, reason: "Unknown shortcut action" })
        const candidate = (raw.bindings as Record<string, unknown>)[actionId]
        if (actionId.length <= 100 && candidate === null) bindings[actionId] = null
        if (actionId.length <= 100 && typeof candidate === "string" && candidate.length <= 100) {
          const validation = validateHotkey(candidate, platform)
          if (validation.valid) bindings[actionId] = validation.hotkey
        }
      }
    }
  } else if (raw.bindings !== undefined) {
    diagnostics.push({ actionId: "config", reason: "Invalid bindings map" })
  }
  return { config: { version: 2, bindings }, diagnostics }
}

export function migrateHotkeysConfig(
  value: unknown,
  platform = getShortcutPlatform(),
): CustomHotkeysConfig {
  return parseHotkeysConfig(value, platform).config
}

export function detectConflicts(
  config: CustomHotkeysConfig | unknown,
  platform = getShortcutPlatform(),
): Map<ShortcutActionId, ShortcutConflict> {
  const conflicts = new Map<ShortcutActionId, ShortcutConflict>()
  const byHotkey = new Map<string, ShortcutActionId[]>()
  const safeConfig = migrateHotkeysConfig(config, platform)
  for (const action of ALL_SHORTCUT_ACTIONS) {
    const hotkey = getResolvedHotkey(action.id, safeConfig, platform)
    const activeBindings = [
      hotkey,
      action.altKeys ? keysToHotkeyString(action.altKeys) : null,
    ].filter((binding): binding is string => Boolean(binding))
    for (const binding of activeBindings) {
      byHotkey.set(binding, [...(byHotkey.get(binding) ?? []), action.id])
    }
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

export function buildShortcutState(value: unknown, platform = getShortcutPlatform()) {
  const parsed = parseHotkeysConfig(value, platform)
  const conflicts = detectConflicts(parsed.config, platform)
  return {
    platform,
    config: parsed.config,
    diagnostics: parsed.diagnostics,
    actions: ALL_SHORTCUT_ACTIONS.filter(
      (action) => action.defaults[platform] !== null || action.editable,
    ).map((action) => ({
      id: action.id,
      label: action.label,
      editable: action.editable,
      dispatch: action.dispatch,
      focusPolicy: action.focusPolicy,
      defaultBinding: action.defaults[platform],
      resolvedBinding: getResolvedHotkey(action.id, parsed.config, platform),
      conflictWith: conflicts.get(action.id)?.conflictingActionIds ?? [],
    })),
  }
}

export function mutateShortcutConfig(
  value: unknown,
  input: {
    operation: "set" | "reset" | "reset-all"
    actionId?: string
    hotkey?: string
  },
  platform = getShortcutPlatform(),
):
  | { ok: true; config: CustomHotkeysConfig }
  | { ok: false; config: CustomHotkeysConfig; error: string } {
  const config = migrateHotkeysConfig(value, platform)
  if (input.operation === "reset-all") return { ok: true, config: { version: 2, bindings: {} } }

  const action = input.actionId ? getShortcutAction(input.actionId as ShortcutActionId) : undefined
  if (!action) return { ok: false, config, error: "Unknown shortcut action" }
  if (!action.editable) return { ok: false, config, error: "Shortcut is not editable" }

  if (input.operation === "reset") {
    const { [action.id]: _removed, ...bindings } = config.bindings
    return { ok: true, config: { version: 2, bindings } }
  }

  if (typeof input.hotkey !== "string") {
    return { ok: false, config, error: "A shortcut binding is required" }
  }
  const validation = validateHotkey(input.hotkey, platform)
  if (!validation.valid) return { ok: false, config, error: validation.reason }
  const candidate = {
    version: 2 as const,
    bindings: { ...config.bindings, [action.id]: validation.hotkey },
  }
  const conflict = detectConflicts(candidate, platform).get(action.id)
  if (conflict) {
    const other = getShortcutAction(conflict.conflictingActionIds[0])
    return {
      ok: false,
      config,
      error: `${other?.label ?? "Another action"} already uses this shortcut`,
    }
  }
  return { ok: true, config: candidate }
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

export function keyToDisplay(
  key: string,
  platform: ShortcutPlatform = getShortcutPlatform(),
): string {
  const normalized = key.toLowerCase()
  if (platform !== "darwin") {
    if (normalized === "cmd") return "Win"
    if (normalized === "ctrl") return "Ctrl"
    if (normalized === "opt") return "Alt"
    if (normalized === "shift") return "Shift"
  }
  return KEY_DISPLAY_MAP[normalized] ?? key.toUpperCase()
}

export function hotkeyToDisplay(
  hotkey: string,
  platform: ShortcutPlatform = getShortcutPlatform(),
): string {
  return hotkeyStringToKeys(hotkey)
    .map((key) => keyToDisplay(key, platform))
    .join(platform === "darwin" ? "" : "+")
}

export function keysToDisplay(keys: string[]): string {
  const platform = getShortcutPlatform()
  return keys.map((key) => keyToDisplay(key, platform)).join(platform === "darwin" ? "" : "+")
}

export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  general: "General",
  workspaces: "Chats",
  agents: "Agents",
}
