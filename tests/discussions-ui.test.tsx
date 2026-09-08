// @vitest-environment jsdom
import { act, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  quoteOccurrences,
  selectedMessageQuote,
} from "../src/renderer/features/discussions/annotation-source"
import { discussionDraftKey } from "../src/renderer/features/discussions/use-discussions"
import { DiscussionAnnotationProvider } from "../src/renderer/features/discussions/discussion-annotation-provider"
import { DiscussionQuestion } from "../src/renderer/features/discussions/discussion-question"
import type { DiscussionTopic } from "../src/shared/discussions"

vi.mock("../src/renderer/lib/trpc", () => ({ trpc: {}, trpcClient: {} }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const scope = { projectId: "project", chatId: "chat", hostId: "local" }
const topic = { id: "topic", scope, revision: 1 } as DiscussionTopic
const question = {
  id: "q-1",
  prompt: "Choose destination",
  choices: [{ id: "a", label: "Alpha" }],
  blocking: false,
  createdAt: 1,
  draft: { choiceIds: [], text: "" },
  answers: [],
}
afterEach(() => {
  document.body.replaceChildren()
  window.localStorage.clear()
  window.getSelection()?.removeAllRanges()
})
describe("discussion source and question boundaries", () => {
  it("keeps chat mounted when annotation scope becomes available", async () => {
    const mounted = vi.fn()
    const unmounted = vi.fn()
    function Chat() {
      useEffect(() => {
        mounted()
        return unmounted
      }, [])
      return <p>Chat</p>
    }
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <DiscussionAnnotationProvider scope={null} subChatId="sub">
          <Chat />
        </DiscussionAnnotationProvider>,
      ),
    )
    await act(async () =>
      root.render(
        <DiscussionAnnotationProvider scope={scope} subChatId="sub">
          <Chat />
        </DiscussionAnnotationProvider>,
      ),
    )
    expect(mounted).toHaveBeenCalledTimes(1)
    expect(unmounted).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
  it("rejects corrupt saved drafts without overwriting recovery data", async () => {
    const key = discussionDraftKey(scope, question.id)
    window.localStorage.setItem(key, "null")
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <DiscussionQuestion
          topic={topic}
          question={question}
          scope={scope}
          change={vi.fn()}
          busy={false}
        />,
      ),
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("invalid")
    expect(window.localStorage.getItem(key)).toBe("null")
    await act(async () => root.unmount())
  })
  it("preserves repeated quote positions and refuses cross-message selection", () => {
    expect(quoteOccurrences("same then same", "same")).toEqual([0, 10])
    document.body.innerHTML =
      '<div data-user-message-id="one">User text</div><div data-assistant-message-id="two">Assistant text</div>'
    const range = document.createRange()
    range.selectNodeContents(document.body.firstElementChild!)
    window.getSelection()!.addRange(range)
    expect(selectedMessageQuote("one")).toBe("User text")
    expect(selectedMessageQuote("two")).toBeUndefined()
    range.setEnd(document.body.lastElementChild!.firstChild!, 5)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    expect(selectedMessageQuote("one")).toBeUndefined()
  })
  it("retains choice drafts across remount and never submits while changing or reading", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    let root = createRoot(container)
    const change = vi.fn().mockResolvedValue({ ...topic, revision: 2 })
    const render = () => (
      <DiscussionQuestion
        topic={topic}
        question={question}
        scope={scope}
        change={change}
        busy={false}
      />
    )
    await act(async () => root.render(render()))
    await act(async () =>
      (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
    )
    expect(change).not.toHaveBeenCalled()
    await act(async () => root.unmount())
    root = createRoot(container)
    await act(async () => root.render(render()))
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(
      true,
    )
    expect(change).not.toHaveBeenCalled()
    await act(async () =>
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    )
    expect(change).toHaveBeenCalledWith(topic, {
      type: "answer",
      questionId: "q-1",
      answer: { choiceIds: ["a"], text: "" },
    })
    await act(async () => root.unmount())
  })
})
