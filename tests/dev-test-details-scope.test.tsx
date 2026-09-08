// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { DevTestControlBridge } from "../src/renderer/features/settings/dev-test-control-bridge"
import { appStore } from "../src/renderer/lib/jotai-store"
import { selectedAgentChatIdAtom } from "../src/renderer/features/agents/atoms"
import {
  detailsSidebarOpenAtom,
  detailsSidebarOpenAtomFamily,
} from "../src/renderer/features/details-sidebar/atoms"
import {
  AgentSubChatStoreScope,
  getMountedAgentSubChatStore,
  useAgentSubChatStore,
} from "../src/renderer/features/agents/stores/sub-chat-store"

vi.mock("../src/renderer/lib/trpc", () => {
  const utils = {
    projects: { list: { invalidate: async () => {}, fetch: async () => [{ id: "project" }] } },
    chats: {
      list: { invalidate: async () => {}, fetch: async () => [{ id: "a", projectId: "project" }] },
      get: { invalidate: async () => {}, fetch: async () => ({ id: "a", projectId: "project" }) },
    },
  }
  return { trpc: { useUtils: () => utils } }
})
let root: Root, container: HTMLDivElement, request: (value: any) => Promise<void>
const respond = vi.fn()
beforeEach(async () => {
  window.desktopApi = {
    onDevRendererControlRequest: (handler: any) => {
      request = handler
      return () => {}
    },
    respondDevRendererControl: respond,
  } as any
  respond.mockClear()
  appStore.set(detailsSidebarOpenAtom, true)
  appStore.set(detailsSidebarOpenAtomFamily("a"), false)
  appStore.set(detailsSidebarOpenAtomFamily("b"), true)
  appStore.set(selectedAgentChatIdAtom, "a")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <>
        <AgentSubChatStoreScope chatId="a">
          <span />
        </AgentSubChatStoreScope>
        <AgentSubChatStoreScope chatId="b">
          <span />
        </AgentSubChatStoreScope>
        <DevTestControlBridge />
      </>,
    ),
  )
  getMountedAgentSubChatStore("a")!.setState({ chatId: "a", activeSubChatId: "pane-a" })
  getMountedAgentSubChatStore("b")!.setState({ chatId: "b", activeSubChatId: "pane-b" })
  useAgentSubChatStore.setState({ chatId: "b", activeSubChatId: "global-stale-pane-b" })
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
async function send(command: string, extra: Record<string, unknown> = {}) {
  await act(async () => request({ requestId: "test", command, ...extra }))
  return respond.mock.lastCall![0].state
}
it("reads selected chat Details and mounted pane instead of legacy global projection", async () => {
  expect(await send("orchestration.get", { taskId: "task-a" })).toMatchObject({
    selectedChatId: "a",
    detailsOpen: false,
    activeSubChatId: "pane-a",
  })
  appStore.set(selectedAgentChatIdAtom, "b")
  expect(await send("orchestration.get", { taskId: "task-b" })).toMatchObject({
    selectedChatId: "b",
    detailsOpen: true,
    activeSubChatId: "pane-b",
  })
  appStore.set(selectedAgentChatIdAtom, "unmounted")
  expect(await send("orchestration.get", { taskId: "task-c" })).toMatchObject({
    detailsOpen: false,
    activeSubChatId: null,
  })
  appStore.set(selectedAgentChatIdAtom, null)
  expect(await send("orchestration.get", { taskId: "task-c" })).toMatchObject({
    detailsOpen: false,
    activeSubChatId: null,
  })
})
it("opens only the requested chat and reports its state even while another chat is selected", async () => {
  appStore.set(selectedAgentChatIdAtom, "b")
  appStore.set(detailsSidebarOpenAtomFamily("b"), false)
  appStore.set(detailsSidebarOpenAtom, false)
  const state = await send("mcp.control", { chatId: "a", operation: "open-audit" })
  expect(state).toMatchObject({
    chatId: "a",
    selectedChatId: "b",
    detailsOpen: true,
    auditOpen: true,
  })
  expect(appStore.get(detailsSidebarOpenAtomFamily("a"))).toBe(true)
  expect(appStore.get(detailsSidebarOpenAtomFamily("b"))).toBe(false)
  expect(appStore.get(detailsSidebarOpenAtom)).toBe(false)
  expect(await send("mcp.get", { chatId: "b" })).toMatchObject({ chatId: "b", detailsOpen: false })
})

it("chat.select opens the exact chat family and returns its mounted pane after visibility verification", async () => {
  appStore.set(detailsSidebarOpenAtom, false)
  const group = document.createElement("div")
  group.setAttribute("data-chat-group", "")
  group.dataset.activeChatId = "a"
  const transcript = document.createElement("div")
  transcript.setAttribute("data-chat-container", "")
  transcript.dataset.activeSubChatId = "pane-a"
  transcript.dataset.stage6PerformanceMessageCount = "0"
  group.append(transcript)
  container.append(group)
  const state = await send("chat.select", {
    chatId: "a",
    subChatId: "pane-a",
    project: { id: "project", name: "Fixture", path: "/fixture" },
    persistedMessages: [],
    showOrchestration: true,
  })
  expect(state).toMatchObject({ chatId: "a", subChatId: "pane-a", detailsOpen: true })
  expect(appStore.get(detailsSidebarOpenAtomFamily("a"))).toBe(true)
  expect(appStore.get(detailsSidebarOpenAtomFamily("b"))).toBe(true)
  expect(appStore.get(detailsSidebarOpenAtom)).toBe(false)
})
