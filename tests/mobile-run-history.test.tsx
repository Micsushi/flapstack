// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { MobileChatHeader } from "../src/renderer/features/agents/ui/mobile-chat-header"

vi.mock("../src/renderer/features/agents/stores/sub-chat-store", () => ({
  useAgentSubChatStore: (selector: (state: unknown) => unknown) =>
    selector({ activeSubChatId: null, allSubChats: [] }),
}))
vi.mock("../src/renderer/features/details-sidebar/sections/run-history-widget", () => ({
  RunHistoryWidget: ({ chatId }: { chatId: string }) => (
    <p data-history-chat={chatId}>Recorded context for {chatId}</p>
  ),
}))
let root: Root, container: HTMLDivElement
beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
async function render(chatId: string) {
  await act(async () => root.render(<MobileChatHeader historyChatId={chatId} />))
}
async function open() {
  const trigger = container.querySelector('[aria-label="Run history"]') as HTMLButtonElement
  trigger.focus()
  await act(async () => {
    trigger.click()
  })
  return trigger
}
it("opens existing history for the exact chat and returns focus on Back to chat", async () => {
  await render("chat-a")
  const trigger = await open()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Run history")
  expect(document.querySelector('[data-history-chat="chat-a"]')).not.toBeNull()
  const back = [...document.querySelectorAll("button")].find(
    (button) => button.textContent === "Back to chat",
  )!
  await act(async () => {
    back.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
it("closes on chat switch and Escape, never carrying the old open history into the next chat", async () => {
  await render("chat-a")
  await open()
  await render("chat-b")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await open()
  expect(document.querySelector('[data-history-chat="chat-a"]')).toBeNull()
  expect(document.querySelector('[data-history-chat="chat-b"]')).not.toBeNull()
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  )
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
