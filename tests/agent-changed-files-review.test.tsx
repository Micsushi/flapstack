// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { beforeEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ review: vi.fn() }))
vi.mock("../src/renderer/lib/trpc", async () => {
  const { useQuery } = await import("@tanstack/react-query")
  return {
    trpc: {
      useUtils: () => ({ runs: { getChangeSet: { setData: vi.fn(), invalidate: vi.fn() } } }),
      runs: {
        getChangeSet: {
          useQuery: () => ({
            data: {
              fileCount: 1,
              files: [{ id: "file", filePath: "example.txt", additions: 1, deletions: 0 }],
              additions: 1,
              deletions: 0,
              recoverable: true,
              undone: false,
            },
            isFetching: false,
            isError: false,
            refetch: vi.fn(),
          }),
        },
        getChangeReview: {
          useQuery: (input: { runId: string; filePath?: string }, options: { enabled: boolean }) =>
            useQuery({
              queryKey: ["change-review", input],
              queryFn: () => mocks.review(input),
              ...options,
            }),
        },
        undoChangeSet: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
      },
    },
  }
})
import { AgentChangedFilesCard } from "../src/renderer/features/agents/ui/agent-changed-files-card"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => mocks.review.mockReset())

async function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AgentChangedFilesCard runId="run-1" />
      </QueryClientProvider>,
    ),
  )
  const review = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Review",
  )!
  await act(async () => review.click())
  return {
    client,
    dialog: () => document.querySelector('[role="dialog"]')!,
    close: async () => {
      await act(async () => root.unmount())
      client.clear()
      host.remove()
    },
  }
}

it("distinguishes a failed diff request from missing history and retries the same review", async () => {
  mocks.review
    .mockRejectedValueOnce(new Error("private backend path"))
    .mockResolvedValue({ diff: "+ recovered" })
  const f = await fixture()
  try {
    await vi.waitFor(() => expect(f.dialog().textContent).toContain("Could not load stored diff."))
    expect(f.dialog().textContent).not.toContain("older run")
    expect(f.dialog().textContent).not.toContain("private backend path")
    const retry = [...f.dialog().querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    )!
    await act(async () => {
      retry.focus()
      retry.click()
    })
    await vi.waitFor(() => expect(f.dialog().querySelector("pre")?.textContent).toBe("+ recovered"))
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(f.dialog().querySelector('[aria-label="Stored diff"]')),
    )
    expect(f.dialog().querySelector('[role="alert"]')).toBeNull()
    expect(mocks.review).toHaveBeenCalledTimes(2)
    expect(
      mocks.review.mock.calls.every(
        ([input]) => input.runId === "run-1" && input.filePath === undefined,
      ),
    ).toBe(true)
  } finally {
    await f.close()
  }
})

it("keeps a cached diff visible when refreshing fails and replaces it after retry", async () => {
  mocks.review
    .mockResolvedValueOnce({ diff: "+ cached" })
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ diff: "+ refreshed" })
  const f = await fixture()
  try {
    await vi.waitFor(() => expect(f.dialog().querySelector("pre")?.textContent).toBe("+ cached"))
    await act(async () => {
      await f.client.invalidateQueries({ queryKey: ["change-review"] })
    })
    await vi.waitFor(() =>
      expect(f.dialog().textContent).toContain(
        "Could not refresh stored diff. Showing the previous result.",
      ),
    )
    expect(f.dialog().querySelector("pre")?.textContent).toBe("+ cached")
    const retry = [...f.dialog().querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    )!
    await act(async () => retry.click())
    await vi.waitFor(() => expect(f.dialog().querySelector("pre")?.textContent).toBe("+ refreshed"))
    expect(f.dialog().querySelector('[role="alert"]')).toBeNull()
  } finally {
    await f.close()
  }
})

it("reserves the historical absence message for a successful null diff", async () => {
  mocks.review.mockResolvedValue({ diff: null })
  const f = await fixture()
  try {
    await vi.waitFor(() =>
      expect(f.dialog().textContent).toContain(
        "Stored historical diff is unavailable for this older run.",
      ),
    )
    expect(f.dialog().querySelector('[role="alert"]')).toBeNull()
    expect(
      [...f.dialog().querySelectorAll("button")].some((button) => button.textContent === "Retry"),
    ).toBe(false)
  } finally {
    await f.close()
  }
})

it("keeps newer dialog focus when a deferred retry succeeds", async () => {
  let resolve!: (value: { diff: string }) => void
  mocks.review.mockRejectedValueOnce(new Error("offline")).mockImplementationOnce(
    () =>
      new Promise<{ diff: string }>((done) => {
        resolve = done
      }),
  )
  const f = await fixture()
  try {
    await vi.waitFor(() => expect(f.dialog().textContent).toContain("Could not load stored diff."))
    const retry = [...f.dialog().querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    )!
    const close = [...f.dialog().querySelectorAll("button")].find(
      (button) => button.textContent === "Close",
    )!
    await act(async () => {
      retry.focus()
      retry.click()
    })
    await vi.waitFor(() => expect(mocks.review).toHaveBeenCalledTimes(2))
    await act(async () => close.focus())
    await act(async () => resolve({ diff: "+ recovered without stealing focus" }))
    await vi.waitFor(() =>
      expect(f.dialog().querySelector("pre")?.textContent).toBe(
        "+ recovered without stealing focus",
      ),
    )
    expect(document.activeElement).toBe(close)
  } finally {
    await f.close()
  }
})
