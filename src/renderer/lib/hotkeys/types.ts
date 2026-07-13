export type ShortcutActionId =
  | "show-shortcuts"
  | "open-settings"
  | "toggle-sidebar"
  | "new-workspace"
  | "new-agent"
  | "archive-agent"
  | "stop-generation"
  | "toggle-details"
  | "toggle-terminal"
  | "open-diff"
  | "search-in-chat"
  | "open-kanban"
  | "file-search"
  | "open-in-editor"
  | "open-file-in-editor"
  | "voice-input"

export type ShortcutCategory = "general" | "workspaces" | "agents"
export type ShortcutPlatform = "darwin" | "win32" | "linux"
export type ShortcutFocusPolicy = "global" | "workspace"
export type ShortcutDispatch = "renderer" | "native" | "local"

export interface ShortcutAction {
  id: ShortcutActionId
  actionId: string
  label: string
  description: string
  category: ShortcutCategory
  defaults: Record<ShortcutPlatform, string | null>
  editable: boolean
  focusPolicy: ShortcutFocusPolicy
  dispatch: ShortcutDispatch
  conflictGroup: "app"
  availability?: "always" | "kanban"
  reservedReason?: string
  altKeys?: string[]
}

export interface CustomHotkeysConfig {
  version: 1 | 2
  bindings: Record<string, string | null>
}

export interface ShortcutConflict {
  actionId: ShortcutActionId
  conflictingActionIds: ShortcutActionId[]
  hotkey: string
}

export type ShortcutValidationResult =
  { valid: true; hotkey: string } | { valid: false; reason: string }
