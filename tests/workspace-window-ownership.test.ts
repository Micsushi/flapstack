import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, it, vi } from "vitest"

const electronState = vi.hoisted(() => ({ focusedWindow: null as FakeWindow | null }))

vi.mock("electron", () => ({
  BrowserWindow: { getFocusedWindow: () => electronState.focusedWindow },
}))
vi.mock("../src/main/lib/git/watcher/ipc-bridge", () => ({
  cleanupWindowSubscriptions: vi.fn(),
}))

import {
  WindowManager,
  stableWorkspaceRemainderWindowId,
  stableWorkspaceRootWindowId,
  stableWorkspaceWindowId,
} from "../src/main/windows/window-manager"

class FakeWebContents extends EventEmitter {
  destroyed = false
  sent: Array<{ channel: string; payload: unknown }> = []
  isDestroyed = () => this.destroyed
  send = (channel: string, payload: unknown) => this.sent.push({ channel, payload })
}

class FakeWindow extends EventEmitter {
  readonly webContents = new FakeWebContents()
  destroyed = false
  minimized = false
  focused = false

  constructor(readonly id: number) {
    super()
  }

  isDestroyed = () => this.destroyed
  isMinimized = () => this.minimized
  restore = () => {
    this.minimized = false
  }
  focus = () => {
    this.focused = true
    this.emit("focus")
  }
}

function register(manager: WindowManager, id: number, stableId?: string) {
  const window = new FakeWindow(id)
  manager.register(window as never, stableId)
  return window
}

describe("saved workspace window ownership", () => {
  let manager: WindowManager
  let main: FakeWindow
  let secondary: FakeWindow

  beforeEach(() => {
    electronState.focusedWindow = null
    manager = new WindowManager()
    main = register(manager, 1)
    secondary = register(manager, 2, "workspace-secondary")
  })

  it("allows only one live pane/chat owner under competing claims", () => {
    const attempts = [
      manager.claimWorkspacePane("workspace", "pane", ["chat"], main.id),
      manager.claimWorkspacePane("workspace", "pane", ["chat"], secondary.id),
      manager.claimWorkspacePane("workspace", "pane", ["chat"], secondary.id),
    ]

    expect(attempts.filter((result) => result.ok)).toHaveLength(1)
    expect(manager.getWorkspacePaneOwner("workspace", "pane")).toBe(main.id)
    expect(manager.getChatOwner("chat")).toBe(main.id)
  })

  it("keeps an exact idempotent claim silent to prevent claim-broadcast recursion", () => {
    manager.claimWorkspacePane("workspace", "pane", ["chat"], main.id)
    const mainEvents = main.webContents.sent.length
    const secondaryEvents = secondary.webContents.sent.length

    expect(manager.claimWorkspacePane("workspace", "pane", ["chat"], main.id)).toMatchObject({
      ok: true,
    })
    expect(main.webContents.sent).toHaveLength(mainEvents)
    expect(secondary.webContents.sent).toHaveLength(secondaryEvents)
  })

  it("focuses, moves, and pulls a pane back without changing workspace/pane identity", () => {
    manager.claimWorkspacePane("workspace", "pane", ["chat"], main.id)
    const moved = manager.transferWorkspacePane(
      "workspace",
      "pane",
      ["chat"],
      main.id,
      secondary.id,
      main.id,
    )
    secondary.minimized = true

    expect(moved).toMatchObject({ ok: true, state: "moved" })
    expect(manager.focusWorkspacePaneOwner("workspace", "pane")).toBe(true)
    expect(secondary.focused).toBe(true)
    expect(secondary.minimized).toBe(false)

    const pulled = manager.pullBackWorkspacePane("workspace", "pane", secondary.id)
    expect(pulled).toMatchObject({ ok: true, state: "moved" })
    expect(manager.getWorkspacePaneOwner("workspace", "pane")).toBe(main.id)
    expect(manager.getChatOwner("chat")).toBe(main.id)
  })

  it("releases claims when the renderer crashes, then lets another window recover", () => {
    manager.claimWorkspacePane("workspace", "pane", ["chat"], main.id)
    main.webContents.destroyed = true
    main.webContents.emit("render-process-gone", {}, { reason: "crashed" })

    expect(manager.getWorkspacePaneOwner("workspace", "pane")).toBeUndefined()
    expect(manager.getChatOwner("chat")).toBeUndefined()
    expect(
      secondary.webContents.sent.some(
        (event) =>
          event.channel === "workspace-window:ownership-changed" &&
          (event.payload as { reason?: string }).reason === "close",
      ),
    ).toBe(true)
    expect(manager.claimWorkspacePane("workspace", "pane", ["chat"], secondary.id)).toMatchObject({
      ok: true,
    })
  })

  it("keeps a gone renderer unavailable until did-finish-load", () => {
    manager.claimWorkspacePane("workspace", "pane", ["chat"], secondary.id)
    secondary.webContents.emit("render-process-gone", {}, { reason: "crashed" })

    expect(secondary.webContents.destroyed).toBe(false)
    expect(manager.findByStableId("workspace-secondary")).toBeUndefined()
    expect(manager.focusWorkspacePaneOwner("workspace", "pane")).toBe(false)
    expect(manager.claimWorkspacePane("workspace", "pane", ["chat"], secondary.id)).toMatchObject({
      ok: false,
    })

    secondary.webContents.emit("did-finish-load")
    expect(manager.findByStableId("workspace-secondary")).toBe(secondary)
    expect(manager.claimWorkspacePane("workspace", "pane", ["chat"], secondary.id)).toMatchObject({
      ok: true,
    })
  })

  it("keeps a registered stable identity unique while its renderer recovers", () => {
    secondary.webContents.emit("render-process-gone", {}, { reason: "crashed" })

    expect(manager.findByStableId("workspace-secondary")).toBeUndefined()
    expect(manager.findRegisteredByStableId("workspace-secondary")).toBe(secondary)
    expect(manager.focusStableWindow("workspace-secondary")).toBe("recovering")
    expect(() => register(manager, 3, "workspace-secondary")).toThrow(
      "Stable window identity workspace-secondary is already registered.",
    )
    expect(manager.count()).toBe(2)
    expect(manager.claimWorkspacePane("workspace", "pane", ["chat"], secondary.id)).toMatchObject({
      ok: false,
    })

    secondary.webContents.emit("did-finish-load")
    expect(manager.focusStableWindow("workspace-secondary")).toBe("focused")
    expect(secondary.focused).toBe(true)
    expect(manager.claimWorkspacePane("workspace", "pane", ["chat"], secondary.id)).toMatchObject({
      ok: true,
    })
    expect(manager.findRegisteredByStableId("workspace-secondary")).toBe(secondary)
    expect(manager.count()).toBe(2)
  })

  it("rejects a managed gone renderer returned by Electron focused-window fallback", () => {
    secondary.focus()
    electronState.focusedWindow = secondary
    secondary.webContents.emit("render-process-gone", {}, { reason: "crashed" })

    expect(manager.getFocused()).toBeNull()
    secondary.webContents.emit("did-finish-load")
    expect(manager.getFocused()).toBe(secondary)
  })

  it("cleans reacquired authority after crash, reload, and later close", () => {
    manager.claimWorkspacePane("workspace", "pane", ["chat"], main.id)
    main.webContents.emit("render-process-gone", {}, { reason: "crashed" })
    main.webContents.emit("did-finish-load")
    expect(manager.claimWorkspacePane("workspace", "pane", ["chat"], main.id)).toMatchObject({
      ok: true,
    })
    const closeEventsBefore = secondary.webContents.sent.filter(
      (event) =>
        event.channel === "workspace-window:ownership-changed" &&
        (event.payload as { reason?: string }).reason === "close",
    ).length

    main.emit("closed")

    const closeEventsAfter = secondary.webContents.sent.filter(
      (event) =>
        event.channel === "workspace-window:ownership-changed" &&
        (event.payload as { reason?: string }).reason === "close",
    ).length
    expect(closeEventsAfter).toBe(closeEventsBefore + 1)
    expect(manager.claimWorkspacePane("workspace", "pane", ["chat"], secondary.id)).toMatchObject({
      ok: true,
    })
  })

  it("treats destroyed webContents as stale even before close cleanup runs", () => {
    manager.claimWorkspacePane("workspace", "pane", ["chat"], main.id)
    main.webContents.destroyed = true

    expect(manager.claimWorkspacePane("workspace", "pane", ["chat"], secondary.id)).toMatchObject({
      ok: true,
    })
  })

  it("does not focus or find dead renderer windows for direct chat or stable identities", () => {
    manager.claimChat("direct-chat", secondary.id)
    secondary.webContents.destroyed = true

    expect(manager.focusChatOwner("direct-chat")).toBe(false)
    expect(manager.findByStableId("workspace-secondary")).toBeUndefined()
    expect(manager.getFocused()).toBe(main)
    expect(manager.claimChat("direct-chat", main.id)).toEqual({ ok: true })
  })

  it("releases a removed A binding when the same pane changes to B", () => {
    manager.claimWorkspacePane("workspace", "pane", ["chat-a"], main.id)
    manager.claimWorkspacePane("workspace", "pane", ["chat-b"], main.id)

    expect(manager.getChatOwner("chat-a")).toBeUndefined()
    expect(manager.getChatOwner("chat-b")).toBe(main.id)
    expect(manager.claimWorkspacePane("other", "pane-a", ["chat-a"], secondary.id)).toMatchObject({
      ok: true,
    })
    const releaseEvent = [...secondary.webContents.sent]
      .reverse()
      .find(
        (event) =>
          event.channel === "workspace-window:ownership-changed" &&
          (event.payload as { workspaceId?: string }).workspaceId === "workspace",
      )
    expect((releaseEvent?.payload as { chatIds: string[] }).chatIds).toEqual(["chat-b", "chat-a"])
  })

  it("compare-releases only the currently bound pane target", () => {
    manager.claimWorkspacePane("workspace", "pane", ["chat-a"], main.id)
    manager.claimWorkspacePane("workspace", "pane", ["chat-b"], main.id)

    manager.releaseWorkspacePane("workspace", "pane", ["chat-a"], main.id)
    expect(manager.getWorkspacePaneOwner("workspace", "pane")).toBe(main.id)
    expect(manager.getChatOwner("chat-b")).toBe(main.id)

    manager.releaseWorkspacePane("workspace", "pane", ["chat-b"], main.id)
    expect(manager.getWorkspacePaneOwner("workspace", "pane")).toBeUndefined()
    expect(manager.getChatOwner("chat-b")).toBeUndefined()
  })

  it("compare-releases zero-chat panes without matching a changed binding", () => {
    manager.claimWorkspacePane("workspace", "pane", [], main.id)

    manager.releaseWorkspacePane("workspace", "pane", ["unexpected-chat"], main.id)
    expect(manager.getWorkspacePaneOwner("workspace", "pane")).toBe(main.id)

    manager.releaseWorkspacePane("workspace", "pane", [], main.id)
    expect(manager.getWorkspacePaneOwner("workspace", "pane")).toBeUndefined()
  })

  it("keeps A claimed when another pane in the same window still references it", () => {
    manager.claimWorkspacePane("workspace", "pane-one", ["chat-a"], main.id)
    manager.claimWorkspacePane("workspace", "pane-two", ["chat-a"], main.id)
    manager.claimWorkspacePane("workspace", "pane-one", ["chat-b"], main.id)

    expect(manager.getChatOwner("chat-a")).toBe(main.id)
    expect(manager.claimWorkspacePane("other", "pane-a", ["chat-a"], secondary.id)).toMatchObject({
      ok: false,
      ownerStableId: "main",
    })
  })

  it("preserves an explicit open-chat claim when a workspace pane changes binding", () => {
    expect(manager.claimChat("chat-a", main.id)).toEqual({ ok: true })
    manager.claimWorkspacePane("workspace", "pane", ["chat-a"], main.id)
    manager.claimWorkspacePane("workspace", "pane", ["chat-b"], main.id)

    expect(manager.getChatOwner("chat-a")).toBe(main.id)
  })

  it("cleans close ownership and recovers after a fresh manager restart", () => {
    manager.claimWorkspacePane("workspace", "pane", ["chat"], secondary.id)
    secondary.emit("closed")
    expect(manager.getChatOwner("chat")).toBeUndefined()

    const restarted = new WindowManager()
    const restoredMain = register(restarted, 10)
    expect(
      restarted.claimWorkspacePane("workspace", "pane", ["chat"], restoredMain.id),
    ).toMatchObject({ ok: true })
  })

  it("derives deterministic bounded stable identities", () => {
    expect(stableWorkspaceWindowId("workspace", "pane")).toBe(
      stableWorkspaceWindowId("workspace", "pane"),
    )
    expect(stableWorkspaceWindowId("workspace", "pane")).not.toBe(
      stableWorkspaceWindowId("workspace", "other-pane"),
    )
    expect(stableWorkspaceRemainderWindowId("workspace", "pane")).toHaveLength(44)
    expect(stableWorkspaceRootWindowId("workspace")).toHaveLength(39)
  })
})
