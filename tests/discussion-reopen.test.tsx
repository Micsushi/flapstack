// @vitest-environment jsdom
import { DiscussionsView } from "../src/renderer/features/discussions/discussions-view"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import {
  DiscussionAnnotationAction,
  DiscussionAnnotationProvider,
} from "../src/renderer/features/discussions/discussion-annotation-provider"
const fixture = vi.hoisted(() => {
  const scope = { projectId: "project", chatId: "chat", hostId: "host" }
  const source = {
    subChatId: "sub",
    messageId: "message",
    role: "user",
    revision: "original",
    target: { kind: "text", quote: "Exact durable source", start: 0, end: 20 },
  }
  const base = {
    scope,
    revision: 3,
    status: "more-work",
    read: false,
    archived: false,
    summaryHistory: [],
    questions: [],
    captures: [],
    canonicalRecordIds: [],
  }
  const topic = {
    ...base,
    id: "parent",
    title: "Saved source topic",
    summary: "",
    annotations: [
      {
        id: "annotation",
        source,
        body: "Durable annotation",
        promotedTopicId: "promoted",
        followups: [
          { id: "reply", role: "assistant", model: "local-model", body: "Durable actual reply" },
        ],
      },
    ],
  }
  const promoted = {
    ...base,
    id: "promoted",
    title: "Promoted durable topic",
    summary: "Preserved finding",
    annotations: [],
  }
  return { scope, topic, promoted, loadMore: vi.fn(), read: vi.fn(), invalidate: vi.fn() }
})
vi.mock("../src/renderer/lib/trpc", () => ({
  trpcClient: {},
  trpc: {
    useUtils: () => ({
      discussions: {
        list: { invalidate: fixture.invalidate },
        read: { invalidate: fixture.invalidate },
      },
    }),
    discussions: {
      list: {
        useInfiniteQuery: () => ({
          data: { pages: [{ topics: [fixture.topic], nextCursor: { id: "older", updatedAt: 1 } }] },
          hasNextPage: true,
          fetchNextPage: fixture.loadMore,
        }),
      },
      sources: {
        useQuery: () => ({
          data: [
            {
              messageId: "message",
              role: "user",
              revision: "original",
              text: "Exact durable source",
              images: [],
            },
          ],
        }),
      },
      read: {
        useQuery: (input: { id: string }) => {
          fixture.read(input)
          return { data: input.id === "promoted" ? fixture.promoted : undefined }
        },
      },
    },
  },
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
it("reopens durable source annotations and promoted topics after close and full remount, retaining pagination", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  let root = createRoot(container)
  const render = () => (
    <DiscussionAnnotationProvider scope={fixture.scope} subChatId="sub">
      <DiscussionAnnotationAction messageId="message" role="user" />
    </DiscussionAnnotationProvider>
  )
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === label || button.textContent === label,
    )
    expect(button, label).toBeTruthy()
    await act(async () => button!.click())
  }
  const reopen = async () => {
    await click("Annotate user message text or image")
    await click("Load more saved annotations")
    await click("Saved source topicDurable annotation")
    expect(
      container.querySelector('[aria-label="Annotation conversation"]')?.textContent,
    ).toContain("Durable actual reply")
    expect(container.querySelector("blockquote")?.textContent).toBe("Exact durable source")
    await click("Open promoted topic")
    expect(container.textContent).toContain("Promoted durable topic")
    expect(container.textContent).toContain("Preserved finding")
    expect(fixture.read).toHaveBeenCalledWith({ scope: fixture.scope, id: "promoted" })
    await click("Back to annotation")
    await click("Back to chat")
    expect(container.querySelector("aside")).toBeNull()
  }
  await act(async () => root.render(render()))
  await reopen()
  await reopen()
  await act(async () => root.unmount())
  root = createRoot(container)
  await act(async () => root.render(render()))
  await reopen()
  expect(fixture.loadMore).toHaveBeenCalledTimes(3)
  await act(async () => root.unmount())
  container.remove()
})

it("opens an unloaded promoted child by scoped ID from a loaded parent", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<DiscussionsView scope={fixture.scope} />))
  const parent = [...container.querySelectorAll("nav button")].find((button) =>
    button.textContent?.includes("Saved source topic"),
  )
  expect(parent).toBeTruthy()
  await act(async () => (parent as HTMLButtonElement).click())
  const open = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Open promoted topic",
  )
  expect(open).toBeTruthy()
  await act(async () => (open as HTMLButtonElement).click())
  expect(container.querySelector("h2")?.textContent).toBe("Promoted durable topic")
  expect(fixture.read).toHaveBeenCalledWith({ scope: fixture.scope, id: "promoted" })
  expect(container.querySelector("nav")?.textContent).toContain("Load more topics")
  await act(async () => root.unmount())
  container.remove()
})
