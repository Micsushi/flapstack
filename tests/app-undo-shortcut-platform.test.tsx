// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

import { WindowsTitleBar } from "../src/renderer/components/windows-title-bar"
import {
  clearAppActionHistory,
  getAppActionHistorySnapshot,
  recordAppAction,
} from "../src/renderer/lib/app-action-history"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null

type DesktopApi = {
  platform: NodeJS.Platform
  getWindowFrameState: () => Promise<boolean>
  showApplicationMenu: () => Promise<void>
}

async function renderTitleBar(platform: NodeJS.Platform, hasNativeFrame: boolean) {
  const desktopApi: DesktopApi = {
    platform,
    getWindowFrameState: async () => hasNativeFrame,
    showApplicationMenu: async () => {},
  }
  ;(window as unknown as { desktopApi: DesktopApi }).desktopApi = desktopApi
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(React.createElement(WindowsTitleBar, {}))
  })
  // Let the asynchronous frame-state probe settle before asserting.
  await act(async () => {})
}

function pressUndoShortcut(useMetaKey: boolean) {
  const event = new KeyboardEvent("keydown", {
    key: "z",
    bubbles: true,
    cancelable: true,
    ctrlKey: !useMetaKey,
    metaKey: useMetaKey,
  })
  document.body.dispatchEvent(event)
  return event
}

beforeEach(() => {
  clearAppActionHistory()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container = null
  document.body.innerHTML = ""
  delete (window as unknown as { desktopApi?: DesktopApi }).desktopApi
  clearAppActionHistory()
})

describe("global app undo shortcut", () => {
  it("drives undo only where the Windows frameless controls are rendered", async () => {
    const undo = vi.fn()
    recordAppAction({ label: "Move Chat", undo, redo: vi.fn() })
    await renderTitleBar("win32", false)

    expect(container?.querySelector('button[aria-label^="Undo"]')).not.toBeNull()

    const event = pressUndoShortcut(false)
    await act(async () => {})

    expect(undo).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it.each<[NodeJS.Platform, boolean, string]>([
    ["darwin", false, "macOS"],
    ["linux", false, "Linux"],
    ["win32", true, "Windows with a native frame"],
  ])("leaves the shortcut inert on %s", async (platform, hasNativeFrame) => {
    const undo = vi.fn()
    recordAppAction({ label: "Move Chat", undo, redo: vi.fn() })
    await renderTitleBar(platform, hasNativeFrame)

    // No affordance is rendered, so the shortcut must not be claimed either.
    expect(container?.innerHTML).toBe("")

    const ctrlEvent = pressUndoShortcut(false)
    const metaEvent = pressUndoShortcut(true)
    await act(async () => {})

    expect(undo).not.toHaveBeenCalled()
    expect(ctrlEvent.defaultPrevented).toBe(false)
    expect(metaEvent.defaultPrevented).toBe(false)
    // The action stays available for a platform-native undo affordance.
    expect(getAppActionHistorySnapshot()).toMatchObject({ canUndo: true, undoLabel: "Move Chat" })
  })
})
