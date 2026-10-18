// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
const mock = vi.hoisted(() => ({
  list: { data: [] as any[], isLoading: false, error: null, refetch: vi.fn() },
  ask: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  promote: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      sideQuestions: { list: { invalidate: mock.invalidate } },
      chats: { list: { invalidate: mock.invalidate } },
    }),
    sideQuestions: { list: { useQuery: () => mock.list } },
  },
  trpcClient: {
    sideQuestions: {
      list: { query: async () => mock.list.data },
      ask: { mutate: mock.ask },
      cancel: { mutate: mock.cancel },
      retry: { mutate: mock.retry },
      promote: { mutate: mock.promote },
    },
  },
}))
vi.mock("../src/renderer/lib/jotai-store", () => ({ appStore: { set: vi.fn() } }))
vi.mock("../src/renderer/features/agents/atoms", () => ({
  openAgentChatIdsAtom: {},
  selectedAgentChatIdAtom: {},
}))
vi.mock("../src/renderer/components/chat-markdown-renderer", () => ({
  ChatMarkdownRenderer: ({ content }: { content: string }) => <p>{content}</p>,
}))
import {
  SideQuestionPanel,
  sideQuestionSnapshot,
} from "../src/renderer/features/agents/main/side-question-panel"
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
const key = "flapstack:side-question:source"
const messages = [
  {
    id: "m",
    role: "assistant",
    parts: [
      { type: "text", text: "Tests are running" },
      { type: "reasoning", text: "PRIVATE" },
    ],
  },
]
const render = () =>
  act(async () =>
    root.render(<SideQuestionPanel subChatId="source" messages={messages} onClose={() => {}} />),
  )
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mock.list.data = []
  mock.ask.mockResolvedValue({})
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
function click(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label)!
  return act(async () => button.click())
}
it("sends captured visible context to the independent endpoint and clears acknowledged draft", async () => {
  localStorage.setItem(key, JSON.stringify({ text: "What is the progress?" }))
  await render()
  await click("Send")
  expect(mock.ask).toHaveBeenCalledOnce()
  expect(mock.ask.mock.calls[0][0]).toMatchObject({
    subChatId: "source",
    question: "What is the progress?",
    visibleMessages: [{ id: "m", role: "assistant", text: "Tests are running" }],
  })
  expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("")
})
it("retries an ambiguous send using the same request identity and preserves draft", async () => {
  localStorage.setItem(key, JSON.stringify({ text: "Question" }))
  mock.ask.mockRejectedValueOnce(new Error("Connection lost"))
  await render()
  await click("Send")
  expect(host.textContent).toContain("Connection lost")
  expect(JSON.parse(localStorage.getItem(key)!).text).toBe("Question")
  await click("Send")
  expect(mock.ask.mock.calls[1][0].requestId).toBe(mock.ask.mock.calls[0][0].requestId)
})
it("does not clear a newer draft after an earlier send finishes", async () => {
  let resolve!: () => void
  mock.ask.mockImplementation(
    () =>
      new Promise<void>((r) => {
        resolve = r
      }),
  )
  localStorage.setItem(key, JSON.stringify({ text: "Old question" }))
  await render()
  await click("Send")
  localStorage.setItem(key, JSON.stringify({ text: "Newer question" }))
  await act(async () => resolve())
  expect(JSON.parse(localStorage.getItem(key)!).text).toBe("Newer question")
})
it("stops only the selected side question and includes completed side context on followup", async () => {
  mock.list.data = [
    {
      id: "first",
      threadId: "first",
      question: "Status?",
      answer: "",
      status: "running",
      promotedChatId: null,
    },
  ]
  localStorage.setItem(key, JSON.stringify({ text: "And next?" }))
  await render()
  expect([...host.querySelectorAll("button")].find((b) => b.textContent === "Send")!.disabled).toBe(
    true,
  )
  await click("Stop")
  expect(mock.cancel).toHaveBeenCalledWith({ subChatId: "source", id: "first" })
  mock.list.data = [{ ...mock.list.data[0], status: "completed", answer: "Tests passing" }]
  await render()
  await click("Send")
  expect(mock.ask.mock.calls[0][0].threadId).toBe("first")
})
it("bounds visible context and excludes non-public message parts", () => {
  const snapshot = sideQuestionSnapshot(
    Array.from({ length: 150 }, (_, i) => ({
      id: String(i),
      role: "assistant",
      parts: [
        { type: "text", text: "a".repeat(30000) },
        { type: "reasoning", text: "private" },
      ],
    })),
  )
  expect(snapshot.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(120000)
  expect(snapshot.every((m) => m.text.length <= 24000)).toBe(true)
  expect(snapshot.at(-1)?.id).toBe("149")
})
