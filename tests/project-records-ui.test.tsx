// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { Provider } from "jotai"
import { expect, it, vi } from "vitest"
import type { ProjectRecordSnapshot } from "../src/shared/project-records"
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
    extra: [] as ProjectRecordSnapshot[],
    mutate: vi.fn(),
    setData: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useQueries: () =>
      [fixture.snapshot, ...fixture.extra].map((data) => ({ data, refetch: vi.fn() })),
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
    Object.assign(
      { ...base, id: "F1", kind: "feature", title: "Daily control", state: "planned" },
      { group: "Daily interface" },
    ),
    Object.assign(
      { ...base, id: "F2", kind: "feature", title: "Admin control", state: "planned" },
      { group: "Administration" },
    ),
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
    expect(Array.from(container.querySelectorAll("h2")).map((node) => node.textContent)).toEqual([
      "Shared work: Needs follow-up",
      "Shared work: Daily interface",
      "Shared work: Administration",
    ])
  } finally {
    await act(async () => root.unmount())
    fixture.snapshot.document.records = records
  }
})

it("defaults to all projects, orders waiting questions first and preserves shared drafts and scoped saves", async () => {
  const base = fixture.snapshot.document.records[0]!
  fixture.extra = [
    {
      ...fixture.snapshot,
      path: "projects/agents-vault/features.md",
      document: {
        schemaVersion: 1,
        title: "Checklist",
        records: [
          {
            ...base,
            id: "F1",
            kind: "feature",
            title: "Vault feature",
            projects: [{ id: "vault", name: "Agents Vault" }],
          },
        ],
      },
    },
    {
      ...fixture.snapshot,
      path: "lanes/vault/questions.md",
      revision: "b".repeat(64),
      document: {
        schemaVersion: 1,
        title: "Questions",
        records: [
          {
            ...base,
            id: "Q1",
            title: "Cross-lane choice",
            projects: [
              { id: "second", name: "Second project" },
              { id: "third", name: "Third project" },
            ],
          },
          {
            ...base,
            id: "Q2",
            title: "Already answered",
            state: "answered",
            answer: "Saved decision",
            answerSource: "owner",
            projects: [{ id: "second", name: "Second project" }],
          },
          {
            ...base,
            id: "Q3",
            title: "AI resolved question",
            state: "resolved_independently",
            answer: "AI conclusion",
            answerSource: "ai",
            projects: [{ id: "second", name: "Second project" }],
          },
        ],
      },
    },
  ]
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
  const filter = (value: string) =>
    act(async () => {
      const select = container.querySelector<HTMLSelectElement>('[aria-label="Record project"]')!
      select.value = value
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
  const click = (label: string, within: ParentNode = container) =>
    act(async () => {
      Array.from(within.querySelectorAll("button"))
        .find((button) => button.textContent === label)!
        .click()
    })
  const question = () =>
    container.querySelector<HTMLTextAreaElement>('[aria-label="Answer to Cross-lane choice"]')!
  try {
    await render()
    expect(container.querySelector<HTMLSelectElement>("select")!.value).toBe("")
    expect(container.textContent).toContain("Destination")
    expect(container.textContent).toContain("Cross-lane choice")
    expect(container.textContent).toContain("Already answered")
    expect(container.textContent).toContain("AI resolved question")
    const titles = Array.from(container.querySelectorAll("h3")).map((node) => node.textContent)
    expect(titles.lastIndexOf("Cross-lane choice")).toBeLessThan(titles.indexOf("Already answered"))
    expect(container.textContent).toContain("Saved owner answer: Saved decision")
    expect(container.textContent).toContain("AI resolution: AI conclusion")
    expect(container.querySelectorAll('[aria-label="Answer to Cross-lane choice"]')).toHaveLength(2)
    await click("Beta", question().closest("li")!)
    expect(
      Array.from(
        container.querySelectorAll<HTMLTextAreaElement>(
          '[aria-label="Answer to Cross-lane choice"]',
        ),
      ).map((node) => node.value),
    ).toEqual(["Beta", "Beta"])
    await filter("vault")
    expect(container.textContent).not.toContain("Cross-lane choice")
    await click("Checklist")
    expect(container.textContent).toContain("Vault feature")
    await filter("second")
    await click("Questions")
    expect(question().value).toBe("Beta")
    fixture.mutate.mockResolvedValueOnce({ conflict: true, snapshot: fixture.extra[1] })
    await click("Submit answer", question().closest("li")!)
    expect(fixture.mutate.mock.lastCall?.[0]).toMatchObject({
      path: "lanes/vault/questions.md",
      recordId: "Q1",
      expectedRevision: "b".repeat(64),
      changes: { answer: "Beta", answerSource: "owner" },
    })
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("changed elsewhere")
    expect(question().value).toBe("Beta")
    expect(base.answer).toBe("")
    await filter("")
    expect(
      Array.from(
        container.querySelectorAll<HTMLTextAreaElement>(
          '[aria-label="Answer to Cross-lane choice"]',
        ),
      ).map((node) => node.value),
    ).toEqual(["Beta", "Beta"])
  } finally {
    await act(async () => root.unmount())
    fixture.extra = []
    window.localStorage.clear()
  }
})
