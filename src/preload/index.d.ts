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
import type {
  WorkbenchWindowCreationBlocked,
  WorkbenchNewWindowResult,
} from "../shared/workbench-window-budget"
import type {
  ChatTransferCommit,
  ChatTransferDestinationReady,
  ChatTransferDropExisting,
  ChatTransferDropOutside,
  ChatTransferOffer,
  ChatTransferOpenNew,
  ChatTransferOpenNewResult,
  ChatTransferRemoveSource,
  ChatTransferReserve,
  ChatTransferResult,
  ChatTransferStart,
  ChatTransferStartResult,
  ChatTransferWindowDestination,
} from "../shared/chat-window-transfer"
import type { ChatWorkbenchSessionPresentation } from "../shared/chat-workbench"
import type { AppCommand } from "../shared/app-command"

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
  undo: () => Promise<void>
  redo: () => Promise<void>
  showApplicationMenu: (menu: "File" | "Edit" | "View" | "Help") => Promise<boolean>
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
  getAnalyticsConsent: () => Promise<boolean>
  setAnalyticsOptOut: (optedOut: boolean) => Promise<void>
  captureAnalyticsEvent: (eventName: string, properties?: Record<string, unknown>) => Promise<void>
  onAnalyticsConsentChanged: (callback: (consentGranted: boolean) => void) => () => void
  onFeatureVisibilityChanged: (callback: () => void) => () => void
  onAgentPersonalitiesChanged: (callback: () => void) => () => void

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
  }) => Promise<WorkbenchNewWindowResult | void>
  focusStableWindow: (stableId: string) => Promise<"focused" | "recovering" | "missing">
  getWorkbenchSession: () => Promise<ChatWorkbenchSessionPresentation | null>
  updateWorkbenchSessionPresentation: (input: ChatWorkbenchSessionPresentation) => Promise<boolean>
  onWorkbenchWindowCreationBlocked: (
    callback: (failure: WorkbenchWindowCreationBlocked) => void,
  ) => () => void

  // Chat ownership - prevent same chat open in multiple windows
  claimChat: (chatId: string) => Promise<{ ok: true } | { ok: false; ownerStableId: string }>
  takeChatOwnership: (
    chatId: string,
    expectedOwnerStableId: string,
  ) => Promise<{ ok: true } | { ok: false; ownerStableId: string | null }>
  releaseChat: (chatId: string) => Promise<void>
  focusChatOwner: (chatId: string) => Promise<boolean>
  startChatTransfer: (
    input: ChatTransferStart,
  ) => Promise<ChatTransferStartResult | ChatTransferResult>
  reserveChatTransfer: (input: ChatTransferReserve) => Promise<ChatTransferResult>
  getChatTransferDestinations: () => Promise<ChatTransferWindowDestination[]>
  dropChatTransferIntoCurrentWindow: (
    input: ChatTransferDropExisting,
  ) => Promise<ChatTransferOpenNewResult>
  dropChatTransferOutside: (input: ChatTransferDropOutside) => Promise<ChatTransferOpenNewResult>
  openNewChatTransfer: (input: ChatTransferOpenNew) => Promise<ChatTransferOpenNewResult>
  markChatTransferDestinationReady: (
    input: ChatTransferDestinationReady,
  ) => Promise<ChatTransferResult>
  transferChatOwnership: (input: ChatTransferCommit) => Promise<ChatTransferResult>
  commitChatTransferDestination: (input: ChatTransferCommit) => Promise<ChatTransferResult>
  commitChatTransferSource: (input: ChatTransferCommit) => Promise<ChatTransferResult>
  abortChatTransfer: (nonce: string) => Promise<ChatTransferResult>
  onChatTransferOffer: (callback: (offer: ChatTransferOffer) => void) => () => void
  onChatTransferRemoveSource: (callback: (input: ChatTransferRemoveSource) => void) => () => void
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
  onAppCommand: (callback: (command: AppCommand) => void) => () => void
  onCliOpenDirectory: (callback: () => void) => () => void
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
