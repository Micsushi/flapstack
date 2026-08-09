import {
  BrowserWindow,
  Notification,
  nativeTheme,
  ipcMain,
  app,
  clipboard,
  nativeImage,
  dialog,
  screen,
} from "electron"
import { sleep } from "../../shared/sleep"
import { join } from "path"
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs"
import { createIPCHandler } from "trpc-electron/main"
import { openExternalSafe } from "../lib/open-external"
import { broadcastAnalyticsConsent } from "../lib/analytics-consent-broadcast"
import { createAppRouter } from "../lib/trpc/routers"
import { registerGitWatcherIPC } from "../lib/git/watcher"
import { hasActiveClaudeSessions, abortAllClaudeSessions } from "../lib/trpc/routers/claude"
import { hasActiveCodexStreams, abortAllCodexStreams } from "../lib/trpc/routers/codex"
import { hasActiveCursorStreams, abortAllCursorStreams } from "../lib/trpc/routers/cursor"
import { hasActiveOpencodeStreams, abortAllOpencodeStreams } from "../lib/trpc/routers/opencode"
import { registerThemeScannerIPC } from "../lib/vscode-theme-scanner"
import type {
  WorkspacePaneWindowTarget,
  WorkspaceWindowOpenTarget,
} from "../../shared/workspace-window-ownership"
import {
  stableWorkspaceRemainderWindowId,
  stableWorkspaceRootWindowId,
  stableWorkspaceWindowId,
  windowManager,
} from "./window-manager"
import { createInitialLaunchPresentationResolver } from "./launch-presentation"
import {
  cleanupFailedWorkbenchWindowCreation,
  clampWorkbenchWindowBounds,
  createFileWorkbenchWindowSessionStorage,
  createWorkbenchWindowCreationFailure,
  type PersistedWorkbenchWindow,
  type PersistedWorkbenchWindowBounds,
  type PersistedWorkbenchWindowLaunch,
  WorkbenchWindowLimitError,
  WorkbenchWindowSessionStore,
  windowBudget,
} from "./workbench-window-budget"
import type { WorkbenchWindowCreationFailure } from "../../shared/workbench-window-budget"
import {
  chatTransferCommitSchema,
  chatTransferDestinationReadySchema,
  chatTransferDropExistingSchema,
  chatTransferDropOutsideSchema,
  chatTransferOpenNewSchema,
  chatTransferReserveSchema,
  chatTransferStartSchema,
  type ChatTransferOffer,
  type ChatTransferOpenNew,
  type ChatTransferOpenNewResult,
  toChatTransferWindowDestinations,
} from "../../shared/chat-window-transfer"
import { ChatTransferCoordinator } from "./chat-transfer-coordinator"
import {
  chatWorkbenchSessionPresentationSchema,
  collectChatGroups,
} from "../../shared/chat-workbench"
import { resolveWindowIconPath } from "./window-icon"

// Flag to bypass close confirmation when app.quit() has already been confirmed
let isQuitting = false
const resolveInitialLaunchPresentation = createInitialLaunchPresentationResolver()
let workbenchWindowSessionStore: WorkbenchWindowSessionStore | null = null
let workbenchWindowSessionWarningLogged = false
const pendingBoundsPersistence = new Map<number, NodeJS.Timeout>()
const pendingChatTransferOffers = new Map<string, ChatTransferOffer>()
const chatTransferCoordinator = new ChatTransferCoordinator({
  getOwner: (chatId) => {
    const ownerId = windowManager.getChatOwner(chatId)
    const owner = ownerId === undefined ? undefined : windowManager.get(ownerId)
    return owner ? windowManager.getStableId(owner) : null
  },
  compareAndTransfer: (chatId, expectedOwner, nextOwner) =>
    windowManager.compareAndTransferChat(chatId, expectedOwner, nextOwner).ok,
  cancelReservation: (reservationId) => {
    windowBudget.cancel(reservationId)
  },
})
const chatTransferExpiryTimer = setInterval(() => chatTransferCoordinator.sweepExpired(), 1_000)
chatTransferExpiryTimer.unref()

function offerChatTransferToWindow(
  input: Pick<
    ChatTransferOpenNew,
    "version" | "chatId" | "sourceWindowId" | "sourceGroupId" | "operation"
  >,
  destination: BrowserWindow,
  destinationGroupId: string,
  zone: "tab" | "left" | "right" | "top" | "bottom",
): ChatTransferOpenNewResult {
  const started = chatTransferCoordinator.start({
    version: input.version,
    chatId: input.chatId,
    sourceWindowId: input.sourceWindowId,
    sourceGroupId: input.sourceGroupId,
    operation: input.operation,
  })
  if (started.status !== "started") return started
  const destinationWindowId = windowManager.getStableId(destination)
  const reserved = chatTransferCoordinator.reserve({
    nonce: started.transfer.nonce,
    destinationWindowId,
    destinationGroupId,
    zone,
  })
  const offer = chatTransferCoordinator.getOffer(started.transfer.nonce)
  if (reserved.status !== "reserved" || !offer) {
    chatTransferCoordinator.fail(started.transfer.nonce, "reservation-failed")
    return { status: "creation-failed" }
  }
  destination.webContents.send("chat-transfer:offer", offer)
  return { status: "offered", nonce: started.transfer.nonce, destinationWindowId }
}

function offerChatTransferInNewWindow(input: ChatTransferOpenNew): ChatTransferOpenNewResult {
  const started = chatTransferCoordinator.start({
    version: input.version,
    chatId: input.chatId,
    sourceWindowId: input.sourceWindowId,
    sourceGroupId: input.sourceGroupId,
    operation: input.operation,
  })
  if (started.status !== "started") return started
  const creation = tryCreateWindow({ projectId: input.projectId })
  if (!creation.ok) {
    chatTransferCoordinator.fail(started.transfer.nonce, creation.reason)
    return creation.reason === "window-limit"
      ? {
          status: "at-limit",
          destinations: chatTransferWindowDestinations(creation.destinations),
        }
      : { status: creation.reason }
  }
  const destinationWindowId = windowManager.getStableId(creation.window)
  const reserved = chatTransferCoordinator.reserve({
    nonce: started.transfer.nonce,
    destinationWindowId,
    destinationGroupId: input.destinationGroupId,
    zone: input.zone,
  })
  const offer = chatTransferCoordinator.getOffer(started.transfer.nonce)
  if (reserved.status !== "reserved" || !offer) {
    creation.window.destroy()
    chatTransferCoordinator.fail(started.transfer.nonce, "reservation-failed")
    return { status: "creation-failed" }
  }
  pendingChatTransferOffers.set(destinationWindowId, offer)
  return { status: "offered", nonce: started.transfer.nonce, destinationWindowId }
}

function getWorkbenchWindowSessionStore(): WorkbenchWindowSessionStore {
  workbenchWindowSessionStore ??= new WorkbenchWindowSessionStore(
    createFileWorkbenchWindowSessionStorage(
      join(app.getPath("userData"), "workbench-windows.json"),
    ),
  )
  return workbenchWindowSessionStore
}

function chatTransferWindowDestinations(
  destinations: readonly {
    stableId: string
    label: string
    state: "available" | "recovering"
  }[],
) {
  return toChatTransferWindowDestinations(destinations).map((destination) => {
    try {
      const session = getWorkbenchWindowSessionStore().get(destination.stableId)
      if (!session?.layout) return destination
      return {
        ...destination,
        groups: collectChatGroups(session.layout.root).map((group, index) => ({
          id: group.id,
          label: `Group ${index + 1}`,
        })),
      }
    } catch {
      return destination
    }
  })
}

function safelyPersistWorkbenchWindow(
  operation: (store: WorkbenchWindowSessionStore) => void,
): boolean {
  try {
    operation(getWorkbenchWindowSessionStore())
    return true
  } catch (error) {
    if (!workbenchWindowSessionWarningLogged) {
      workbenchWindowSessionWarningLogged = true
      console.warn("[Main] Workbench window session state was preserved without mutation:", error)
    }
    return false
  }
}

function hasActiveAgentSessions(): boolean {
  return (
    hasActiveClaudeSessions() ||
    hasActiveCodexStreams() ||
    hasActiveCursorStreams() ||
    hasActiveOpencodeStreams()
  )
}

function abortAllAgentSessions(): void {
  abortAllClaudeSessions()
  abortAllCodexStreams()
  abortAllCursorStreams()
  abortAllOpencodeStreams()
}

export function setIsQuitting(value: boolean): void {
  isQuitting = value
}

// Helper to get window from IPC event
function getWindowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  const webContents = event.sender
  const win = BrowserWindow.fromWebContents(webContents)
  return win && !win.isDestroyed() ? win : null
}

interface DesktopNotificationOptions {
  title: string
  body: string
  chatId?: string
  subChatId?: string
}

// Register IPC handlers for window operations (only once)
let ipcHandlersRegistered = false

function registerIpcHandlers(): void {
  if (ipcHandlersRegistered) return
  ipcHandlersRegistered = true

  ipcMain.on("chat-transfer:renderer-ready", (event) => {
    const destination = getWindowFromEvent(event)
    if (!destination) return
    const destinationWindowId = windowManager.getStableId(destination)
    const offer = pendingChatTransferOffers.get(destinationWindowId)
    if (!offer) return
    pendingChatTransferOffers.delete(destinationWindowId)
    destination.webContents.send("chat-transfer:offer", offer)
  })

  // App info
  ipcMain.handle("app:version", () => app.getVersion())
  ipcMain.handle("app:isPackaged", () => app.isPackaged)

  // Windows: Frame preference persistence
  ipcMain.handle("window:set-frame-preference", (_event, useNativeFrame: boolean) => {
    try {
      const settingsPath = join(app.getPath("userData"), "window-settings.json")
      const settingsDir = app.getPath("userData")
      mkdirSync(settingsDir, { recursive: true })
      writeFileSync(settingsPath, JSON.stringify({ useNativeFrame }, null, 2))
      return true
    } catch (error) {
      console.error("[Main] Failed to save frame preference:", error)
      return false
    }
  })

  // Windows: Get current window frame state
  ipcMain.handle("window:get-frame-state", () => {
    if (process.platform !== "win32") return false
    try {
      const settingsPath = join(app.getPath("userData"), "window-settings.json")
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, "utf-8"))
        return settings.useNativeFrame === true
      }
      return false // Default: frameless
    } catch {
      return false
    }
  })

  ipcMain.handle("app:set-badge", (event, count: number | null) => {
    const win = getWindowFromEvent(event)
    if (process.platform === "darwin") {
      app.dock?.setBadge(count ? String(count) : "")
    } else if (process.platform === "win32" && win) {
      // Windows: Update title with count as fallback
      if (count !== null && count > 0) {
        win.setTitle(`${app.getName()} (${count})`)
      } else {
        win.setTitle(app.getName())
        win.setOverlayIcon(null, "")
      }
    }
  })

  // Windows: Badge overlay icon
  ipcMain.handle("app:set-badge-icon", (event, imageData: string | null) => {
    const win = getWindowFromEvent(event)
    if (process.platform === "win32" && win) {
      if (imageData) {
        const image = nativeImage.createFromDataURL(imageData)
        win.setOverlayIcon(image, "New messages")
      } else {
        win.setOverlayIcon(null, "")
      }
    }
  })

  ipcMain.handle("app:show-notification", (event, options: DesktopNotificationOptions) => {
    try {
      if (!Notification.isSupported()) {
        console.warn("[Main] Notifications not supported on this system")
        return
      }

      // On macOS, the app icon is used automatically - no custom icon needed.
      // On Windows, use .ico; on Linux, use .png.
      let icon: Electron.NativeImage | undefined
      if (process.platform !== "darwin") {
        const ext = process.platform === "win32" ? "icon.ico" : "icon.png"
        const iconPath = join(__dirname, "../../build", ext)
        icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined
      }

      const notification = new Notification({
        title: options.title,
        body: options.body,
        ...(icon && { icon }),
        ...(process.platform === "win32" && { silent: false }),
      })

      notification.on("click", () => {
        const win = getWindowFromEvent(event)
        if (win) {
          if (win.isMinimized()) win.restore()
          win.focus()
        }
        if (!event.sender.isDestroyed()) {
          event.sender.send("app:notification-clicked", {
            chatId: options.chatId,
            subChatId: options.subChatId,
          })
        }
      })

      notification.show()
    } catch (error) {
      console.error("[Main] Failed to show notification:", error)
    }
  })

  // Flapstack is local-first; no hosted desktop account backend is configured.
  ipcMain.handle("app:get-api-base-url", () => "")

  // Window controls - use event.sender to identify window
  ipcMain.handle("window:minimize", (event) => {
    getWindowFromEvent(event)?.minimize()
  })
  ipcMain.handle("window:maximize", (event) => {
    const win = getWindowFromEvent(event)
    if (win?.isMaximized()) {
      win.unmaximize()
    } else {
      win?.maximize()
    }
  })
  ipcMain.handle("window:close", (event) => {
    getWindowFromEvent(event)?.close()
  })
  ipcMain.handle("window:is-maximized", (event) => {
    return getWindowFromEvent(event)?.isMaximized() ?? false
  })
  ipcMain.handle("window:toggle-fullscreen", (event) => {
    const win = getWindowFromEvent(event)
    if (win) {
      win.setFullScreen(!win.isFullScreen())
    }
  })
  ipcMain.handle("window:is-fullscreen", (event) => {
    return getWindowFromEvent(event)?.isFullScreen() ?? false
  })

  // Traffic light visibility control (for hybrid native/custom approach)
  ipcMain.handle("window:set-traffic-light-visibility", (event, visible: boolean) => {
    const win = getWindowFromEvent(event)
    if (win && process.platform === "darwin") {
      // In fullscreen, always show native traffic lights (don't let React hide them)
      if (win.isFullScreen()) {
        win.setWindowButtonVisibility(true)
      } else {
        win.setWindowButtonVisibility(visible)
      }
    }
  })

  // Zoom controls
  ipcMain.handle("window:zoom-in", (event) => {
    const win = getWindowFromEvent(event)
    if (win) {
      const zoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.min(zoom + 0.1, 3))
    }
  })
  ipcMain.handle("window:zoom-out", (event) => {
    const win = getWindowFromEvent(event)
    if (win) {
      const zoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.max(zoom - 0.1, 0.5))
    }
  })
  ipcMain.handle("window:zoom-reset", (event) => {
    getWindowFromEvent(event)?.webContents.setZoomFactor(1)
  })
  ipcMain.handle("window:get-zoom", (event) => {
    return getWindowFromEvent(event)?.webContents.getZoomFactor() ?? 1
  })
  ipcMain.handle("window:focus-stable", (_event, stableId: string) => {
    const validStableId = validRequiredId(stableId)
    return validStableId ? windowManager.focusStableWindow(validStableId) : "missing"
  })
  ipcMain.handle("workbench-session:get", (event) => {
    const window = getWindowFromEvent(event)
    if (!window) return null
    const persisted = getWorkbenchWindowSessionStore().get(windowManager.getStableId(window))
    if (!persisted?.layout) return null
    return {
      layout: persisted.layout,
      compact: persisted.compact ?? false,
      draftRefs: persisted.draftRefs ?? {},
      scrollAnchorRefs: persisted.scrollAnchorRefs ?? {},
    }
  })
  ipcMain.handle("workbench-session:update-presentation", (event, raw: unknown) => {
    const window = getWindowFromEvent(event)
    const parsed = chatWorkbenchSessionPresentationSchema.safeParse(raw)
    if (!window || !parsed.success) return false
    let updated = false
    const persisted = safelyPersistWorkbenchWindow((store) => {
      updated = store.updatePresentation(windowManager.getStableId(window), parsed.data)
    })
    return persisted && updated
  })

  // New window - optionally open with specific chat/subchat
  ipcMain.handle("window:new", (_event, options?: { chatId?: string; subChatId?: string }) => {
    // If chatId specified, check ownership atomically via focusChatOwner
    if (options?.chatId && windowManager.focusChatOwner(options.chatId)) {
      return { blocked: true, reason: "already-open" as const }
    }
    const creation = tryCreateWindow(options)
    if (!creation.ok) {
      return { blocked: true, ...workbenchCreationFailure(creation) }
    }

    const win = creation.window

    // Pre-claim the chat for the new window
    if (options?.chatId) {
      windowManager.claimChat(options.chatId, win.id)
    }

    return { blocked: false }
  })

  // Chat ownership - prevent same chat open in multiple windows
  ipcMain.handle("chat:claim", (event, chatId: string) => {
    const win = getWindowFromEvent(event)
    if (!win) return { ok: false, ownerStableId: "unknown" }
    return windowManager.claimChat(chatId, win.id)
  })

  ipcMain.handle("chat:take-ownership", (event, chatId: string, expectedOwnerStableId: string) => {
    const win = getWindowFromEvent(event)
    if (
      !win ||
      typeof chatId !== "string" ||
      chatId.trim().length === 0 ||
      chatId.length > 256 ||
      typeof expectedOwnerStableId !== "string" ||
      expectedOwnerStableId.trim().length === 0 ||
      expectedOwnerStableId.length > 256
    ) {
      return { ok: false, ownerStableId: null }
    }
    return windowManager.compareAndTransferChat(
      chatId,
      expectedOwnerStableId,
      windowManager.getStableId(win),
    )
  })

  ipcMain.handle("chat:release", (event, chatId: string) => {
    const win = getWindowFromEvent(event)
    if (!win) return
    windowManager.releaseChat(chatId, win.id)
  })

  ipcMain.handle("chat:focus-owner", (_event, chatId: string) => {
    return windowManager.focusChatOwner(chatId)
  })

  ipcMain.handle("chat-transfer:start", (event, raw: unknown) => {
    const source = getWindowFromEvent(event)
    const parsed = chatTransferStartSchema.safeParse(raw)
    if (!source || !parsed.success) return { status: "invalid-phase" as const }
    if (windowManager.getStableId(source) !== parsed.data.sourceWindowId) {
      return { status: "wrong-window" as const }
    }
    return chatTransferCoordinator.start(parsed.data)
  })

  ipcMain.handle("chat-transfer:reserve", (event, raw: unknown) => {
    const source = getWindowFromEvent(event)
    const parsed = chatTransferReserveSchema.safeParse(raw)
    if (!source || !parsed.success) return { status: "invalid-phase" as const }
    const offer = chatTransferCoordinator.getOffer(parsed.data.nonce)
    if (offer && offer.transfer.sourceWindowId !== windowManager.getStableId(source)) {
      return { status: "wrong-window" as const }
    }
    const result = chatTransferCoordinator.reserve(parsed.data)
    if (result.status !== "reserved") return result
    const destination = windowManager.findByStableId(parsed.data.destinationWindowId)
    const transferOffer = chatTransferCoordinator.getOffer(parsed.data.nonce)
    if (!destination || !transferOffer) {
      return chatTransferCoordinator.fail(parsed.data.nonce, "destination-unavailable")
    }
    destination.webContents.send("chat-transfer:offer", transferOffer)
    return result
  })

  ipcMain.handle("chat-transfer:destinations", (event) => {
    const source = getWindowFromEvent(event)
    if (!source) return []
    const sourceWindowId = windowManager.getStableId(source)
    return chatTransferWindowDestinations(
      windowBudget
        .inspect()
        .destinations.filter(
          (destination) =>
            destination.stableId !== sourceWindowId && destination.state === "available",
        ),
    )
  })

  ipcMain.handle("chat-transfer:drop-existing", (event, raw: unknown) => {
    const destination = getWindowFromEvent(event)
    const parsed = chatTransferDropExistingSchema.safeParse(raw)
    if (
      !destination ||
      !parsed.success ||
      windowManager.getStableId(destination) !== parsed.data.destinationWindowId ||
      parsed.data.sourceWindowId === parsed.data.destinationWindowId ||
      !windowManager.findByStableId(parsed.data.sourceWindowId)
    ) {
      return { status: "source-preserved" as const }
    }
    return offerChatTransferToWindow(
      parsed.data,
      destination,
      parsed.data.destinationGroupId,
      parsed.data.zone,
    )
  })

  ipcMain.handle("chat-transfer:drop-outside", (event, raw: unknown) => {
    const source = getWindowFromEvent(event)
    const parsed = chatTransferDropOutsideSchema.safeParse(raw)
    if (
      !source ||
      !parsed.success ||
      windowManager.getStableId(source) !== parsed.data.sourceWindowId
    ) {
      return { status: "source-preserved" as const }
    }
    const point = { x: parsed.data.screenX, y: parsed.data.screenY }
    const overRegisteredWindow = windowManager.getAll().some((window) => {
      const bounds = window.getBounds()
      return (
        point.x >= bounds.x &&
        point.x < bounds.x + bounds.width &&
        point.y >= bounds.y &&
        point.y < bounds.y + bounds.height
      )
    })
    if (overRegisteredWindow) return { status: "source-preserved" as const }
    return offerChatTransferInNewWindow(parsed.data)
  })

  ipcMain.handle("chat-transfer:open-new", (event, raw: unknown): ChatTransferOpenNewResult => {
    const source = getWindowFromEvent(event)
    const parsed = chatTransferOpenNewSchema.safeParse(raw)
    if (
      !source ||
      !parsed.success ||
      windowManager.getStableId(source) !== parsed.data.sourceWindowId
    ) {
      return { status: "creation-failed" }
    }
    return offerChatTransferInNewWindow(parsed.data)
  })

  ipcMain.handle("chat-transfer:destination-ready", (event, raw: unknown) => {
    const destination = getWindowFromEvent(event)
    const parsed = chatTransferDestinationReadySchema.safeParse(raw)
    if (!destination || !parsed.success) return { status: "invalid-phase" as const }
    if (windowManager.getStableId(destination) !== parsed.data.destinationWindowId) {
      return { status: "wrong-window" as const }
    }
    return chatTransferCoordinator.destinationReady(
      parsed.data.nonce,
      parsed.data.destinationWindowId,
    )
  })

  ipcMain.handle("chat-transfer:transfer-ownership", (event, raw: unknown) => {
    const destination = getWindowFromEvent(event)
    const parsed = chatTransferCommitSchema.safeParse(raw)
    if (
      !destination ||
      !parsed.success ||
      windowManager.getStableId(destination) !== parsed.data.windowId
    ) {
      return { status: "wrong-window" as const }
    }
    return chatTransferCoordinator.transferOwnership(parsed.data.nonce)
  })

  ipcMain.handle("chat-transfer:commit-destination", (event, raw: unknown) => {
    const destination = getWindowFromEvent(event)
    const parsed = chatTransferCommitSchema.safeParse(raw)
    if (
      !destination ||
      !parsed.success ||
      windowManager.getStableId(destination) !== parsed.data.windowId
    ) {
      return { status: "wrong-window" as const }
    }
    const result = chatTransferCoordinator.commitDestination(
      parsed.data.nonce,
      parsed.data.windowId,
    )
    if (result.status === "destination-committed" && result.removeSource) {
      windowManager
        .findByStableId(result.removeSource.sourceWindowId)
        ?.webContents.send("chat-transfer:remove-source", {
          version: 1,
          nonce: parsed.data.nonce,
          ...result.removeSource,
        })
    }
    return result
  })

  ipcMain.handle("chat-transfer:commit-source", (event, raw: unknown) => {
    const source = getWindowFromEvent(event)
    const parsed = chatTransferCommitSchema.safeParse(raw)
    if (!source || !parsed.success || windowManager.getStableId(source) !== parsed.data.windowId) {
      return { status: "wrong-window" as const }
    }
    return chatTransferCoordinator.commitSourceRemoval(parsed.data.nonce, parsed.data.windowId)
  })

  ipcMain.handle("chat-transfer:abort", (event, nonce: unknown) => {
    const participant = getWindowFromEvent(event)
    if (
      !participant ||
      typeof nonce !== "string" ||
      !chatTransferCoordinator.isParticipant(nonce, windowManager.getStableId(participant))
    ) {
      return { status: "wrong-window" as const }
    }
    return chatTransferCoordinator.fail(nonce, "renderer-abort")
  })

  ipcMain.handle("workspace-window:open-pane", (event, raw: WorkspacePaneWindowTarget) => {
    const source = getWindowFromEvent(event)
    const input = validWorkspacePaneTarget(raw)
    if (!source || !input) return ownershipFailure("unknown")

    const currentOwner = windowManager.getWorkspacePaneOwner(input.workspaceId, input.paneId)
    if (currentOwner !== undefined && currentOwner !== source.id) {
      windowManager.focusWorkspacePaneOwner(input.workspaceId, input.paneId)
      const owner = windowManager.get(currentOwner)
      return {
        ok: true as const,
        state: "focused" as const,
        ownerStableId: owner ? windowManager.getStableId(owner) : "unknown",
      }
    }

    const conflicts = windowManager.inspectWorkspacePaneClaim(
      input.workspaceId,
      input.paneId,
      input.chatIds,
      source.id,
    )
    if (conflicts.length > 0) {
      return { ok: false as const, ownerStableId: conflicts[0].ownerStableId, conflicts }
    }
    const stableWindowId = stableWorkspaceWindowId(input.workspaceId, input.paneId)
    const stableWindowState = windowManager.focusStableWindow(stableWindowId)
    if (stableWindowState === "focused") {
      return { ok: true as const, state: "focused" as const, ownerStableId: stableWindowId }
    }
    if (stableWindowState === "recovering") return ownershipRecovering(stableWindowId)
    const creation = tryCreateWindow({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      paneId: input.paneId,
      stableWindowId,
    })
    if (!creation.ok) return workbenchWindowCreationFailure(creation)
    const popout = creation.window
    const claim = windowManager.transferWorkspacePane(
      input.workspaceId,
      input.paneId,
      input.chatIds,
      source.id,
      popout.id,
      source.id,
    )
    if (!claim.ok) {
      popout.destroy()
      return claim
    }
    return { ok: true as const, state: "opened" as const, ownerStableId: stableWindowId }
  })

  ipcMain.handle("workspace-window:open-workspace", (event, raw: WorkspaceWindowOpenTarget) => {
    const source = getWindowFromEvent(event)
    const input = validWorkspaceWindowTarget(raw)
    if (!source || !input) return ownershipFailure("unknown")
    const stableWindowId = stableWorkspaceRootWindowId(input.workspaceId)
    const stableWindowState = windowManager.focusStableWindow(stableWindowId)
    if (stableWindowState === "focused") {
      return { ok: true as const, state: "focused" as const, ownerStableId: stableWindowId }
    }
    if (stableWindowState === "recovering") return ownershipRecovering(stableWindowId)

    const conflicts = input.panes.flatMap((pane) =>
      windowManager.inspectWorkspacePaneClaim(
        input.workspaceId,
        pane.paneId,
        pane.chatIds,
        source.id,
      ),
    )
    if (conflicts.length > 0) {
      return { ok: false as const, ownerStableId: conflicts[0].ownerStableId, conflicts }
    }
    const creation = tryCreateWindow({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      stableWindowId,
    })
    if (!creation.ok) return workbenchWindowCreationFailure(creation)
    const workspaceWindow = creation.window
    for (const pane of input.panes) {
      windowManager.claimWorkspacePane(
        input.workspaceId,
        pane.paneId,
        pane.chatIds,
        workspaceWindow.id,
        { move: true, returnWindowId: source.id },
      )
    }
    return { ok: true as const, state: "opened" as const, ownerStableId: stableWindowId }
  })

  ipcMain.handle(
    "workspace-window:claim-pane",
    (event, raw: WorkspacePaneWindowTarget & { mode?: "claim" | "move" }) => {
      const win = getWindowFromEvent(event)
      const input = validWorkspacePaneTarget(raw)
      if (!win || !input) return ownershipFailure("unknown")
      return windowManager.claimWorkspacePane(
        input.workspaceId,
        input.paneId,
        input.chatIds,
        win.id,
        { move: raw?.mode === "move" },
      )
    },
  )

  ipcMain.handle("workspace-window:release-pane", (event, raw: WorkspacePaneWindowTarget) => {
    const win = getWindowFromEvent(event)
    const input = validWorkspacePaneTarget(raw)
    if (!win || !input) return
    windowManager.releaseWorkspacePane(input.workspaceId, input.paneId, input.chatIds, win.id)
  })

  ipcMain.handle(
    "workspace-window:focus-pane-owner",
    (_event, raw: Pick<WorkspacePaneWindowTarget, "workspaceId" | "paneId">) => {
      const input = validWorkspacePaneIdentity(raw)
      return input ? windowManager.focusWorkspacePaneOwner(input.workspaceId, input.paneId) : false
    },
  )

  ipcMain.handle(
    "workspace-window:pull-back-pane",
    (event, raw: Pick<WorkspacePaneWindowTarget, "workspaceId" | "paneId">) => {
      const win = getWindowFromEvent(event)
      const input = validWorkspacePaneIdentity(raw)
      if (!win || !input) return ownershipFailure("unknown")
      const result = windowManager.pullBackWorkspacePane(input.workspaceId, input.paneId, win.id)
      if (result.ok) setImmediate(() => win.close())
      return result
    },
  )

  ipcMain.handle(
    "workspace-window:open-remainder",
    (event, raw: { projectId?: string; workspaceId: string; skipPaneId: string }) => {
      const source = getWindowFromEvent(event)
      const identity = validWorkspacePaneIdentity({
        workspaceId: raw?.workspaceId,
        paneId: raw?.skipPaneId,
      })
      if (!source || !identity) return { ok: false as const }
      const stableWindowId = stableWorkspaceRemainderWindowId(identity.workspaceId, identity.paneId)
      const stableWindowState = windowManager.focusStableWindow(stableWindowId)
      if (stableWindowState === "focused") {
        return { ok: true as const, state: "focused" as const, ownerStableId: stableWindowId }
      }
      if (stableWindowState === "recovering") return ownershipRecovering(stableWindowId)
      const creation = tryCreateWindow({
        projectId: validOptionalId(raw.projectId),
        workspaceId: identity.workspaceId,
        skipPaneId: identity.paneId,
        stableWindowId,
      })
      if (!creation.ok) return workbenchWindowCreationFailure(creation)
      return { ok: true as const, state: "opened" as const, ownerStableId: stableWindowId }
    },
  )

  // Set window title
  ipcMain.handle("window:set-title", (event, title: string) => {
    const win = getWindowFromEvent(event)
    if (win) {
      // Show just the title, or default app name if empty
      win.setTitle(title || app.getName())
    }
  })

  // DevTools - only allowed in dev mode or when unlocked
  ipcMain.handle("window:toggle-devtools", (event) => {
    const win = getWindowFromEvent(event)
    // Check if devtools are unlocked (or in dev mode)
    const isUnlocked = !app.isPackaged || (global as any).__devToolsUnlocked
    if (win && isUnlocked) {
      win.webContents.toggleDevTools()
    }
  })

  // Unlock DevTools (hidden feature - 5 clicks on Beta tab)
  ipcMain.handle("window:unlock-devtools", () => {
    // Mark as unlocked locally for IPC check
    ;(global as any).__devToolsUnlocked = true
    // Call the global function to rebuild menu
    if ((global as any).__unlockDevTools) {
      ;(global as any).__unlockDevTools()
    }
  })

  // Analytics
  ipcMain.handle("analytics:get-consent", async () => {
    const { getAnalyticsConsent } = await import("../lib/analytics")
    return getAnalyticsConsent()
  })
  ipcMain.handle("analytics:set-opt-out", async (_event, optedOut: boolean) => {
    if (typeof optedOut !== "boolean") {
      throw new Error("Analytics opt-out value must be a boolean.")
    }
    const { initAnalytics, setOptOut } = await import("../lib/analytics")
    try {
      await setOptOut(optedOut)
      if (!optedOut) {
        await initAnalytics().catch((error) => {
          console.warn("[Analytics] Hosted client initialization failed:", error)
        })
      }
    } finally {
      const { getAnalyticsConsent } = await import("../lib/analytics")
      const consentGranted = getAnalyticsConsent()
      broadcastAnalyticsConsent(BrowserWindow.getAllWindows(), consentGranted)
    }
  })
  ipcMain.handle("analytics:capture", async (_event, eventName: unknown, properties?: unknown) => {
    if (
      typeof eventName !== "string" ||
      properties === null ||
      (properties !== undefined && (typeof properties !== "object" || Array.isArray(properties)))
    ) {
      return
    }
    const { capture } = await import("../lib/analytics")
    await capture(eventName, properties as Record<string, unknown> | undefined)
  })

  // Shell
  ipcMain.handle("shell:open-external", (_event, url: string) => openExternalSafe(url))

  // Clipboard
  ipcMain.handle("clipboard:write", (_event, text: string) => clipboard.writeText(text))
  ipcMain.handle("clipboard:read", () => clipboard.readText())

  // Save file with native dialog
  ipcMain.handle(
    "dialog:save-file",
    async (
      event,
      options: {
        base64Data: string
        filename: string
        filters?: { name: string; extensions: string[] }[]
      },
    ) => {
      const win = getWindowFromEvent(event)
      if (!win) return { success: false }

      // Ensure window is focused before showing dialog (required on macOS)
      if (!win.isFocused()) {
        win.focus()
        await sleep(100)
      }

      const result = await dialog.showSaveDialog(win, {
        defaultPath: options.filename,
        filters: options.filters || [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
          { name: "All Files", extensions: ["*"] },
        ],
      })

      if (result.canceled || !result.filePath) return { success: false }

      try {
        const buffer = Buffer.from(options.base64Data, "base64")
        writeFileSync(result.filePath, buffer)
        return { success: true, filePath: result.filePath }
      } catch (err) {
        console.error("[dialog:save-file] Failed to write file:", err)
        return { success: false }
      }
    },
  )

  // Flapstack does not require a hosted app sign-in; harness-specific auth
  // remains under Codex/Claude/MCP.
  const validateSender = (event: Electron.IpcMainInvokeEvent): boolean => {
    const senderUrl = event.sender.getURL()
    try {
      const parsed = new URL(senderUrl)
      if (parsed.protocol === "file:") return true
      const hostname = parsed.hostname.toLowerCase()
      const trusted = ["localhost", "127.0.0.1"]
      return trusted.some((h) => hostname === h || hostname.endsWith(`.${h}`))
    } catch {
      return false
    }
  }

  ipcMain.handle("auth:get-user", (event) => {
    if (!validateSender(event)) return null
    return null
  })

  ipcMain.handle("auth:is-authenticated", (event) => {
    if (!validateSender(event)) return false
    return true
  })

  ipcMain.handle("auth:logout", async (event) => {
    if (!validateSender(event)) return
    console.log("[Auth] Hosted app logout ignored; no desktop account is active")
  })

  ipcMain.handle("auth:update-user", async (event, updates: { name?: string }) => {
    if (!validateSender(event)) return null
    console.log("[Auth] Hosted profiles are disabled", updates)
    return null
  })

  // Register git watcher IPC handlers
  registerGitWatcherIPC()

  // Register VS Code theme scanner IPC handlers
  registerThemeScannerIPC()
}

export function showLoginPage(): void {
  console.log("[Main] Hosted login page is disabled in Flapstack")
}

// Singleton IPC handler (prevents duplicate handlers on macOS window recreation)
let ipcHandler: ReturnType<typeof createIPCHandler> | null = null

/**
 * Get the focused window reference
 * Used by tRPC procedures that need window access
 */
export function getWindow(): BrowserWindow | null {
  return windowManager.getFocused()
}

/**
 * Get all windows
 */
export function getAllWindows(): BrowserWindow[] {
  return windowManager.getAll()
}

/**
 * Read window frame preference from settings file (Windows only)
 * Returns true if native frame should be used, false for frameless
 */
function getUseNativeFramePreference(): boolean {
  if (process.platform !== "win32") return false

  try {
    const settingsPath = join(app.getPath("userData"), "window-settings.json")
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"))
      return settings.useNativeFrame === true
    }
    return false // Default: frameless (dark title bar)
  } catch {
    return false
  }
}

/**
 * Create a new application window
 * @param options Optional settings for the new window
 * @param options.chatId Open this chat in the new window
 * @param options.subChatId Open this sub-chat in the new window
 */
export type CreateWindowOptions = {
  chatId?: string
  subChatId?: string
  projectId?: string
  workspaceId?: string
  paneId?: string
  skipPaneId?: string
  stableWindowId?: string
  applyInitialLaunchPresentation?: boolean
  restoredBounds?: PersistedWorkbenchWindowBounds
  restoredLastFocusedAt?: number
}

export type TryCreateWindowResult =
  { ok: true; window: BrowserWindow } | ({ ok: false } & WorkbenchWindowCreationFailure)

function workbenchCreationFailure(
  creation: Extract<TryCreateWindowResult, { ok: false }>,
): WorkbenchWindowCreationFailure {
  return createWorkbenchWindowCreationFailure(
    creation.reason,
    creation.reason === "window-limit" ? creation.destinations : [],
  )
}

export function tryCreateWindow(options?: CreateWindowOptions): TryCreateWindowResult {
  try {
    return { ok: true, window: createWindow(options) }
  } catch (error) {
    if (error instanceof WorkbenchWindowLimitError) {
      return {
        ok: false,
        ...createWorkbenchWindowCreationFailure(
          "window-limit",
          windowBudget.inspect().destinations,
        ),
      }
    }
    if (error instanceof WorkbenchWindowReservationExpiredError) {
      return {
        ok: false,
        ...createWorkbenchWindowCreationFailure(
          "reservation-expired",
          windowBudget.inspect().destinations,
        ),
      }
    }
    console.error("[Main] Failed to create workbench window:", error)
    return {
      ok: false,
      ...createWorkbenchWindowCreationFailure(
        "creation-failed",
        windowBudget.inspect().destinations,
      ),
    }
  }
}

export function tryCreateWindowWithRendererChoice(
  options?: CreateWindowOptions,
): TryCreateWindowResult {
  const result = tryCreateWindow(options)
  if (!result.ok) {
    const feedbackWindow = getWindow() ?? getAllWindows()[0]
    feedbackWindow?.webContents.send("window:creation-blocked", workbenchCreationFailure(result))
  }
  return result
}

export function notifyNativeWorkbenchWindowCreationBlocked(
  failure: WorkbenchWindowCreationFailure,
): void {
  const copy =
    failure.reason === "window-limit"
      ? {
          title: "Flapstack window limit reached",
          body: "Four workbench windows are already open. Recover or close one before trying again.",
        }
      : failure.reason === "reservation-expired"
        ? {
            title: "Flapstack window creation timed out",
            body: "The reserved window slot expired before creation completed. Try again.",
          }
        : {
            title: "Flapstack could not create a window",
            body: "The new window could not be constructed or attached. Existing work was kept.",
          }
  try {
    if (!Notification.isSupported()) {
      console.warn(`[Main] ${copy.title}: ${copy.body}`)
      return
    }
    new Notification({ ...copy, silent: true }).show()
  } catch (error) {
    console.warn(`[Main] ${copy.title}: ${copy.body}`, error)
  }
}

class WorkbenchWindowReservationExpiredError extends Error {
  constructor() {
    super("The workbench window reservation expired before creation completed.")
    this.name = "WorkbenchWindowReservationExpiredError"
  }
}

class WorkbenchWindowStableIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkbenchWindowStableIdentityError"
  }
}

function persistedLaunchFromOptions(options?: CreateWindowOptions): PersistedWorkbenchWindowLaunch {
  return {
    ...(options?.chatId ? { chatId: options.chatId } : {}),
    ...(options?.subChatId ? { subChatId: options.subChatId } : {}),
    ...(options?.projectId ? { projectId: options.projectId } : {}),
    ...(options?.workspaceId ? { workspaceId: options.workspaceId } : {}),
    ...(options?.paneId ? { paneId: options.paneId } : {}),
    ...(options?.skipPaneId ? { skipPaneId: options.skipPaneId } : {}),
  }
}

function persistedBounds(window: BrowserWindow): PersistedWorkbenchWindowBounds {
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(500, bounds.width),
    height: Math.max(600, bounds.height),
  }
}

function persistedDisplayId(window: BrowserWindow): string {
  return String(screen.getDisplayMatching(persistedBounds(window)).id)
}

function scheduleWorkbenchWindowBoundsPersistence(window: BrowserWindow, stableId: string): void {
  const pending = pendingBoundsPersistence.get(window.id)
  if (pending) clearTimeout(pending)
  pendingBoundsPersistence.set(
    window.id,
    setTimeout(() => {
      pendingBoundsPersistence.delete(window.id)
      if (window.isDestroyed()) return
      safelyPersistWorkbenchWindow((store) => {
        store.updateBounds(stableId, persistedBounds(window))
      })
    }, 250),
  )
}

export function createWindow(options?: CreateWindowOptions): BrowserWindow {
  // Register IPC handlers before creating first window
  registerIpcHandlers()
  const reservation = windowBudget.reserve({
    classification: "workbench",
    requestedStableId: options?.stableWindowId,
  })
  if (reservation.status === "at-limit") throw new WorkbenchWindowLimitError(reservation)
  if (reservation.status === "stable-id-conflict") {
    throw new WorkbenchWindowStableIdentityError(
      `Stable workbench window identity ${reservation.stableId} is already live or reserved.`,
    )
  }
  if (!reservation.reservationId) {
    throw new Error("Workbench window creation requires a counted reservation.")
  }
  const reservationId = reservation.reservationId
  let window: BrowserWindow | null = null
  let stableWindowId: string | null = null
  let committedStableWindowId: string | null = null
  let sessionPersisted = false

  try {
    // Read Windows frame preference
    const useNativeFrame = getUseNativeFramePreference()
    const launchPresentation = resolveInitialLaunchPresentation(
      {
        env: process.env,
        argv: process.argv,
        displays: screen.getAllDisplays(),
        primaryDisplayId: screen.getPrimaryDisplay().id,
      },
      options?.applyInitialLaunchPresentation === true,
    )
    const initialBounds = options?.restoredBounds ?? launchPresentation.bounds

    window = new BrowserWindow({
      width: initialBounds?.width ?? 1400,
      height: initialBounds?.height ?? 900,
      ...(initialBounds ? { x: initialBounds.x, y: initialBounds.y } : {}),
      minWidth: 500, // Allow narrow mobile-like mode
      minHeight: 600,
      show: false,
      title: "Flapstack",
      icon: resolveWindowIconPath({
        platform: process.platform,
        isPackaged: app.isPackaged,
        appPath: app.getAppPath(),
        resourcesPath: process.resourcesPath,
      }),
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#09090b" : "#ffffff",
      titleBarStyle:
        process.platform === "darwin"
          ? "hiddenInset"
          : process.platform === "win32" && !useNativeFrame
            ? "hidden"
            : "default",
      trafficLightPosition: process.platform === "darwin" ? { x: 15, y: 12 } : undefined,
      // Windows: Use native frame or frameless based on user preference
      ...(process.platform === "win32" && {
        frame: useNativeFrame,
        autoHideMenuBar: true,
        ...(!useNativeFrame && {
          titleBarOverlay: {
            color: "#00000000",
            symbolColor: nativeTheme.shouldUseDarkColors ? "#f4f4f5" : "#18181b",
            height: 32,
          },
        }),
      }),
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false, // Required for electron-trpc
        webSecurity: true,
        partition: "persist:main", // Use persistent session for cookies
        ...(launchPresentation.keepRendererActive ? { backgroundThrottling: false } : {}),
      },
    })
    const createdWindow = window

    // Register window with manager and get stable ID for localStorage namespacing
    stableWindowId = windowManager.register(createdWindow, options?.stableWindowId)
    createdWindow.webContents.prependListener("render-process-gone", () => {
      chatTransferCoordinator.windowUnavailable(stableWindowId!)
    })
    createdWindow.webContents.prependListener("destroyed", () => {
      chatTransferCoordinator.windowUnavailable(stableWindowId!)
    })
    createdWindow.prependListener("closed", () => {
      chatTransferCoordinator.windowUnavailable(stableWindowId!)
    })
    const committed = windowBudget.commit(reservationId, {
      stableId: stableWindowId,
      kind: stableWindowId === "main" ? "main" : options?.workspaceId ? "workspace" : "chat",
      hasProject: Boolean(options?.projectId),
      hasChat: Boolean(options?.chatId),
    })
    if (committed.status === "reservation-expired") {
      throw new WorkbenchWindowReservationExpiredError()
    }
    if (committed.status !== "available") {
      throw new WorkbenchWindowStableIdentityError(
        committed.status === "stable-id-mismatch"
          ? `Reserved stable identity ${committed.requestedStableId} cannot commit as ${committed.actualStableId}.`
          : `Stable identity ${committed.stableId} is already committed.`,
      )
    }
    committedStableWindowId = stableWindowId
    console.log(
      `[Main] Created window ${createdWindow.id} with stable ID "${stableWindowId}" (total: ${windowManager.count()})`,
    )

    // Setup tRPC IPC handler (singleton pattern)
    if (ipcHandler) {
      // Reuse existing handler, just attach new window
      ipcHandler.attachWindow(createdWindow)
    } else {
      // Create new handler with context
      ipcHandler = createIPCHandler({
        router: createAppRouter(getWindow),
        windows: [createdWindow],
        createContext: async () => ({
          getWindow,
        }),
      })
    }

    // Show window when ready
    createdWindow.on("ready-to-show", () => {
      console.log("[Main] Window", createdWindow.id, "ready to show")
      // Start with traffic lights hidden - the renderer will show them
      // after hydration based on the persisted sidebar state
      if (process.platform === "darwin") {
        createdWindow.setWindowButtonVisibility(false)
      }
      if (launchPresentation.showInactive) {
        createdWindow.showInactive()
      } else {
        createdWindow.show()
      }
      if (launchPresentation.startMinimized) {
        createdWindow.minimize()
        console.log(
          `[Main] Window ${createdWindow.id} started minimized` +
            (launchPresentation.bounds ? " on a secondary display" : ""),
        )
      }
    })

    // Emit fullscreen change events and manage traffic lights
    createdWindow.on("enter-full-screen", () => {
      // Always show native traffic lights in fullscreen
      if (process.platform === "darwin") {
        createdWindow.setWindowButtonVisibility(true)
      }
      createdWindow.webContents.send("window:fullscreen-change", true)
    })
    createdWindow.on("leave-full-screen", () => {
      // Don't force traffic lights visible here - the renderer will
      // restore the correct visibility based on sidebar state when
      // it receives the fullscreen-change event
      createdWindow.webContents.send("window:fullscreen-change", false)
    })

    // Emit focus change events
    createdWindow.on("focus", () => {
      windowBudget.markFocused(stableWindowId!)
      safelyPersistWorkbenchWindow((store) => {
        store.touch(stableWindowId!, persistedBounds(createdWindow))
      })
      createdWindow.webContents.send("window:focus-change", true)
    })
    createdWindow.on("blur", () => {
      createdWindow.webContents.send("window:focus-change", false)
    })
    createdWindow.on("move", () => {
      scheduleWorkbenchWindowBoundsPersistence(createdWindow, stableWindowId!)
    })
    createdWindow.on("resize", () => {
      scheduleWorkbenchWindowBoundsPersistence(createdWindow, stableWindowId!)
    })

    // Disable Cmd+R / Ctrl+R to prevent accidental page refresh
    // Cmd+Shift+R / Ctrl+Shift+R is allowed but warns if there are active streams
    createdWindow.webContents.on("before-input-event", (event, input) => {
      const isMac = process.platform === "darwin"
      const modifierKey = isMac ? input.meta : input.control
      if (modifierKey && input.key.toLowerCase() === "r") {
        if (!input.shift) {
          // Block Cmd+R entirely
          event.preventDefault()
        } else if (hasActiveAgentSessions()) {
          // Cmd+Shift+R with active streams - intercept and confirm
          event.preventDefault()
          dialog
            .showMessageBox(createdWindow, {
              type: "warning",
              buttons: ["Cancel", "Reload Anyway"],
              defaultId: 0,
              cancelId: 0,
              title: "Active Sessions",
              message: "There are active agent sessions running.",
              detail:
                "Reloading will interrupt them. The current progress will be saved. Are you sure you want to reload?",
            })
            .then(({ response }) => {
              if (response === 1) {
                abortAllAgentSessions()
                createdWindow.webContents.reloadIgnoringCache()
              }
            })
        }
      }
    })

    // Handle external links
    createdWindow.webContents.setWindowOpenHandler(({ url }) => {
      void openExternalSafe(url)
      return { action: "deny" }
    })

    // Prevent window close if there are active streaming sessions
    createdWindow.on("close", (event) => {
      if (sessionPersisted && !createdWindow.isDestroyed()) {
        safelyPersistWorkbenchWindow((store) => {
          store.updateBounds(stableWindowId!, persistedBounds(createdWindow))
        })
      }
      // Skip confirmation if app quit was already confirmed by the user
      if (isQuitting) {
        // Still abort sessions gracefully so partial state is saved
        abortAllAgentSessions()
        return
      }

      if (hasActiveAgentSessions()) {
        event.preventDefault()
        dialog
          .showMessageBox(createdWindow, {
            type: "warning",
            buttons: ["Cancel", "Close Anyway"],
            defaultId: 0,
            cancelId: 0,
            title: "Active Sessions",
            message: "There are active agent sessions running.",
            detail:
              "Closing this window will interrupt them. The current progress will be saved. Are you sure you want to close?",
          })
          .then(({ response }) => {
            if (response === 1) {
              abortAllAgentSessions()
              createdWindow.destroy()
            }
          })
      }
    })

    // Handle window close
    createdWindow.on("closed", () => {
      windowBudget.release(stableWindowId!)
      const pendingBounds = pendingBoundsPersistence.get(createdWindow.id)
      if (pendingBounds) clearTimeout(pendingBounds)
      pendingBoundsPersistence.delete(createdWindow.id)
      if (sessionPersisted && !isQuitting) {
        if (stableWindowId !== "main") {
          safelyPersistWorkbenchWindow((store) => {
            store.remove(stableWindowId!)
          })
        }
        setImmediate(() => restoreNextDormantWorkbenchWindow())
      }
      console.log(`[Main] Window ${createdWindow.id} closed`)
      // windowManager handles cleanup via 'closed' event listener
    })

    // Load the renderer directly. Flapstack is local-first and has no hosted
    // desktop account gate.
    const devServerUrl = process.env.ELECTRON_RENDERER_URL
    const windowId = windowManager.getStableId(createdWindow)

    const buildParams = (params: URLSearchParams) => {
      params.set("windowId", windowId)
      if (options?.chatId) params.set("chatId", options.chatId)
      if (options?.subChatId) params.set("subChatId", options.subChatId)
      if (options?.projectId) params.set("projectId", options.projectId)
      if (options?.workspaceId) params.set("workspaceId", options.workspaceId)
      if (options?.paneId) params.set("paneId", options.paneId)
      if (options?.skipPaneId) params.set("skipPaneId", options.skipPaneId)
    }

    if (devServerUrl) {
      const url = new URL(devServerUrl)
      buildParams(url.searchParams)
      createdWindow.loadURL(url.toString())
      if (!app.isPackaged && windowId === "main" && process.env.FLAPSTACK_OPEN_DEVTOOLS === "1") {
        createdWindow.webContents.openDevTools()
      }
    } else {
      const hashParams = new URLSearchParams()
      buildParams(hashParams)
      createdWindow.loadFile(join(__dirname, "../renderer/index.html"), {
        hash: hashParams.toString(),
      })
    }

    // Log page load - traffic light visibility is managed by the renderer
    createdWindow.webContents.on("did-finish-load", () => {
      windowBudget.markAvailable(stableWindowId!)
      console.log("[Main] Page finished loading in window", createdWindow.id)
    })
    createdWindow.webContents.on("render-process-gone", () => {
      windowBudget.markRecovering(stableWindowId!)
    })
    createdWindow.webContents.on("destroyed", () => {
      windowBudget.markRecovering(stableWindowId!)
    })
    createdWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
      console.error(
        "[Main] Page failed to load in window",
        createdWindow.id,
        ":",
        errorCode,
        errorDescription,
      )
    })
    setImmediate(() => {
      if (createdWindow.isDestroyed()) return
      sessionPersisted = safelyPersistWorkbenchWindow((store) => {
        store.upsert({
          stableId: stableWindowId!,
          kind:
            stableWindowId === "main" ? "main" : options?.workspaceId ? "saved-workspace" : "chat",
          lastFocusedAt: options?.restoredLastFocusedAt ?? Date.now(),
          launch: persistedLaunchFromOptions(options),
          bounds: persistedBounds(createdWindow),
          displayId: persistedDisplayId(createdWindow),
        })
      })
    })

    return createdWindow
  } catch (error) {
    cleanupFailedWorkbenchWindowCreation({
      budget: windowBudget,
      reservationId,
      stableId: committedStableWindowId,
      window,
      unregister: (partialWindow) => windowManager.unregister(partialWindow),
      destroy: (partialWindow) => {
        if (!partialWindow.isDestroyed()) partialWindow.destroy()
      },
    })
    throw error
  }
}

/**
 * Create the main application window (alias for createWindow for backwards compatibility)
 */
export function createMainWindow(): BrowserWindow {
  return createWindow({ applyInitialLaunchPresentation: true })
}

function restoredWindowOptions(record: PersistedWorkbenchWindow): CreateWindowOptions {
  const restored =
    record.bounds && screen.getAllDisplays().length > 0
      ? clampWorkbenchWindowBounds(
          { displayId: record.displayId, bounds: record.bounds },
          screen.getAllDisplays().map((display) => ({
            id: display.id,
            workArea: display.workArea,
          })),
        )
      : null
  return {
    ...record.launch,
    stableWindowId: record.stableId,
    restoredBounds: restored?.bounds ?? record.bounds,
    restoredLastFocusedAt: record.lastFocusedAt,
    applyInitialLaunchPresentation: record.stableId === "main" && !record.bounds,
  }
}

export function restoreWorkbenchWindows(): TryCreateWindowResult[] {
  const store = getWorkbenchWindowSessionStore()
  const inspection = store.inspect()
  if (inspection.status === "corrupt") {
    console.warn(
      "[Main] Persisted workbench-window state is corrupt; starting one window without replacing it.",
    )
    return [tryCreateWindow({ applyInitialLaunchPresentation: true })]
  }
  const plan = store.selectForStartup()
  if (plan.active.length === 0) {
    return [tryCreateWindow({ applyInitialLaunchPresentation: true })]
  }

  const results = plan.active.map((record) => tryCreateWindow(restoredWindowOptions(record)))
  if (!results.some((result) => result.ok)) {
    results.push(tryCreateWindow({ applyInitialLaunchPresentation: true }))
  }
  return results
}

export function restoreNextDormantWorkbenchWindow(): TryCreateWindowResult | null {
  if (isQuitting) return null
  const store = getWorkbenchWindowSessionStore()
  if (store.inspect().status === "corrupt") return null
  const dormant = store.nextDormant(windowManager.getRegisteredStableIds())
  return dormant ? tryCreateWindow(restoredWindowOptions(dormant)) : null
}

function validWorkspacePaneTarget(value: unknown): WorkspacePaneWindowTarget | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const identity = validWorkspacePaneIdentity(record)
  if (!identity || !Array.isArray(record.chatIds) || record.chatIds.length > 128) return null
  const chatIds = record.chatIds.map(validRequiredId)
  if (chatIds.some((id) => id === null)) return null
  return {
    ...identity,
    projectId: validOptionalId(record.projectId),
    chatIds: [...new Set(chatIds as string[])],
  }
}

function validWorkspaceWindowTarget(value: unknown): WorkspaceWindowOpenTarget | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const workspaceId = validRequiredId(record.workspaceId)
  if (!workspaceId || !Array.isArray(record.panes) || record.panes.length > 128) return null
  const panes = record.panes.map((pane) => {
    if (!pane || typeof pane !== "object") return null
    const paneRecord = pane as Record<string, unknown>
    const paneId = validRequiredId(paneRecord.paneId)
    if (!paneId || !Array.isArray(paneRecord.chatIds) || paneRecord.chatIds.length > 128)
      return null
    const chatIds = paneRecord.chatIds.map(validRequiredId)
    if (chatIds.some((chatId) => chatId === null)) return null
    return { paneId, chatIds: [...new Set(chatIds as string[])] }
  })
  if (panes.some((pane) => pane === null)) return null
  return {
    workspaceId,
    projectId: validOptionalId(record.projectId),
    panes: panes as WorkspaceWindowOpenTarget["panes"],
  }
}

function validWorkspacePaneIdentity(
  value: unknown,
): Pick<WorkspacePaneWindowTarget, "workspaceId" | "paneId"> | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const workspaceId = validRequiredId(record.workspaceId)
  const paneId = validRequiredId(record.paneId)
  return workspaceId && paneId ? { workspaceId, paneId } : null
}

function validRequiredId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized && normalized.length <= 200 ? normalized : null
}

function validOptionalId(value: unknown): string | undefined {
  return value === undefined ? undefined : (validRequiredId(value) ?? undefined)
}

function ownershipFailure(ownerStableId: string) {
  return {
    ok: false as const,
    ownerStableId,
    conflicts: [{ kind: "workspace-pane" as const, ownerStableId }],
  }
}

function ownershipRecovering(ownerStableId: string) {
  return { ...ownershipFailure(ownerStableId), reason: "recovering" as const }
}

function workbenchWindowCreationFailure(creation: Extract<TryCreateWindowResult, { ok: false }>) {
  const failure = workbenchCreationFailure(creation)
  const base = {
    ok: false as const,
    ownerStableId:
      failure.reason === "window-limit"
        ? (failure.destinations[0]?.stableId ?? "unknown")
        : "unknown",
    conflicts: [],
  }
  return failure.reason === "window-limit"
    ? { ...base, reason: failure.reason, destinations: failure.destinations }
    : { ...base, reason: failure.reason }
}
