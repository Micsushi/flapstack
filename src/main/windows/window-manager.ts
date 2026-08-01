import { BrowserWindow } from "electron"
import { createHash } from "node:crypto"
import type {
  WorkspaceOwnershipConflict,
  WorkspaceOwnershipInvalidation,
  WorkspacePaneClaimResult,
} from "../../shared/workspace-window-ownership"
import { cleanupWindowSubscriptions } from "../lib/git/watcher/ipc-bridge"

type WorkspacePaneOwner = {
  windowId: number
  returnWindowId: number | null
  chatIds: Set<string>
}

type ClaimOptions = {
  move?: boolean
  returnWindowId?: number | null
}

/**
 * Manages multiple application windows
 */
export class WindowManager {
  private windows: Map<number, BrowserWindow> = new Map()
  private focusedWindowId: number | null = null
  private mainWindowId: number | null = null // Track the "main" window
  private windowIdMap: Map<number, string> = new Map() // Map Electron window.id to stable ID
  private rendererAvailable: Map<number, boolean> = new Map()
  private nextSecondaryId = 2 // Counter for secondary windows
  private chatOwnership: Map<string, number> = new Map() // chatId -> electronWindowId
  private directChatOwnership: Map<string, number> = new Map()
  private workspacePaneOwnership: Map<string, WorkspacePaneOwner> = new Map()
  private ownershipRevision = 0

  /**
   * Register a window with the manager and assign a stable ID
   * Returns the stable window ID to use for localStorage namespacing
   */
  register(window: BrowserWindow, preferredStableId?: string): string {
    const electronId = window.id
    if (preferredStableId) {
      const collision = this.findRegisteredByStableId(preferredStableId)
      if (collision && collision.id !== electronId) {
        throw new Error(`Stable window identity ${preferredStableId} is already registered.`)
      }
    }
    this.windows.set(electronId, window)
    this.rendererAvailable.set(electronId, true)
    if (this.mainWindowId === null) this.mainWindowId = electronId

    // Assign stable ID
    let stableId: string
    if (preferredStableId) {
      stableId = preferredStableId
      if (preferredStableId === "main") this.mainWindowId = electronId
      const restoredSecondary = /^window-(\d+)$/.exec(preferredStableId)
      if (restoredSecondary) {
        this.nextSecondaryId = Math.max(this.nextSecondaryId, Number(restoredSecondary[1]) + 1)
      }
    } else if (this.windows.size === 1) {
      // First window ever registered becomes the "main" window
      stableId = "main"
    } else {
      // Secondary windows get incrementing IDs
      do {
        stableId = `window-${this.nextSecondaryId++}`
      } while (this.findRegisteredByStableId(stableId))
    }
    this.windowIdMap.set(electronId, stableId)

    // Track focus
    window.on("focus", () => {
      this.focusedWindowId = electronId
    })

    const releaseAuthority = () => {
      const releasedChatIds = [...this.chatOwnership]
        .filter(([, owner]) => owner === electronId)
        .map(([chatId]) => chatId)
      const releasedPanes = this.releaseAllWorkspacePanes(electronId)
      this.releaseAllChats(electronId)
      if (releasedPanes.length > 0 || releasedChatIds.length > 0) {
        this.broadcastOwnershipChange({
          reason: "close",
          chatIds: [
            ...new Set([...releasedChatIds, ...releasedPanes.flatMap((entry) => entry.chatIds)]),
          ],
          sourceStableId: stableId,
        })
      }
    }

    window.webContents.on("render-process-gone", () => {
      this.rendererAvailable.set(electronId, false)
      releaseAuthority()
    })
    window.webContents.on("destroyed", () => {
      this.rendererAvailable.set(electronId, false)
      releaseAuthority()
    })
    window.webContents.on("did-finish-load", () => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        this.rendererAvailable.set(electronId, true)
      }
    })

    // Clean up on close
    // Note: Electron automatically removes all listeners when a window is destroyed,
    // so we only need to clean up our internal tracking here
    window.on("closed", () => {
      // Cleanup git watcher subscriptions for this window to prevent memory leaks
      cleanupWindowSubscriptions(electronId)
      releaseAuthority()

      this.windows.delete(electronId)
      this.windowIdMap.delete(electronId)
      this.rendererAvailable.delete(electronId)
      if (this.focusedWindowId === electronId) {
        this.focusedWindowId = null
      }
      // If main window is closed, update mainWindowId for internal tracking
      // but DON'T change the stable ID of remaining windows - they keep their localStorage namespace
      if (this.mainWindowId === electronId) {
        const remainingWindows = Array.from(this.windows.keys())
        this.mainWindowId = remainingWindows.length > 0 ? remainingWindows[0] : null
        // Note: We intentionally keep the existing stable ID (e.g., "window-2")
        // Changing it to "main" would orphan the window's localStorage data
      }
    })

    // Set as focused if it's the only window
    if (this.windows.size === 1) {
      this.focusedWindowId = electronId
    }

    return stableId
  }

  /**
   * Get the stable ID for a window
   */
  getStableId(window: BrowserWindow): string {
    return this.windowIdMap.get(window.id) ?? "main"
  }

  findByStableId(stableId: string): BrowserWindow | undefined {
    for (const [electronId, candidate] of this.windows) {
      if (this.windowIdMap.get(electronId) !== stableId) continue
      if (this.isLive(electronId)) return candidate
    }
    return undefined
  }

  findRegisteredByStableId(stableId: string): BrowserWindow | undefined {
    for (const [electronId, candidate] of this.windows) {
      if (this.windowIdMap.get(electronId) !== stableId) continue
      if (!candidate.isDestroyed()) return candidate
    }
    return undefined
  }

  focusStableWindow(stableId: string): "focused" | "recovering" | "missing" {
    const registered = this.findRegisteredByStableId(stableId)
    if (!registered) return "missing"
    if (!this.isLive(registered.id)) return "recovering"
    if (registered.isMinimized()) registered.restore()
    registered.focus()
    return "focused"
  }

  /**
   * Unregister a window
   */
  unregister(window: BrowserWindow): void {
    const electronId = window.id
    cleanupWindowSubscriptions(electronId)
    this.releaseAllWorkspacePanes(electronId)
    this.releaseAllChats(electronId)
    this.windows.delete(electronId)
    this.windowIdMap.delete(electronId)
    this.rendererAvailable.delete(electronId)
    if (this.focusedWindowId === electronId) {
      this.focusedWindowId = null
    }
    if (this.mainWindowId === electronId) {
      this.mainWindowId = this.windows.keys().next().value ?? null
    }
  }

  /**
   * Get a window by ID
   */
  get(id: number): BrowserWindow | undefined {
    return this.windows.get(id)
  }

  /**
   * Get the currently focused window
   */
  getFocused(): BrowserWindow | null {
    if (this.focusedWindowId !== null) {
      const win = this.windows.get(this.focusedWindowId)
      if (win && this.isLive(this.focusedWindowId)) {
        return win
      }
    }
    // Fallback to BrowserWindow.getFocusedWindow() with destroyed check
    const focusedWin = BrowserWindow.getFocusedWindow()
    const focusedIsLive = focusedWin
      ? this.windows.has(focusedWin.id)
        ? this.isLive(focusedWin.id)
        : !focusedWin.isDestroyed() && !focusedWin.webContents.isDestroyed()
      : false
    if (focusedWin && focusedIsLive) {
      return focusedWin
    }
    return null
  }

  /**
   * Get all windows
   */
  getAll(): BrowserWindow[] {
    return Array.from(this.windows.entries())
      .filter(([electronId]) => this.isLive(electronId))
      .map(([, window]) => window)
  }

  /**
   * Get the number of windows
   */
  count(): number {
    return this.windows.size
  }

  getRegisteredStableIds(): string[] {
    return [...this.windows.entries()]
      .filter(([, window]) => !window.isDestroyed())
      .map(([electronId]) => this.windowIdMap.get(electronId))
      .filter((stableId): stableId is string => Boolean(stableId))
  }

  /**
   * Find window by webContents ID
   */
  findByWebContentsId(webContentsId: number): BrowserWindow | undefined {
    for (const [electronId, window] of this.windows) {
      if (this.isLive(electronId) && window.webContents.id === webContentsId) {
        return window
      }
    }
    return undefined
  }

  /**
   * Attempt to claim a chat for a window.
   * Returns { ok: true } if claimed, or { ok: false, ownerStableId } if already owned by another window.
   */
  claimChat(
    chatId: string,
    electronId: number,
  ): { ok: true } | { ok: false; ownerStableId: string } {
    const existingOwner = this.chatOwnership.get(chatId)

    // Already owned by this same window - idempotent success
    if (existingOwner === electronId) {
      this.directChatOwnership.set(chatId, electronId)
      return { ok: true }
    }

    // Owned by another window - check it still exists
    if (existingOwner !== undefined) {
      if (this.isLive(existingOwner)) {
        const ownerStableId = this.windowIdMap.get(existingOwner) ?? "unknown"
        return { ok: false, ownerStableId }
      }
      // Owner window is gone - stale entry, clean it up
      this.chatOwnership.delete(chatId)
    }

    this.chatOwnership.set(chatId, electronId)
    this.directChatOwnership.set(chatId, electronId)
    this.broadcastOwnershipChange({
      reason: "claim",
      chatIds: [chatId],
      targetStableId: this.stableIdFor(electronId),
    })
    return { ok: true }
  }

  /**
   * Release a chat owned by a specific window.
   */
  releaseChat(chatId: string, electronId: number): void {
    if (this.chatOwnership.get(chatId) === electronId) {
      this.directChatOwnership.delete(chatId)
      if (!this.isChatReferencedByWorkspacePane(chatId, electronId)) {
        this.chatOwnership.delete(chatId)
      }
      this.broadcastOwnershipChange({
        reason: "release",
        chatIds: [chatId],
        sourceStableId: this.stableIdFor(electronId),
      })
    }
  }

  /**
   * Release all chats owned by a window (called on window close).
   */
  releaseAllChats(electronId: number): void {
    for (const [chatId, owner] of this.chatOwnership.entries()) {
      if (owner === electronId) {
        this.chatOwnership.delete(chatId)
      }
    }
    for (const [chatId, owner] of this.directChatOwnership.entries()) {
      if (owner === electronId) this.directChatOwnership.delete(chatId)
    }
  }

  /**
   * Focus the window that owns a given chatId.
   * Returns true if the window was found and focused.
   */
  focusChatOwner(chatId: string): boolean {
    const ownerId = this.chatOwnership.get(chatId)
    if (ownerId === undefined) return false

    const window = this.windows.get(ownerId)
    if (!window || !this.isLive(ownerId)) {
      this.chatOwnership.delete(chatId)
      return false
    }

    if (window.isMinimized()) window.restore()
    window.focus()
    return true
  }

  /**
   * Get the electron window ID that owns a chat, if any.
   */
  getChatOwner(chatId: string): number | undefined {
    const ownerId = this.chatOwnership.get(chatId)
    if (ownerId === undefined) return undefined
    if (this.isLive(ownerId)) return ownerId
    this.chatOwnership.delete(chatId)
    return undefined
  }

  compareAndTransferChat(
    chatId: string,
    expectedOwnerStableId: string,
    nextOwnerStableId: string,
  ): { ok: true } | { ok: false; ownerStableId: string | null } {
    this.pruneStaleOwnership()
    const expectedWindow = this.findByStableId(expectedOwnerStableId)
    const nextWindow = this.findByStableId(nextOwnerStableId)
    const currentOwner = this.chatOwnership.get(chatId)
    if (!expectedWindow || !nextWindow || currentOwner !== expectedWindow.id) {
      return {
        ok: false,
        ownerStableId: currentOwner === undefined ? null : this.stableIdFor(currentOwner),
      }
    }
    if (expectedWindow.id === nextWindow.id) return { ok: true }
    this.chatOwnership.set(chatId, nextWindow.id)
    this.directChatOwnership.set(chatId, nextWindow.id)
    this.broadcastOwnershipChange({
      reason: "move",
      chatIds: [chatId],
      sourceStableId: expectedOwnerStableId,
      targetStableId: nextOwnerStableId,
    })
    return { ok: true }
  }

  inspectWorkspacePaneClaim(
    workspaceId: string,
    paneId: string,
    chatIds: string[],
    acceptedWindowId?: number,
  ): WorkspaceOwnershipConflict[] {
    this.pruneStaleOwnership()
    const conflicts: WorkspaceOwnershipConflict[] = []
    const paneOwner = this.workspacePaneOwnership.get(workspacePaneKey(workspaceId, paneId))
    if (paneOwner && paneOwner.windowId !== acceptedWindowId) {
      conflicts.push({
        kind: "workspace-pane",
        ownerStableId: this.stableIdFor(paneOwner.windowId),
      })
    }
    for (const chatId of uniqueIds(chatIds)) {
      const owner = this.chatOwnership.get(chatId)
      if (owner !== undefined && owner !== acceptedWindowId) {
        conflicts.push({ kind: "chat", chatId, ownerStableId: this.stableIdFor(owner) })
      }
    }
    return conflicts
  }

  claimWorkspacePane(
    workspaceId: string,
    paneId: string,
    chatIds: string[],
    electronId: number,
    options: ClaimOptions = {},
  ): WorkspacePaneClaimResult {
    if (!this.isLive(electronId)) {
      return {
        ok: false,
        ownerStableId: "unknown",
        conflicts: [{ kind: "workspace-pane", ownerStableId: "unknown" }],
      }
    }
    const normalizedChatIds = uniqueIds(chatIds)
    const key = workspacePaneKey(workspaceId, paneId)
    const currentOwner = this.workspacePaneOwnership.get(key)
    if (
      currentOwner?.windowId === electronId &&
      sameIds(currentOwner.chatIds, normalizedChatIds) &&
      normalizedChatIds.every((chatId) => this.chatOwnership.get(chatId) === electronId)
    ) {
      if (options.returnWindowId !== undefined) {
        currentOwner.returnWindowId = options.returnWindowId
      }
      return { ok: true, state: "claimed", ownerStableId: this.stableIdFor(electronId) }
    }
    const conflicts = this.inspectWorkspacePaneClaim(
      workspaceId,
      paneId,
      normalizedChatIds,
      electronId,
    )
    if (conflicts.length > 0 && !options.move) {
      return { ok: false, ownerStableId: conflicts[0].ownerStableId, conflicts }
    }

    const previousPaneOwner = this.workspacePaneOwnership.get(key)
    const previousOwners = new Set<number>()
    if (previousPaneOwner && previousPaneOwner.windowId !== electronId) {
      previousOwners.add(previousPaneOwner.windowId)
    }
    for (const chatId of normalizedChatIds) {
      const previousOwner = this.chatOwnership.get(chatId)
      if (previousOwner !== undefined && previousOwner !== electronId)
        previousOwners.add(previousOwner)
      if (previousOwner !== undefined && previousOwner !== electronId) {
        this.directChatOwnership.delete(chatId)
      }
      this.chatOwnership.set(chatId, electronId)
    }
    this.workspacePaneOwnership.set(key, {
      windowId: electronId,
      returnWindowId:
        options.returnWindowId === undefined
          ? (previousPaneOwner?.returnWindowId ?? null)
          : options.returnWindowId,
      chatIds: new Set(normalizedChatIds),
    })
    const releasedChatIds: string[] = []
    if (previousPaneOwner) {
      for (const removedChatId of previousPaneOwner.chatIds) {
        if (normalizedChatIds.includes(removedChatId)) continue
        if (
          this.chatOwnership.get(removedChatId) === previousPaneOwner.windowId &&
          this.directChatOwnership.get(removedChatId) !== previousPaneOwner.windowId &&
          !this.isChatReferencedByWorkspacePane(removedChatId, previousPaneOwner.windowId, key)
        ) {
          this.chatOwnership.delete(removedChatId)
          releasedChatIds.push(removedChatId)
        }
      }
    }
    const state = previousOwners.size > 0 ? "moved" : "claimed"
    this.broadcastOwnershipChange({
      reason: state === "moved" ? "move" : "claim",
      workspaceId,
      paneId,
      chatIds: [...new Set([...normalizedChatIds, ...releasedChatIds])],
      sourceStableId:
        previousOwners.size > 0
          ? this.stableIdFor(previousOwners.values().next().value!)
          : undefined,
      targetStableId: this.stableIdFor(electronId),
    })
    return { ok: true, state, ownerStableId: this.stableIdFor(electronId) }
  }

  transferWorkspacePane(
    workspaceId: string,
    paneId: string,
    chatIds: string[],
    fromWindowId: number,
    toWindowId: number,
    returnWindowId: number | null = fromWindowId,
  ): WorkspacePaneClaimResult {
    const conflicts = this.inspectWorkspacePaneClaim(workspaceId, paneId, chatIds, fromWindowId)
    if (conflicts.length > 0) {
      return { ok: false, ownerStableId: conflicts[0].ownerStableId, conflicts }
    }
    return this.claimWorkspacePane(workspaceId, paneId, chatIds, toWindowId, {
      move: true,
      returnWindowId,
    })
  }

  releaseWorkspacePane(
    workspaceId: string,
    paneId: string,
    expectedChatIds: string[],
    electronId: number,
  ): void {
    const key = workspacePaneKey(workspaceId, paneId)
    const owner = this.workspacePaneOwnership.get(key)
    if (
      !owner ||
      owner.windowId !== electronId ||
      !sameIds(owner.chatIds, uniqueIds(expectedChatIds))
    )
      return
    this.workspacePaneOwnership.delete(key)
    for (const chatId of owner.chatIds) {
      if (
        this.chatOwnership.get(chatId) === electronId &&
        this.directChatOwnership.get(chatId) !== electronId &&
        !this.isChatReferencedByWorkspacePane(chatId, electronId, key)
      ) {
        this.chatOwnership.delete(chatId)
      }
    }
    this.broadcastOwnershipChange({
      reason: "release",
      workspaceId,
      paneId,
      chatIds: [...owner.chatIds],
      sourceStableId: this.stableIdFor(electronId),
    })
  }

  releaseAllWorkspacePanes(electronId: number): Array<{ chatIds: string[] }> {
    const released: Array<{ chatIds: string[] }> = []
    for (const [key, owner] of this.workspacePaneOwnership) {
      if (owner.windowId !== electronId) continue
      this.workspacePaneOwnership.delete(key)
      released.push({ chatIds: [...owner.chatIds] })
    }
    return released
  }

  focusWorkspacePaneOwner(workspaceId: string, paneId: string): boolean {
    this.pruneStaleOwnership()
    const owner = this.workspacePaneOwnership.get(workspacePaneKey(workspaceId, paneId))
    return owner ? this.focusWindow(owner.windowId) : false
  }

  pullBackWorkspacePane(
    workspaceId: string,
    paneId: string,
    electronId: number,
  ): WorkspacePaneClaimResult {
    this.pruneStaleOwnership()
    const key = workspacePaneKey(workspaceId, paneId)
    const owner = this.workspacePaneOwnership.get(key)
    if (!owner || owner.windowId !== electronId) {
      return {
        ok: false,
        ownerStableId: owner ? this.stableIdFor(owner.windowId) : "unknown",
        conflicts: [
          {
            kind: "workspace-pane",
            ownerStableId: owner ? this.stableIdFor(owner.windowId) : "unknown",
          },
        ],
      }
    }
    const targetId =
      (owner.returnWindowId !== null && this.isLive(owner.returnWindowId)
        ? owner.returnWindowId
        : undefined) ??
      (this.mainWindowId !== null &&
      this.mainWindowId !== electronId &&
      this.isLive(this.mainWindowId)
        ? this.mainWindowId
        : undefined) ??
      [...this.windows.keys()].find((id) => id !== electronId && this.isLive(id))
    if (targetId === undefined) {
      return {
        ok: false,
        ownerStableId: this.stableIdFor(electronId),
        conflicts: [{ kind: "workspace-pane", ownerStableId: this.stableIdFor(electronId) }],
      }
    }
    const sourceStableId = this.stableIdFor(electronId)
    const result = this.claimWorkspacePane(workspaceId, paneId, [...owner.chatIds], targetId, {
      move: true,
      returnWindowId: null,
    })
    if (result.ok) {
      this.focusWindow(targetId)
      this.broadcastOwnershipChange({
        reason: "pull-back",
        workspaceId,
        paneId,
        chatIds: [...owner.chatIds],
        sourceStableId,
        targetStableId: this.stableIdFor(targetId),
      })
    }
    return result
  }

  getWorkspacePaneOwner(workspaceId: string, paneId: string): number | undefined {
    this.pruneStaleOwnership()
    return this.workspacePaneOwnership.get(workspacePaneKey(workspaceId, paneId))?.windowId
  }

  private focusWindow(electronId: number): boolean {
    const window = this.windows.get(electronId)
    if (!window || !this.isLive(electronId)) return false
    if (window.isMinimized()) window.restore()
    window.focus()
    return true
  }

  private isLive(electronId: number): boolean {
    const window = this.windows.get(electronId)
    return Boolean(
      window &&
      this.rendererAvailable.get(electronId) !== false &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed(),
    )
  }

  private stableIdFor(electronId: number): string {
    return this.windowIdMap.get(electronId) ?? "unknown"
  }

  private pruneStaleOwnership(): void {
    for (const [chatId, owner] of this.chatOwnership) {
      if (!this.isLive(owner)) {
        this.chatOwnership.delete(chatId)
        this.directChatOwnership.delete(chatId)
      }
    }
    for (const [key, owner] of this.workspacePaneOwnership) {
      if (!this.isLive(owner.windowId)) this.workspacePaneOwnership.delete(key)
    }
  }

  private broadcastOwnershipChange(input: Omit<WorkspaceOwnershipInvalidation, "revision">): void {
    const payload: WorkspaceOwnershipInvalidation = {
      ...input,
      revision: ++this.ownershipRevision,
    }
    for (const window of this.getAll()) {
      if (!window.webContents.isDestroyed()) {
        window.webContents.send("workspace-window:ownership-changed", payload)
      }
    }
  }

  private isChatReferencedByWorkspacePane(
    chatId: string,
    electronId: number,
    exceptKey?: string,
  ): boolean {
    for (const [key, owner] of this.workspacePaneOwnership) {
      if (key === exceptKey || owner.windowId !== electronId) continue
      if (owner.chatIds.has(chatId)) return true
    }
    return false
  }
}

function workspacePaneKey(workspaceId: string, paneId: string): string {
  return JSON.stringify([workspaceId, paneId])
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
}

function sameIds(left: Set<string>, right: string[]): boolean {
  return left.size === right.length && right.every((id) => left.has(id))
}

export function stableWorkspaceWindowId(workspaceId: string, paneId: string): string {
  const digest = createHash("sha256").update(`${workspaceId}\0${paneId}`).digest("hex").slice(0, 24)
  return `workspace-${digest}`
}

export function stableWorkspaceRootWindowId(workspaceId: string): string {
  const digest = createHash("sha256").update(`${workspaceId}\0root`).digest("hex").slice(0, 24)
  return `workspace-root-${digest}`
}

export function stableWorkspaceRemainderWindowId(workspaceId: string, skipPaneId: string): string {
  const digest = createHash("sha256")
    .update(`${workspaceId}\0remainder\0${skipPaneId}`)
    .digest("hex")
    .slice(0, 24)
  return `workspace-remainder-${digest}`
}

// Singleton instance
export const windowManager = new WindowManager()
