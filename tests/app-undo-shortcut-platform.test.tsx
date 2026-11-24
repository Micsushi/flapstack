// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

import type { AppCommand } from "../src/shared/app-command"
import { AppCommandBridge } from "../src/renderer/components/app-command-bridge"
import { WindowsTitleBar } from "../src/renderer/components/windows-title-bar"
import { clearAppActionHistory, recordAppAction } from "../src/renderer/lib/app-action-history"

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
