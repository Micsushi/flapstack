import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, it, vi } from "vitest"

const electronState = vi.hoisted(() => ({ focusedWindow: null as FakeWindow | null }))

vi.mock("electron", () => ({
  BrowserWindow: { getFocusedWindow: () => electronState.focusedWindow },
}))
vi.mock("../src/main/lib/git/watcher/ipc-bridge", () => ({
  cleanupWindowSubscriptions: vi.fn(),
}))

import { WindowManager } from "../src/main/windows/window-manager"

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
})
