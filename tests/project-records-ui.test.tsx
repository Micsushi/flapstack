// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { Provider } from "jotai"
import { expect, it, vi } from "vitest"
import { ProjectRecordsView } from "../src/renderer/features/project-records/project-records-view"

const fixture = vi.hoisted(() => {
  const path = "lanes/flapstack/questions.md"
  const snapshot = {
    schemaVersion: 1,
    path,
    revision: "a".repeat(64),
    document: {
      schemaVersion: 1,
      title: "Questions",
      records: [
        {
          id: "Q1",
          kind: "question",
          title: "Destination",
          state: "open",
          history: [],
          choices: ["Alpha", "Beta"],
          draft: "",
          answer: "",
          answerSource: "",
          recommendation: "",
        },
      ],
    },
  }
  return {
    path,
    snapshot,
    mutate: vi.fn(),
    setData: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useQueries: () => [{ data: fixture.snapshot, refetch: vi.fn() }],
    useUtils: () => ({
      projectRecords: { read: { cancel: fixture.cancel, setData: fixture.setData } },
    }),
    projectRecords: {
      list: {
        useQuery: () => ({
          data: { documents: [{ path: fixture.path, title: "Questions" }] },
          refetch: vi.fn(),
        }),
      },
      read: { useQuery: () => ({ data: fixture.snapshot, refetch: vi.fn() }) },
      patch: { useMutation: () => ({ mutateAsync: fixture.mutate, isPending: false }) },
    },
  },
  trpcClient: {},
}))
vi.mock("../src/renderer/features/project-records/record-action", () => ({
  retainRecordAction: vi.fn(),
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

it("keeps a newer owner draft when an earlier answer finishes saving", async () => {
  let finish!: (value: unknown) => void
  fixture.mutate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const click = async (label: string) =>
    act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === label)!
        .click(),
    )
  await act(async () =>
    root.render(
      <Provider>
        <ProjectRecordsView />
      </Provider>,
    ),
  )
  await click("Alpha")
  expect(fixture.mutate).not.toHaveBeenCalled()
  await click("Submit answer")
  await click("Beta")
  await act(async () => finish({ conflict: false, snapshot: fixture.snapshot }))
  expect(fixture.mutate.mock.calls[0][0].changes).toEqual({
    answer: "Alpha",
    answerSource: "owner",
    draft: "Alpha",
    state: "answered",
  })
  expect(container.querySelector("textarea")!.value).toBe("Beta")
  expect(fixture.setData).toHaveBeenCalledWith({ path: fixture.path }, fixture.snapshot)
  await act(async () => root.unmount())
  container.remove()
  window.localStorage.clear()
})

it("keeps AI recommendations and resolutions out of the owner's answer draft", async () => {
  const record = fixture.snapshot.document.records[0]!
  const original = { ...record }
  Object.assign(record, {
    state: "resolved_independently",
    answer: "AI chose Alpha",
    answerSource: "ai",
    recommendation: "Alpha is the recommended default",
  })
  const container = document.createElement("div")
  const root = createRoot(container)
  const render = () =>
    act(async () =>
      root.render(
        <Provider>
          <ProjectRecordsView />
        </Provider>,
      ),
    )
  try {
    await render()
    expect(container.querySelector("textarea")!.value).toBe("")
    expect(container.textContent).toContain("AI resolution: AI chose Alpha")
    expect(container.textContent).not.toContain("Saved owner answer")
    record.answerSource = ""
    await render()
    expect(container.textContent).toContain("Saved answer (source unverified)")
    expect(container.textContent).not.toContain("Saved owner answer")
  } finally {
    await act(async () => root.unmount())
    Object.assign(record, original)
  }
})

it("keeps unfinished outcomes in Checklist and answered questions in Questions", async () => {
  const records = fixture.snapshot.document.records
  const base = records[0]!
  fixture.snapshot.document.records = [
    { ...base, state: "answered" },
    { ...base, id: "D1", kind: "outcome", title: "Finished work", state: "done" },
    { ...base, id: "D2", kind: "outcome", title: "Unfinished work", state: "more_work" },
    { ...base, id: "D3", kind: "outcome", title: "Retained history", state: "superseded" },
  ]
  const container = document.createElement("div")
  const root = createRoot(container)
  const click = (label: string) =>
    act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === label)!
        .click(),
    )
  try {
    await act(async () =>
      root.render(
        <Provider>
          <ProjectRecordsView />
        </Provider>,
      ),
    )
    expect(container.textContent).toContain("Destination")
    await click("Completed")
    expect(container.textContent).toContain("Finished work")
    expect(container.textContent).not.toContain("Unfinished work")
    expect(container.textContent).not.toContain("Retained history")
    await click("Checklist")
    expect(container.textContent).toContain("Unfinished work")
    expect(container.textContent).toContain("More work")
    expect(container.textContent).toContain("Retained history")
    expect(container.textContent).toContain("Superseded")
    expect(container.textContent).not.toContain("Finished work")
  } finally {
    await act(async () => root.unmount())
    fixture.snapshot.document.records = records
  }
})
