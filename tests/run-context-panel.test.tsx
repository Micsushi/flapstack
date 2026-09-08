// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { Provider } from "jotai"
import { beforeEach, expect, it, vi } from "vitest"
import { RunHistoryWidget } from "../src/renderer/features/details-sidebar/sections/run-history-widget"

const state = vi.hoisted(() => ({
  response: {} as { data?: any; error?: Error; isFetching?: boolean },
  query: vi.fn(),
  refetch: vi.fn(),
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    runs: {
      listByChat: {
        useQuery: () => ({
          data: ["first", "second"].map((id) => ({
            id,
            model: id,
            harness: "codex",
            status: "success",
            permissionMode: "read-only",
          })),
        }),
      },
      getManifest: { useQuery: () => ({ data: { manifest: [], checkpoints: [] } }) },
      getContextHealth: {
        useQuery: (input: unknown, options: unknown) => {
          state.query(input, options)
          return { ...state.response, refetch: state.refetch }
        },
      },
    },
  },
}))
vi.mock("../src/renderer/features/agents/constants", () => ({
  getHarnessChipMeta: () => ({ name: "Codex", className: "" }),
}))
vi.mock("../src/shared/model-catalog", () => ({ formatModelDisplayName: (value: string) => value }))
vi.mock("../src/renderer/features/automations/state", async () => ({
  automationEvidenceRunIdAtom: (await import("jotai")).atom(null),
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function evidence(status = "included") {
  return {
    chatId: "chat",
    runId: "first",
    projectId: "project",
    taskId: null,
    checkedAt: 1700000000000,
    status,
    reason: null,
    selectionSource: "task",
    budget: { maxBytes: 100, maxEstimatedTokens: 25, includedBytes: 50, estimatedTokens: 13 },
    graphGenerationId: null,
    filesystemFreshness: "unverified",
    providerReceipt: "unverified",
    sources: [
      {
        kind: "section",
        id: "section-one",
        title: "Saved source",
        sourcePath: "docs/context.md",
        version: 1,
        contentHash: "hash",
        originalBytes: 100,
        includedBytes: 50,
        estimatedTokens: 13,
        truncated: true,
        current: {
          status: "changed",
          version: 2,
          contentHash: "changed-hash",
          recordedAt: 1700000000000,
        },
      },
    ],
  }
}
beforeEach(() => {
  state.query.mockClear()
  state.refetch.mockClear()
  state.response = { data: evidence(), isFetching: false }
})
async function mount() {
  const container = document.createElement("div")
  const root = createRoot(container)
  const render = () =>
    act(async () =>
      root.render(
        <Provider>
          <RunHistoryWidget chatId="chat" />
        </Provider>,
      ),
    )
  await render()
  const click = (text: string) =>
    act(async () =>
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes(text))!
        .click(),
    )
  return { container, render, click, close: () => act(async () => root.unmount()) }
}
it("loads only on deliberate open, refreshes manually and closes on selected run change without leaking old evidence", async () => {
  const ui = await mount()
  try {
    expect(state.query).not.toHaveBeenCalled()
    await ui.click("Project context")
    expect(state.query).toHaveBeenLastCalledWith(
      { chatId: "chat", runId: "first" },
      { retry: false, refetchOnWindowFocus: false, refetchOnMount: "always" },
    )
    expect(ui.container.textContent).toContain("Saved source")
    expect(ui.container.textContent).toContain("Changed since launch (recorded metadata)")
    expect(ui.container.textContent).toContain("Truncated at launch: 50 of 100 bytes")
    expect(ui.container.textContent).toContain("Current files and provider receipt are unverified")
    await ui.click("Refresh project context")
    expect(state.refetch).toHaveBeenCalledOnce()
    const count = state.query.mock.calls.length
    await ui.click("second")
    expect(state.query).toHaveBeenCalledTimes(count)
    expect(ui.container.textContent).not.toContain("Saved source")
    await ui.click("Project context")
    expect(state.query.mock.lastCall?.[0]).toEqual({ chatId: "chat", runId: "second" })
    expect(ui.container.textContent).not.toContain("Saved source")
    expect(ui.container.textContent).toContain("evidence is unknown for this run")
  } finally {
    await ui.close()
  }
})
it.each([
  ["unavailable", "Launch context unavailable"],
  ["empty", "No project context included at launch"],
  ["rejected", "Project context rejected at launch"],
])("shows %s without implying context delivery", async (status, label) => {
  state.response = {
    data: {
      ...evidence(status),
      sources: [],
      reason: "Saved manifest has no usable source evidence.",
    },
  }
  const ui = await mount()
  try {
    await ui.click("Project context")
    expect(ui.container.textContent).toContain(label)
    expect(ui.container.textContent).toContain("No source evidence recorded.")
    expect(ui.container.textContent).toContain("provider receipt are unverified")
  } finally {
    await ui.close()
  }
})
it("shows loading and safe errors, suppressing stale evidence until retry", async () => {
  state.response = { isFetching: true }
  const ui = await mount()
  try {
    await ui.click("Project context")
    expect(ui.container.querySelector('[role="status"]')?.textContent).toContain("Loading")
    state.response = {
      data: evidence(),
      error: new Error("must not display raw sensitive details"),
      isFetching: false,
    }
    await ui.render()
    expect(ui.container.querySelector('[role="alert"]')?.textContent).toContain("Refresh to retry")
    expect(ui.container.textContent).not.toContain("Saved source")
    expect(ui.container.textContent).not.toContain("sensitive details")
    await ui.click("Refresh project context")
    expect(state.refetch).toHaveBeenCalledOnce()
  } finally {
    await ui.close()
  }
})
it.each(["unchanged", "missing", "unknown"] as const)(
  "keeps %s comparison distinct from launch truncation",
  async (status) => {
    const data = evidence()
    data.sources[0]!.current.status = status
    data.sources[0]!.truncated = false
    state.response = { data }
    const ui = await mount()
    try {
      await ui.click("Project context")
      expect(ui.container.textContent).toContain(
        {
          unchanged: "Unchanged since launch",
          missing: "Missing from recorded metadata",
          unknown: "Comparison unknown",
        }[status]!,
      )
      expect(ui.container.textContent).toContain("Not truncated at launch")
    } finally {
      await ui.close()
    }
  },
)
