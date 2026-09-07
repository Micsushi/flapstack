// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDesktopNotifications } from "../src/renderer/features/agents/hooks/use-desktop-notifications"

const settings = vi.hoisted(() => ({ enabled: true }))
vi.mock("jotai", () => ({ useAtomValue: () => settings.enabled }))
vi.mock("../src/renderer/lib/atoms", () => ({
  desktopNotificationsEnabledAtom: {},
  notifyWhenFocusedAtom: {},
}))
vi.mock("../src/renderer/lib/utils/platform", () => ({ isDesktopApp: () => true }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe("task notification delivery", () => {
  let api: ReturnType<typeof useDesktopNotifications>
  let root: ReturnType<typeof createRoot>
  let container: HTMLDivElement
  const deliver = vi.fn()
  function Harness() {
    api = useDesktopNotifications()
    return null
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-06T12:00:00Z"))
    settings.enabled = true
    deliver.mockReset()
    Object.defineProperty(window, "desktopApi", {
      configurable: true,
      value: { showNotification: deliver },
    })
    container = document.createElement("div")
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    vi.useRealTimers()
    container.remove()
  })

  it("preserves simultaneous alerts for different tasks and their exact targets", () => {
    for (const subChatId of ["a", "b", "c"]) {
      api.notifyAgentComplete(subChatId, { chatId: "project-chat", subChatId })
    }
    vi.runAllTimers()
    expect(deliver.mock.calls.map(([event]) => event.subChatId)).toEqual(["a", "b", "c"])
    expect(deliver.mock.calls.every(([event]) => event.chatId === "project-chat")).toBe(true)
  })

  it("coalesces the same task with error priority without losing another task", () => {
    const target = { chatId: "chat", subChatId: "a" }
    api.notifyAgentComplete("A", target)
    api.notifyAgentError("A failed", target)
    api.notifyAgentComplete("A", target)
    api.notifyAgentComplete("B", { chatId: "chat", subChatId: "b" })
    vi.runAllTimers()
    expect(deliver.mock.calls.map(([event]) => [event.subChatId, event.title])).toEqual([
      ["a", "Agent Complete"],
      ["b", "Agent Complete"],
      ["a", "Agent Error"],
    ])
  })

  it("cancels pending delivery when notifications are disabled", async () => {
    const target = { chatId: "chat", subChatId: "a" }
    api.notifyAgentComplete("A", target)
    api.notifyAgentError("A failed", target)
    settings.enabled = false
    await act(async () => root.render(<Harness />))
    vi.runAllTimers()
    expect(deliver).toHaveBeenCalledTimes(1)
  })

  it("releases task timers after a four-task burst and allows a later immediate alert", () => {
    for (let update = 0; update < 25; update++) {
      for (const subChatId of ["a", "b", "c", "d"]) {
        api.notifyAgentComplete(subChatId, { chatId: "chat", subChatId })
      }
    }
    expect(deliver).toHaveBeenCalledTimes(4)
    expect(vi.getTimerCount()).toBe(4)
    vi.runAllTimers()
    expect(deliver).toHaveBeenCalledTimes(8)
    expect(vi.getTimerCount()).toBe(0)
    api.notifyAgentComplete("A", { chatId: "chat", subChatId: "a" })
    expect(deliver).toHaveBeenCalledTimes(9)
  })

  it("cancels pending delivery on unmount", async () => {
    api.notifyAgentComplete("A", { chatId: "chat" })
    api.notifyAgentError("A failed", { chatId: "chat" })
    await act(async () => root.render(null))
    vi.runAllTimers()
    expect(deliver).toHaveBeenCalledTimes(1)
  })
})
