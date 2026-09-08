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
const flags = vi.hoisted(() => ({ orchestration: true }))
vi.mock("../src/renderer/features/settings/use-beta-features", () => ({
  useBetaFeatures: () => flags,
}))
vi.mock("../src/renderer/features/agents/ui/orchestration-review-panel", () => ({
  OrchestrationReviewPanel: ({
    projectId,
    taskId,
    onNavigate,
  }: {
    projectId: string
    taskId: string
    onNavigate: (id: string) => void
  }) => (
    <section aria-label="Run reviews" data-project={projectId} data-task={taskId}>
      <button onClick={() => onNavigate("reviewer-chat")}>Open reviewer chat</button>
    </section>
  ),
}))
import { clearAppActionHistory, recordAppAction } from "../src/renderer/lib/app-action-history"
let root: Root, container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  flags.orchestration = true
  clearAppActionHistory()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
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
  })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  // Radix restores focus in its deferred unmount effect after React commits the close.
  await act(async () => {
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger), { timeout: 1000 })
  })
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

async function button(name: string) {
  const target = [...document.querySelectorAll("button")].find((node) => node.textContent === name)!
  expect(target).toBeTruthy()
  await act(async () => target.click())
}
it("gates reviews by beta and exact task/project while lazily preserving history", async () => {
  const navigate = vi.fn()
  await act(async () =>
    root.render(
      <MobileChatHeader
        historyChatId="a"
        projectId="project-a"
        taskId="task-a"
        onNavigate={navigate}
      />,
    ),
  )
  await open()
  expect(document.querySelector('[aria-label="Run reviews"]')).toBeNull()
  await button("Run reviews")
  expect(document.querySelector('[data-project="project-a"][data-task="task-a"]')).not.toBeNull()
  await button("History")
  expect(document.querySelector('[data-history-chat="a"]')).not.toBeNull()
  await button("Run reviews")
  await button("Back to chat")
  await open()
  expect(document.querySelector('[data-task="task-a"]')).not.toBeNull()
  await button("Open reviewer chat")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(navigate).toHaveBeenCalledWith("reviewer-chat")
  flags.orchestration = false
  await act(async () =>
    root.render(
      <MobileChatHeader
        historyChatId="b"
        projectId="project-b"
        taskId="task-b"
        onNavigate={navigate}
      />,
    ),
  )
  await open()
  expect(document.querySelector('[aria-label="Run history view"]')).toBeNull()
  flags.orchestration = true
  await act(async () =>
    root.render(<MobileChatHeader historyChatId="c" projectId="project-c" onNavigate={navigate} />),
  )
  await open()
  expect(document.querySelector('[aria-label="Run history view"]')).toBeNull()
})
it("dispatches real chronological shared undo/redo in the modal and retains errors", async () => {
  const undo = vi.fn(),
    redo = vi.fn()
  recordAppAction({ label: "Save run review", undo, redo })
  await act(async () =>
    root.render(
      <MobileChatHeader historyChatId="a" projectId="p" taskId="t" onNavigate={() => {}} />,
    ),
  )
  await open()
  await button("Run reviews")
  await button("Undo Save run review")
  expect(undo).toHaveBeenCalledOnce()
  await button("Redo Save run review")
  expect(redo).toHaveBeenCalledOnce()
  await act(async () =>
    recordAppAction({
      label: "External action",
      undo: () => {
        throw new Error("Changed elsewhere")
      },
      redo,
    }),
  )
  await button("Undo External action")
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "Undo failed: Changed elsewhere",
  )
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
})

vi.mock("../src/renderer/features/agents/ui/mobile-worktree-access", () => ({
  MobileWorktreeAccess: ({
    projectId,
    taskId,
    onNavigate,
  }: {
    projectId: string
    taskId: string
    onNavigate: (id: string) => void
  }) => (
    <section data-worktree-task={taskId} data-worktree-project={projectId}>
      <button onClick={() => onNavigate("source-chat")}>Open worktree source</button>
    </section>
  ),
}))
it("mounts worktree access only on its choice and closes before exact navigation", async () => {
  const navigate = vi.fn()
  await act(async () =>
    root.render(
      <MobileChatHeader historyChatId="a" projectId="p" taskId="t" onNavigate={navigate} />,
    ),
  )
  await open()
  expect(document.querySelector("[data-worktree-task]")).toBeNull()
  await button("Worktree access")
  expect(
    document.querySelector('[data-worktree-task="t"][data-worktree-project="p"]'),
  ).not.toBeNull()
  await button("History")
  expect(document.querySelector("[data-worktree-task]")).toBeNull()
  await button("Worktree access")
  await button("Open worktree source")
  expect(navigate).toHaveBeenCalledWith("source-chat")
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
