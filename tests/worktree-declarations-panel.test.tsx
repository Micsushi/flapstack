// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { WorktreeDeclarationsPanel } from "../src/renderer/features/agents/ui/worktree-declarations-panel"
import {
  clearAppActionHistory,
  undoAppAction,
  redoAppAction,
} from "../src/renderer/lib/app-action-history"
const flags = vi.hoisted(() => ({ orchestration: true }))
vi.mock("../src/renderer/features/settings/use-beta-features", () => ({
  useBetaFeatures: () => flags,
}))
const mock = vi.hoisted(() => ({
  data: null as any,
  listeners: new Set<() => void>(),
  set: vi.fn(),
  restore: vi.fn(),
  invalidate: vi.fn(),
  snapshots: [] as any[],
  revision: 0,
  external: false,
}))
vi.mock("../src/renderer/lib/trpc", async () => {
  const { useSyncExternalStore } = await import("react")
  return {
    trpcClient: {
      orchestrationOperations: {
        setWorktreeDeclaration: { mutate: mock.set },
        restoreWorktreeDeclaration: { mutate: mock.restore },
      },
    },
    trpc: {
      useUtils: () => ({
        orchestrationOperations: { worktreeDeclarationState: { invalidate: mock.invalidate } },
      }),
      orchestrationOperations: {
        worktreeDeclarationState: {
          useQuery: () => ({
            data: useSyncExternalStore(
              (callback) => {
                mock.listeners.add(callback)
                return () => mock.listeners.delete(callback)
              },
              () => mock.data,
            ),
            isLoading: false,
          }),
        },
      },
    },
  }
})
let container: HTMLDivElement, root: Root
const navigate = vi.fn()
const member = {
  agentId: "agent",
  runId: "run",
  chatId: "chat",
  subChatId: "pane",
  name: "Worker",
  runStatus: "pending",
  worktreePath: "C:/shared",
  eligible: true,
  reason: null,
}
function publish(declaration: any) {
  mock.revision++
  mock.snapshots[mock.revision] = declaration
  mock.data = {
    ...mock.data,
    declarations: [
      {
        runId: "run",
        taskId: "task",
        revision: mock.revision,
        declaration,
        activity: declaration ? "active" : "released",
      },
    ],
  }
  mock.listeners.forEach((fn) => fn())
  return { runId: "run", revision: mock.revision, declaration }
}
beforeEach(() => {
  flags.orchestration = true
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  localStorage.clear()
  clearAppActionHistory()
  mock.revision = 0
  mock.snapshots = [null]
  mock.external = false
  mock.data = {
    observedAt: 1,
    scope: "project",
    advisoryOnly: true,
    members: [member],
    declarations: [],
    conflicts: [],
  }
  mock.set.mockReset()
  mock.restore.mockReset()
  mock.invalidate.mockReset().mockResolvedValue(undefined)
  navigate.mockClear()
  mock.set.mockImplementation(async (input: any) => {
    if (mock.external || input.expectedRevision !== mock.revision)
      throw new Error("Revision conflict")
    return publish(
      input.intent
        ? {
            agentId: "agent",
            chatId: "chat",
            subChatId: "pane",
            worktreePath: "C:/shared",
            intent: input.intent,
            recordedAt: 1,
            attribution: "manual",
          }
        : null,
    )
  })
  mock.restore.mockImplementation(async (input: any) => {
    if (mock.external || input.expectedRevision !== mock.revision)
      throw new Error("Revision conflict")
    return publish(mock.snapshots[input.targetRevision])
  })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function render(taskId = "task") {
  await act(async () =>
    root.render(
      <WorktreeDeclarationsPanel
        key={taskId}
        projectId="project"
        taskId={taskId}
        onNavigate={navigate}
      />,
    ),
  )
}
async function select(label: string, value: string) {
  await act(async () => {
    const node = container.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement
    node.value = value
    node.dispatchEvent(new Event("change", { bubbles: true }))
  })
}
async function click(label: string) {
  await act(async () => {
    ;[...container.querySelectorAll("button")].find((b) => b.textContent === label)!.click()
  })
}
it("records read/write and consecutive chronological undo/redo, releases and restores after remount", async () => {
  await render()
  await select("Declaration run", "run")
  await click("Save declaration")
  await select("Declared intent", "write")
  await click("Save declaration")
  expect(mock.revision).toBe(2)
  await act(async () => {
    await undoAppAction()
    await undoAppAction()
    await redoAppAction()
    await redoAppAction()
  })
  expect(mock.revision).toBe(6)
  expect(mock.data.declarations[0].declaration.intent).toBe("write")
  await click("Release declaration")
  expect(mock.data.declarations[0].declaration).toBeNull()
  await render("other")
  await render()
  await act(async () => {
    await undoAppAction()
  })
  expect(mock.revision).toBe(8)
  expect(mock.data.declarations[0].declaration.intent).toBe("write")
  expect(
    (container.querySelector('[aria-label="Declared intent"]') as HTMLSelectElement).value,
  ).toBe("write")
  await click("Open selected run")
  expect(navigate).toHaveBeenCalledWith("chat")
})
it("retains intent on stale CAS and refuses shared undo over an external write", async () => {
  await render()
  await select("Declaration run", "run")
  await click("Save declaration")
  await select("Declared intent", "write")
  mock.external = true
  await click("Save declaration")
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Revision conflict")
  expect(
    (container.querySelector('[aria-label="Declared intent"]') as HTMLSelectElement).value,
  ).toBe("write")
  await expect(undoAppAction()).rejects.toThrow("Revision conflict")
  expect(mock.revision).toBe(1)
})
it("renders projectwide conflicts and inactive histories honestly; refresh failure does not replay committed action", async () => {
  mock.data = {
    ...mock.data,
    conflicts: [
      {
        worktreePath: "C:/shared",
        runs: [
          { taskId: "task", runId: "run", intent: "write" },
          { taskId: "other", runId: "other-run", intent: "read" },
        ],
      },
    ],
    declarations: [
      {
        taskId: "other",
        runId: "old",
        revision: 1,
        activity: "terminal",
        declaration: { chatId: "old-chat", worktreePath: "C:/shared", intent: "write" },
      },
    ],
  }
  await render()
  expect(container.textContent).toContain("Potential conflicts across this project")
  expect(container.textContent).toContain("task other")
  expect(container.textContent).toContain("(terminal)")
  await act(async () => {
    ;(container.querySelector('[aria-label="Open declared run old"]') as HTMLButtonElement).click()
  })
  expect(navigate).toHaveBeenCalledWith("old-chat")
  await select("Declaration run", "run")
  mock.invalidate.mockRejectedValue(new Error("Refresh offline"))
  await click("Save declaration")
  await act(async () => {
    await undoAppAction()
  })
  expect(mock.revision).toBe(2)
  expect(mock.restore).toHaveBeenCalledOnce()
})

it("hides declaration controls when orchestration visibility is disabled", async () => {
  flags.orchestration = false
  await render()
  expect(container.querySelector('[aria-label="Worktree declarations"]')).toBeNull()
})
