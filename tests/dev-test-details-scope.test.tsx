// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useProjectSelectionGuard } from "../src/renderer/features/sidebar/use-project-selection-guard"
import { DevTestControlBridge } from "../src/renderer/features/settings/dev-test-control-bridge"
import { findDevVisibleTranscript } from "../src/renderer/features/settings/dev-test-visible-transcript"
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
  projectAgentSubChatStore,
} from "../src/renderer/features/agents/stores/sub-chat-store"

vi.mock("../src/renderer/lib/trpc", () => {
  const utils = {
    projects: {
      list: {
        invalidate: async () => {},
        fetch: async () => [{ id: "project" }, { id: "project-b" }],
      },
    },
    chats: {
      list: {
        invalidate: async () => {},
        fetch: async () => [
          { id: "a", projectId: "project" },
          { id: "b", projectId: "project-b" },
        ],
      },
      get: {
        invalidate: async () => {},
        fetch: async ({ id }: { id: string }) => ({
          id,
          projectId: id === "b" ? "project-b" : "project",
        }),
      },
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

it("chat.select verifies the selected mounted mobile pane without a desktop group", async () => {
  const mobile = document.createElement("div")
  mobile.dataset.mobileChatMode = ""
  const transcript = document.createElement("div")
  transcript.dataset.chatContainer = ""
  transcript.dataset.activeSubChatId = "pane-a"
  transcript.dataset.stage6PerformanceMessageCount = "0"
  vi.spyOn(transcript, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList)
  mobile.append(transcript)
  container.append(mobile)
  expect(
    await send("chat.select", {
      chatId: "a",
      subChatId: "pane-a",
      project: { id: "project", name: "Fixture", path: "/fixture" },
      persistedMessages: [],
      showOrchestration: true,
    }),
  ).toMatchObject({ chatId: "a", subChatId: "pane-a", detailsOpen: true })
})

it("rejects ambiguous, hidden, unselected and incorrectly mounted mobile transcripts", () => {
  const mobile = document.createElement("div")
  mobile.dataset.mobileChatMode = ""
  container.append(mobile)
  const pane = () => {
    const element = document.createElement("div")
    element.dataset.chatContainer = ""
    element.dataset.activeSubChatId = "pane-a"
    vi.spyOn(element, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList)
    mobile.append(element)
    return element
  }
  const first = pane()
  const input = {
    document,
    chatId: "a",
    subChatId: "pane-a",
    selectedChatId: "a",
    mountedState: getMountedAgentSubChatStore("a")!.getState(),
  }
  expect(findDevVisibleTranscript(input)).toBe(first)
  const duplicate = pane()
  expect(findDevVisibleTranscript(input)).toBeNull()
  duplicate.remove()
  expect(findDevVisibleTranscript({ ...input, selectedChatId: "b" })).toBeNull()
  expect(
    findDevVisibleTranscript({
      ...input,
      mountedState: getMountedAgentSubChatStore("b")!.getState(),
    }),
  ).toBeNull()
  expect(findDevVisibleTranscript({ ...input, subChatId: "pane-b" })).toBeNull()
  first.style.visibility = "hidden"
  expect(findDevVisibleTranscript(input)).toBeNull()
  first.style.visibility = "visible"
  vi.mocked(first.getClientRects).mockReturnValue([] as unknown as DOMRectList)
  expect(findDevVisibleTranscript(input)).toBeNull()
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

it("selecting B preserves the previously projected A store and selects B's mounted pane", async () => {
  const a = getMountedAgentSubChatStore("a")!
  const b = getMountedAgentSubChatStore("b")!
  a.setState({ chatId: "a", activeSubChatId: "pane-a", openSubChatIds: ["pane-a"] })
  b.setState({ chatId: "b", activeSubChatId: "other-pane-b", openSubChatIds: ["other-pane-b"] })
  projectAgentSubChatStore(a)
  const group = document.createElement("div")
  group.dataset.chatGroup = ""
  group.dataset.activeChatId = "b"
  const transcript = document.createElement("div")
  transcript.dataset.chatContainer = ""
  transcript.dataset.activeSubChatId = "pane-b"
  transcript.dataset.stage6PerformanceMessageCount = "0"
  group.append(transcript)
  container.append(group)
  const result = await send("chat.select", {
    chatId: "b",
    subChatId: "pane-b",
    project: { id: "project-b", name: "B", path: "/b" },
    persistedMessages: [],
    showOrchestration: false,
  })
  expect(result).toMatchObject({ chatId: "b", subChatId: "pane-b" })
  expect(a.getState()).toMatchObject({
    chatId: "a",
    activeSubChatId: "pane-a",
    openSubChatIds: ["pane-a"],
  })
  expect(b.getState()).toMatchObject({
    chatId: "b",
    activeSubChatId: "pane-b",
    openSubChatIds: ["other-pane-b", "pane-b"],
  })
})

it("preserves explicit cross-project selection but clears stale selection on project-only changes", async () => {
  let setProject!: React.Dispatch<React.SetStateAction<string | null>>
  let setChat!: React.Dispatch<React.SetStateAction<string | null>>
  let currentChat: string | null = null
  const chats = [
    { id: "a", projectId: "project" },
    { id: "b", projectId: "project-b" },
  ]
  function Selection() {
    const [project, updateProject] = React.useState<string | null>(null)
    const [chat, updateChat] = React.useState<string | null>("a")
    setProject = updateProject
    setChat = updateChat
    currentChat = chat
    useProjectSelectionGuard(project, chat, false, chats, () => updateChat(null))
    return <span>{chat}</span>
  }
  await act(async () => root.render(<Selection />))
  expect(currentChat).toBe("a")
  await act(async () => setProject("project"))
  expect(currentChat).toBe("a")
  await act(async () => {
    setProject("project-b")
    setChat("b")
  })
  expect(currentChat).toBe("b")
  await act(async () => setProject("project"))
  expect(currentChat).toBeNull()
  await act(async () => setChat("a"))
  await act(async () => setProject(null))
  expect(currentChat).toBeNull()
})
