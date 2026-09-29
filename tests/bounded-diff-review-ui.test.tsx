// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { BoundedDiffReview } from "../src/renderer/features/agents/ui/bounded-diff-review"

const state = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpcClient: { chats: { getDiffReview: { subscribe: state.subscribe } } },
}))
const file = {
  key: "a->a",
  oldPath: "a",
  newPath: "a",
  diffText: "",
  isBinary: false,
  additions: 3000,
  deletions: 0,
  observedDiffHash: "a".repeat(64),
}
let root: ReturnType<typeof createRoot> | undefined
let container: HTMLDivElement
afterEach(async () => {
  await act(async () => root?.unmount())
  container?.remove()
  vi.clearAllMocks()
})
async function mount(props: Partial<React.ComponentProps<typeof BoundedDiffReview>> = {}) {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  state.subscribe.mockReturnValue({ unsubscribe: state.unsubscribe })
  await act(async () => root!.render(<BoundedDiffReview chatId="chat" file={file} {...props} />))
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text)
  if (!button) throw new Error(`Missing ${text}`)
  await act(async () => button.click())
}
it("loads one section, attaches comments only to displayed complete lines and cancels transport", async () => {
  const onComment = vi.fn()
  await mount({ onComment })
  await click("Review large diff")
  const callbacks = state.subscribe.mock.calls[0][1]
  await act(async () =>
    callbacks.onData({
      kind: "text",
      offset: 0,
      total: 400,
      next: 200,
      rows: [
        { text: "+new", right: 10, left: null, truncated: false },
        { text: "+long", right: 11, left: null, truncated: true },
      ],
    }),
  )
  expect(container.querySelectorAll('button[aria-label^="Comment on"]')).toHaveLength(1)
  await click("Comment")
  expect(onComment).toHaveBeenCalledWith(file, { start: 10, end: 10, side: "additions" })
  await click("Next section")
  expect(state.subscribe.mock.calls[1][0].offset).toBe(200)
  await click("Cancel loading")
  expect(state.unsubscribe).toHaveBeenCalledTimes(2)
  expect(container.textContent).toContain("Other rows are not loaded")
})
it("shows exact before/after identities and meaningful added/deleted sides", async () => {
  await mount({ file: { ...file, isBinary: true } })
  await click("Preview images")
  await act(async () =>
    state.subscribe.mock.calls[0][1].onData({
      kind: "image",
      before: null,
      after: { hash: "pixel-hash", dataUrl: "data:image/png;base64,a" },
    }),
  )
  expect(container.textContent).toContain("New image")
  expect(container.textContent).toContain("pixel-hash")
  expect(container.querySelector("img")?.getAttribute("alt")).toBe("After a")
})
it("keeps errors actionable and refuses unverified remote patches", async () => {
  await mount()
  await click("Review large diff")
  await act(async () =>
    state.subscribe.mock.calls[0][1].onError(
      new Error("Diff changed. Refresh before loading this section."),
    ),
  )
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Refresh")
  await act(async () =>
    root!.render(
      <BoundedDiffReview chatId="chat" file={{ ...file, observedDiffHash: undefined }} />,
    ),
  )
  expect(container.querySelector("button")?.disabled).toBe(true)
})
