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
  metadataRefresh: vi.fn(),
  send: vi.fn(),
  cancelFeedback: vi.fn(),
  projectAvailable: true,
  rows: [] as any[],
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    chats: {
      getMetadata: {
        useQuery: () => ({
          data: state.projectAvailable ? { projectId: "project" } : undefined,
          error: state.projectAvailable ? null : new Error("Metadata offline"),
          refetch: state.metadataRefresh,
        }),
      },
    },
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
      send: { mutate: state.send },
      cancelFeedback: { mutate: state.cancelFeedback },
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
  state.projectAvailable = true
  window.localStorage.clear()
  clearAppActionHistory()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
function Harness({
  draft = initial,
  displayedDiffHash = "a".repeat(64),
  feedbackTarget = { id: "sub", name: "Current conversation" },
}: {
  draft?: DiffCommentDraft | null
  displayedDiffHash?: string | null
  feedbackTarget?: { id: string; name: string } | null
}) {
  const [value, setValue] = useState(draft)
  return (
    <DiffComments
      chatId="chat"
      draft={value}
      setDraft={setValue}
      onBusyChange={() => {}}
      displayedDiffHash={displayedDiffHash}
      feedbackTarget={feedbackTarget}
    />
  )
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  )
  expect(button).toBeTruthy()
  await act(async () => button!.click())
}
function savedRow() {
  return {
    ...initial.anchor,
    id: initial.id,
    body: initial.body,
    version: 1,
    deletedAt: null,
    projectId: "project",
    chatId: "chat",
    createdAt: 1,
    updatedAt: 1,
    freshness: "current",
  }
}
async function selectFeedback() {
  const checkbox = container.querySelector<HTMLInputElement>('input[aria-label^="Select feedback"]')
  expect(checkbox).toBeTruthy()
  await act(async () => checkbox!.click())
}
it("restores a failed send identity after remount and shows durable sent status", async () => {
  state.rows = [savedRow()]
  state.send
    .mockRejectedValueOnce(new Error("response lost"))
    .mockImplementationOnce(async (input) => {
      state.rows = [
        {
          ...savedRow(),
          lastFeedbackVersion: 1,
          lastFeedbackBatchId: input.id,
          feedback: { batchId: input.id, runId: "run", subChatId: "sub", status: "pending" },
        },
      ]
      return { id: input.id }
    })
  await act(async () => root.render(<Harness draft={null} />))
  await selectFeedback()
  await click("Send feedback")
  const first = state.send.mock.calls[0][0]
  expect(first.subChatId).toBe("sub")
  expect(container.textContent).toContain("response lost")
  await act(async () => root.render(null))
  await act(async () =>
    root.render(
      <Harness draft={null} feedbackTarget={{ id: "other", name: "Other conversation" }} />,
    ),
  )
  expect(container.textContent).toContain("Send to sub")
  await click("Retry feedback")
  expect(state.send.mock.calls[1][0]).toEqual(first)
  expect(container.textContent).toContain("Feedback v1 · pending")
  expect(
    container.querySelector<HTMLInputElement>('input[aria-label^="Select feedback"]')?.disabled,
  ).toBe(true)
  expect(window.localStorage.length).toBe(0)
})
it("does not send if durable retry storage refuses the write", async () => {
  state.rows = [savedRow()]
  await act(async () => root.render(<Harness draft={null} />))
  await selectFeedback()
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage quota")
  })
  try {
    await click("Send feedback")
    expect(state.send).not.toHaveBeenCalled()
    expect(container.textContent).toContain("storage quota")
  } finally {
    write.mockRestore()
  }
})
it("cancels using scoped batch identity and explains cancellation is not undo", async () => {
  state.rows = [
    {
      ...savedRow(),
      lastFeedbackVersion: 1,
      lastFeedbackBatchId: initial.id,
      feedback: { batchId: initial.id, runId: "run", subChatId: "sub", status: "running" },
    },
  ]
  state.cancelFeedback.mockResolvedValue({ cancelled: true })
  await act(async () => root.render(<Harness draft={null} />))
  expect(container.textContent).toContain("Cancellation does not undo changes")
  await click("Cancel feedback run")
  expect(state.cancelFeedback).toHaveBeenCalledWith({
    id: initial.id,
    chatId: "chat",
    projectId: "project",
  })
})
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

it("keeps a shared version lineage across create, edit, undo and redo", async () => {
  let row: any
  state.create.mockImplementation(async (input) => {
    row = { ...input, ...input.anchor, version: 1, deletedAt: null, freshness: "current" }
    state.rows = [row]
    return row
  })
  const change = (input: any) => {
    if (input.expectedVersion !== row.version) throw new Error("Version conflict")
    row = {
      ...row,
      ...(input.anchor ?? {}),
      ...(input.body === undefined ? {} : { body: input.body }),
      deletedAt: input.deleted === undefined ? row.deletedAt : input.deleted ? 1 : null,
      version: row.version + 1,
    }
    state.rows = [row]
    return row
  }
  state.revise.mockImplementation(change)
  state.remove.mockImplementation(change)
  await act(async () => root.render(<Harness />))
  await click("Save comment")
  await click("Edit")
  await click("Save comment")
  await act(async () => {
    await undoAppAction()
    await undoAppAction()
    await redoAppAction()
    await redoAppAction()
  })
  expect(row).toMatchObject({ version: 6, deletedAt: null, body: initial.body })
  row.version++ // independent edit must still reject old local authority
  await expect(undoAppAction()).rejects.toThrow("Version conflict")
})

it("marks cached saved comments stale when the displayed diff changes", async () => {
  state.rows = [
    {
      ...initial.anchor,
      id: initial.id,
      body: "Saved text",
      version: 1,
      deletedAt: null,
      freshness: "current",
    },
  ]
  await act(async () => root.render(<Harness draft={null} />))
  await act(async () => root.render(<Harness draft={null} displayedDiffHash={"b".repeat(64)} />))
  expect(container.querySelector("li")?.textContent).toContain("stale")
  await act(async () => root.render(<Harness draft={null} displayedDiffHash={null} />))
  expect(container.querySelector("li")?.textContent).toContain("unverified")
})

it("allows recovery after metadata failure without allowing an unscoped save", async () => {
  state.projectAvailable = false
  state.metadataRefresh.mockImplementation(async () => {
    state.projectAvailable = true
    return { data: { projectId: "project" } }
  })
  await act(async () => root.render(<Harness />))
  expect(container.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(true)
  await click("Refresh")
  expect(state.metadataRefresh).toHaveBeenCalledTimes(1)
  expect(state.create).not.toHaveBeenCalled()
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
