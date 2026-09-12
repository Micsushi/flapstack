// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { Provider } from "jotai"
import { expect, it, vi } from "vitest"
import type { ProjectRecordSnapshot } from "../src/shared/project-records"
import { BlockerDetails } from "../src/renderer/features/project-records/blocker-details"
import { ProjectRecordsView } from "../src/renderer/features/project-records/project-records-view"

const blocker = {
  id: "B1",
  kind: "blocker" as const,
  title: "Synthetic provider sign-in",
  state: "blocked",
  history: [],
  category: "credentials",
  affectedWork: ["F1"],
  cause: "The isolated session is signed out.",
  missingPrerequisite: "A test session signed in by the owner.",
  whyAgentCannotResolve: "Only the account holder can complete sign-in.",
  resolutionSteps: ["Prepare an isolated login.", "Complete the login in your browser."],
  attemptedResolutions: ["Checked the isolated login status."],
  evidence: ["Login status returned signed out."],
  independentWork: ["Test synthetic tool execution."],
  ownerAction: "Complete the isolated login.",
  resolutionVerification: ["Run a harmless marker and verify its hook receipt."],
  sourceLinks: ["Synthetic login receipt"],
  questionIds: ["Q1"],
  projects: [
    { id: "shared-work", name: "Shared work" },
    { id: "second", name: "Second project" },
  ],
}

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

it("shows blockers beside questions, preserves drafts, and separates history and unfinished work", async () => {
  const original = fixture.extra
  fixture.extra = [
    {
      ...fixture.snapshot,
      path: "lanes/vault/questions.md",
      document: {
        schemaVersion: 1,
        title: "Shared records",
        records: [
          blocker,
          {
            ...blocker,
            id: "B2",
            title: "Resolved environment",
            state: "resolved",
            resolutionEvidence: ["Fresh start passed."],
          },
          {
            ...blocker,
            id: "B3",
            title: "Waiting for an external repair",
            ownerAction: null,
            category: "external_dependency",
          },
          {
            id: "F1",
            kind: "feature",
            title: "Covered blocked feature",
            state: "blocked",
            history: [],
          },
          {
            id: "F2",
            kind: "feature",
            title: "Deferred monitoring",
            state: "planned",
            history: [],
          },
          {
            id: "F3",
            kind: "outcome",
            title: "Screenshot evidence gap",
            state: "more_work",
            history: [],
          },
        ],
      },
    },
  ]
  const container = document.createElement("div")
  const root = createRoot(container)
  const click = (label: string) =>
    act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.startsWith(label))!
        .click()
    })
  try {
    await act(async () =>
      root.render(
        <Provider>
          <ProjectRecordsView />
        </Provider>,
      ),
    )
    expect(container.textContent).toContain("Shared work: Blockers")
    expect(container.textContent).toContain("Destination")
    expect(container.textContent).toContain("Steps to resolve")
    expect(container.textContent).toContain("Only the account holder can complete sign-in.")
    expect(container.textContent).toContain("No owner-specific action is currently established.")
    expect(container.textContent).not.toContain("Resolved environment")
    expect(container.textContent).not.toContain("Deferred monitoring")
    expect(container.textContent).not.toContain("Screenshot evidence gap")
    expect(container.textContent).not.toContain("Covered blocked feature")
    expect(container.querySelector('[aria-label="2 active blockers"]')).not.toBeNull()
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
    await click("Beta")
    await click("Blockers")
    expect(container.querySelector("textarea")).toBeNull()
    expect(container.textContent).toContain("Resolved environment")
    expect(container.textContent).toContain("Fresh start passed.")
    await click("Open Q1")
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Beta")
    expect(container.textContent).not.toContain("Synthetic provider sign-in")
    // Refreshes update blocker data without creating an owner answer or clearing the draft.
    fixture.extra[0]!.document.records[0] = { ...blocker, cause: "Updated canonical cause" }
    await act(async () =>
      root.render(
        <Provider>
          <ProjectRecordsView />
        </Provider>,
      ),
    )
    await click("Questions")
    expect(container.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Beta")
  } finally {
    await act(async () => root.unmount())
    fixture.extra = original
    window.localStorage.clear()
  }
})

it("keeps legacy blocked work visible without inventing a human prerequisite", async () => {
  fixture.extra = [
    {
      ...fixture.snapshot,
      path: "projects/flapstack/features.md",
      document: {
        schemaVersion: 1,
        title: "Features",
        records: [
          {
            id: "LEGACY",
            kind: "feature",
            title: "Missing blocker details",
            context: "Legacy context must remain visible.",
            state: "blocked",
            history: [],
          },
        ],
      },
    },
  ]
  const container = document.createElement("div")
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <Provider>
          <ProjectRecordsView />
        </Provider>,
      ),
    )
    expect(container.textContent).toContain("Missing blocker details")
    expect(container.textContent).toContain("Legacy context must remain visible.")
    expect(container.textContent).toContain("Human help has not been established as necessary.")
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0)
  } finally {
    await act(async () => root.unmount())
    fixture.extra = []
  }
})

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

it("copies the exact continuation message, reports failures honestly and keeps diagnostics collapsed", async () => {
  const prompt =
    "  Continue blocker B1 in lanes/flapstack/questions.md.\nPrepare <fresh login URL>, then ask the owner to sign in.\nVerify the marker receipt.  "
  let finish!: () => void
  const writeText = vi.fn().mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
  const originalDesktopApi = Object.getOwnPropertyDescriptor(window, "desktopApi")
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  Object.defineProperty(window, "desktopApi", { configurable: true, value: undefined })
  const container = document.createElement("div")
  const root = createRoot(container)
  const render = (continuationPrompt?: string) =>
    act(async () =>
      root.render(
        <BlockerDetails record={{ ...blocker, continuationPrompt }} openQuestion={vi.fn()} />,
      ),
    )
  try {
    await render(prompt)
    const message = container.querySelector<HTMLElement>('[aria-label="Continuation message"]')!
    expect(message.textContent).toBe(prompt)
    expect(message.tabIndex).toBe(0)
    const details = container.querySelector("details")!
    expect(details.open).toBe(false)
    expect(details.textContent).toContain(blocker.whyAgentCannotResolve)
    expect(details.textContent).toContain(blocker.sourceLinks[0])
    expect(details.textContent).toContain(blocker.independentWork[0])
    expect(details.textContent).not.toContain(blocker.ownerAction)
    expect(container.querySelector("ol")!.textContent).toContain(blocker.resolutionSteps[0])
    const copy = () =>
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Copy"),
      )!
    await act(async () => copy().click())
    expect(copy().disabled).toBe(true)
    expect(container.textContent).not.toContain("Continuation message copied.")
    expect(writeText).toHaveBeenCalledWith(prompt)
    await act(async () => finish())
    expect(container.querySelector('[role="status"]')!.textContent).toBe(
      "Continuation message copied.",
    )
    writeText.mockRejectedValueOnce(new Error("Permission denied"))
    await act(async () => copy().click())
    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "Could not copy. Select the message above",
    )
    expect(message.textContent).toBe(prompt)
    await render(prompt + " Updated.")
    expect(container.textContent).not.toContain("Could not copy.")
    await render()
    expect(container.textContent).toContain(
      "A continuation message is not available for this blocker.",
    )
    expect(container.querySelector('[aria-label="Continuation message"]')).toBeNull()
    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("Copy"),
      ),
    ).toBe(false)
  } finally {
    await act(async () => root.unmount())
    if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard)
    else Reflect.deleteProperty(navigator, "clipboard")
    if (originalDesktopApi) Object.defineProperty(window, "desktopApi", originalDesktopApi)
    else Reflect.deleteProperty(window, "desktopApi")
  }
})

it("shows current and stale agent reviews and keeps follow-up answers inside the parent revision", async () => {
  const review = {
    reviewedAnswer: "Alpha",
    reviewedAnswerSource: "owner" as const,
    status: "confirmed" as const,
    note: "The destination is clear.",
  }
  const child = {
    id: "folder:next",
    title: "Test folder",
    state: "open" as const,
    context: "Choose where the test files go.",
    choices: ["Temporary folder", "Project folder"],
    recommendation: "Temporary folder",
    draft: "",
    answer: "",
    affectedWork: [],
    metadata: { retained: true },
  }
  const sibling = {
    ...child,
    id: "research",
    title: "Check folder access",
    state: "agent_research" as const,
    draft: "Agent draft",
  }
  const parent = {
    ...fixture.snapshot.document.records[0]!,
    id: "review-parent",
    title: "Reviewed destination",
    state: "answered",
    answer: "Alpha",
    answerSource: "owner",
    agentReview: review,
    followUps: [child, sibling],
  }
  fixture.extra = [
    {
      ...fixture.snapshot,
      path: "lanes/vault/questions.md",
      revision: "c".repeat(64),
      document: { schemaVersion: 1, title: "Questions", records: [parent] },
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
  const childGroup = () =>
    container.querySelector<HTMLElement>('[role="group"][aria-label="Test folder"]')!
  const click = (label: string, within: ParentNode) =>
    act(async () =>
      Array.from(within.querySelectorAll("button"))
        .find((button) => button.textContent === label)!
        .click(),
    )
  try {
    await render()
    const parentItem = Array.from(container.querySelectorAll("li")).find((item) =>
      item.textContent?.includes("Reviewed destination"),
    )!
    expect(parentItem.closest("section")!.getAttribute("aria-label")).toContain(
      "Waiting for your answer",
    )
    expect(parentItem.textContent).toContain("Agent confirmed this answer")
    expect(parentItem.textContent).toContain(
      "The agent is checking this. No answer is needed from you.",
    )
    expect(parentItem.querySelector('[aria-label="Answer to Check folder access"]')).toBeNull()
    expect(
      Array.from(parentItem.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("Confirm"),
      ),
    ).toBe(false)
    await click("Temporary folder", childGroup())
    const conflict = structuredClone(fixture.extra[0]!)
    conflict.revision = "d".repeat(64)
    conflict.document.records[0]!.followUps![1]!.answer = "Access checked"
    fixture.mutate.mockResolvedValueOnce({ conflict: true, snapshot: conflict })
    await click("Submit answer", childGroup())
    expect(fixture.mutate.mock.lastCall?.[0]).toMatchObject({
      path: "lanes/vault/questions.md",
      expectedRevision: "c".repeat(64),
      recordId: parent.id,
    })
    const changes = fixture.mutate.mock.lastCall![0].changes
    expect(Object.keys(changes)).toEqual(["followUps"])
    expect(changes.followUps).toEqual([
      {
        ...child,
        draft: "Temporary folder",
        answer: "Temporary folder",
        answerSource: "owner",
        state: "answered",
      },
      sibling,
    ])
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("changed elsewhere")
    expect(childGroup().querySelector("textarea")!.value).toBe("Temporary folder")
    fixture.extra[0] = conflict
    await render()
    fixture.mutate.mockResolvedValueOnce({ conflict: false, snapshot: conflict })
    await click("Submit answer", childGroup())
    expect(fixture.mutate.mock.lastCall?.[0].expectedRevision).toBe("d".repeat(64))
    expect(fixture.mutate.mock.lastCall?.[0].changes.followUps[1].answer).toBe("Access checked")
    const current = conflict.document.records[0]!
    current.draft = "Still typing"
    await render()
    expect(container.textContent).toContain("Agent confirmed this answer")
    current.answerSource = "ai"
    await render()
    expect(container.textContent).toContain("Answer changed. Agent needs to review it again.")
    expect(container.textContent).toContain("Previous review: The destination is clear.")
    current.answerSource = "owner"
    await render()
    expect(container.textContent).toContain("Agent confirmed this answer")
  } finally {
    await act(async () => root.unmount())
    fixture.extra = []
    window.localStorage.clear()
  }
})

it("keeps resolved and superseded blocker instructions historical without asking the owner to repeat them", async () => {
  const container = document.createElement("div")
  const root = createRoot(container)
  try {
    for (const state of ["resolved", "superseded"]) {
      await act(async () =>
        root.render(
          <BlockerDetails
            record={{
              ...blocker,
              state,
              continuationPrompt: "Previous test instructions",
              resolutionEvidence: ["The exact session-start check passed."],
            }}
            openQuestion={vi.fn()}
          />,
        ),
      )
      expect(container.textContent).toContain(
        state === "resolved"
          ? "Resolved. No further action is needed"
          : "This blocker was replaced",
      )
      expect(container.textContent).not.toContain("Why this is blocked")
      expect(container.textContent).not.toContain("Your action")
      expect(container.querySelector('[aria-label="Continuation message"]')).toBeNull()
      expect(
        Array.from(container.querySelectorAll("button")).some((button) =>
          button.textContent?.includes("Copy"),
        ),
      ).toBe(false)
      const details = container.querySelector("details")!
      expect(details.open).toBe(false)
      expect(details.textContent).toContain("Previously requested action")
      expect(details.textContent).toContain(blocker.ownerAction)
      expect(details.textContent).toContain("Previous test instructions")
      expect(details.textContent).toContain("The exact session-start check passed.")
    }
  } finally {
    await act(async () => root.unmount())
  }
})
