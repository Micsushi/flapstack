import type {
  DevMcpSettingsInvalidation,
  DevRendererControlRequest,
  DevRendererControlResponse,
} from "../shared/dev-renderer-control"
import type {
  WorkspaceOwnershipInvalidation,
  WorkspacePaneClaimResult,
  WorkspacePaneOpenResult,
  WorkspacePaneWindowTarget,
  WorkspaceWindowOpenTarget,
} from "../shared/workspace-window-ownership"

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

export interface ProductMcpRendererInvalidation {
  version: 1
  source: "product-mcp"
  domains: Array<
    | "projects"
    | "tasks"
    | "chats"
    | "runs"
    | "attachments"
    | "approvals"
    | "audit"
    | "orchestrations"
  >
  chatIds?: string[]
  runIds?: string[]
  projectIds?: string[]
  taskIds?: string[]
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
  openWorkspacePane: (target: WorkspacePaneWindowTarget) => Promise<WorkspacePaneOpenResult>
  openWorkspaceWindow: (target: WorkspaceWindowOpenTarget) => Promise<WorkspacePaneOpenResult>
  claimWorkspacePane: (
    target: WorkspacePaneWindowTarget,
    mode?: "claim" | "move",
  ) => Promise<WorkspacePaneClaimResult>
  releaseWorkspacePane: (target: WorkspacePaneWindowTarget) => Promise<void>
  focusWorkspacePaneOwner: (workspaceId: string, paneId: string) => Promise<boolean>
  pullBackWorkspacePane: (workspaceId: string, paneId: string) => Promise<WorkspacePaneClaimResult>
  openWorkspaceRemainder: (input: {
    projectId?: string
    workspaceId: string
    skipPaneId: string
  }) => Promise<WorkspacePaneOpenResult>
  onWorkspaceOwnershipChanged: (
    callback: (payload: WorkspaceOwnershipInvalidation) => void,
  ) => () => void

  // Shortcuts
  onShortcutNewAgent: (callback: () => void) => () => void
  onShortcutOpenSettings: (callback: () => void) => () => void
  onDevRendererControlRequest: (
    callback: (payload: DevRendererControlRequest) => void,
  ) => () => void
  respondDevRendererControl: (response: DevRendererControlResponse) => void
  onDevMcpViewChanged: (
    callback: (payload: import("../shared/dev-test-control").DevTestControlViewPayload) => void,
  ) => () => void
  onDevMcpAgentInput: (
    callback: (payload: import("../shared/dev-agent-input").DevAgentInputPayload) => void,
  ) => () => void
  onDevMcpSettingsChanged: (callback: (payload: DevMcpSettingsInvalidation) => void) => () => void
  onProductMcpInvalidation: (
    callback: (payload: ProductMcpRendererInvalidation) => void,
  ) => () => void

  // Worktree setup failures
  onWorktreeSetupFailed: (callback: (payload: WorktreeSetupFailurePayload) => void) => () => void
}

declare global {
  interface Window {
    desktopApi: DesktopApi
  }
}
