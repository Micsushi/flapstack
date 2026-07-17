import { contextBridge, ipcRenderer, webUtils } from "electron"
import { exposeElectronTRPC } from "trpc-electron/main"
import {
  parseProductMcpRendererInvalidation,
  PRODUCT_MCP_INVALIDATION_CHANNEL,
  type ProductMcpRendererInvalidation,
} from "../shared/product-mcp-invalidation"
import {
  DEV_RENDERER_CONTROL_REQUEST_CHANNEL,
  DEV_RENDERER_CONTROL_RESPONSE_CHANNEL,
  DEV_MCP_SETTINGS_INVALIDATION_CHANNEL,
  parseDevRendererControlRequest,
  parseDevRendererControlResponse,
  parseDevMcpSettingsInvalidation,
  type DevMcpSettingsInvalidation,
  type DevRendererControlRequest,
  type DevRendererControlResponse,
} from "../shared/dev-renderer-control"
import { DEV_AGENT_INPUT_CHANNEL, type DevAgentInputPayload } from "../shared/dev-agent-input"
import {
  DEV_TEST_CONTROL_VIEW_CHANNEL,
  type DevTestControlViewPayload,
} from "../shared/dev-test-control"
import type {
  WorkspaceOwnershipInvalidation,
  WorkspacePaneClaimResult,
  WorkspacePaneOpenResult,
  WorkspacePaneWindowTarget,
  WorkspaceWindowOpenTarget,
} from "../shared/workspace-window-ownership"

// Only initialize Sentry in production to avoid IPC errors in dev mode
if (process.env.NODE_ENV === "production") {
  import("@sentry/electron/renderer").then((Sentry) => {
    Sentry.init()
  })
}

// Expose tRPC IPC bridge for type-safe communication
exposeElectronTRPC()

// Expose webUtils for file path access in drag and drop
contextBridge.exposeInMainWorld("webUtils", {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})

// Expose analytics force flag for testing
if (process.env.FORCE_ANALYTICS === "true") {
  contextBridge.exposeInMainWorld("__FORCE_ANALYTICS__", true)
}

// Expose desktop-specific APIs
contextBridge.exposeInMainWorld("desktopApi", {
  // Platform info
  platform: process.platform,
  arch: process.arch,
  getVersion: () => ipcRenderer.invoke("app:version"),
  isPackaged: () => ipcRenderer.invoke("app:isPackaged"),

  // Window controls
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowMaximize: () => ipcRenderer.invoke("window:maximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  windowIsMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  windowToggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  windowIsFullscreen: () => ipcRenderer.invoke("window:is-fullscreen"),
  setTrafficLightVisibility: (visible: boolean) =>
    ipcRenderer.invoke("window:set-traffic-light-visibility", visible),

  // Windows-specific: Frame preference (native vs frameless)
  setWindowFramePreference: (useNativeFrame: boolean) =>
    ipcRenderer.invoke("window:set-frame-preference", useNativeFrame),
  getWindowFrameState: () => ipcRenderer.invoke("window:get-frame-state"),

  // Window events
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
    const handler = (_event: unknown, isFullscreen: boolean) => callback(isFullscreen)
    ipcRenderer.on("window:fullscreen-change", handler)
    return () => ipcRenderer.removeListener("window:fullscreen-change", handler)
  },
  onFocusChange: (callback: (isFocused: boolean) => void) => {
    const handler = (_event: unknown, isFocused: boolean) => callback(isFocused)
    ipcRenderer.on("window:focus-change", handler)
    return () => ipcRenderer.removeListener("window:focus-change", handler)
  },

  // Zoom controls
  zoomIn: () => ipcRenderer.invoke("window:zoom-in"),
  zoomOut: () => ipcRenderer.invoke("window:zoom-out"),
  zoomReset: () => ipcRenderer.invoke("window:zoom-reset"),
  getZoom: () => ipcRenderer.invoke("window:get-zoom"),

  // Multi-window
  newWindow: (options?: { chatId?: string; subChatId?: string }) =>
    ipcRenderer.invoke("window:new", options) as Promise<{ blocked: boolean } | void>,
  setWindowTitle: (title: string) => ipcRenderer.invoke("window:set-title", title),

  // Chat ownership - prevent same chat open in multiple windows
  claimChat: (chatId: string) =>
    ipcRenderer.invoke("chat:claim", chatId) as Promise<
      { ok: true } | { ok: false; ownerStableId: string }
    >,
  releaseChat: (chatId: string) => ipcRenderer.invoke("chat:release", chatId) as Promise<void>,
  focusChatOwner: (chatId: string) =>
    ipcRenderer.invoke("chat:focus-owner", chatId) as Promise<boolean>,

  openWorkspacePane: (target: WorkspacePaneWindowTarget) =>
    ipcRenderer.invoke("workspace-window:open-pane", target) as Promise<WorkspacePaneOpenResult>,
  openWorkspaceWindow: (target: WorkspaceWindowOpenTarget) =>
    ipcRenderer.invoke(
      "workspace-window:open-workspace",
      target,
    ) as Promise<WorkspacePaneOpenResult>,
  claimWorkspacePane: (target: WorkspacePaneWindowTarget, mode: "claim" | "move" = "claim") =>
    ipcRenderer.invoke("workspace-window:claim-pane", {
      ...target,
      mode,
    }) as Promise<WorkspacePaneClaimResult>,
  releaseWorkspacePane: (target: WorkspacePaneWindowTarget) =>
    ipcRenderer.invoke("workspace-window:release-pane", target) as Promise<void>,
  focusWorkspacePaneOwner: (workspaceId: string, paneId: string) =>
    ipcRenderer.invoke("workspace-window:focus-pane-owner", {
      workspaceId,
      paneId,
    }) as Promise<boolean>,
  pullBackWorkspacePane: (workspaceId: string, paneId: string) =>
    ipcRenderer.invoke("workspace-window:pull-back-pane", {
      workspaceId,
      paneId,
    }) as Promise<WorkspacePaneClaimResult>,
  openWorkspaceRemainder: (input: {
    projectId?: string
    workspaceId: string
    skipPaneId: string
  }) =>
    ipcRenderer.invoke(
      "workspace-window:open-remainder",
      input,
    ) as Promise<WorkspacePaneOpenResult>,
  onWorkspaceOwnershipChanged: (callback: (payload: WorkspaceOwnershipInvalidation) => void) => {
    const handler = (_event: unknown, payload: WorkspaceOwnershipInvalidation) => callback(payload)
    ipcRenderer.on("workspace-window:ownership-changed", handler)
    return () => ipcRenderer.removeListener("workspace-window:ownership-changed", handler)
  },

  // DevTools
  toggleDevTools: () => ipcRenderer.invoke("window:toggle-devtools"),
  unlockDevTools: () => ipcRenderer.invoke("window:unlock-devtools"),

  // Analytics
  setAnalyticsOptOut: (optedOut: boolean) => ipcRenderer.invoke("analytics:set-opt-out", optedOut),

  // Native features
  setBadge: (count: number | null) => ipcRenderer.invoke("app:set-badge", count),
  setBadgeIcon: (imageData: string | null) => ipcRenderer.invoke("app:set-badge-icon", imageData),
  showNotification: (options: {
    title: string
    body: string
    chatId?: string
    subChatId?: string
  }) => ipcRenderer.invoke("app:show-notification", options),
  onNotificationClicked: (callback: (payload: { chatId?: string; subChatId?: string }) => void) => {
    const handler = (_event: unknown, payload: { chatId?: string; subChatId?: string }) =>
      callback(payload)
    ipcRenderer.on("app:notification-clicked", handler)
    return () => ipcRenderer.removeListener("app:notification-clicked", handler)
  },
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),

  // API base URL (for fetch requests to server)
  getApiBaseUrl: () => ipcRenderer.invoke("app:get-api-base-url"),

  // Clipboard
  clipboardWrite: (text: string) => ipcRenderer.invoke("clipboard:write", text),
  clipboardRead: () => ipcRenderer.invoke("clipboard:read"),

  // Save file with native dialog
  saveFile: (options: {
    base64Data: string
    filename: string
    filters?: { name: string; extensions: string[] }[]
  }) =>
    ipcRenderer.invoke("dialog:save-file", options) as Promise<{
      success: boolean
      filePath?: string
    }>,

  // Auth methods
  getUser: () => ipcRenderer.invoke("auth:get-user"),
  isAuthenticated: () => ipcRenderer.invoke("auth:is-authenticated"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  updateUser: (updates: { name?: string }) => ipcRenderer.invoke("auth:update-user", updates),

  // Shortcut events (from main process menu accelerators)
  onShortcutNewAgent: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on("shortcut:new-agent", handler)
    return () => ipcRenderer.removeListener("shortcut:new-agent", handler)
  },
  onShortcutOpenSettings: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on("shortcut:open-settings", handler)
    return () => ipcRenderer.removeListener("shortcut:open-settings", handler)
  },
  onDevMcpViewChanged: (callback: (payload: DevTestControlViewPayload) => void) => {
    const handler = (_event: unknown, payload: DevTestControlViewPayload) => callback(payload)
    ipcRenderer.on(DEV_TEST_CONTROL_VIEW_CHANNEL, handler)
    return () => ipcRenderer.removeListener(DEV_TEST_CONTROL_VIEW_CHANNEL, handler)
  },
  onDevMcpAgentInput: (callback: (payload: DevAgentInputPayload) => void) => {
    const handler = (_event: unknown, payload: DevAgentInputPayload) => callback(payload)
    ipcRenderer.on(DEV_AGENT_INPUT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(DEV_AGENT_INPUT_CHANNEL, handler)
  },
  onDevMcpSettingsChanged: (callback: (payload: DevMcpSettingsInvalidation) => void) => {
    const handler = (_event: unknown, raw: unknown) => {
      const payload = parseDevMcpSettingsInvalidation(raw)
      if (payload) callback(payload)
    }
    ipcRenderer.on(DEV_MCP_SETTINGS_INVALIDATION_CHANNEL, handler)
    return () => ipcRenderer.removeListener(DEV_MCP_SETTINGS_INVALIDATION_CHANNEL, handler)
  },
  onDevRendererControlRequest: (callback: (payload: DevRendererControlRequest) => void) => {
    const handler = (_event: unknown, raw: unknown) => {
      const payload = parseDevRendererControlRequest(raw)
      if (payload) callback(payload)
    }
    ipcRenderer.on(DEV_RENDERER_CONTROL_REQUEST_CHANNEL, handler)
    return () => ipcRenderer.removeListener(DEV_RENDERER_CONTROL_REQUEST_CHANNEL, handler)
  },
  respondDevRendererControl: (response: DevRendererControlResponse) => {
    const safeResponse = parseDevRendererControlResponse(response)
    if (safeResponse) ipcRenderer.send(DEV_RENDERER_CONTROL_RESPONSE_CHANNEL, safeResponse)
  },
  onProductMcpInvalidation: (callback: (payload: ProductMcpRendererInvalidation) => void) => {
    const handler = (_event: unknown, raw: unknown) => {
      const payload = parseProductMcpRendererInvalidation(raw)
      if (payload) callback(payload)
    }
    ipcRenderer.on(PRODUCT_MCP_INVALIDATION_CHANNEL, handler)
    return () => ipcRenderer.removeListener(PRODUCT_MCP_INVALIDATION_CHANNEL, handler)
  },

  // File change events (from Claude Write/Edit tools)
  onFileChanged: (
    callback: (data: { filePath: string; type: string; subChatId: string }) => void,
  ) => {
    const handler = (
      _event: unknown,
      data: { filePath: string; type: string; subChatId: string },
    ) => callback(data)
    ipcRenderer.on("file-changed", handler)
    return () => ipcRenderer.removeListener("file-changed", handler)
  },

  // Git status change events (from file watcher)
  onGitStatusChanged: (
    callback: (data: {
      worktreePath: string
      changes: Array<{ path: string; type: "add" | "change" | "unlink" }>
    }) => void,
  ) => {
    const handler = (
      _event: unknown,
      data: {
        worktreePath: string
        changes: Array<{ path: string; type: "add" | "change" | "unlink" }>
      },
    ) => callback(data)
    ipcRenderer.on("git:status-changed", handler)
    return () => ipcRenderer.removeListener("git:status-changed", handler)
  },

  // Worktree setup failure events
  onWorktreeSetupFailed: (
    callback: (data: {
      kind: "create-failed" | "setup-failed"
      message: string
      projectId: string
    }) => void,
  ) => {
    const handler = (
      _event: unknown,
      data: { kind: "create-failed" | "setup-failed"; message: string; projectId: string },
    ) => callback(data)
    ipcRenderer.on("worktree:setup-failed", handler)
    return () => ipcRenderer.removeListener("worktree:setup-failed", handler)
  },

  // Subscribe to git watcher for a worktree (from renderer)
  subscribeToGitWatcher: (worktreePath: string) =>
    ipcRenderer.invoke("git:subscribe-watcher", worktreePath),
  unsubscribeFromGitWatcher: (worktreePath: string) =>
    ipcRenderer.invoke("git:unsubscribe-watcher", worktreePath),

  // VS Code theme scanning
  scanVSCodeThemes: () => ipcRenderer.invoke("vscode:scan-themes"),
  loadVSCodeTheme: (themePath: string) => ipcRenderer.invoke("vscode:load-theme", themePath),
})

// Type definitions
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

export type EditorSource = "vscode" | "vscode-insiders" | "cursor" | "windsurf"

export interface DiscoveredTheme {
  id: string
  name: string
  type: "light" | "dark"
  extensionId: string
  extensionName: string
  path: string
  source: EditorSource
}

export interface VSCodeThemeData {
  id: string
  name: string
  type: "light" | "dark"
  colors: Record<string, string>
  tokenColors?: any[]
  semanticHighlighting?: boolean
  semanticTokenColors?: Record<string, any>
  source: "imported"
  path: string
}

export interface DesktopApi {
  platform: NodeJS.Platform
  arch: string
  getVersion: () => Promise<string>
  isPackaged: () => Promise<boolean>
  // Window controls
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  windowToggleFullscreen: () => Promise<void>
  windowIsFullscreen: () => Promise<boolean>
  setTrafficLightVisibility: (visible: boolean) => Promise<void>
  // Windows-specific frame preference
  setWindowFramePreference: (useNativeFrame: boolean) => Promise<boolean>
  getWindowFrameState: () => Promise<boolean>
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void
  onFocusChange: (callback: (isFocused: boolean) => void) => () => void
  zoomIn: () => Promise<void>
  zoomOut: () => Promise<void>
  zoomReset: () => Promise<void>
  getZoom: () => Promise<number>
  // Multi-window
  newWindow: (options?: {
    chatId?: string
    subChatId?: string
  }) => Promise<{ blocked: boolean } | void>
  setWindowTitle: (title: string) => Promise<void>
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
  toggleDevTools: () => Promise<void>
  unlockDevTools: () => Promise<void>
  setAnalyticsOptOut: (optedOut: boolean) => Promise<void>
  setBadge: (count: number | null) => Promise<void>
  setBadgeIcon: (imageData: string | null) => Promise<void>
  showNotification: (options: {
    title: string
    body: string
    chatId?: string
    subChatId?: string
  }) => Promise<void>
  onNotificationClicked: (
    callback: (payload: { chatId?: string; subChatId?: string }) => void,
  ) => () => void
  openExternal: (url: string) => Promise<void>
  getApiBaseUrl: () => Promise<string>
  clipboardWrite: (text: string) => Promise<void>
  clipboardRead: () => Promise<string>
  saveFile: (options: {
    base64Data: string
    filename: string
    filters?: { name: string; extensions: string[] }[]
  }) => Promise<{ success: boolean; filePath?: string }>
  // Auth
  getUser: () => Promise<{
    id: string
    email: string
    name: string | null
    imageUrl: string | null
    username: string | null
  } | null>
  isAuthenticated: () => Promise<boolean>
  logout: () => Promise<void>
  updateUser: (updates: { name?: string }) => Promise<{
    id: string
    email: string
    name: string | null
    imageUrl: string | null
    username: string | null
  } | null>
  // Shortcuts
  onShortcutNewAgent: (callback: () => void) => () => void
  onShortcutOpenSettings: (callback: () => void) => () => void
  onDevRendererControlRequest: (
    callback: (payload: DevRendererControlRequest) => void,
  ) => () => void
  respondDevRendererControl: (response: DevRendererControlResponse) => void
  onDevMcpSettingsChanged: (callback: (payload: DevMcpSettingsInvalidation) => void) => () => void
  onDevMcpViewChanged: (callback: (payload: DevTestControlViewPayload) => void) => () => void
  onDevMcpAgentInput: (callback: (payload: DevAgentInputPayload) => void) => () => void
  onProductMcpInvalidation: (
    callback: (payload: ProductMcpRendererInvalidation) => void,
  ) => () => void
  // File changes
  onFileChanged: (
    callback: (data: { filePath: string; type: string; subChatId: string }) => void,
  ) => () => void
  // Git status changes (from file watcher)
  onGitStatusChanged: (
    callback: (data: {
      worktreePath: string
      changes: Array<{ path: string; type: "add" | "change" | "unlink" }>
    }) => void,
  ) => () => void
  subscribeToGitWatcher: (
    worktreePath: string,
  ) => Promise<{ status: "subscribed" } | { status: "blocked"; reason: string }>
  unsubscribeFromGitWatcher: (worktreePath: string) => Promise<void>
  // VS Code theme scanning
  scanVSCodeThemes: () => Promise<DiscoveredTheme[]>
  loadVSCodeTheme: (themePath: string) => Promise<VSCodeThemeData>
}

declare global {
  interface Window {
    desktopApi: DesktopApi
    webUtils: {
      getPathForFile: (file: File) => string
    }
  }
}
