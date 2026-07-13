export interface UpdateInfo {
  version: string
  releaseDate?: string
}

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface DesktopUser {
  id: string
  email: string
  name: string | null
  imageUrl: string | null
  username: string | null
}

export interface WorktreeSetupFailurePayload {
  kind: "create-failed" | "setup-failed"
  message: string
  projectId: string
}

export interface NotificationNavigationPayload {
  chatId?: string
  subChatId?: string
}

export interface DesktopNotificationOptions extends NotificationNavigationPayload {
  title: string
  body: string
}

export interface DesktopApi {
  // Platform info
  platform: NodeJS.Platform
  arch: string
  getVersion: () => Promise<string>

  // Window controls
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  windowToggleFullscreen: () => Promise<void>
  windowIsFullscreen: () => Promise<boolean>
  setTrafficLightVisibility: (visible: boolean) => Promise<void>
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void
  onFocusChange: (callback: (isFocused: boolean) => void) => () => void

  // Zoom
  zoomIn: () => Promise<void>
  zoomOut: () => Promise<void>
  zoomReset: () => Promise<void>
  getZoom: () => Promise<number>

  // DevTools
  toggleDevTools: () => Promise<void>

  // Analytics
  setAnalyticsOptOut: (optedOut: boolean) => Promise<void>

  // Native features
  setBadge: (count: number | null) => Promise<void>
  showNotification: (options: DesktopNotificationOptions) => Promise<void>
  onNotificationClicked: (callback: (payload: NotificationNavigationPayload) => void) => () => void
  openExternal: (url: string) => Promise<void>
  getApiBaseUrl: () => Promise<string>

  // Clipboard
  clipboardWrite: (text: string) => Promise<void>
  clipboardRead: () => Promise<string>

  // Auth
  getUser: () => Promise<DesktopUser | null>
  isAuthenticated: () => Promise<boolean>
  logout: () => Promise<void>
  updateUser: (updates: { name?: string }) => Promise<DesktopUser | null>

  // Multi-window
  newWindow: (options?: {
    chatId?: string
    subChatId?: string
  }) => Promise<{ blocked: boolean } | void>

  // Chat ownership - prevent same chat open in multiple windows
  claimChat: (chatId: string) => Promise<{ ok: true } | { ok: false; ownerStableId: string }>
  releaseChat: (chatId: string) => Promise<void>
  focusChatOwner: (chatId: string) => Promise<boolean>

  // Shortcuts
  onShortcutNewAgent: (callback: () => void) => () => void
  onDevMcpChatsChanged: (
    callback: (payload: { action: "created" | "archived"; chatId: string }) => void,
  ) => () => void

  // Worktree setup failures
  onWorktreeSetupFailed: (callback: (payload: WorktreeSetupFailurePayload) => void) => () => void
}

declare global {
  interface Window {
    desktopApi: DesktopApi
  }
}
