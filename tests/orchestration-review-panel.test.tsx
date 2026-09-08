// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { OrchestrationReviewPanel } from "../src/renderer/features/agents/ui/orchestration-review-panel"
const mock = vi.hoisted(() => ({
  members: [
    {
      agentId: "agent-source",
      runId: "source-run",
      name: "Source",
      role: "Worker",
      status: "completed",
      runStatus: "success",
      chatId: "source-chat",
      subChatId: "source-sub",
    },
    {
      agentId: "agent-reviewer",
      runId: "reviewer-run",
      name: "Reviewer",
      role: "Reviewer",
      status: "completed",
      runStatus: "success",
      chatId: "reviewer-chat",
      subChatId: "reviewer-sub",
    },
  ],
  reviews: [] as any[],
  listeners: new Set<() => void>(),
  actions: [] as any[],
  set: vi.fn(),
  restore: vi.fn(),
  invalidate: vi.fn(),
  fail: false,
}))
vi.mock("../src/renderer/lib/app-action-history", () => ({
  recordAppAction: (action: unknown) => mock.actions.push(action),
}))
vi.mock("../src/renderer/lib/trpc", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    trpcClient: {
      orchestrationOperations: {
        setReview: { mutate: mock.set },
        restoreReview: { mutate: mock.restore },
      },
    },
    trpc: {
      useUtils: () => ({
        orchestrationOperations: { reviewState: { invalidate: mock.invalidate } },
      }),
      orchestrationOperations: {
        reviewState: {
          useQuery: () => {
            const reviews = useSyncExternalStore(
              (callback) => {
                mock.listeners.add(callback)
                return () => mock.listeners.delete(callback)
              },
              () => mock.reviews,
            )
            return { data: { members: mock.members, reviews }, isLoading: false }
          },
        },
      },
    },
  }
})
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const publish = (row: any) => {
  mock.reviews = [row]
  mock.listeners.forEach((listener) => listener())
}
let container: HTMLDivElement, root: ReturnType<typeof createRoot>
const render = (taskId = "task-a") =>
  root.render(
    <OrchestrationReviewPanel
      key={taskId}
      projectId="project"
      taskId={taskId}
      onNavigate={vi.fn()}
    />,
  )
const select = async (label: string, value: string) =>
  act(async () => {
    const node = container.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement
    node.value = value
    node.dispatchEvent(new Event("change", { bubbles: true }))
  })
const evidence = async (value: string) =>
  act(async () => {
    const node = container.querySelector("textarea")!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value)
    node.dispatchEvent(new Event("input", { bubbles: true }))
  })
const click = async (label: string) =>
  act(async () => {
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === label,
    )
    expect(button, label).toBeTruthy()
    button!.click()
  })
beforeEach(async () => {
  mock.reviews = []
  mock.actions = []
  mock.fail = false
  mock.members[1]!.runStatus = "success"
  const snapshots = new Map<number, any>([[0, null]])
  mock.invalidate.mockReset().mockResolvedValue(undefined)
  mock.set.mockReset().mockImplementation(async (input) => {
    if (mock.fail || input.expectedRevision !== (mock.reviews[0]?.revision ?? 0))
      throw new Error("Review changed elsewhere")
    snapshots.set(input.expectedRevision, mock.reviews[0]?.review ?? null)
    const row = {
      sourceRunId: input.sourceRunId,
      revision: input.expectedRevision + 1,
      review: input.review ? { ...input.review, attribution: "manual", recordedAt: 1 } : null,
    }
    snapshots.set(row.revision, row.review)
    publish(row)
    return row
  })
  mock.restore.mockReset().mockImplementation(async (input) => {
    if (input.expectedRevision !== mock.reviews[0]?.revision)
      throw new Error("Review changed elsewhere")
    const row = {
      sourceRunId: input.sourceRunId,
      revision: input.expectedRevision + 1,
      review: snapshots.get(input.targetRevision),
    }
    snapshots.set(row.revision, row.review)
    publish(row)
    return row
  })
  window.localStorage.clear()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  await act(async () => render())
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
it("never infers pass from completed reviewer role, and gates pass on actual terminal runs", async () => {
  mock.members[1]!.runStatus = "running"
  await select("Review source run", "source-run")
  expect(container.querySelector('[aria-label="Saved run review"]')?.textContent).toBe("Unreviewed")
  await select("Reviewer run", "reviewer-run")
  expect((container.querySelector('option[value="pass"]') as HTMLOptionElement).disabled).toBe(true)
  await select("Review verdict", "needs-work")
  await evidence("Still checking output")
  await click("Save verdict")
  expect(mock.set).toHaveBeenCalledWith({
    projectId: "project",
    taskId: "task-a",
    sourceRunId: "source-run",
    expectedRevision: 0,
    review: {
      reviewerRunId: "reviewer-run",
      verdict: "needs-work",
      evidence: "Still checking output",
    },
  })
  expect(container.textContent).toContain("Needs work")
  expect(container.textContent).toContain("reviewer-run")
  expect(mock.members[0]!.runStatus).toBe("success")
})
it("retains failed evidence drafts across task switches without replacing the saved verdict", async () => {
  await select("Review source run", "source-run")
  await select("Reviewer run", "reviewer-run")
  await select("Review verdict", "inconclusive")
  await evidence("Draft evidence A")
  mock.fail = true
  await click("Save verdict")
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "Review changed elsewhere",
  )
  await act(async () => render("task-b"))
  expect(container.querySelector("textarea")).toBeNull()
  await act(async () => render())
  expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
    "Draft evidence A",
  )
  expect(container.querySelector('[aria-label="Saved run review"]')?.textContent).toBe("Unreviewed")
})
it("records durable save/remove with CAS-aware shared undo and redo", async () => {
  await select("Review source run", "source-run")
  await select("Reviewer run", "reviewer-run")
  await select("Review verdict", "pass")
  await evidence("Verified evidence")
  await click("Save verdict")
  expect(mock.actions[0].label).toBe("Save run review")
  await act(async () => mock.actions[0].undo())
  expect(mock.restore).toHaveBeenLastCalledWith({
    projectId: "project",
    taskId: "task-a",
    sourceRunId: "source-run",
    expectedRevision: 1,
    targetRevision: 0,
  })
  expect(container.querySelector('[aria-label="Saved run review"]')?.textContent).toBe("Unreviewed")
  await act(async () => mock.actions[0].redo())
  expect(mock.restore).toHaveBeenLastCalledWith({
    projectId: "project",
    taskId: "task-a",
    sourceRunId: "source-run",
    expectedRevision: 2,
    targetRevision: 1,
  })
  await click("Remove saved verdict")
  expect(mock.set.mock.calls.at(-1)?.[0].review).toBeNull()
  expect(mock.actions.at(-1).label).toBe("Remove run review")
  expect(container.querySelector('[aria-label="Saved run review"]')?.textContent).toBe("Unreviewed")
})

it("supports consecutive own undo/redo across remounts, with best-effort postcommit refresh", async () => {
  await select("Review source run", "source-run")
  await select("Reviewer run", "reviewer-run")
  await select("Review verdict", "pass")
  await evidence("Evidence A")
  await click("Save verdict")
  await evidence("Evidence B")
  await click("Revise verdict")
  await act(async () => render("task-b"))
  await act(async () => render())
  mock.invalidate.mockRejectedValue(new Error("Refresh unavailable"))
  await act(async () => mock.actions[1].undo())
  await act(async () => mock.actions[0].undo())
  expect(
    mock.restore.mock.calls.map((call) => [call[0].expectedRevision, call[0].targetRevision]),
  ).toEqual([
    [2, 1],
    [3, 0],
  ])
  expect(mock.reviews[0].review).toBeNull()
  await act(async () => mock.actions[0].redo())
  await act(async () => mock.actions[1].redo())
  expect(
    mock.restore.mock.calls
      .slice(-2)
      .map((call) => [call[0].expectedRevision, call[0].targetRevision]),
  ).toEqual([
    [4, 1],
    [5, 2],
  ])
  expect(mock.reviews[0].review.evidence).toBe("Evidence B")
  await evidence("Evidence C")
  await click("Revise verdict")
  expect(mock.reviews[0].review.evidence).toBe("Evidence C")
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
it("refuses external CAS conflicts and cannot undo through a later external state", async () => {
  await select("Review source run", "source-run")
  await select("Reviewer run", "reviewer-run")
  await select("Review verdict", "pass")
  await evidence("Own A")
  await click("Save verdict")
  await act(async () =>
    publish({
      sourceRunId: "source-run",
      revision: 2,
      review: {
        reviewerRunId: "reviewer-run",
        verdict: "inconclusive",
        evidence: "External result",
        attribution: "manual",
        recordedAt: 2,
      },
    }),
  )
  await act(async () => {
    await expect(mock.actions[0].undo()).rejects.toThrow("Review changed elsewhere")
  })
  expect(mock.reviews[0].review.evidence).toBe("External result")
  await evidence("Own B after external result")
  await click("Revise verdict")
  await act(async () => mock.actions[1].undo())
  expect(mock.reviews[0].review.evidence).toBe("External result")
  const calls = mock.restore.mock.calls.length
  await act(async () => {
    await expect(mock.actions[0].undo()).rejects.toThrow(
      "Review history changed outside this action",
    )
  })
  expect(mock.restore.mock.calls.length).toBe(calls)
})
