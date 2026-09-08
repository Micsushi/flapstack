// @vitest-environment jsdom
import { DiscussionAnnotationThread } from "../src/renderer/features/discussions/discussion-annotation-thread"
import type { DiscussionTopic } from "../src/shared/discussions"
import type { useDiscussions } from "../src/renderer/features/discussions/use-discussions"
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
  return {
    scope,
    topic,
    promoted,
    loadMore: vi.fn(),
    read: vi.fn(),
    invalidate: vi.fn(),
    preview: vi.fn(),
  }
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
      imagePreview: {
        useQuery: (input: unknown) => {
          fixture.preview(input)
          return {
            data: {
              available: true,
              imageSnapshot: {
                dataUrl: "data:image/png;base64,c3ludGhldGlj",
                width: 100,
                height: 100,
              },
            },
          }
        },
      },
      sources: {
        useQuery: () => ({
          data: [
            {
              messageId: "message",
              role: "user",
              revision: "original",
              text: "Exact durable source",
              images: [{ partIndex: 2, imageIdentity: "second-image" }],
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

it("previews the verified current image and overlays numeric region controls", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () =>
    root.render(
      <DiscussionAnnotationProvider scope={fixture.scope} subChatId="sub">
        <DiscussionAnnotationAction messageId="message" role="user" />
      </DiscussionAnnotationProvider>,
    ),
  )
  await act(async () =>
    (
      container.querySelector(
        'button[aria-label="Annotate user message text or image"]',
      ) as HTMLButtonElement
    ).click(),
  )
  const select = container.querySelector("select")!
  await act(async () => {
    select.value = "second-image"
    select.dispatchEvent(new Event("change", { bubbles: true }))
  })
  expect(container.querySelector('img[alt="Current source image"]')?.getAttribute("src")).toBe(
    "data:image/png;base64,c3ludGhldGlj",
  )
  expect(fixture.preview).toHaveBeenLastCalledWith({
    scope: fixture.scope,
    source: {
      subChatId: "sub",
      messageId: "message",
      role: "user",
      revision: "original",
      target: {
        kind: "image",
        partIndex: 2,
        imageIdentity: "second-image",
        region: { x: 0, y: 0, width: 1, height: 1 },
      },
    },
  })
  const input = container.querySelector('input[type="number"]') as HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "25")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(container.querySelector("[data-image-region-overlay]")).toBeNull()
  expect(container.textContent).toContain("Region must stay inside the image.")
  await act(async () => root.unmount())
  container.remove()
})

it("retains saved crop and percentages after remount and a changed source, without trusting external preview URLs", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  let root = createRoot(container)
  const topic = structuredClone(fixture.topic) as unknown as DiscussionTopic
  const annotation = topic.annotations[0]!
  annotation.source = {
    subChatId: "sub",
    messageId: "message",
    role: "user",
    revision: "saved-revision",
    target: {
      kind: "image",
      partIndex: 2,
      imageIdentity: "second-image",
      region: { x: 0.25, y: 0.1, width: 0.5, height: 0.4 },
    },
  }
  annotation.imageSnapshot = { dataUrl: "data:image/png;base64,c2F2ZWQ=", width: 50, height: 40 }
  const store = { busy: false, refresh: vi.fn(), change: vi.fn() } as unknown as ReturnType<
    typeof useDiscussions
  >
  const render = () => (
    <DiscussionAnnotationThread
      topic={topic}
      annotation={annotation}
      scope={fixture.scope}
      store={store}
    />
  )
  await act(async () => root.render(render()))
  expect(container.textContent).toContain("Source changed")
  expect(container.textContent).toContain("Left 25%, Top 10%, Width 50%, Height 40%")
  expect(container.textContent).not.toContain("Image 3")
  expect(container.textContent).toContain("Local image questions use this selected crop")
  await act(async () => root.unmount())
  root = createRoot(container)
  await act(async () => root.render(render()))
  expect(
    container.querySelector('img[alt="Saved selected image region"]')?.getAttribute("src"),
  ).toBe("data:image/png;base64,c2F2ZWQ=")
  annotation.imageSnapshot = {
    dataUrl: "https://untrusted.invalid/image.png",
    width: 50,
    height: 40,
  }
  await act(async () => root.render(render()))
  expect(container.querySelector("img")).toBeNull()
  expect(container.textContent).toContain("cannot inspect this image")
  await act(async () => root.unmount())
  container.remove()
})
