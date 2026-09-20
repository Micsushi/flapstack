// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({
  register: vi.fn(),
  refresh: vi.fn(),
  project: { id: "project", name: "My project" },
}))
vi.mock("jotai", async (original) => ({
  ...(await original<typeof import("jotai")>()),
  useAtomValue: () => state.project,
}))
vi.mock("../src/renderer/features/plan/plan-kanban-dev-fixtures", () => ({
  PlanKanbanDevFixtures: () => null,
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    planSources: {
      refresh: { useQuery: () => ({ data: null, refetch: state.refresh }) },
      sourceLinks: { useQuery: () => ({ data: [], refetch: vi.fn() }) },
      watch: { useSubscription: vi.fn() },
      registerMarkdown: { useMutation: () => ({ mutateAsync: state.register, isPending: false }) },
    },
    external: { openFileInEditor: { useMutation: () => ({ mutate: vi.fn() }) } },
  },
}))
import { PlanView } from "../src/renderer/features/plan/plan-view"
globalThis.IS_REACT_ACT_ENVIRONMENT = true
it("registers from the empty Plan view, retains rejected paths, and refreshes after success", async () => {
  state.register
    .mockRejectedValueOnce(new Error("File must be inside the project"))
    .mockResolvedValueOnce({})
  state.refresh.mockResolvedValue({ data: null })
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const click = async (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (node) => node.textContent === label,
    )!
    await act(async () => button.click())
  }
  try {
    await act(async () => root.render(<PlanView />))
    expect(container.textContent).toContain("No plan sources found")
    expect(container.textContent).not.toContain("creates a reviewed task and chat")
    await click("Add Markdown plan")
    const input = document.querySelector<HTMLInputElement>('input[placeholder="docs/plan.md"]')!
    expect(input.parentElement?.textContent).toContain("Path relative to My project")
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "docs/plan.md",
      )
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await click("Add plan")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("inside the project")
    expect(input.value).toBe("docs/plan.md")
    expect(state.refresh).not.toHaveBeenCalled()
    await click("Add plan")
    expect(state.register).toHaveBeenLastCalledWith({
      projectId: "project",
      relativePath: "docs/plan.md",
    })
    expect(state.refresh).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click("Add Markdown plan")
    expect(
      document.querySelector<HTMLInputElement>('input[placeholder="docs/plan.md"]')?.value,
    ).toBe("")
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it("ignores registration completion after switching projects", async () => {
  vi.clearAllMocks()
  let complete!: (value: object) => void
  state.register.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<PlanView />))
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((node) => node.textContent === "Add Markdown plan")!
        .click(),
    )
    const input = document.querySelector<HTMLInputElement>('input[placeholder="docs/plan.md"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "docs/plan.md",
      )
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    )
    state.project = { id: "other", name: "Other project" }
    await act(async () => root.render(<PlanView />))
    await act(async () => complete({}))
    expect(state.refresh).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain("Other project")
  } finally {
    state.project = { id: "project", name: "My project" }
    await act(async () => root.unmount())
    container.remove()
  }
})
