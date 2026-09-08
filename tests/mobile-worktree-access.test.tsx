// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { MobileWorktreeAccess } from "../src/renderer/features/agents/ui/mobile-worktree-access"
const mock = vi.hoisted(() => ({
  data: null as any,
  isLoading: false,
  isFetching: false,
  error: null as any,
  refetch: vi.fn(),
  query: vi.fn(),
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    spawnedAgents: {
      getTaskOverview: {
        useQuery: (input: unknown, options: unknown) => {
          mock.query(input, options)
          return mock
        },
      },
    },
  },
}))
let root: Root, container: HTMLDivElement
beforeEach(() => {
  mock.data = null
  mock.isLoading = false
  mock.error = null
  mock.query.mockClear()
  mock.refetch.mockClear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
const navigate = vi.fn()
async function render() {
  await act(async () =>
    root.render(<MobileWorktreeAccess projectId="p" taskId="t" onNavigate={navigate} />),
  )
}
it("distinguishes loading, error, unavailable, empty and stale identity with explicit refresh", async () => {
  mock.isLoading = true
  await render()
  expect(container.textContent).toContain("Loading worktree")
  mock.isLoading = false
  mock.error = new Error("Offline")
  await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Offline")
  mock.error = null
  await render()
  expect(container.textContent).toContain("unavailable")
  mock.data = {
    orchestration: { taskId: "other", projectId: "p" },
    sharedWorktrees: { groups: [], unknown: [] },
  }
  await render()
  expect(container.textContent).toContain("unavailable")
  mock.data.orchestration = { taskId: "t", projectId: "other" }
  await render()
  expect(container.textContent).toContain("unavailable")
  mock.data.orchestration = { taskId: "t", projectId: "p" }
  await render()
  expect(container.textContent).toContain("No potential overlap was reported")
  expect(container.textContent).toContain("External writes and exclusive access are not verified")
  await act(async () => container.querySelector("button")!.click())
  expect(mock.refetch).toHaveBeenCalledOnce()
  expect(mock.query).toHaveBeenLastCalledWith(
    { taskId: "t" },
    { refetchInterval: 5000, refetchIntervalInBackground: false },
  )
})
it("reuses qualified warning and exact navigation with long-path wrapping and unknown evidence", async () => {
  const run = {
    agentId: "a",
    runId: "run-exact",
    chatId: "chat-exact",
    name: "Source",
    access: "may-edit",
  }
  mock.data = {
    orchestration: { taskId: "t", projectId: "p" },
    sharedWorktrees: {
      groups: [{ path: "C:/" + "long-path/".repeat(20), runs: [run] }],
      unknown: [{ ...run, runId: "unknown-run", name: "Other" }],
    },
  }
  await render()
  const advisory = container.querySelector('[aria-label="Shared worktree advisory"]')!
  expect(advisory.textContent).toContain("not confirmed writes or an exclusive lock")
  expect(advisory.textContent).toContain("May edit")
  expect(advisory.textContent).toContain("overlap could not be checked")
  expect(advisory.querySelector("code")?.classList.contains("break-all")).toBe(true)
  const target = advisory.querySelector(
    '[aria-label="Open Source, run run-exact"]',
  ) as HTMLButtonElement
  expect(target.classList.contains("whitespace-normal")).toBe(true)
  await act(async () => target.click())
  expect(navigate).toHaveBeenCalledWith("chat-exact")
})

vi.mock("../src/renderer/features/agents/ui/worktree-declarations-panel", () => ({
  WorktreeDeclarationsPanel: () => null,
}))
