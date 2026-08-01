// @vitest-environment jsdom

import { act, createElement, useEffect, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../src/renderer/lib/trpc", () => ({ trpcClient: {} }))

import { ChatWorkbench } from "../src/renderer/features/agents/workbench/chat-workbench"
import {
  AgentSubChatStoreScope,
  getAgentSubChatStore,
  getMountedAgentSubChatStore,
  useAgentSubChatStore,
  useAgentSubChatStoreApi,
} from "../src/renderer/features/agents/stores/sub-chat-store"
import { createChatWorkbenchLayout, reduceChatWorkbench } from "../src/shared/chat-workbench"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function IsolatedPane({ chatId }: { chatId: string }) {
  return createElement(
    AgentSubChatStoreScope,
    { chatId },
    createElement(IsolatedPaneBody, { chatId }),
  )
}

function IsolatedPaneBody({ chatId }: { chatId: string }) {
  const store = useAgentSubChatStoreApi()
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  const [draft, setDraft] = useState("")
  const [runState, setRunState] = useState<"idle" | "streaming" | "error">("idle")

  useEffect(() => {
    const subChatId = `${chatId}-conversation`
    store.getState().setChatId(chatId)
    store.getState().setAllSubChats([{ id: subChatId, name: `${chatId} heading` }])
    store.getState().setOpenSubChats([subChatId])
    store.getState().setActiveSubChat(subChatId)
  }, [chatId, store])

  return (
    <section data-isolated-chat={chatId}>
      <h2>{`${chatId} heading`}</h2>
      <output data-active-subchat>{activeSubChatId}</output>
      <label>
        {`${chatId} draft`}
        <textarea
          aria-label={`${chatId} composer`}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      </label>
      <button type="button" onClick={() => setRunState("streaming")}>
        {`Send ${chatId}`}
      </button>
      <button type="button" onClick={() => setRunState("error")}>
        {`Fail ${chatId}`}
      </button>
      <output data-run-state>{runState}</output>
    </section>
  )
}

describe("Stage 6 simultaneous top-level Chat pane isolation", () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement("div")
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it("keeps four headings, drafts, selected conversations, run/error state, and focus independent", async () => {
    const chatIds = ["chat-a", "chat-b", "chat-c", "chat-d"]
    const layout = reduceChatWorkbench(createChatWorkbenchLayout(chatIds), {
      type: "apply-preset",
      preset: "grid-2x2",
    }).layout

    await act(async () =>
      root.render(
        createElement(ChatWorkbench, {
          chats: chatIds.map((id) => ({ id, name: id })),
          layout,
          viewport: { width: 1_200, height: 800 },
          onLayoutChange: vi.fn(),
          onActiveChatChange: vi.fn(),
          renderChat: (chatId: string) => createElement(IsolatedPane, { chatId }),
        }),
      ),
    )

    expect(container.querySelectorAll("[data-isolated-chat]")).toHaveLength(4)
    for (const chatId of chatIds) {
      expect(container.textContent).toContain(`${chatId} heading`)
      expect(getAgentSubChatStore(chatId).getState()).toMatchObject({
        chatId,
        activeSubChatId: `${chatId}-conversation`,
        openSubChatIds: [`${chatId}-conversation`],
      })
    }

    const composers = chatIds.map((chatId) =>
      container.querySelector<HTMLTextAreaElement>(`[aria-label="${chatId} composer"]`)!,
    )
    await act(async () => {
      composers.forEach((composer, index) => {
        composer.value = `draft-${index}`
        composer.dispatchEvent(new Event("input", { bubbles: true }))
      })
    })
    expect(composers.map((composer) => composer.value)).toEqual([
      "draft-0",
      "draft-1",
      "draft-2",
      "draft-3",
    ])

    composers[2].focus()
    expect(document.activeElement).toBe(composers[2])
    await act(async () => {
      for (const chatId of chatIds) {
        ;[...container.querySelectorAll("button")]
          .find((button) => button.textContent === `Send ${chatId}`)!
          .click()
      }
    })
    expect(
      [...container.querySelectorAll("[data-run-state]")].map((state) => state.textContent),
    ).toEqual(["streaming", "streaming", "streaming", "streaming"])

    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Fail chat-b")!
        .click(),
    )
    expect(
      [...container.querySelectorAll("[data-run-state]")].map((state) => state.textContent),
    ).toEqual(["streaming", "error", "streaming", "streaming"])

    act(() => getAgentSubChatStore("chat-a").getState().setActiveSubChat("chat-a-alternate"))
    expect(getAgentSubChatStore("chat-a").getState().activeSubChatId).toBe("chat-a-alternate")
    expect(getAgentSubChatStore("chat-b").getState().activeSubChatId).toBe("chat-b-conversation")
  })

  it("exposes only the exact mounted pane store to renderer test control", async () => {
    expect(getMountedAgentSubChatStore("chat-a")).toBeNull()

    await act(async () => root.render(createElement(IsolatedPane, { chatId: "chat-a" })))

    expect(getMountedAgentSubChatStore("chat-a")).toBe(getAgentSubChatStore("chat-a"))
    expect(getMountedAgentSubChatStore("chat-b")).toBeNull()

    await act(async () => root.render(createElement("div")))
    expect(getMountedAgentSubChatStore("chat-a")).toBeNull()
  })
})
