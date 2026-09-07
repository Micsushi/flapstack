// @vitest-environment jsdom
import React, { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import {
  DiffComments,
  type DiffCommentDraft,
} from "../src/renderer/features/agents/ui/diff-comments"
import {
  clearAppActionHistory,
  undoAppAction,
  redoAppAction,
} from "../src/renderer/lib/app-action-history"
const state = vi.hoisted(() => ({
  create: vi.fn(),
  revise: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  rows: [] as any[],
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    chats: { getMetadata: { useQuery: () => ({ data: { projectId: "project" } }) } },
    diffAnnotations: {
      list: {
        useQuery: () => ({
          data: { annotations: state.rows, diffHash: "a".repeat(64) },
          refetch: state.refresh,
          isLoading: false,
        }),
      },
    },
  },
  trpcClient: {
    diffAnnotations: {
      create: { mutate: state.create },
      revise: { mutate: state.revise },
      setDeleted: { mutate: state.remove },
    },
  },
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement, root: ReturnType<typeof createRoot>
const initial: DiffCommentDraft = {
  id: "36d0c1bd-ff3e-4d4a-ad48-a80f0a05df5f",
  body: "Keep this draft",
  anchor: {
    diffHash: "a".repeat(64),
    filePath: "file.ts",
    side: "right",
    startLine: 1,
    endLine: 2,
  },
}
beforeEach(() => {
  vi.resetAllMocks()
  state.rows = []
  clearAppActionHistory()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
function Harness({ draft = initial }: { draft?: DiffCommentDraft | null }) {
  const [value, setValue] = useState(draft)
  return <DiffComments chatId="chat" draft={value} setDraft={setValue} onBusyChange={() => {}} />
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  )
  expect(button).toBeTruthy()
  await act(async () => button!.click())
}
it("keeps the body and request identity after a failed create and retries once with shared undo", async () => {
  const row = { ...initial.anchor, id: initial.id, body: initial.body, version: 1, deletedAt: null }
  state.create.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(row)
  state.remove.mockImplementation(async (input) => ({
    ...row,
    version: input.expectedVersion + 1,
    deletedAt: input.deleted ? 1 : null,
  }))
  await act(async () => root.render(<Harness />))
  await click("Save comment")
  expect(container.querySelector("textarea")?.value).toBe(initial.body)
  expect(container.textContent).toContain("offline")
  await click("Save comment")
  expect(state.create).toHaveBeenCalledTimes(2)
  expect(state.create.mock.calls[0][0]).toEqual(state.create.mock.calls[1][0])
  expect(container.querySelector("textarea")).toBeNull()
  await act(async () => {
    await undoAppAction()
    await redoAppAction()
  })
  expect(state.remove.mock.calls.map(([input]) => [input.expectedVersion, input.deleted])).toEqual([
    [1, true],
    [2, false],
  ])
})
it("retains a stale draft when main rejects its old anchor", async () => {
  state.create.mockRejectedValue(new Error("Diff changed; refresh"))
  await act(async () =>
    root.render(
      <Harness draft={{ ...initial, anchor: { ...initial.anchor, diffHash: "b".repeat(64) } }} />,
    ),
  )
  expect(container.textContent).toContain("diff changed or cannot be verified")
  await click("Save comment")
  expect(container.querySelector("textarea")?.value).toBe(initial.body)
  expect(state.create.mock.calls[0][0].anchor.diffHash).toBe("b".repeat(64))
})
it("deletes a scoped comment reversibly and shows stale saved text", async () => {
  const row = {
    ...initial.anchor,
    id: initial.id,
    body: "Saved text",
    version: 4,
    deletedAt: null,
    freshness: "stale",
  }
  state.rows = [row]
  state.remove.mockImplementation(async (input) => ({
    ...row,
    version: input.expectedVersion + 1,
    deletedAt: input.deleted ? 1 : null,
  }))
  await act(async () => root.render(<Harness draft={null} />))
  expect(container.textContent).toContain("stale")
  expect(container.textContent).toContain("Saved text")
  await click("Delete")
  await act(async () => {
    await undoAppAction()
  })
  expect(
    state.remove.mock.calls.map(([input]) => [
      input.projectId,
      input.chatId,
      input.expectedVersion,
      input.deleted,
    ]),
  ).toEqual([
    ["project", "chat", 4, true],
    ["project", "chat", 5, false],
  ])
})
