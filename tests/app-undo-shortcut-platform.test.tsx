// @vitest-environment jsdom

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

import type { AppCommand } from "../src/shared/app-command"
import { AppCommandBridge } from "../src/renderer/components/app-command-bridge"
import { WindowsTitleBar } from "../src/renderer/components/windows-title-bar"
import {
  clearAppActionHistory,
  getAppActionHistorySnapshot,
  recordAppAction,
} from "../src/renderer/lib/app-action-history"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLDivElement | null = null
let emitAppCommand: ((command: AppCommand) => void) | null = null

type DesktopApi = {
  platform: NodeJS.Platform
  getWindowFrameState: () => Promise<boolean>
  showApplicationMenu: () => Promise<void>
  undo: () => Promise<void>
  redo: () => Promise<void>
  onAppCommand: (callback: (command: AppCommand) => void) => () => void
}

async function renderAppChrome(
  platform: NodeJS.Platform,
  hasNativeFrame: boolean,
  onNavigate = vi.fn(),
) {
  const desktopApi: DesktopApi = {
    platform,
    getWindowFrameState: async () => hasNativeFrame,
    showApplicationMenu: async () => {},
    undo: vi.fn(async () => {}),
    redo: vi.fn(async () => {}),
    onAppCommand: (callback) => {
      emitAppCommand = callback
      return () => {
        emitAppCommand = null
      }
    },
  }
  ;(window as unknown as { desktopApi: DesktopApi }).desktopApi = desktopApi
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <>
        <AppCommandBridge onNavigate={onNavigate} />
        <WindowsTitleBar />
      </>,
    )
  })
  await act(async () => {})
  return onNavigate
}

function pressHistoryShortcut({
  useMetaKey,
  redo = false,
  target = document.body,
}: {
  useMetaKey: boolean
  redo?: boolean
  target?: HTMLElement
}) {
  const event = new KeyboardEvent("keydown", {
    key: "z",
    bubbles: true,
    cancelable: true,
    ctrlKey: !useMetaKey,
    metaKey: useMetaKey,
    shiftKey: redo,
  })
  target.dispatchEvent(event)
  return event
}

beforeEach(() => {
  clearAppActionHistory()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  container = null
  emitAppCommand = null
  document.body.innerHTML = ""
  delete (window as unknown as { desktopApi?: DesktopApi }).desktopApi
  clearAppActionHistory()
})

describe("global app history shortcuts", () => {
  it.each<[NodeJS.Platform, boolean, boolean]>([
    ["linux", false, true],
    ["win32", false, true],
    ["win32", false, false],
  ])(
    "uses the platform-native primary modifier on %s",
    async (platform, useMetaKey, hasNativeFrame) => {
      const undo = vi.fn()
      const redo = vi.fn()
      recordAppAction({ label: "Move Chat", undo, redo })
      await renderAppChrome(platform, hasNativeFrame)

      const wrongModifierEvent = pressHistoryShortcut({ useMetaKey: !useMetaKey })
      const undoEvent = pressHistoryShortcut({ useMetaKey })
      await act(async () => {})

      expect(undo).toHaveBeenCalledOnce()
      expect(wrongModifierEvent.defaultPrevented).toBe(false)
      expect(undoEvent.defaultPrevented).toBe(true)
      expect(getAppActionHistorySnapshot()).toMatchObject({ canRedo: true })

      const redoEvent = pressHistoryShortcut({ useMetaKey, redo: true })
      await act(async () => {})

      expect(redo).toHaveBeenCalledOnce()
      expect(redoEvent.defaultPrevented).toBe(true)
    },
  )

  it("leaves Command+Z to the native macOS Edit menu", async () => {
    const undo = vi.fn()
    recordAppAction({ label: "Move Chat", undo, redo: vi.fn() })
    await renderAppChrome("darwin", true)

    const event = pressHistoryShortcut({ useMetaKey: true })
    await act(async () => {})

    expect(undo).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it("preserves native editing undo inside editable controls", async () => {
    const undo = vi.fn()
    recordAppAction({ label: "Move Chat", undo, redo: vi.fn() })
    await renderAppChrome("darwin", true)
    const input = document.createElement("input")
    document.body.appendChild(input)

    const event = pressHistoryShortcut({ useMetaKey: true, target: input })
    await act(async () => {})

    expect(undo).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(getAppActionHistorySnapshot()).toMatchObject({ canUndo: true })
  })

  it("accepts app history and navigation commands from the native menu", async () => {
    const undo = vi.fn()
    const onNavigate = await renderAppChrome("darwin", true)
    recordAppAction({ label: "Move Chat", undo, redo: vi.fn() })

    await act(async () => {
      emitAppCommand?.("history-undo")
      emitAppCommand?.("navigate-back")
      emitAppCommand?.("navigate-forward")
    })

    expect(undo).toHaveBeenCalledOnce()
    expect(onNavigate).toHaveBeenNthCalledWith(1, -1)
    expect(onNavigate).toHaveBeenNthCalledWith(2, 1)
  })

  it("routes native macOS menu history to an active text field", async () => {
    const appUndo = vi.fn()
    recordAppAction({ label: "Move Chat", undo: appUndo, redo: vi.fn() })
    await renderAppChrome("darwin", true)
    const input = document.createElement("input")
    document.body.appendChild(input)
    input.focus()

    await act(async () => {
      emitAppCommand?.("history-undo")
    })

    expect(appUndo).not.toHaveBeenCalled()
    expect(window.desktopApi.undo).toHaveBeenCalledOnce()
  })
})

describe("Windows title bar", () => {
  it("keeps its visual controls limited to the Windows frameless window", async () => {
    await renderAppChrome("win32", false)
    expect(container?.querySelector('button[aria-label="Back"]')).not.toBeNull()

    await act(async () => root?.unmount())
    root = null
    document.body.innerHTML = ""
    container = null

    await renderAppChrome("darwin", true)
    expect(container?.innerHTML).toBe("")
  })
})
